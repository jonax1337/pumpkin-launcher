//! Freundschaftsanfragen mit beidseitiger Zustimmung (SPEC 4.3): einlösen, zustellen (mit Backoff bis zu 14 Tagen),
//! annehmen, ablehnen, zurückziehen, und das Aufräumen abgelaufener Datensätze.
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use data_encoding::HEXLOWER;

use super::code;
use super::contract::{
    FriendRequest, FriendRequestEvent, FriendRequestRefusedEvent, RequestDirection, RequestRefusal, RequestState,
    MAX_FRIENDS, REQUEST_TTL_SECS,
};
use super::control::WireProfile;
use super::events::FriendsEvent;
use super::hello::{self, Delivery, HelloRefusal};
use super::identity::fingerprint;
use super::records::{CodeRecord, FriendRecord, RequestRecord};
use super::service::{now_secs, Core, Friends, Runtime};
use super::status::{self, Target};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::new_id;
use crate::services::p2p::{find_relay, PeerId};

/// Höchstens so viele eingehende Anfragen warten auf eine Antwort (SPEC 12.4).
const MAX_PENDING_INCOMING: usize = 20;
const PRUNE_INTERVAL: Duration = Duration::from_secs(3600);

impl Friends {
    pub async fn requests(&self) -> AppResult<Vec<FriendRequest>> {
        self.core.ensure_enabled()?;
        Ok(self.core.stores.requests.list().into_iter().map(request_view).collect())
    }

    /// Löst einen Code ein; zugestellt wird im Hintergrund, auch wenn der Besitzer erst später online kommt.
    pub async fn add(&self, code: &str) -> AppResult<FriendRequest> {
        let core = &self.core;
        core.ensure_enabled()?;
        let parts = code::parse(code)?;
        parts.ensure_relay_known(|index| find_relay(&core.options.relay_map, index).is_some())?;
        let identity = core.identity().ok_or_else(|| AppError::invalid(coded!("errors.friends.identityLost")))?;
        parts.ensure_not_own(&hello::own_hello_ids(core, &identity))?;
        PeerId::from_bytes(&parts.hello_id).map_err(|_| AppError::invalid(coded!("errors.friends.codeInvalid")))?;
        let hello_id = HEXLOWER.encode(&parts.hello_id);
        if core.stores.requests.list().iter().any(|request| request.hello_id.as_deref() == Some(&hello_id)) {
            return Err(AppError::invalid(coded!("errors.friends.alreadyRequested")));
        }
        ensure_friend_capacity(core)?;
        let now = now_secs();
        let record = core.stores.requests.insert(RequestRecord {
            id: new_id(),
            direction: RequestDirection::Outgoing,
            state: RequestState::Delivering,
            peer_id: None,
            hello_id: Some(hello_id),
            relay_index: Some(parts.relay_index),
            secret: Some(parts.secret_hex()),
            display_name: None,
            mc_name: None,
            mc_uuid: None,
            code_tail: Some(parts.tail()),
            created_at: now,
            expires_at: core.request_deadline(),
        })?;
        core.emit(FriendsEvent::Changed);
        dial_now(core, Target::Request(record.id.clone()));
        Ok(request_view(record))
    }

    /// Annehmen macht den Peer zum (unbestätigten) Freund und wählt ihn sofort an; Ablehnen schickt nichts.
    pub async fn answer_request(&self, request_id: &str, accept: bool) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        let request = incoming_request(core, request_id)?;
        if accept {
            ensure_friend_capacity(core)?;
            let peer_id = request.peer_id.clone().unwrap_or_default();
            core.stores.friends.upsert(new_friend(&peer_id, &request, false))?;
            core.stores.requests.remove(request_id)?;
            if let Ok(peer) = PeerId::from_str(&peer_id) {
                dial_now(core, Target::Friend(peer));
            }
        } else {
            core.stores.requests.remove(request_id)?;
        }
        core.emit(FriendsEvent::Changed);
        Ok(())
    }

    /// Zieht eine eigene Anfrage zurück; hatte der Besitzer schon angenommen, sieht er uns als „entfernt“.
    pub async fn cancel_request(&self, request_id: &str) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        let request = core.stores.requests.get(request_id)?;
        if request.direction != RequestDirection::Outgoing {
            return Err(not_found(request_id));
        }
        core.stores.requests.remove(request_id)?;
        if let Some(runtime) = core.runtime() {
            runtime.scheduler.forget(&Target::Request(request_id.to_owned()));
        }
        core.emit(FriendsEvent::Changed);
        Ok(())
    }

    /// Stellt wartende Anfragen sofort zu und wählt Offline-Freunde an (SPEC 4.3, 4.4); kehrt sofort zurück.
    pub async fn retry_now(&self) -> AppResult<()> {
        let core = &self.core;
        core.ensure_enabled()?;
        if let Some(runtime) = core.runtime() {
            let requests = delivering(core).into_iter().map(Target::Request).collect();
            let friends = status::offline_friends(core, |_| true);
            runtime.scheduler.retry_now(&status::presence_plan(core, &runtime), requests, friends);
        }
        Ok(())
    }
}

