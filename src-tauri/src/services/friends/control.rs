//! `pumpkin/peer/1` (SPEC 5.1, 5.3): Öffnungsrahmen, Steuernachrichten und die Steuerverbindung zu einem Freund.
//! Eingehende Nachrichten werden geprüft und ihre Fremdtexte bereinigt (SPEC 12.3), bevor der Dienst sie sieht;
//! Request- und Tunnel-Streams gehen an den [`super::PeerStreamHandler`].
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use data_encoding::HEXLOWER;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant};

use super::contract::{InstanceSummary, Presence, RevokeReason};
use super::limits::{SlidingWindow, CONTROL_FRAMES, CONTROL_FRAME_LIMIT, OPEN_FRAME_LIMIT, REQUEST_FRAME_LIMIT};
use super::service::{Core, Runtime};
use super::status::{self, Link, Registration, Target};
use super::{outbox, requests, sanitize};
use crate::services::p2p::{frame, BiStream, CloseCode, FrameError, NetError, PeerConn, PeerId};

/// Wartezeit auf den ersten Rahmen eines neuen Streams und auf den Austausch der `hello`s (SPEC 5.1).
const FIRST_FRAME_WAIT: Duration = Duration::from_secs(10);
/// So lange wartet, wer `unfriend` oder `identityRotated` schickt, auf das `ack`, und wer es bekam, auf das Schließen.
pub(super) const ACK_WAIT: Duration = Duration::from_secs(10);
/// Ausgehende Steuernachrichten, die auf das Schreiben warten.
const CONTROL_QUEUE: usize = 64;
/// So oft wird geprüft, ob die Verbindung den Weg gewechselt hat (Relay zu direkt).
const PATH_POLL: Duration = Duration::from_secs(5);

pub const PEER_ALPN: &[u8] = b"pumpkin/peer/1";
pub const PROTOCOL_VERSION: u32 = 1;

/// Erster Rahmen jedes Bi-Streams, vom Öffnenden gesendet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OpenFrame {
    /// Einer je Verbindung, vom Anwählenden geöffnet.
    Control,
    Request,
    Tunnel {
        session_id: String,
    },
    #[serde(other)]
    Unknown,
}

/// Das selbst angegebene Profil eines Launchers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireProfile {
    pub display_name: String,
    pub mc_name: Option<String>,
    pub mc_uuid: Option<String>,
}

impl WireProfile {
    /// Bereinigt; ein leerer Name wird zum Ersatznamen aus der Peer-ID.
    pub fn sanitized(&self, peer_id: &str) -> Self {
        Self {
            display_name: sanitize::display_name(&self.display_name, peer_id),
            mc_name: sanitize::mc_name(self.mc_name.as_deref()),
            mc_uuid: sanitize::mc_uuid(self.mc_uuid.as_deref()),
        }
    }
}

/// Das `invite`-Objekt einer Einladung (Host an Gast).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireInvite {
    pub id: String,
    pub session_id: String,
    pub world_name: Option<String>,
    pub instance: InstanceSummary,
    pub expires_at: u64,
}

/// Die Steuernachrichten der Sitzungen, die der Dienst an den [`super::PeerStreamHandler`] weiterreicht.
#[derive(Debug, Clone, PartialEq)]
pub enum SessionControl {
    Invite(WireInvite),
    InviteRevoke { invite_id: String, reason: RevokeReason },
    InviteDecline { invite_id: String },
}

/// Alle Nachrichten des Steuer-Streams, so wie sie auf der Leitung stehen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(super) enum ControlMessage {
    Hello {
        protocol: u32,
        #[serde(default)]
        features: Vec<String>,
        launcher: String,
        profile: WireProfile,
        /// Index in der Relay-Karte, nie eine URL.
        home_relay: Option<u8>,
    },
    Status {
        presence: Presence,
    },
    Profile {
        profile: WireProfile,
    },
    Invite {
        invite: WireInvite,
    },
    InviteRevoke {
        invite_id: String,
        reason: RevokeReason,
    },
    InviteDecline {
        invite_id: String,
    },
    Unfriend,
    IdentityRotated {
        new_peer_id: String,
        signature: String,
    },
    Ack,
    #[serde(other)]
    Unknown,
}

