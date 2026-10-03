//! Freundescodes und ihre Hello-Endpunkte (SPEC 4.2, 4.3, 5.2): Codes erzeugen, auflisten und widerrufen; je aktivem
//! Code ein Endpunkt nur am Relay des Codes, der Anfragen mit dem richtigen Geheimnis annimmt und Fremden nichts
//! verrät. Dazu die Gegenseite: die Anfrage an den Hello-Endpunkt eines eingelösten Codes.
use std::str::FromStr;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use data_encoding::HEXLOWER;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::time::{timeout, Instant};

use super::code::{self, secret_matches};
use super::contract::{FriendCode, CODE_TTL_SECS, MAX_ACTIVE_CODES};
use super::control::{signature_bytes, WireProfile, PROTOCOL_VERSION};
use super::events::FriendsEvent;
use super::identity::{self, Identity};
use super::limits::{SlidingWindow, HELLO_FRAME_LIMIT, HELLO_PER_CODE, HELLO_PER_PEER_AND_CODE};
use super::records::CodeRecord;
use super::requests;
use super::service::{hello_net_config, now_secs, Core, Friends, Runtime};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::new_id;
use crate::services::lock;
use crate::services::p2p::{frame, Admission, BiStream, CloseCode, FrameError, Gate, PeerConn, PeerId, PeerNet};

pub const HELLO_ALPN: &[u8] = b"pumpkin/hello/1";
/// Die Unterschrift des Code-Besitzers bindet seine dauerhafte ID an den Hello-Schlüssel des Codes.
const BIND_DOMAIN: &[u8] = b"pumpkin/bind/1";
/// Anfrage und Antwort am Hello-Endpunkt (SPEC 5.1).
const HELLO_WAIT: Duration = Duration::from_secs(10);

/// Anfrage des Eingeladenen an den Hello-Endpunkt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum HelloRequest {
    FriendRequest {
        protocol: u32,
        secret: String,
        profile: WireProfile,
    },
    #[serde(other)]
    Unknown,
}

/// Antwort des Code-Besitzers; bei falschem Geheimnis gibt es keine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum HelloAnswer {
    Received { peer_id: String, binding: String, profile: WireProfile },
    Error { code: HelloRefusal },
}

/// Warum der Code-Besitzer eine Anfrage mit richtigem Geheimnis ablehnt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum HelloRefusal {
    CodeUsed,
    AlreadyFriends,
    Full,
    Unsupported,
}

/// Ergebnis einer Anfrage an einen Hello-Endpunkt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Delivery {
    /// Angekommen; die ID ist durch die Unterschrift belegt, das Profil bereinigt.
    Received {
        peer: PeerId,
        profile: WireProfile,
    },
    Refused(HelloRefusal),
    /// Keine (gültige) Antwort: Besitzer offline, Code abgelaufen oder Geheimnis falsch.
    Failed,
}

impl Friends {
    /// Neuer Code am Heim-Relay; der Klartext steht nur in dieser Antwort.
    pub async fn code_create(&self) -> AppResult<FriendCode> {
        let core = &self.core;
        core.ensure_enabled()?;
        if active_codes(core).len() >= MAX_ACTIVE_CODES {
            return Err(AppError::invalid(coded!("errors.friends.tooManyCodes", max = MAX_ACTIVE_CODES)));
        }
        let identity = core.identity().ok_or_else(|| AppError::invalid(coded!("errors.friends.identityLost")))?;
        let relay_index = code_relay(core)?;
        let issued = code::issue(&identity, relay_index)?;
        let now = now_secs();
        let record = CodeRecord {
            id: new_id(),
            salt: HEXLOWER.encode(&issued.salt),
            secret_sha256: issued.parts.secret_digest(),
            relay_index,
            tail: issued.parts.tail(),
            created_at: now,
            expires_at: now + CODE_TTL_SECS,
            used_by: None,
        };
        core.stores.codes.insert(record.clone())?;
        if let Some(runtime) = core.runtime() {
            bind_code(core, &runtime, &record).await;
        }
        core.emit(FriendsEvent::Changed);
        Ok(FriendCode { code: Some(issued.parts.encode()), ..code_view(&record) })
    }

    pub async fn codes(&self) -> AppResult<Vec<FriendCode>> {
        self.core.ensure_enabled()?;
        Ok(active_codes(&self.core).iter().map(code_view).collect())
    }