/// Das Gate des Haupt-Endpunkts: Freunde (nicht gesperrt) und Peers, auf deren Antwort unsere Anfrage wartet.
pub(super) fn may_connect(core: &Core, peer_id: &str) -> bool {
    if core.stores.blocked.get(peer_id).is_ok() {
        return false;
    }
    core.stores.friends.get(peer_id).is_ok() || awaiting_answer_from(core, peer_id).is_some()
}

/// IDs der ausgehenden Anfragen, die noch zugestellt werden.
pub(super) fn delivering(core: &Core) -> Vec<String> {
    let requests = core.stores.requests.list().into_iter();
    requests.filter(|request| request.state == RequestState::Delivering).map(|request| request.id).collect()
}

/// Ein Zustellversuch; `true`, wenn nichts mehr zu tun ist (angekommen, endgültig abgelehnt oder verschwunden).
pub(super) async fn deliver(core: &Arc<Core>, runtime: &Runtime, request_id: &str) -> bool {
    let Ok(request) = core.stores.requests.get(request_id) else { return true };
    let (Some(hello_id), Some(secret)) = (hello_peer(&request), request.secret.as_deref()) else { return true };
    if request.state != RequestState::Delivering {
        return true;
    }
    match hello::send_request(&runtime.main, hello_id, secret, core.own_profile()).await {
        Delivery::Received { peer, profile } => {
            mark_received(core, request_id, &peer, profile);
            true
        }
        Delivery::Refused(HelloRefusal::Full) | Delivery::Failed => false,
        Delivery::Refused(HelloRefusal::CodeUsed) => drop_refused(core, request, RequestRefusal::CodeUsed),
        Delivery::Refused(HelloRefusal::AlreadyFriends) => drop_refused(core, request, RequestRefusal::AlreadyFriends),
        Delivery::Refused(HelloRefusal::Unsupported) => drop_refused(core, request, RequestRefusal::Unsupported),
    }
}

/// Eine endgültig abgelehnte Anfrage verschwindet; die Oberfläche erfährt den Grund (`friend-request-refused`).
fn drop_refused(core: &Core, request: RequestRecord, reason: RequestRefusal) -> bool {
    tracing::info!(?reason, "Freundschaftsanfrage abgelehnt, wird verworfen");
    if core.stores.requests.remove(&request.id).is_ok() {
        core.emit(FriendsEvent::Changed);
        core.emit(FriendsEvent::RequestRefused(FriendRequestRefusedEvent { request: request_view(request), reason }));
    }
    true
}

/// Eine Anfrage mit richtigem Geheimnis am Hello-Endpunkt (SPEC 4.3): wird als eingehende Anfrage gespeichert, eine
/// wiederholte bekommt dieselbe Antwort.
pub(super) fn receive(core: &Core, code: &CodeRecord, peer_id: &str, profile: WireProfile) -> Result<(), HelloRefusal> {
    match code.used_by.as_deref() {
        Some(user) if user != peer_id => return Err(HelloRefusal::CodeUsed),
        Some(_) => return Ok(()),
        None => {}
    }
    if core.stores.friends.get(peer_id).is_ok() {
        return Err(HelloRefusal::AlreadyFriends);
    }
    let already_pending = pending_from(core, peer_id).is_some();
    if !already_pending && pending_count(core) >= MAX_PENDING_INCOMING {
        return Err(HelloRefusal::Full);
    }
    core.stores.codes.modify(&code.id, |code| code.used_by = Some(peer_id.to_owned())).map_err(|err| {
        tracing::warn!(%err, "Code nicht als eingelöst markiert");
        HelloRefusal::Unsupported
    })?;
    if already_pending {
        return Ok(());
    }
    let request = incoming_record(core, code, peer_id, profile);
    core.stores.requests.insert(request.clone()).map_err(|err| {
        tracing::warn!(%err, "eingehende Anfrage nicht gespeichert");
        HelloRefusal::Unsupported
    })?;
    core.emit(FriendsEvent::Changed);
    core.emit(FriendsEvent::Request(FriendRequestEvent { request: request_view(request) }));
    Ok(())
}