impl ControlMessage {
    pub(super) fn hello(profile: WireProfile, home_relay: Option<u8>) -> Self {
        Self::Hello {
            protocol: PROTOCOL_VERSION,
            features: Vec::new(),
            launcher: env!("CARGO_PKG_VERSION").to_owned(),
            profile,
            home_relay,
        }
    }
}

impl From<SessionControl> for ControlMessage {
    fn from(message: SessionControl) -> Self {
        match message {
            SessionControl::Invite(invite) => Self::Invite { invite },
            SessionControl::InviteRevoke { invite_id, reason } => Self::InviteRevoke { invite_id, reason },
            SessionControl::InviteDecline { invite_id } => Self::InviteDecline { invite_id },
        }
    }
}

/// Eine geprüfte, bereinigte Steuernachricht.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Incoming {
    Hello {
        profile: WireProfile,
        home_relay: Option<u8>,
    },
    Status(Presence),
    Profile(WireProfile),
    Session(SessionControl),
    Unfriend,
    IdentityRotated {
        new_peer_id: PeerId,
        signature: [u8; 64],
    },
    Ack,
    /// Unbekannter Typ aus einer neueren Version: wird ignoriert (SPEC 5.1).
    Unknown,
}

/// Eine Nachricht mit falsch geformter ID oder Signatur: ein Protokollfehler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Malformed;

/// Prüft und bereinigt eine Nachricht von `peer`.
pub(super) fn parse(message: ControlMessage, peer: &PeerId) -> Result<Incoming, Malformed> {
    let peer_id = peer.to_string();
    Ok(match message {
        ControlMessage::Hello { profile, home_relay, .. } => {
            Incoming::Hello { profile: profile.sanitized(&peer_id), home_relay }
        }
        ControlMessage::Status { presence } => Incoming::Status(presence),
        ControlMessage::Profile { profile } => Incoming::Profile(profile.sanitized(&peer_id)),
        ControlMessage::Invite { invite } => Incoming::Session(SessionControl::Invite(sanitized_invite(invite)?)),
        ControlMessage::InviteRevoke { invite_id, reason } => {
            Incoming::Session(SessionControl::InviteRevoke { invite_id: checked_id(invite_id)?, reason })
        }
        ControlMessage::InviteDecline { invite_id } => {
            Incoming::Session(SessionControl::InviteDecline { invite_id: checked_id(invite_id)? })
        }
        ControlMessage::Unfriend => Incoming::Unfriend,
        ControlMessage::IdentityRotated { new_peer_id, signature } => Incoming::IdentityRotated {
            new_peer_id: PeerId::from_str(&new_peer_id).map_err(|_| Malformed)?,
            signature: signature_bytes(&signature).ok_or(Malformed)?,
        },
        ControlMessage::Ack => Incoming::Ack,
        ControlMessage::Unknown => Incoming::Unknown,
    })
}

/// 128 kleine Hex-Zeichen, wie Signaturen auf der Leitung stehen.
pub(super) fn signature_bytes(hex: &str) -> Option<[u8; 64]> {
    HEXLOWER.decode(hex.as_bytes()).ok()?.try_into().ok()
}

fn sanitized_invite(invite: WireInvite) -> Result<WireInvite, Malformed> {
    let instance = invite.instance;
    Ok(WireInvite {
        id: checked_id(invite.id)?,
        session_id: checked_id(invite.session_id)?,
        world_name: invite.world_name.as_deref().map(sanitize::world_or_instance_name).filter(|name| !name.is_empty()),
        instance: InstanceSummary {
            name: sanitize::world_or_instance_name(&instance.name),
            minecraft_version: sanitize::world_or_instance_name(&instance.minecraft_version),
            loader: instance.loader,
            loader_version: instance
                .loader_version
                .as_deref()
                .map(sanitize::world_or_instance_name)
                .filter(|version| !version.is_empty()),
            mod_count: instance.mod_count,
        },
        expires_at: invite.expires_at,
    })
}