    /// Widerruft den Code; sein Hello-Endpunkt geht sofort zu.
    pub async fn code_revoke(&self, code_id: &str) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        core.stores.codes.remove(code_id)?;
        if let Some(runtime) = core.runtime() {
            close_code(&runtime, code_id).await;
        }
        core.emit(FriendsEvent::Changed);
        Ok(())
    }
}

/// Bindet die Hello-Endpunkte aller noch gültigen Codes.
pub(super) async fn bind_active_codes(core: &Arc<Core>, runtime: &Arc<Runtime>) {
    for record in active_codes(core) {
        bind_code(core, runtime, &record).await;
    }
}

pub(super) async fn close_code(runtime: &Runtime, code_id: &str) {
    let endpoint = lock(&runtime.hellos).remove(code_id);
    if let Some(endpoint) = endpoint {
        endpoint.close(CloseCode::SHUTDOWN).await;
    }
}

pub(super) async fn close_all(runtime: &Runtime) {
    let endpoints: Vec<_> = lock(&runtime.hellos).drain().map(|(_, endpoint)| endpoint).collect();
    for endpoint in endpoints {
        endpoint.close(CloseCode::SHUTDOWN).await;
    }
}

/// Codes sind aus dem Schlüssel abgeleitet; nach einem neuen Schlüssel taugen sie nichts mehr (SPEC 4.6).
pub(super) fn delete_all_codes(core: &Core) -> AppResult<()> {
    for record in core.stores.codes.list() {
        core.stores.codes.remove(&record.id)?;
    }
    Ok(())
}

/// Codes, deren Gültigkeit noch läuft, eingelöst oder nicht.
pub(super) fn active_codes(core: &Core) -> Vec<CodeRecord> {
    let now = now_secs();
    core.stores.codes.list().into_iter().filter(|record| record.expires_at > now).collect()
}

/// Hello-IDs der eigenen gültigen Codes, damit niemand seinen eigenen Code einlöst.
pub(super) fn own_hello_ids(core: &Core, identity: &Identity) -> Vec<[u8; 32]> {
    active_codes(core).iter().filter_map(|record| salt_of(record).map(|salt| identity.hello_id(&salt))).collect()
}

/// Stellt die Anfrage an den Hello-Endpunkt `hello_id` und prüft die Unterschrift der Antwort (SPEC 5.2).
pub(super) async fn send_request(net: &PeerNet, hello_id: PeerId, secret_hex: &str, profile: WireProfile) -> Delivery {
    let Ok(conn) = net.dial(&hello_id, HELLO_ALPN).await else { return Delivery::Failed };
    let request = HelloRequest::FriendRequest { protocol: PROTOCOL_VERSION, secret: secret_hex.to_owned(), profile };
    let answer = timeout(HELLO_WAIT, exchange(&conn, &request)).await;
    conn.close(CloseCode::NORMAL);
    match answer {
        Ok(Ok(answer)) => evaluate(answer, &hello_id, &net.id()),
        Ok(Err(err)) => {
            tracing::debug!(%err, "keine Antwort vom Hello-Endpunkt");
            Delivery::Failed
        }
        Err(_) => Delivery::Failed,
    }
}

async fn exchange(conn: &PeerConn, request: &HelloRequest) -> Result<HelloAnswer, FrameError> {
    let mut stream = conn.open_bi().await.map_err(|err| FrameError::Io(std::io::Error::other(err)))?;
    frame::write(&mut stream, request, HELLO_FRAME_LIMIT).await?;
    stream.read_frame(HELLO_FRAME_LIMIT).await
}

fn evaluate(answer: HelloAnswer, hello_id: &PeerId, own_id: &PeerId) -> Delivery {
    match answer {
        HelloAnswer::Received { peer_id, binding, profile } => {
            let bound = signature_bytes(&binding).is_some_and(|signature| {
                identity::verify(&peer_id, BIND_DOMAIN, &[hello_id.as_bytes(), own_id.as_bytes()], &signature)
            });
            match PeerId::from_str(&peer_id) {
                Ok(peer) if bound => Delivery::Received { peer, profile: profile.sanitized(&peer_id) },
                _ => Delivery::Failed,
            }
        }
        HelloAnswer::Error { code } => Delivery::Refused(code),
    }
}