/// Das erste `hello` des Code-Besitzers nach dem Annehmen: er wird bestätigter Freund, die Anfrage ist erledigt.
pub(super) fn accept_answer(
    core: &Core,
    peer: &PeerId,
    profile: WireProfile,
    home_relay: Option<u8>,
) -> AppResult<bool> {
    let peer_id = peer.to_string();
    let Some(request) = awaiting_answer_from(core, &peer_id) else { return Ok(false) };
    let home_relay = home_relay.filter(|index| find_relay(&core.options.relay_map, *index).is_some());
    let friend = FriendRecord {
        display_name: profile.display_name,
        mc_name: profile.mc_name,
        mc_uuid: profile.mc_uuid,
        home_relay,
        ..new_friend(&peer_id, &request, true)
    };
    core.stores.friends.upsert(friend)?;
    core.stores.requests.remove(&request.id)?;
    core.emit(FriendsEvent::Changed);
    Ok(true)
}

/// Das `hello` des Freundes nach unserem Annehmen bestätigt die Freundschaft auch bei uns.
pub(super) fn confirm_friend(core: &Core, peer_id: &str) {
    if core.stores.friends.modify(peer_id, |friend| friend.confirmed = true).is_ok() {
        core.emit(FriendsEvent::Changed);
    }
}

pub(super) fn request_of(core: &Core, peer_id: &str) -> Option<RequestRecord> {
    core.stores.requests.list().into_iter().find(|request| request.peer_id.as_deref() == Some(peer_id))
}

/// Gesperrt: alle Anfragen dieses Peers verschwinden.
pub(super) fn remove_requests_of(core: &Core, peer_id: &str) -> AppResult<()> {
    while let Some(request) = request_of(core, peer_id) {
        core.stores.requests.remove(&request.id)?;
    }
    Ok(())
}

/// Nach einem neuen Schlüssel: eingehende und angekommene ausgehende Anfragen hängen an der alten ID (SPEC 4.6).
pub(super) fn drop_requests_bound_to_old_id(core: &Core) -> AppResult<()> {
    for request in core.stores.requests.list() {
        if request.state != RequestState::Delivering {
            core.stores.requests.remove(&request.id)?;
        }
    }
    Ok(())
}

/// Zurücksetzen: Freunde, Anfragen, Codes und Sperren verschwinden (SPEC 4.6).
pub(super) fn delete_all_records(core: &Core) -> AppResult<()> {
    let stores = &core.stores;
    for friend in stores.friends.list() {
        stores.friends.remove(&friend.id)?;
        core.patches.forget(&friend.id);
    }
    for request in stores.requests.list() {
        stores.requests.remove(&request.id)?;
    }
    for blocked in stores.blocked.list() {
        stores.blocked.remove(&blocked.id)?;
    }
    hello::delete_all_codes(core)
}

/// Entfernt abgelaufene Anfragen, Codes, Postausgang-Einträge und zu lange unbestätigte Freunde.
pub(super) fn prune_expired(core: &Core) {
    let now = now_secs();
    let stores = &core.stores;
    let mut removed = 0;
    for request in stores.requests.list().into_iter().filter(|request| request.expires_at <= now) {
        removed += usize::from(stores.requests.remove(&request.id).is_ok());
    }
    for code in stores.codes.list().into_iter().filter(|code| code.expires_at <= now) {
        removed += usize::from(stores.codes.remove(&code.id).is_ok());
    }
    for item in stores.outbox.list().into_iter().filter(|item| item.until <= now) {
        removed += usize::from(stores.outbox.remove(&item.id).is_ok());
    }
    let added_before = now.saturating_sub(REQUEST_TTL_SECS);
    let stale = stores.friends.list().into_iter().filter(|friend| !friend.confirmed && friend.added_at <= added_before);
    for friend in stale {
        removed += usize::from(stores.friends.remove(&friend.id).is_ok());
    }
    if removed > 0 {
        core.emit(FriendsEvent::Changed);
    }
}

/// Räumt stündlich auf und schließt die Hello-Endpunkte abgelaufener Codes.
pub(super) fn spawn_hourly_prune(core: &Arc<Core>, runtime: &Arc<Runtime>) {
    let (core, runtime_task) = (core.clone(), runtime.clone());
    tokio::spawn(runtime.stop.clone().run_until_cancelled_owned(async move {
        let mut ticks = tokio::time::interval(PRUNE_INTERVAL);
        loop {
            ticks.tick().await;
            prune_expired(&core);
            close_expired_hello_endpoints(&core, &runtime_task).await;
        }
    }));
}