/// Einladungs- und Sitzungs-IDs sind UUIDs in der üblichen Schreibweise (klein, mit Bindestrichen).
pub(super) fn checked_id(id: String) -> Result<String, Malformed> {
    let canonical = uuid::Uuid::parse_str(&id).map(|uuid| uuid.hyphenated().to_string());
    if canonical.as_deref() == Ok(id.as_str()) {
        Ok(id)
    } else {
        Err(Malformed)
    }
}

/// Antwort auf einen Stream, den der Dienst nicht bedienen kann.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum StreamReply {
    Error { code: &'static str },
}

/// Warum eine Steuerverbindung nicht zustande kam.
#[derive(Debug, thiserror::Error)]
pub(super) enum SessionError {
    #[error(transparent)]
    Net(#[from] NetError),
    #[error(transparent)]
    Frame(#[from] FrameError),
    #[error("kein `hello` innerhalb der Wartezeit")]
    Timeout,
    #[error("erster Stream oder erster Rahmen war nicht der erwartete")]
    Protocol,
    #[error("Peer ist kein Freund")]
    NotFriend,
    #[error("eine andere Verbindung zu diesem Peer bleibt")]
    Duplicate,
    #[error("Peer ersetzt seine Verbindung zu oft")]
    TooFrequent,
}

impl SessionError {
    /// Code, mit dem die Verbindung geschlossen wird; `None`, wenn sie schon zu ist.
    fn close_code(&self) -> Option<CloseCode> {
        match self {
            Self::Net(_) => None,
            Self::Frame(err) if connection_lost(err) => None,
            Self::Frame(_) | Self::Timeout | Self::Protocol => Some(CloseCode::PROTOCOL),
            Self::NotFriend => Some(CloseCode::NOT_FRIEND),
            Self::Duplicate => Some(CloseCode::DUPLICATE),
            Self::TooFrequent => Some(CloseCode::RATE_LIMITED),
        }
    }
}

/// Wir haben angewählt: Steuer-Stream öffnen, `hello`s tauschen, Status senden, Verbindung eintragen.
pub(super) async fn run_outgoing(core: &Arc<Core>, runtime: &Arc<Runtime>, conn: PeerConn) -> Result<(), SessionError> {
    let established = async {
        let (mut stream, profile, home_relay) = open_control(&conn, &own_hello(core, runtime)).await?;
        accept_hello(core, &conn.remote(), profile, home_relay)?;
        frame::write(&mut stream, &own_status(core), CONTROL_FRAME_LIMIT).await?;
        Ok(stream)
    };
    let stream = timeout(FIRST_FRAME_WAIT, established).await.unwrap_or(Err(SessionError::Timeout));
    let started = stream.and_then(|stream| start_link(core, runtime, conn.clone(), stream));
    if let Err(err) = &started {
        close_after(&conn, err);
    }
    started
}

/// Der Peer hat angewählt: sein Steuer-Stream kommt zuerst, dann antworten wir mit `hello` und Status.
pub(super) async fn run_incoming(core: Arc<Core>, runtime: Arc<Runtime>, conn: PeerConn) {
    let started = match timeout(FIRST_FRAME_WAIT, accept_control(&core, &runtime, &conn)).await {
        Ok(Ok(stream)) => start_link(&core, &runtime, conn.clone(), stream),
        Ok(Err(err)) => Err(err),
        Err(_) => Err(SessionError::Timeout),
    };
    if let Err(err) = started {
        tracing::debug!(peer = %conn.remote().short(), %err, "eingehende Steuerverbindung abgelehnt");
        close_after(&conn, &err);
    }
}

/// Öffnet den Steuer-Stream, sendet `hello` und liest das `hello` des Peers.
pub(super) async fn open_control(
    conn: &PeerConn,
    hello: &ControlMessage,
) -> Result<(BiStream, WireProfile, Option<u8>), SessionError> {
    let mut stream = conn.open_bi().await?;
    frame::write(&mut stream, &OpenFrame::Control, OPEN_FRAME_LIMIT).await?;
    frame::write(&mut stream, hello, CONTROL_FRAME_LIMIT).await?;
    let (profile, home_relay) = read_hello(&mut stream, &conn.remote()).await?;
    Ok((stream, profile, home_relay))
}

/// Schickt eine letzte Nachricht (`unfriend`), wartet auf das `ack` und schließt normal.
pub(super) async fn say_goodbye(link: Link, message: ControlMessage) {
    if link.send(message).is_ok() {
        let _ = timeout(ACK_WAIT, link.acked.notified()).await;
    }
    link.conn.close(CloseCode::NORMAL);
}

async fn accept_control(core: &Arc<Core>, runtime: &Runtime, conn: &PeerConn) -> Result<BiStream, SessionError> {
    let mut stream = conn.accept_bi().await?;
    if stream.read_frame::<OpenFrame>(OPEN_FRAME_LIMIT).await? != OpenFrame::Control {
        return Err(SessionError::Protocol);
    }
    let (profile, home_relay) = read_hello(&mut stream, &conn.remote()).await?;
    accept_hello(core, &conn.remote(), profile, home_relay)?;
    frame::write(&mut stream, &own_hello(core, runtime), CONTROL_FRAME_LIMIT).await?;
    frame::write(&mut stream, &own_status(core), CONTROL_FRAME_LIMIT).await?;
    Ok(stream)
}

async fn read_hello(stream: &mut BiStream, peer: &PeerId) -> Result<(WireProfile, Option<u8>), SessionError> {
    let message = stream.read_frame::<ControlMessage>(CONTROL_FRAME_LIMIT).await?;
    match parse(message, peer) {
        Ok(Incoming::Hello { profile, home_relay }) => Ok((profile, home_relay)),
        _ => Err(SessionError::Protocol),
    }
}

/// Ein Freund wird aktualisiert und (falls nötig) bestätigt; ein Peer, auf dessen Antwort unsere Anfrage wartet,
/// wird Freund (SPEC 4.3). Alle anderen sind keine Freunde.
fn accept_hello(core: &Core, peer: &PeerId, profile: WireProfile, home_relay: Option<u8>) -> Result<(), SessionError> {
    let id = peer.to_string();
    if let Some(friend) = status::friend(core, &id) {
        if !friend.confirmed {
            requests::confirm_friend(core, &id);
        }
        status::apply_profile(core, peer, profile);
        status::apply_home_relay(core, peer, home_relay, &core.options.relay_map);
        return Ok(());
    }
    match requests::accept_answer(core, peer, profile, home_relay) {
        Ok(true) => Ok(()),
        Ok(false) => Err(SessionError::NotFriend),
        Err(err) => {
            tracing::warn!(%err, "Freund aus angenommener Anfrage nicht gespeichert");
            Err(SessionError::NotFriend)
        }
    }
}

fn own_hello(core: &Core, runtime: &Runtime) -> ControlMessage {
    ControlMessage::hello(core.own_profile(), runtime.main.home_relay())
}

fn own_status(core: &Core) -> ControlMessage {
    ControlMessage::Status { presence: core.links.own_presence() }
}

/// Trägt die Verbindung ein und startet Schreiber, Leser, Stream-Annahme und Wegbeobachtung.
fn start_link(core: &Arc<Core>, runtime: &Arc<Runtime>, conn: PeerConn, stream: BiStream) -> Result<(), SessionError> {
    let peer = conn.remote();
    let (sender, outgoing) = mpsc::channel(CONTROL_QUEUE);
    let link = core.links.new_link(conn, sender);
    match core.links.register(&runtime.main.id(), link.clone()) {
        Registration::Duplicate => return Err(SessionError::Duplicate),
        Registration::TooFrequent => return Err(SessionError::TooFrequent),
        Registration::Kept { replaced: Some(old) } => old.conn.close(CloseCode::DUPLICATE),
        Registration::Kept { replaced: None } => status::emit_presence(core, &peer, link.state()),
    }
    runtime.scheduler.connected(&Target::Friend(peer));
    let (read, write) = tokio::io::split(stream);
    let stop = &runtime.stop;
    tokio::spawn(stop.clone().run_until_cancelled_owned(write_control(write, outgoing)));
    tokio::spawn(stop.clone().run_until_cancelled_owned(serve_link(core.clone(), runtime.clone(), link, read)));
    Ok(())
}

fn close_after(conn: &PeerConn, err: &SessionError) {
    if let Some(code) = err.close_code() {
        conn.close(code);
    }
}

async fn write_control(mut write: WriteHalf<BiStream>, mut outgoing: mpsc::Receiver<ControlMessage>) {
    while let Some(message) = outgoing.recv().await {
        if let Err(err) = frame::write(&mut write, &message, CONTROL_FRAME_LIMIT).await {
            tracing::debug!(%err, "Steuernachricht nicht geschrieben");
            return;
        }
    }
}

/// Bedient die Verbindung bis zu ihrem Ende und meldet dann, wie sie endete.
async fn serve_link(core: Arc<Core>, runtime: Arc<Runtime>, link: Link, read: ReadHalf<BiStream>) {
    let conn = link.conn.clone();
    tokio::select! {
        _ = conn.closed() => {}
        () = read_control(&core, &runtime, &link, read) => {}
        () = serve_streams(&core, &runtime, &conn) => {}
        () = watch_path(&core, &link) => {}
    }
    let reason = conn.closed().await;
    status::link_ended(&core, &runtime, &conn.remote(), link.id, reason);
}

/// Liest Steuernachrichten, bis die Verbindung endet; jedes Ende des Lesens schließt sie.
async fn read_control(core: &Arc<Core>, runtime: &Arc<Runtime>, link: &Link, mut read: ReadHalf<BiStream>) {
    let peer = link.conn.remote();
    let mut frames = SlidingWindow::new(CONTROL_FRAMES);
    loop {
        let message = match frame::read::<ControlMessage>(&mut read, CONTROL_FRAME_LIMIT).await {
            Ok(message) => message,
            Err(err) => return close_unless_lost(&link.conn, &err),
        };
        if !frames.try_hit((), Instant::now()) {
            link.conn.close(CloseCode::RATE_LIMITED);
            return;
        }
        let Ok(incoming) = parse(message, &peer) else {
            link.conn.close(CloseCode::PROTOCOL);
            return;
        };
        if handle(core, runtime, link, incoming).await == Flow::Ended {
            return;
        }
    }
}

/// Ein kaputter oder beendeter Steuer-Stream schließt mit `PROTOCOL`.
fn close_unless_lost(conn: &PeerConn, err: &FrameError) {
    if !connection_lost(err) {
        conn.close(CloseCode::PROTOCOL);
    }
}

/// Die Verbindung selbst ist schon zu. Ein spätes `close` ließe sie dann als von uns geschlossen gelten und verdeckte
/// den Code des Peers.
fn connection_lost(err: &FrameError) -> bool {
    matches!(err, FrameError::Io(io) if io.kind() == std::io::ErrorKind::NotConnected)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flow {
    Continue,
    Ended,
}

async fn handle(core: &Arc<Core>, runtime: &Arc<Runtime>, link: &Link, incoming: Incoming) -> Flow {
    let peer = link.conn.remote();
    match incoming {
        Incoming::Status(presence) => {
            if let Some(changed) = core.links.update(&peer, link.id, |current, _| *current = presence) {
                status::emit_presence(core, &peer, changed);
            }
        }
        Incoming::Profile(profile) => status::apply_profile(core, &peer, profile),
        Incoming::Session(message) => hand_to_sessions(core, peer, message),
        Incoming::Unfriend => {
            status::mark_removed_by_peer(core, &peer);
            acknowledge_and_close(link).await;
            return Flow::Ended;
        }
        Incoming::IdentityRotated { new_peer_id, signature } => {
            if outbox::accept_rotation(core, &peer, &new_peer_id, &signature) {
                acknowledge_and_close(link).await;
                runtime.scheduler.dial_now(&status::presence_plan(core, runtime), Target::Friend(new_peer_id));
            } else {
                link.conn.close(CloseCode::PROTOCOL);
            }
            return Flow::Ended;
        }
        Incoming::Ack => link.acked.notify_one(),
        Incoming::Hello { .. } | Incoming::Unknown => {
            tracing::debug!(peer = %peer.short(), "Steuernachricht ignoriert")
        }
    }
    Flow::Continue
}

fn hand_to_sessions(core: &Core, peer: PeerId, message: SessionControl) {
    let Some(handler) = core.handler() else {
        tracing::debug!(peer = %peer.short(), "Sitzungsnachricht ohne Handler ignoriert");
        return;
    };
    tokio::spawn(async move { handler.on_control_message(&peer, message).await });
}

/// Bestätigt und wartet, bis der Peer schließt; nur wenn er das nicht tut, schließen wir selbst.
async fn acknowledge_and_close(link: &Link) {
    let closed_by_peer = link.send(ControlMessage::Ack).is_ok() && timeout(ACK_WAIT, link.conn.closed()).await.is_ok();
    if !closed_by_peer {
        link.conn.close(CloseCode::NORMAL);
    }
}

/// Nimmt weitere Streams des Peers an und reicht sie nach ihrem Öffnungsrahmen weiter.
async fn serve_streams(core: &Arc<Core>, runtime: &Runtime, conn: &PeerConn) {
    while let Ok(stream) = conn.accept_bi().await {
        let dispatch = dispatch_stream(core.clone(), conn.remote(), stream);
        tokio::spawn(runtime.stop.clone().run_until_cancelled_owned(dispatch));
    }
}

async fn dispatch_stream(core: Arc<Core>, peer: PeerId, mut stream: BiStream) {
    let open = match timeout(FIRST_FRAME_WAIT, stream.read_frame::<OpenFrame>(OPEN_FRAME_LIMIT)).await {
        Ok(Ok(open)) => open,
        Ok(Err(_)) => return,
        Err(_) => return stream.reset(CloseCode::PROTOCOL),
    };
    match open {
        OpenFrame::Request => serve_request(&core, &peer, stream).await,
        OpenFrame::Tunnel { session_id } => match checked_id(session_id) {
            Ok(session_id) => serve_tunnel(&core, &peer, session_id, stream).await,
            Err(Malformed) => stream.reset(CloseCode::PROTOCOL),
        },
        OpenFrame::Control | OpenFrame::Unknown => stream.reset(CloseCode::PROTOCOL),
    }
}

async fn serve_request(core: &Core, peer: &PeerId, stream: BiStream) {
    if !core.links.admit_request_stream(peer) {
        return refuse(stream, "rateLimited", REQUEST_FRAME_LIMIT).await;
    }
    match core.handler() {
        Some(handler) => handler.on_request_stream(peer, stream).await,
        None => refuse(stream, "unsupported", REQUEST_FRAME_LIMIT).await,
    }
}

async fn serve_tunnel(core: &Core, peer: &PeerId, session_id: String, stream: BiStream) {
    match core.handler() {
        Some(handler) => handler.on_tunnel_stream(peer, session_id, stream).await,
        None => refuse(stream, "sessionNotFound", OPEN_FRAME_LIMIT).await,
    }
}

async fn refuse(mut stream: BiStream, code: &'static str, limit: usize) {
    if frame::write(&mut stream, &StreamReply::Error { code }, limit).await.is_ok() {
        let _ = stream.shutdown().await;
    }
}

/// Meldet einen Wechsel des Wegs (Relay oder direkt) als Präsenzänderung.
async fn watch_path(core: &Core, link: &Link) {
    let peer = link.conn.remote();
    loop {
        tokio::time::sleep(PATH_POLL).await;
        let path = link.conn.path();
        if let Some(changed) = core.links.update(&peer, link.id, |_, current| *current = path) {
            status::emit_presence(core, &peer, changed);
        }
    }
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;
    use serde_json::json;

    use super::*;
    use crate::services::shared_types::ModLoader;

    const INVITE_ID: &str = "0f8d2c1e-6a4b-4f7e-9c3d-2b1a0e9f8d7c";
    const SESSION_ID: &str = "7c6b5a49-3827-4615-a0b9-c8d7e6f5a4b3";

    fn peer() -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[3; 32]).public())
    }