/// Codes liegen am Heim-Relay; vor dem ersten Kontakt am ersten Relay der Karte.
fn code_relay(core: &Core) -> AppResult<u8> {
    let home = core.runtime().and_then(|runtime| runtime.main.home_relay());
    home.or_else(|| core.options.relay_map.first().map(|entry| entry.index))
        .ok_or_else(|| AppError::invalid(coded!("errors.friends.networkUnavailable")))
}

fn code_view(record: &CodeRecord) -> FriendCode {
    FriendCode {
        id: record.id.clone(),
        code: None,
        tail: record.tail.clone(),
        created_at: record.created_at,
        expires_at: record.expires_at,
        used: record.used_by.is_some(),
    }
}

fn salt_of(record: &CodeRecord) -> Option<[u8; 16]> {
    HEXLOWER.decode(record.salt.as_bytes()).ok()?.try_into().ok()
}

async fn bind_code(core: &Arc<Core>, runtime: &Arc<Runtime>, record: &CodeRecord) {
    let Some(salt) = salt_of(record) else {
        tracing::warn!(code = %record.id, "Code ohne gültiges Salz, kein Hello-Endpunkt");
        return;
    };
    let config = hello_net_config(&core.options, &runtime.identity, &salt, record.relay_index);
    let gate = Arc::new(HelloGate::new(Arc::downgrade(core)));
    let endpoint = match PeerNet::bind(config, gate).await {
        Ok(endpoint) => Arc::new(endpoint),
        Err(err) => {
            tracing::warn!(%err, "Hello-Endpunkt nicht gebunden");
            return;
        }
    };
    lock(&runtime.hellos).insert(record.id.clone(), endpoint.clone());
    let serve = serve_endpoint(core.clone(), runtime.clone(), endpoint, record.id.clone());
    tokio::spawn(runtime.stop.clone().run_until_cancelled_owned(serve));
}

async fn serve_endpoint(core: Arc<Core>, runtime: Arc<Runtime>, endpoint: Arc<PeerNet>, code_id: String) {
    while let Some((_, conn)) = endpoint.accept().await {
        let answer = answer_request(core.clone(), runtime.clone(), endpoint.id(), code_id.clone(), conn);
        tokio::spawn(runtime.stop.clone().run_until_cancelled_owned(answer));
    }
}

/// Beantwortet eine Anfrage am Hello-Endpunkt. Falsches Geheimnis, abgelaufener Code: kein Rahmen, nur Schließen.
async fn answer_request(core: Arc<Core>, runtime: Arc<Runtime>, hello_id: PeerId, code_id: String, conn: PeerConn) {
    let read = timeout(HELLO_WAIT, read_request(&conn)).await;
    let (mut stream, request) = match read {
        Ok(Ok(read)) => read,
        Ok(Err(err)) => {
            tracing::debug!(%err, "Anfrage am Hello-Endpunkt unlesbar");
            return conn.close(CloseCode::PROTOCOL);
        }
        Err(_) => return conn.close(CloseCode::PROTOCOL),
    };
    let Some(answer) = decide(&core, &runtime.identity, &hello_id, &code_id, &conn.remote(), request) else {
        return conn.close(CloseCode::NORMAL);
    };
    if frame::write(&mut stream, &answer, HELLO_FRAME_LIMIT).await.is_ok() {
        let _ = stream.shutdown().await;
        let _ = timeout(HELLO_WAIT, conn.closed()).await;
    }
    conn.close(CloseCode::NORMAL);
}

async fn read_request(conn: &PeerConn) -> Result<(BiStream, HelloRequest), FrameError> {
    let mut stream = conn.accept_bi().await.map_err(|err| FrameError::Io(std::io::Error::other(err)))?;
    let request = stream.read_frame(HELLO_FRAME_LIMIT).await?;
    Ok((stream, request))
}

/// Die Antwort auf eine Anfrage; `None` heißt Schweigen (falsches Geheimnis oder kein gültiger Code mehr).
fn decide(
    core: &Core,
    identity: &Identity,
    hello_id: &PeerId,
    code_id: &str,
    peer: &PeerId,
    request: HelloRequest,
) -> Option<HelloAnswer> {
    let HelloRequest::FriendRequest { protocol: PROTOCOL_VERSION, secret, profile } = request else {
        return Some(HelloAnswer::Error { code: HelloRefusal::Unsupported });
    };
    let code = core.stores.codes.get(code_id).ok().filter(|code| code.expires_at > now_secs())?;
    if !secret_matches(&code.secret_sha256, &secret) {
        return None;
    }
    let peer_id = peer.to_string();
    Some(match requests::receive(core, &code, &peer_id, profile.sanitized(&peer_id)) {
        Ok(()) => HelloAnswer::Received {
            peer_id: identity.peer_id(),
            binding: HEXLOWER.encode(&identity.sign(BIND_DOMAIN, &[hello_id.as_bytes(), peer.as_bytes()])),
            profile: core.own_profile(),
        },
        Err(refusal) => HelloAnswer::Error { code: refusal },
    })
}