pub(super) fn request_view(record: RequestRecord) -> FriendRequest {
    FriendRequest {
        fingerprint: record.peer_id.as_deref().map(fingerprint),
        id: record.id,
        direction: record.direction,
        state: record.state,
        peer_id: record.peer_id,
        display_name: record.display_name,
        mc_name: record.mc_name,
        code_tail: record.code_tail,
        created_at: record.created_at,
        expires_at: record.expires_at,
    }
}

async fn close_expired_hello_endpoints(core: &Core, runtime: &Runtime) {
    let active: Vec<String> = hello::active_codes(core).into_iter().map(|code| code.id).collect();
    let open: Vec<String> = crate::services::lock(&runtime.hellos).keys().cloned().collect();
    for code_id in open.into_iter().filter(|code_id| !active.contains(code_id)) {
        hello::close_code(runtime, &code_id).await;
    }
}

fn dial_now(core: &Arc<Core>, target: Target) {
    if let Some(runtime) = core.runtime() {
        runtime.scheduler.dial_now(&status::presence_plan(core, &runtime), target);
    }
}

fn mark_received(core: &Core, request_id: &str, peer: &PeerId, profile: WireProfile) {
    let marked = core.stores.requests.modify(request_id, |request| {
        request.state = RequestState::AwaitingAnswer;
        request.peer_id = Some(peer.to_string());
        request.display_name = Some(profile.display_name);
        request.mc_name = profile.mc_name;
        request.mc_uuid = profile.mc_uuid;
        request.secret = None;
    });
    if marked.is_ok() {
        core.emit(FriendsEvent::Changed);
    }
}

fn hello_peer(request: &RequestRecord) -> Option<PeerId> {
    let bytes: [u8; 32] = HEXLOWER.decode(request.hello_id.as_deref()?.as_bytes()).ok()?.try_into().ok()?;
    PeerId::from_bytes(&bytes).ok()
}

fn incoming_request(core: &Core, request_id: &str) -> AppResult<RequestRecord> {
    let request = core.stores.requests.get(request_id)?;
    if request.direction == RequestDirection::Incoming && request.peer_id.is_some() {
        Ok(request)
    } else {
        Err(not_found(request_id))
    }
}

fn incoming_record(core: &Core, code: &CodeRecord, peer_id: &str, profile: WireProfile) -> RequestRecord {
    RequestRecord {
        id: new_id(),
        direction: RequestDirection::Incoming,
        state: RequestState::Pending,
        peer_id: Some(peer_id.to_owned()),
        hello_id: None,
        relay_index: None,
        secret: None,
        display_name: Some(profile.display_name),
        mc_name: profile.mc_name,
        mc_uuid: profile.mc_uuid,
        code_tail: Some(code.tail.clone()),
        created_at: now_secs(),
        expires_at: core.request_deadline(),
    }
}

fn new_friend(peer_id: &str, request: &RequestRecord, confirmed: bool) -> FriendRecord {
    FriendRecord {
        id: peer_id.to_owned(),
        display_name: request.display_name.clone().unwrap_or_else(|| super::sanitize::display_name("", peer_id)),
        alias: None,
        mc_name: request.mc_name.clone(),
        mc_uuid: request.mc_uuid.clone(),
        home_relay: None,
        added_at: now_secs(),
        last_seen: None,
        confirmed,
        removed_by_peer: false,
        notice: None,
    }
}

fn awaiting_answer_from(core: &Core, peer_id: &str) -> Option<RequestRecord> {
    request_of(core, peer_id).filter(|request| request.state == RequestState::AwaitingAnswer)
}

fn pending_from(core: &Core, peer_id: &str) -> Option<RequestRecord> {
    request_of(core, peer_id).filter(|request| request.state == RequestState::Pending)
}

fn pending_count(core: &Core) -> usize {
    core.stores.requests.list().iter().filter(|request| request.state == RequestState::Pending).count()
}

/// Freunde (auch unbestätigte) und ausgehende Anfragen zählen zur Grenze von 50.
fn ensure_friend_capacity(core: &Core) -> AppResult<()> {
    let outgoing = core.stores.requests.list().iter().filter(|r| r.direction == RequestDirection::Outgoing).count();
    if core.stores.friends.list().len() + outgoing >= MAX_FRIENDS {
        return Err(AppError::invalid(coded!("errors.friends.friendLimit", max = MAX_FRIENDS)));
    }
    Ok(())
}

fn not_found(request_id: &str) -> AppError {
    AppError::NotFound(coded!("errors.friends.notFound.request", id = request_id).into())
}