    fn incoming(json: serde_json::Value) -> Result<Incoming, Malformed> {
        parse(serde_json::from_value(json).unwrap(), &peer())
    }

    #[test]
    fn open_frames_have_the_wire_shape() {
        let tunnel = OpenFrame::Tunnel { session_id: SESSION_ID.into() };

        assert_eq!(serde_json::to_value(OpenFrame::Control).unwrap(), json!({ "type": "control" }));
        assert_eq!(serde_json::to_value(tunnel).unwrap(), json!({ "type": "tunnel", "sessionId": SESSION_ID }));
        assert_eq!(serde_json::from_value::<OpenFrame>(json!({ "type": "video" })).unwrap(), OpenFrame::Unknown);
    }

    #[test]
    fn hello_has_the_wire_shape() {
        let profile = WireProfile { display_name: "Alex".into(), mc_name: Some("Alex".into()), mc_uuid: None };

        let wire = serde_json::to_value(ControlMessage::hello(profile, Some(0))).unwrap();

        assert_eq!(wire["type"], "hello");
        assert_eq!(wire["protocol"], 1);
        assert_eq!(wire["features"], json!([]));
        assert_eq!(wire["profile"], json!({ "displayName": "Alex", "mcName": "Alex", "mcUuid": null }));
        assert_eq!(wire["homeRelay"], 0);
    }