/// Lässt am Hello-Endpunkt alle zu, außer Gesperrten und wer die Grenzen je Code überschreitet; die werden ohne Grund
/// geschlossen (SPEC 3.5, 12.4). Das Geheimnis prüft erst der erste Rahmen.
struct HelloGate {
    core: Weak<Core>,
    limits: Mutex<HelloLimits>,
}

struct HelloLimits {
    per_code: SlidingWindow<()>,
    per_peer: SlidingWindow<PeerId>,
}

impl HelloGate {
    fn new(core: Weak<Core>) -> Self {
        let limits = HelloLimits {
            per_code: SlidingWindow::new(HELLO_PER_CODE),
            per_peer: SlidingWindow::new(HELLO_PER_PEER_AND_CODE),
        };
        Self { core, limits: Mutex::new(limits) }
    }

    fn within_limits(&self, peer: &PeerId) -> bool {
        let mut limits = lock(&self.limits);
        let now = Instant::now();
        limits.per_code.try_hit((), now) && limits.per_peer.try_hit(*peer, now)
    }
}

impl Gate for HelloGate {
    fn admit(&self, peer: &PeerId, _alpn: &[u8]) -> Admission {
        let blocked = self.core.upgrade().is_none_or(|core| core.stores.blocked.get(&peer.to_string()).is_ok());
        if blocked || !self.within_limits(peer) {
            Admission::Drop
        } else {
            Admission::Accept
        }
    }
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;
    use serde_json::json;

    use super::*;

    fn peer(seed: u8) -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[seed; 32]).public())
    }

    fn profile() -> WireProfile {
        WireProfile { display_name: "Alex".into(), mc_name: None, mc_uuid: None }
    }

    #[test]
    fn friend_request_has_the_wire_shape() {
        let request = HelloRequest::FriendRequest { protocol: 1, secret: "a0".repeat(9), profile: profile() };

        let wire = serde_json::to_value(request).unwrap();

        assert_eq!(wire["type"], "friendRequest");
        assert_eq!(wire["secret"], "a0".repeat(9));
        assert_eq!(wire["profile"]["displayName"], "Alex");
    }

    #[test]
    fn refusal_has_the_wire_shape() {
        let wire = serde_json::to_value(HelloAnswer::Error { code: HelloRefusal::AlreadyFriends }).unwrap();

        assert_eq!(wire, json!({ "type": "error", "code": "alreadyFriends" }));
    }

    #[test]
    fn received_answer_counts_only_with_the_owner_binding() {
        let owner = Identity::generate();
        let (hello_id, invitee) = (peer(1), peer(2));
        let binding = owner.sign(BIND_DOMAIN, &[hello_id.as_bytes(), invitee.as_bytes()]);
        let answer = |binding: &[u8; 64]| HelloAnswer::Received {
            peer_id: owner.peer_id(),
            binding: HEXLOWER.encode(binding),
            profile: profile(),
        };

        let delivered = evaluate(answer(&binding), &hello_id, &invitee);
        let forged = evaluate(answer(&[0; 64]), &hello_id, &invitee);
        let for_someone_else = evaluate(answer(&binding), &hello_id, &peer(3));

        let owner_id = PeerId::from_str(&owner.peer_id()).unwrap();
        assert_eq!(delivered, Delivery::Received { peer: owner_id, profile: profile() });
        assert_eq!((forged, for_someone_else), (Delivery::Failed, Delivery::Failed));
    }

    #[tokio::test(start_paused = true)]
    async fn hello_gate_counts_three_per_peer_and_ten_per_code() {
        let gate = HelloGate::new(Weak::new());
        let in_limits: Vec<bool> = (0..4).map(|_| gate.within_limits(&peer(1))).collect();
        assert_eq!(in_limits, [true, true, true, false]);

        let others: Vec<bool> = (2..10).map(|seed| gate.within_limits(&peer(seed))).collect();

        assert_eq!(others.iter().filter(|admitted| **admitted).count(), 6, "ten per code, four already used");
    }
}