    #[test]
    fn hello_profile_is_sanitised_and_unknown_fields_are_ignored() {
        let parsed = incoming(json!({
            "type": "hello", "protocol": 1, "launcher": "9.9.9", "future": true,
            "profile": { "displayName": "\u{202e}Bob§c", "mcName": "no spaces", "mcUuid": "ABC" }
        }));

        let profile = WireProfile { display_name: "Bobc".into(), mc_name: None, mc_uuid: None };
        assert_eq!(parsed, Ok(Incoming::Hello { profile, home_relay: None }));
    }

    #[test]
    fn unknown_message_type_is_ignored() {
        assert_eq!(incoming(json!({ "type": "chat", "text": "hi" })), Ok(Incoming::Unknown));
    }

    #[test]
    fn invite_names_are_sanitised() {
        let parsed = incoming(json!({ "type": "invite", "invite": {
            "id": INVITE_ID, "sessionId": SESSION_ID, "worldName": "  Insel\u{200b}welt ",
            "instance": { "name": "Fabric§a 26.3", "minecraftVersion": "26.3", "loader": "fabric",
                          "loaderVersion": "", "modCount": 42 },
            "expiresAt": 1_790_000_000u64
        }}));

        let Ok(Incoming::Session(SessionControl::Invite(invite))) = parsed else { panic!("{parsed:?}") };
        assert_eq!(invite.world_name.as_deref(), Some("Inselwelt"));
        assert_eq!(invite.instance.name, "Fabrica 26.3");
        assert_eq!(invite.instance.loader, ModLoader::Fabric);
        assert_eq!(invite.instance.loader_version, None);
    }

    #[test]
    fn ids_that_are_not_canonical_uuids_are_malformed() {
        let upper = INVITE_ID.to_uppercase();

        for id in ["x", upper.as_str(), "0f8d2c1e6a4b4f7e9c3d2b1a0e9f8d7c"] {
            assert_eq!(incoming(json!({ "type": "inviteDecline", "inviteId": id })), Err(Malformed), "{id}");
        }
    }

    #[test]
    fn revoke_reason_and_id_pass_through() {
        let parsed = incoming(json!({ "type": "inviteRevoke", "inviteId": INVITE_ID, "reason": "kicked" }));

        let revoke = SessionControl::InviteRevoke { invite_id: INVITE_ID.into(), reason: RevokeReason::Kicked };
        assert_eq!(parsed, Ok(Incoming::Session(revoke)));
    }

    #[test]
    fn identity_rotated_needs_a_peer_id_and_a_full_signature() {
        let new_peer_id = peer().to_string();
        let signature = "ab".repeat(64);

        let parsed = incoming(json!({ "type": "identityRotated", "newPeerId": new_peer_id, "signature": signature }));
        let short = incoming(json!({ "type": "identityRotated", "newPeerId": new_peer_id, "signature": "ab" }));

        assert_eq!(parsed, Ok(Incoming::IdentityRotated { new_peer_id: peer(), signature: [0xab; 64] }));
        assert_eq!(short, Err(Malformed));
    }
}
