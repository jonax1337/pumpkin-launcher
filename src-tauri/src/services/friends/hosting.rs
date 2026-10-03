//! Gastgeber (SPEC 5.4, 5.5, 6.1): eine für LAN geöffnete Welt mit eingeladenen Freunden teilen. Der Tunnel führt
//! nur an `127.0.0.1:<Port>`, nachdem der Port als Eigentum des Spielprozesses geprüft ist und das Spiel auf eine
//! Statusabfrage antwortet; jeder Stream zeigt vorher ein gültiges Handshake (und Login Start).
//! Eingelassen wird nur, wer eine offene Einladung hat oder gerade verbunden ist; ein Rauswurf oder eine Absage
//! schließt die Einladung, bis der Gastgeber neu einlädt.
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::str::FromStr;
use std::sync::{Arc, Weak};
use std::time::Duration;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::contract::{
    GuestState, HostSession, HostSessionEndedEvent, HostSessionEvent, InstanceSummary, LanEvent, LanStatus, PathKind,
    PortSource, RevokeReason, SessionEnd, SessionGuest, INVITE_TTL_SECS, MAX_GUESTS, MIN_MC_LABEL, PORT_MIN,
};
use super::control::{SessionControl, WireInvite};
use super::limits::{RateLimit, SlidingWindow, OPEN_FRAME_LIMIT, REQUEST_FRAME_LIMIT};
use super::manifest::{self, Manifest, ManifestError, VersionIndex};
use super::mcproto::{self, HOST_WINDOW};
use super::mod_link;
use super::sanitize;
use super::service::now_secs;
use super::session_events::SessionEvent;
use super::sessions::{friends_by_id, shown_name, FriendSessions, Shared};
use super::Lifecycle;
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{new_id, Instance, Mod};
use crate::services::lan_detect::{self, PortCheck};
use crate::services::modbridge::protocol::{ModGuest, ModGuestState, ModNotify};
use crate::services::p2p::tunnel::bridge;
use crate::services::p2p::{frame, BiStream, CloseCode, PeerId};
use crate::services::{blocking, lock, sockowner};

const MAX_STREAMS_PER_GUEST: usize = 4;
const NEW_STREAMS_PER_GUEST: RateLimit = RateLimit { max: 20, window: Duration::from_secs(60) };
const LAN_CONNECT_WAIT: Duration = Duration::from_secs(3);
/// Wartezeit auf den Anfrage-Rahmen eines Request-Streams (SPEC 5.1).
const FIRST_FRAME_WAIT: Duration = Duration::from_secs(10);
/// So oft werden Weg und Umlaufzeit der Gäste aufgefrischt und abgelaufene Einladungen geschlossen.
const REFRESH_INTERVAL: Duration = Duration::from_secs(5);
/// So viele fehlgeschlagene Port-Prüfungen hintereinander beenden die Sitzung.
const LIVENESS_FAILURES: usize = 2;

/// Anfrage auf einem Request-Stream (Gast an Gastgeber).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(super) enum RequestMessage {
    ManifestRequest {
        session_id: String,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum RequestReply {
    Manifest { manifest: Manifest },
    Error { code: String },
}

/// Antwort des Gastgebers auf den Öffnungsrahmen eines Tunnel-Streams; danach folgen rohe Bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum TunnelReply {
    TunnelOk,
    Error { code: String },
}

/// Warum der Gastgeber einen Stream nicht bedient (SPEC 5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Refusal {
    SessionNotFound,
    NotInvited,
    GuestLimit,
    RateLimited,
    Unsupported,
}

impl Refusal {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::SessionNotFound => "sessionNotFound",
            Self::NotInvited => "notInvited",
            Self::GuestLimit => "guestLimit",
            Self::RateLimited => "rateLimited",
            Self::Unsupported => "unsupported",
        }
    }
}

/// Laufende Spiele und die (höchstens eine) geteilte Welt.
#[derive(Default)]
pub(super) struct Hosting {
    games: std::sync::Mutex<HashMap<String, Game>>,
    session: std::sync::Mutex<Option<Session>>,
}

/// Ein laufendes Spiel, wie es die Spielsignale melden.
#[derive(Debug, Clone, PartialEq)]
struct Game {
    pid: u32,
    online_account: bool,
    /// Nur geprüfte Ports.
    lan: Option<LanStatus>,
}

impl Hosting {
    fn game(&self, instance_id: &str) -> Option<Game> {
        lock(&self.games).get(instance_id).cloned()
    }

    pub(super) fn running_instances(&self) -> Vec<String> {
        lock(&self.games).keys().cloned().collect()
    }

    /// Die eingeladenen und verbundenen Gäste der Sitzung dieser Instanz, so wie die Mod sie zeigt (SPEC 7.3).
    pub(super) fn guests_for_mod(&self, instance_id: &str) -> Option<Vec<ModGuest>> {
        let session = lock(&self.session);
        let session = session.as_ref().filter(|session| session.instance_id == instance_id)?;
        Some(session.guests.iter().filter_map(Guest::for_mod).collect())
    }

    pub(super) fn session_of(&self, instance_id: &str) -> Option<String> {
        let session = lock(&self.session);
        session.as_ref().filter(|session| session.instance_id == instance_id).map(|session| session.id.clone())
    }
}

/// Eine geteilte Welt mit ihren Gästen; nur im Speicher.
struct Session {
    id: String,
    instance_id: String,
    pid: u32,
    port: u16,
    port_source: PortSource,
    show_world_name: bool,
    started_at: u64,
    summary: InstanceSummary,
    /// Manifest und die Mod-Liste, aus der es entstand; neu gebaut, wenn sich die Liste ändert (SPEC 5.5).
    manifest: (Vec<Mod>, Manifest),
    guests: Vec<Guest>,
    stop: CancellationToken,
}

struct Guest {
    peer: PeerId,
    name: String,
    mc_uuid: Option<String>,
    state: GuestState,
    kicked: bool,
    /// Die zuletzt gesendete Einladung; mit ihr wird widerrufen.
    invite_id: String,
    /// Bis wann die Einladung offen ist; `None` nach Rauswurf, Absage oder Ablauf.
    open_until: Option<u64>,
    streams: usize,
    opened: SlidingWindow<()>,
    /// Beendet alle Tunnel dieses Gastes (Rauswurf).
    stop: CancellationToken,
}

/// Ein neuer Gast für [`Session::invite`].
struct Invitee {
    peer: PeerId,
    name: String,
    mc_uuid: Option<String>,
}

impl Guest {
    fn has_open_invite(&self, now: u64) -> bool {
        self.open_until.is_some_and(|until| until > now)
    }

    fn is_shut_out(&self) -> bool {
        self.state == GuestState::Declined || (self.state == GuestState::Left && self.kicked)
    }

    /// Ein Platz in der Sitzung: eingeladen, verbunden oder von selbst gegangen (SPEC 5.4).
    fn holds_seat(&self) -> bool {
        !self.is_shut_out()
    }

    fn may_enter(&self, now: u64) -> bool {
        !self.is_shut_out() && (self.has_open_invite(now) || self.streams > 0)
    }

    fn for_mod(&self) -> Option<ModGuest> {
        let state = match self.state {
            GuestState::Invited => ModGuestState::Invited,
            GuestState::Connected => ModGuestState::Connected,
            GuestState::Declined | GuestState::Left => return None,
        };
        Some(ModGuest { id: self.peer.to_string(), name: self.name.clone(), state })
    }

    /// Schließt die Einladung und trennt alle Tunnel; spätere Streams bekommen `notInvited`.
    fn shut_out(&mut self, state: GuestState, kicked: bool) {
        self.state = state;
        self.kicked = kicked;
        self.open_until = None;
        self.stop.cancel();
        self.stop = CancellationToken::new();
    }
}

impl Session {
    fn guest(&self, peer: &PeerId) -> Option<&Guest> {
        self.guests.iter().find(|guest| guest.peer == *peer)
    }

    fn guest_mut(&mut self, peer: &PeerId) -> Option<&mut Guest> {
        self.guests.iter_mut().find(|guest| guest.peer == *peer)
    }

    /// Manifest-Anfragen: nur mit offener Einladung oder als verbundener Gast.
    fn admit_request(&self, peer: &PeerId, now: u64) -> Result<(), Refusal> {
        let allowed = self.guest(peer).is_some_and(|guest| guest.may_enter(now));
        allowed.then_some(()).ok_or(Refusal::NotInvited)
    }

    /// Tunnel-Streams: zusätzlich höchstens 7 verbundene Gäste, je Gast 4 zugleich und 20 neue je Minute (SPEC 6.1).
    /// `true`, wenn der Gast damit verbunden ist.
    fn admit_stream(&mut self, peer: &PeerId, now: u64, clock: Instant) -> Result<bool, Refusal> {
        self.admit_request(peer, now)?;
        let others_connected = self.guests.iter().filter(|guest| guest.peer != *peer && guest.streams > 0).count();
        let guest = self.guest_mut(peer).ok_or(Refusal::NotInvited)?;
        if guest.streams == 0 && others_connected >= MAX_GUESTS {
            return Err(Refusal::GuestLimit);
        }
        if guest.streams >= MAX_STREAMS_PER_GUEST || !guest.opened.try_hit((), clock) {
            return Err(Refusal::RateLimited);
        }
        guest.streams += 1;
        let joined = guest.streams == 1;
        if joined {
            guest.state = GuestState::Connected;
        }
        Ok(joined)
    }

    /// Ein Tunnel ist zu Ende; `true`, wenn der Gast damit gegangen ist.
    fn stream_ended(&mut self, peer: &PeerId) -> bool {
        let Some(guest) = self.guest_mut(peer) else { return false };
        guest.streams = guest.streams.saturating_sub(1);
        let left = guest.streams == 0 && guest.state == GuestState::Connected;
        if left {
            guest.state = GuestState::Left;
            guest.kicked = false;
        }
        left
    }

    /// Plätze nach dem Einladen von `peers`; Abgesagte und Rausgeworfene zählen nicht.
    fn seats_with(&self, peers: &[PeerId]) -> usize {
        let seated = self.guests.iter().filter(|guest| guest.holds_seat()).count();
        let new = peers.iter().filter(|peer| !self.guest(peer).is_some_and(Guest::holds_seat)).count();
        seated + new
    }

    /// Lädt neu ein (neue ID, `invited`, nicht rausgeworfen); ein gerade verbundener Gast bleibt, wie er ist.
    fn invite(&mut self, invitee: Invitee, invite_id: String, open_until: u64) -> Option<WireInvite> {
        if self.guest(&invitee.peer).is_some_and(|guest| guest.streams > 0) {
            return None;
        }
        self.guests.retain(|guest| guest.peer != invitee.peer);
        self.guests.push(Guest {
            peer: invitee.peer,
            name: invitee.name,
            mc_uuid: invitee.mc_uuid,
            state: GuestState::Invited,
            kicked: false,
            invite_id: invite_id.clone(),
            open_until: Some(open_until),
            streams: 0,
            opened: SlidingWindow::new(NEW_STREAMS_PER_GUEST),
            stop: CancellationToken::new(),
        });
        Some(WireInvite {
            id: invite_id,
            session_id: self.id.clone(),
            world_name: None,
            instance: self.summary.clone(),
            expires_at: open_until,
        })
    }

    /// Rauswurf: die ID der Einladung, die widerrufen wird.
    fn kick(&mut self, peer: &PeerId) -> Option<String> {
        let guest = self.guest_mut(peer)?;
        guest.shut_out(GuestState::Left, true);
        Some(guest.invite_id.clone())
    }

    /// Absage der Einladung `invite_id`; eine ältere Einladung schließt die neue nicht.
    fn decline(&mut self, peer: &PeerId, invite_id: &str) -> bool {
        let Some(guest) = self.guest_mut(peer).filter(|guest| guest.invite_id == invite_id) else { return false };
        guest.shut_out(GuestState::Declined, false);
        true
    }

    /// Schließt abgelaufene Einladungen; wer nicht verbunden ist, verlässt die Liste. Liefert, was zu widerrufen ist.
    fn expire_invites(&mut self, now: u64) -> Vec<(PeerId, String)> {
        let mut expired = Vec::new();
        for guest in &mut self.guests {
            if guest.open_until.is_some_and(|until| until <= now) {
                guest.open_until = None;
                expired.push((guest.peer, guest.invite_id.clone()));
            }
        }
        let lapsed = |guest: &Guest| guest.open_until.is_none() && guest.streams == 0 && guest.holds_seat();
        self.guests.retain(|guest| !lapsed(guest));
        expired
    }

    /// Wer beim Ende der Sitzung `inviteRevoke{stopped}` bekommt: offene Einladungen und verbundene Gäste.
    fn revocable(&self, now: u64) -> Vec<(PeerId, String)> {
        let reachable = |guest: &&Guest| guest.may_enter(now);
        self.guests.iter().filter(reachable).map(|guest| (guest.peer, guest.invite_id.clone())).collect()
    }

    fn view(&self, link_of: impl Fn(&PeerId) -> (Option<PathKind>, Option<u32>)) -> HostSession {
        let guests = self.guests.iter().map(|guest| {
            let (path, rtt_ms) =
                if guest.state == GuestState::Connected { link_of(&guest.peer) } else { (None, None) };
            SessionGuest {
                friend_id: guest.peer.to_string(),
                display_name: guest.name.clone(),
                state: guest.state,
                kicked: guest.kicked,
                path,
                rtt_ms,
            }
        });
        HostSession {
            id: self.id.clone(),
            instance_id: self.instance_id.clone(),
            port: self.port,
            port_source: self.port_source,
            pid: self.pid,
            world_name: None,
            show_world_name: self.show_world_name,
            started_at: self.started_at,
            guests: guests.collect(),
        }
    }
}

impl FriendSessions {
    /// Der geprüfte LAN-Port der laufenden Instanz.
    pub async fn lan_status(&self, instance_id: &str) -> AppResult<Option<LanStatus>> {
        self.shared.ensure_enabled()?;
        Ok(self.shared.hosting.game(instance_id).and_then(|game| game.lan))
    }

    pub async fn host_sessions(&self) -> AppResult<Vec<HostSession>> {
        self.shared.ensure_enabled()?;
        Ok(current_view(&self.shared).into_iter().collect())
    }

    /// Teilt die Welt der laufenden Instanz (SPEC 6.1): Microsoft-Start, Minecraft ab 1.20, ein geprüfter Port.
    pub async fn host_start(
        &self,
        instance_id: &str,
        port: Option<u16>,
        show_world_name: bool,
    ) -> AppResult<HostSession> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        ensure_no_session(shared)?;
        let game = hostable_game(shared, instance_id)?;
        let instance = supported_instance(shared, instance_id).await?;
        let lan = match port {
            Some(port) => manual_lan(shared, instance_id, game.pid, port).await?,
            None => game.lan.ok_or_else(|| invalid(coded!("errors.friends.lanPortUnknown")))?,
        };
        let manifest = build_manifest(shared, &instance).await?;
        let session = new_session(&instance, lan, show_world_name, manifest);
        let view = store_session(shared, session, game.pid)?;
        shared.emit(SessionEvent::HostSession(HostSessionEvent { session: view.clone() }));
        Ok(view)
    }

    /// Was `host_start` ohne manuellen Port verlangt, ohne etwas zu starten: die Mod fragt erst danach im Launcher nach
    /// (SPEC 7.4), damit niemand ein Teilen bestätigt, das danach doch scheitert.
    pub(super) async fn ensure_hostable(&self, instance_id: &str) -> AppResult<()> {
        let shared = &self.shared;
        let game = hostable_game(shared, instance_id)?;
        supported_instance(shared, instance_id).await?;
        game.lan.map(drop).ok_or_else(|| invalid(coded!("errors.friends.lanPortUnknown")))
    }

    /// Lädt verbundene, bestätigte Freunde ein; höchstens 7 Plätze je Sitzung (SPEC 5.4).
    pub async fn host_invite(&self, session_id: &str, friend_ids: Vec<String>) -> AppResult<HostSession> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let invitees = online_friends(shared, &friend_ids).await?;
        let open_until = now_secs() + INVITE_TTL_SECS;
        let invites = {
            let mut guard = lock(&shared.hosting.session);
            let session = session_with_id(&mut guard, session_id)?;
            let peers: Vec<PeerId> = invitees.iter().map(|invitee| invitee.peer).collect();
            if session.seats_with(&peers) > MAX_GUESTS {
                return Err(invalid(coded!("errors.friends.guestLimit", max = MAX_GUESTS)));
            }
            let invite = |invitee: Invitee| Some((invitee.peer, session.invite(invitee, new_id(), open_until)?));
            invitees.into_iter().filter_map(invite).collect::<Vec<_>>()
        };
        for (peer, invite) in invites {
            send_session_control(shared, &peer, SessionControl::Invite(invite));
        }
        announce_session(shared, session_id)
    }

    /// Wirft einen Gast hinaus: Einladung zu, Tunnel getrennt, `inviteRevoke{kicked}` (SPEC 6.1).
    pub async fn host_kick(&self, session_id: &str, friend_id: &str) -> AppResult<HostSession> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let peer = parse_friend_id(friend_id)?;
        let invite_id = {
            let mut guard = lock(&shared.hosting.session);
            session_with_id(&mut guard, session_id)?.kick(&peer).ok_or_else(|| friend_not_found(friend_id))?
        };
        send_session_control(shared, &peer, SessionControl::InviteRevoke { invite_id, reason: RevokeReason::Kicked });
        announce_session(shared, session_id)
    }

    pub async fn host_stop(&self, session_id: &str) -> AppResult<()> {
        self.shared.ensure_enabled()?;
        session_with_id(&mut lock(&self.shared.hosting.session), session_id)?;
        end_session(&self.shared, |session| session.id == session_id, SessionEnd::Stopped);
        Ok(())
    }

    pub(super) fn host_stop_for_instance(&self, instance_id: &str) {
        end_session(&self.shared, |session| session.instance_id == instance_id, SessionEnd::Stopped);
    }
}

fn invalid(coded: crate::error::Coded) -> AppError {
    AppError::invalid(coded)
}

fn friend_not_found(friend_id: &str) -> AppError {
    AppError::NotFound(coded!("errors.friends.notFound.friend", id = friend_id).into())
}

fn parse_friend_id(friend_id: &str) -> AppResult<PeerId> {
    PeerId::from_str(friend_id).map_err(|_| friend_not_found(friend_id))
}

fn ensure_no_session(shared: &Shared) -> AppResult<()> {
    match lock(&shared.hosting.session).as_ref() {
        Some(_) => Err(invalid(coded!("errors.friends.sessionActive"))),
        None => Ok(()),
    }
}

fn session_with_id<'a>(session: &'a mut Option<Session>, session_id: &str) -> AppResult<&'a mut Session> {
    let found = session.as_mut().filter(|session| session.id == session_id);
    found.ok_or_else(|| invalid(coded!("errors.friends.sessionNotFound")))
}

/// Minecraft ab 1.20 (SPEC 6.1); eine Version, die Mojang nicht kennt, lässt sich nicht prüfen und zählt als zu alt.
/// Das laufende Spiel der Instanz, gestartet mit Microsoft-Konto.
fn hostable_game(shared: &Shared, instance_id: &str) -> AppResult<Game> {
    let game = shared.hosting.game(instance_id).ok_or_else(|| invalid(coded!("errors.friends.gameNotRunning")))?;
    if game.online_account {
        Ok(game)
    } else {
        Err(invalid(coded!("errors.friends.msAccountRequired")))
    }
}

/// Die Instanz, wenn ihre Minecraft-Version das Teilen unterstützt (ab 1.20).
async fn supported_instance(shared: &Shared, instance_id: &str) -> AppResult<Instance> {
    let instance = shared.instances.get(instance_id)?;
    ensure_supported_version(&instance.minecraft_version, &shared.versions.index().await?)?;
    Ok(instance)
}

fn ensure_supported_version(minecraft_version: &str, versions: &VersionIndex) -> AppResult<()> {
    let probe = Manifest {
        minecraft_version: minecraft_version.to_owned(),
        loader: crate::models::ModLoader::Vanilla,
        loader_version: None,
        mods: Vec::new(),
    };
    match manifest::validate(probe, versions) {
        Ok(_) => Ok(()),
        Err(ManifestError::VersionUnsupported | ManifestError::Invalid(_)) => {
            Err(invalid(coded!("errors.friends.versionUnsupported", min = MIN_MC_LABEL)))
        }
    }
}

/// Ein selbst eingegebener Port: im erlaubten Bereich, dem Spiel gehörend und antwortend.
async fn manual_lan(shared: &Shared, instance_id: &str, pid: u32, port: u16) -> AppResult<LanStatus> {
    if port < PORT_MIN {
        return Err(invalid(coded!("errors.friends.portInvalid", min = PORT_MIN, max = super::contract::PORT_MAX)));
    }
    let lan = LanStatus { port, source: PortSource::Manual, pid };
    match lan_detect::verify_port(pid, port).await {
        PortCheck::Ok => {
            remember_lan(shared, instance_id, lan.clone());
            Ok(lan)
        }
        PortCheck::NotOwned => Err(invalid(coded!("errors.friends.portNotGame", port = port))),
        PortCheck::NoAnswer => Err(invalid(coded!("errors.friends.lanUnreachable"))),
    }
}

async fn build_manifest(shared: &Shared, instance: &Instance) -> AppResult<(Vec<Mod>, Manifest)> {
    let (instance, mods_dir, hashes) = (instance.clone(), shared.dirs.mods_dir(&instance.id), shared.hashes.clone());
    blocking(move |_| {
        let manifest = manifest::build(&instance, &mods_dir, &|path| hashes.hash(path));
        Ok((instance.mods, manifest))
    })
    .await
}

fn new_session(instance: &Instance, lan: LanStatus, show_world_name: bool, manifest: (Vec<Mod>, Manifest)) -> Session {
    Session {
        id: new_id(),
        instance_id: instance.id.clone(),
        pid: lan.pid,
        port: lan.port,
        port_source: lan.source,
        show_world_name,
        started_at: now_secs(),
        summary: InstanceSummary {
            name: sanitize::world_or_instance_name(&instance.name),
            minecraft_version: instance.minecraft_version.clone(),
            loader: instance.loader,
            loader_version: instance.loader_version.clone(),
            mod_count: u32::try_from(manifest.1.mods.len()).unwrap_or(u32::MAX),
        },
        manifest,
        guests: Vec::new(),
        stop: CancellationToken::new(),
    }
}

/// Trägt die Sitzung ein, wenn das Spiel noch läuft und keine andere entstanden ist, und startet ihre Überwachung.
fn store_session(shared: &Arc<Shared>, session: Session, pid: u32) -> AppResult<HostSession> {
    let still_running = shared.hosting.game(&session.instance_id).is_some_and(|game| game.pid == pid);
    if !still_running {
        return Err(invalid(coded!("errors.friends.gameNotRunning")));
    }
    let mut current = lock(&shared.hosting.session);
    if current.is_some() {
        return Err(invalid(coded!("errors.friends.sessionActive")));
    }
    let view = session.view(|peer| link_of(shared, peer));
    tokio::spawn(watch_session(Arc::downgrade(shared), session.id.clone(), session.stop.clone()));
    *current = Some(session);
    Ok(view)
}

/// Die Freunde, die eingeladen werden können: bestätigt, nicht entfernt und gerade verbunden.
async fn online_friends(shared: &Shared, friend_ids: &[String]) -> AppResult<Vec<Invitee>> {
    let friends = friends_by_id(shared).await?;
    let mut invitees: Vec<Invitee> = Vec::new();
    for id in friend_ids {
        let peer = parse_friend_id(id)?;
        let friend = friends.get(id).filter(|friend| friend.confirmed && !friend.removed_by_peer);
        let friend = friend.ok_or_else(|| friend_not_found(id))?;
        if shared.friends.connection(&peer).is_none() {
            return Err(invalid(coded!("errors.friends.peerOffline", name = shown_name(friend))));
        }
        if invitees.iter().all(|invitee| invitee.peer != peer) {
            invitees.push(Invitee { peer, name: shown_name(friend), mc_uuid: friend.mc_uuid.clone() });
        }
    }
    Ok(invitees)
}

fn send_session_control(shared: &Shared, peer: &PeerId, message: SessionControl) {
    if shared.friends.send_control(peer, message).is_err() {
        tracing::debug!(peer = %peer.short(), "Sitzungsnachricht nicht zugestellt");
    }
}

fn link_of(shared: &Shared, peer: &PeerId) -> (Option<PathKind>, Option<u32>) {
    let Some(conn) = shared.friends.connection(peer) else { return (None, None) };
    let rtt_ms = conn.rtt().map(|rtt| u32::try_from(rtt.as_millis()).unwrap_or(u32::MAX));
    (conn.path(), rtt_ms)
}

fn current_view(shared: &Shared) -> Option<HostSession> {
    lock(&shared.hosting.session).as_ref().map(|session| session.view(|peer| link_of(shared, peer)))
}

/// Meldet den Stand der geänderten Sitzung an die Oberfläche und gibt ihn zurück. Zwischen Änderung und Meldung kann
/// ein `end_session` sie beendet haben; gemeldet wird unter der Sperre, damit ihr Ende stets nach diesem Stand kommt.
fn announce_session(shared: &Shared, session_id: &str) -> AppResult<HostSession> {
    let mut guard = lock(&shared.hosting.session);
    let view = session_with_id(&mut guard, session_id)?.view(|peer| link_of(shared, peer));
    shared.emit(SessionEvent::HostSession(HostSessionEvent { session: view.clone() }));
    Ok(view)
}

fn announce_if_active(shared: &Shared) {
    if let Some(session) = current_view(shared) {
        shared.emit(SessionEvent::HostSession(HostSessionEvent { session }));
    }
}

/// Beendet die Sitzung, auf die `applies` zutrifft: `inviteRevoke{stopped}` an alle Gäste, dann sind alle Tunnel zu.
fn end_session(shared: &Shared, applies: impl FnOnce(&Session) -> bool, reason: SessionEnd) {
    let ended = {
        let mut current = lock(&shared.hosting.session);
        if current.as_ref().is_some_and(applies) { current.take() } else { None }
    };
    let Some(session) = ended else { return };
    for (peer, invite_id) in session.revocable(now_secs()) {
        send_session_control(shared, &peer, SessionControl::InviteRevoke { invite_id, reason: RevokeReason::Stopped });
    }
    session.stop.cancel();
    for guest in &session.guests {
        guest.stop.cancel();
    }
    shared.emit(SessionEvent::HostSessionEnded(HostSessionEndedEvent { session_id: session.id, reason }));
    mod_link::notify(shared, &session.instance_id, ModNotify::SessionEnded, None);
}

/// Vor dem Abbau der Endpunkte (SPEC 6.1): Abschalten heißt `disabled`, alles andere `stopped`.
pub(super) fn end_for_lifecycle(shared: &Shared, kind: Lifecycle) {
    let reason = if kind == Lifecycle::Disabled { SessionEnd::Disabled } else { SessionEnd::Stopped };
    end_session(shared, |_| true, reason);
}

/// Der Gast hat abgesagt: Einladung zu, später nur nach neuer Einladung (SPEC 5.4).
pub(super) fn declined(shared: &Shared, peer: &PeerId, invite_id: &str) {
    let changed = lock(&shared.hosting.session).as_mut().is_some_and(|session| session.decline(peer, invite_id));
    if changed {
        announce_if_active(shared);
    }
}

pub(super) fn game_spawned(shared: &Shared, instance_id: &str, pid: u32, online_account: bool) {
    lock(&shared.hosting.games).insert(instance_id.to_owned(), Game { pid, online_account, lan: None });
}

/// Ein gemeldeter Port (Mod oder Log) ist nur ein Hinweis: erst die Prüfung macht ihn zum LAN-Port (SPEC 6.1).
pub(super) fn lan_opened(shared: &Arc<Shared>, instance_id: &str, port: u16, source: PortSource) {
    let Some(game) = shared.hosting.game(instance_id) else { return };
    let (shared, instance_id) = (shared.clone(), instance_id.to_owned());
    tokio::spawn(async move {
        let check = lan_detect::verify_port(game.pid, port).await;
        if check != PortCheck::Ok {
            tracing::info!(port, ?source, ?check, "gemeldeter LAN-Port nicht verwendbar");
            return;
        }
        let lan = LanStatus { port, source, pid: game.pid };
        if shared.hosting.game(&instance_id).is_some_and(|current| current.pid == game.pid) {
            remember_lan(&shared, &instance_id, lan.clone());
            switch_session_port(&shared, &instance_id, &lan);
        }
    });
}

fn remember_lan(shared: &Shared, instance_id: &str, lan: LanStatus) {
    let changed = {
        let mut games = lock(&shared.hosting.games);
        let Some(game) = games.get_mut(instance_id) else { return };
        game.lan.replace(lan.clone()).as_ref() != Some(&lan)
    };
    if changed {
        shared.emit(SessionEvent::Lan(LanEvent { instance_id: instance_id.to_owned(), lan: Some(lan) }));
    }
}

/// Ein neuer, geprüfter Port derselben Instanz löst den alten ab; neue Tunnel gehen dann dorthin.
fn switch_session_port(shared: &Shared, instance_id: &str, lan: &LanStatus) {
    let switched = {
        let mut current = lock(&shared.hosting.session);
        let session = current.as_mut().filter(|session| session.instance_id == instance_id && session.port != lan.port);
        session.map(|session| {
            session.port = lan.port;
            session.port_source = lan.source;
        })
    };
    if switched.is_some() {
        announce_if_active(shared);
    }
}

/// Welt geschlossen („Stopping server“, Unpublish oder die Mod): der Port gilt nicht mehr, die Sitzung endet.
pub(super) fn lan_closed(shared: &Shared, instance_id: &str) {
    forget_lan(shared, instance_id);
    end_session(shared, |session| session.instance_id == instance_id, SessionEnd::LanClosed);
}

pub(super) fn game_exited(shared: &Shared, instance_id: &str) {
    let game = lock(&shared.hosting.games).remove(instance_id);
    if game.is_some_and(|game| game.lan.is_some()) {
        shared.emit(SessionEvent::Lan(LanEvent { instance_id: instance_id.to_owned(), lan: None }));
    }
    end_session(shared, |session| session.instance_id == instance_id, SessionEnd::GameExited);
}

fn forget_lan(shared: &Shared, instance_id: &str) {
    let had_lan = lock(&shared.hosting.games).get_mut(instance_id).and_then(|game| game.lan.take()).is_some();
    if had_lan {
        shared.emit(SessionEvent::Lan(LanEvent { instance_id: instance_id.to_owned(), lan: None }));
    }
}

/// Überwacht eine Sitzung bis zu ihrem Ende: Port-Prüfung alle `liveness`, Gäste und Einladungen alle 5 s.
async fn watch_session(shared: Weak<Shared>, session_id: String, stop: CancellationToken) {
    let Some(liveness) = shared.upgrade().map(|shared| shared.liveness) else { return };
    let probe = || {
        let shared = shared.clone();
        async move { session_port_alive(&shared).await }
    };
    tokio::select! {
        () = stop.cancelled() => {}
        () = refresh_regularly(&shared) => {}
        () = until_dead(liveness, probe) => {
            if let Some(shared) = shared.upgrade() {
                end_session(&shared, |session| session.id == session_id, SessionEnd::LanClosed);
            }
        }
    }
}

/// Kehrt zurück, sobald `alive` zweimal hintereinander verneint (SPEC 6.1).
async fn until_dead<F, Fut>(interval: Duration, mut alive: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let mut failures = 0;
    while failures < LIVENESS_FAILURES {
        tokio::time::sleep(interval).await;
        failures = if alive().await { 0 } else { failures + 1 };
    }
}

/// Gehört der Port der Sitzung noch dem Spiel? Eine Abfrage, die scheitert, zählt als nein.
async fn session_port_alive(shared: &Weak<Shared>) -> bool {
    let Some(target) = shared.upgrade().and_then(|shared| {
        lock(&shared.hosting.session).as_ref().map(|session| (session.pid, session.port))
    }) else {
        return false;
    };
    let (pid, port) = target;
    matches!(tokio::task::spawn_blocking(move || sockowner::listens(pid, port)).await, Ok(Ok(true)))
}

async fn refresh_regularly(shared: &Weak<Shared>) {
    let mut last = None;
    loop {
        tokio::time::sleep(REFRESH_INTERVAL).await;
        let Some(shared) = shared.upgrade() else { return };
        close_expired_invites(&shared);
        let view = current_view(&shared);
        if view != last {
            if let Some(session) = view.clone() {
                shared.emit(SessionEvent::HostSession(HostSessionEvent { session }));
            }
            last = view;
        }
    }
}

fn close_expired_invites(shared: &Shared) {
    let expired = lock(&shared.hosting.session).as_mut().map(|session| session.expire_invites(now_secs()));
    for (peer, invite_id) in expired.unwrap_or_default() {
        send_session_control(shared, &peer, SessionControl::InviteRevoke { invite_id, reason: RevokeReason::Expired });
    }
}

/// Ein offener Tunnel eines Gastes; sein Ende zählt der Gast ab.
struct StreamGuard {
    shared: Arc<Shared>,
    session_id: String,
    peer: PeerId,
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        let left = {
            let mut current = lock(&self.shared.hosting.session);
            let session = current.as_mut().filter(|session| session.id == self.session_id);
            session.map(|session| (session.stream_ended(&self.peer), session.instance_id.clone()))
        };
        if let Some((true, instance_id)) = left {
            announce_if_active(&self.shared);
            notify_guest(&self.shared, &instance_id, &self.peer, ModNotify::GuestLeft);
        }
    }
}

/// Wohin ein zugelassener Tunnel geht.
struct Admitted {
    port: u16,
    stop: CancellationToken,
    guard: StreamGuard,
}

fn admit_stream(shared: &Arc<Shared>, peer: &PeerId, session_id: &str) -> Result<Admitted, Refusal> {
    let (admitted, joined, instance_id) = {
        let mut current = lock(&shared.hosting.session);
        let session = current.as_mut().filter(|session| session.id == session_id).ok_or(Refusal::SessionNotFound)?;
        let joined = session.admit_stream(peer, now_secs(), Instant::now())?;
        let stop = session.guest(peer).map_or_else(CancellationToken::new, |guest| guest.stop.child_token());
        let guard = StreamGuard { shared: shared.clone(), session_id: session_id.to_owned(), peer: *peer };
        (Admitted { port: session.port, stop, guard }, joined, session.instance_id.clone())
    };
    if joined {
        announce_if_active(shared);
        notify_guest(shared, &instance_id, peer, ModNotify::GuestJoined);
    }
    Ok(admitted)
}

fn notify_guest(shared: &Shared, instance_id: &str, peer: &PeerId, event: ModNotify) {
    let guest = lock(&shared.hosting.session)
        .as_ref()
        .and_then(|session| session.guest(peer).map(|guest| (guest.name.clone(), guest.mc_uuid.clone())));
    mod_link::notify(shared, instance_id, event, guest);
}

/// Ein Tunnel-Stream eines Freundes (SPEC 6.1): zulassen, `tunnelOk`, Handshake prüfen, erst dann zum LAN-Port.
pub(super) async fn serve_tunnel(shared: &Arc<Shared>, peer: &PeerId, session_id: &str, mut stream: BiStream) {
    let admitted = match admit_stream(shared, peer, session_id) {
        Ok(admitted) => admitted,
        Err(refusal) => return refuse(stream, &TunnelReply::Error { code: refusal.code().to_owned() }).await,
    };
    if frame::write(&mut stream, &TunnelReply::TunnelOk, OPEN_FRAME_LIMIT).await.is_err() {
        return;
    }
    let check = |bytes: &[u8]| mcproto::check_host_opening(bytes, HOST_WINDOW.max_bytes);
    let Some(((), opening)) = mcproto::read_checked(&mut stream, HOST_WINDOW, check).await else {
        return stream.reset(CloseCode::PROTOCOL);
    };
    let Some(lan) = connect_lan(admitted.port, &opening).await else {
        return stream.reset(CloseCode::PROTOCOL);
    };
    if let Err(err) = bridge(stream, lan, Bytes::new(), admitted.stop).await {
        tracing::debug!(peer = %peer.short(), %err, "Tunnel mit Fehler beendet");
    }
    drop(admitted.guard);
}

/// Verbindet nur mit dem geprüften Port auf `127.0.0.1` und reicht die schon geprüften Bytes zuerst weiter.
async fn connect_lan(port: u16, opening: &[u8]) -> Option<TcpStream> {
    let connected = tokio::time::timeout(LAN_CONNECT_WAIT, TcpStream::connect((Ipv4Addr::LOCALHOST, port))).await;
    let mut lan = connected.ok()?.inspect_err(|err| tracing::debug!(port, %err, "LAN-Port nicht erreichbar")).ok()?;
    lan.set_nodelay(true).ok()?;
    lan.write_all(opening).await.ok()?;
    Some(lan)
}

/// Ein Request-Stream (SPEC 5.3): bisher nur `manifestRequest`.
pub(super) async fn serve_request(shared: &Arc<Shared>, peer: &PeerId, mut stream: BiStream) {
    let request = stream.read_frame::<RequestMessage>(REQUEST_FRAME_LIMIT);
    let reply = match tokio::time::timeout(FIRST_FRAME_WAIT, request).await {
        Ok(Ok(RequestMessage::ManifestRequest { session_id })) => manifest_reply(shared, peer, &session_id).await,
        Ok(Ok(RequestMessage::Unknown)) => refusal_reply(Refusal::Unsupported),
        Ok(Err(_)) => return,
        Err(_) => return stream.reset(CloseCode::PROTOCOL),
    };
    if frame::write(&mut stream, &reply, REQUEST_FRAME_LIMIT).await.is_ok() {
        let _ = stream.shutdown().await;
    }
}

fn refusal_reply(refusal: Refusal) -> RequestReply {
    RequestReply::Error { code: refusal.code().to_owned() }
}

async fn manifest_reply(shared: &Shared, peer: &PeerId, session_id: &str) -> RequestReply {
    let admitted = {
        let current = lock(&shared.hosting.session);
        let session = current.as_ref().filter(|session| session.id == session_id);
        session.ok_or(Refusal::SessionNotFound).and_then(|session| {
            session.admit_request(peer, now_secs())?;
            Ok((session.instance_id.clone(), session.manifest.clone()))
        })
    };
    match admitted {
        Ok((instance_id, cached)) => {
            RequestReply::Manifest { manifest: current_manifest(shared, &instance_id, cached).await }
        }
        Err(refusal) => refusal_reply(refusal),
    }
}

/// Das Manifest der Sitzung; hat sich die Mod-Liste der Instanz geändert, wird es neu gebaut und gemerkt.
async fn current_manifest(shared: &Shared, instance_id: &str, cached: (Vec<Mod>, Manifest)) -> Manifest {
    let Ok(instance) = shared.instances.get(instance_id) else { return cached.1 };
    if instance.mods == cached.0 {
        return cached.1;
    }
    match build_manifest(shared, &instance).await {
        Ok(rebuilt) => {
            if let Some(session) = lock(&shared.hosting.session).as_mut().filter(|s| s.instance_id == instance_id) {
                session.manifest = rebuilt.clone();
            }
            rebuilt.1
        }
        Err(err) => {
            tracing::warn!(%err, "Manifest nicht neu gebaut, das alte bleibt");
            cached.1
        }
    }
}

async fn refuse(mut stream: BiStream, reply: &TunnelReply) {
    if frame::write(&mut stream, reply, OPEN_FRAME_LIMIT).await.is_ok() {
        let _ = stream.shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;

    use super::super::lookup::{ModrinthHttp, ModrinthLookup};
    use super::super::sessions::{MojangVersions, SessionContext, PRODUCTION_LIVENESS};
    use super::super::test_support::{error_key, TempDir};
    use super::super::{Friends, JoinTimers, NetOptions};
    use super::*;
    use crate::models::ModLoader;
    use crate::services::gamesignal::GameSignals;
    use crate::services::modbridge::ModBridge;
    use crate::services::secrets::MemorySecretStore;
    use crate::services::store::JsonStore;
    use crate::services::Dirs;

    const NOW: u64 = 1_000_000;

    fn peer(seed: u8) -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[seed; 32]).public())
    }

    fn session() -> Session {
        Session {
            id: "s1".into(),
            instance_id: "i1".into(),
            pid: 1,
            port: 25565,
            port_source: PortSource::Manual,
            show_world_name: false,
            started_at: NOW,
            summary: InstanceSummary {
                name: "Welt".into(),
                minecraft_version: "26.3".into(),
                loader: ModLoader::Vanilla,
                loader_version: None,
                mod_count: 0,
            },
            manifest: (Vec::new(), Manifest {
                minecraft_version: "26.3".into(),
                loader: ModLoader::Vanilla,
                loader_version: None,
                mods: Vec::new(),
            }),
            guests: Vec::new(),
            stop: CancellationToken::new(),
        }
    }

    fn invited(seeds: impl IntoIterator<Item = u8>) -> Session {
        let mut session = session();
        for seed in seeds {
            let invitee = Invitee { peer: peer(seed), name: format!("g{seed}"), mc_uuid: None };
            session.invite(invitee, format!("inv{seed}"), NOW + INVITE_TTL_SECS);
        }
        session
    }

    /// Sitzungen eines Dienstes, der nie startet: genug für den Zustand hinter der Sitzungssperre.
    fn idle_sessions(dir: &TempDir) -> FriendSessions {
        let (signals, dirs) = (GameSignals::default(), Dirs::new(dir.path()));
        let bridge = ModBridge::new(signals.clone());
        let secrets = Arc::new(MemorySecretStore::new());
        let friends = Friends::new(&dirs, secrets, signals.clone(), bridge.clone(), NetOptions::production()).unwrap();
        FriendSessions::new(SessionContext {
            friends,
            signals,
            bridge,
            instances: Arc::new(JsonStore::open(dir.path().join("instances.json")).unwrap()),
            dirs,
            lookup: Arc::new(ModrinthLookup::new(ModrinthHttp::new().unwrap())),
            versions: Arc::new(MojangVersions::new(reqwest::Client::new())),
            timers: JoinTimers::production(),
            liveness: PRODUCTION_LIVENESS,
        })
    }

    fn state_of(session: &Session, seed: u8) -> (GuestState, bool) {
        let guest = session.guest(&peer(seed)).unwrap();
        (guest.state, guest.kicked)
    }

    #[test]
    fn invited_guest_connects_and_leaves_with_its_last_stream() {
        let mut session = invited([1]);
        let clock = Instant::now();

        assert_eq!(session.admit_stream(&peer(1), NOW, clock), Ok(true));
        assert_eq!(session.admit_stream(&peer(1), NOW, clock), Ok(false));
        assert_eq!(state_of(&session, 1), (GuestState::Connected, false));
        assert!(!session.stream_ended(&peer(1)));
        assert!(session.stream_ended(&peer(1)));
        assert_eq!(state_of(&session, 1), (GuestState::Left, false));
    }

    #[test]
    fn strangers_and_expired_invites_are_not_invited() {
        let mut session = invited([1]);
        let clock = Instant::now();

        assert_eq!(session.admit_stream(&peer(9), NOW, clock), Err(Refusal::NotInvited));
        assert_eq!(session.admit_stream(&peer(1), NOW + INVITE_TTL_SECS, clock), Err(Refusal::NotInvited));
        assert_eq!(session.admit_request(&peer(9), NOW), Err(Refusal::NotInvited));
    }

    #[test]
    fn a_kick_shuts_out_streams_and_manifest_requests_until_a_new_invite() {
        let mut session = invited([1]);
        let clock = Instant::now();
        session.admit_stream(&peer(1), NOW, clock).unwrap();
        let tunnels = session.guest(&peer(1)).unwrap().stop.clone();

        assert_eq!(session.kick(&peer(1)), Some("inv1".into()));

        assert!(tunnels.is_cancelled(), "running tunnels are cut");
        assert_eq!(state_of(&session, 1), (GuestState::Left, true));
        assert_eq!(session.admit_stream(&peer(1), NOW, clock), Err(Refusal::NotInvited));
        assert_eq!(session.admit_request(&peer(1), NOW), Err(Refusal::NotInvited));
        session.stream_ended(&peer(1));
        assert_eq!(state_of(&session, 1), (GuestState::Left, true), "the cut stream keeps the kick");
        let again = Invitee { peer: peer(1), name: "g1".into(), mc_uuid: None };
        assert!(session.invite(again, "inv1b".into(), NOW + INVITE_TTL_SECS).is_some());
        assert_eq!(state_of(&session, 1), (GuestState::Invited, false));
        assert_eq!(session.admit_stream(&peer(1), NOW, clock), Ok(true));
    }

    #[test]
    fn a_decline_of_the_current_invite_shuts_the_guest_out() {
        let mut session = invited([1]);

        assert!(!session.decline(&peer(1), "older"));
        assert!(session.decline(&peer(1), "inv1"));

        assert_eq!(state_of(&session, 1), (GuestState::Declined, false));
        assert_eq!(session.admit_request(&peer(1), NOW), Err(Refusal::NotInvited));
    }

    #[test]
    fn a_guest_who_left_on_its_own_may_rejoin_while_the_invite_is_open() {
        let mut session = invited([1]);
        let clock = Instant::now();
        session.admit_stream(&peer(1), NOW, clock).unwrap();
        session.stream_ended(&peer(1));

        assert_eq!(session.admit_stream(&peer(1), NOW + 60, clock), Ok(true));
    }

    #[test]
    fn a_connected_guest_stays_admitted_after_its_invite_expired() {
        let mut session = invited([1]);
        let clock = Instant::now();
        session.admit_stream(&peer(1), NOW, clock).unwrap();

        assert_eq!(session.admit_stream(&peer(1), NOW + INVITE_TTL_SECS + 1, clock), Ok(false));
    }

    #[test]
    fn an_eighth_connected_guest_gets_guest_limit() {
        let mut session = invited(1..=8);
        let clock = Instant::now();
        for seed in 1..=7 {
            session.admit_stream(&peer(seed), NOW, clock).unwrap();
        }

        assert_eq!(session.admit_stream(&peer(8), NOW, clock), Err(Refusal::GuestLimit));
        assert_eq!(session.admit_stream(&peer(7), NOW, clock), Ok(false), "a connected guest is not counted twice");
    }

    #[test]
    fn a_guest_gets_four_concurrent_and_twenty_new_streams_a_minute() {
        let mut session = invited([1]);
        let clock = Instant::now();
        for _ in 0..4 {
            session.admit_stream(&peer(1), NOW, clock).unwrap();
        }
        assert_eq!(session.admit_stream(&peer(1), NOW, clock), Err(Refusal::RateLimited));

        for _ in 0..16 {
            session.stream_ended(&peer(1));
            session.admit_stream(&peer(1), NOW, clock).unwrap();
        }
        session.stream_ended(&peer(1));
        assert_eq!(session.admit_stream(&peer(1), NOW, clock), Err(Refusal::RateLimited));
        assert!(session.admit_stream(&peer(1), NOW, clock + Duration::from_secs(60)).is_ok());
    }

    #[test]
    fn invites_beyond_seven_seats_are_counted_without_shut_out_guests() {
        let mut session = invited(1..=7);
        session.kick(&peer(1));
        session.decline(&peer(2), "inv2");

        assert_eq!(session.seats_with(&[peer(8), peer(9)]), 7);
        assert_eq!(session.seats_with(&[peer(8), peer(9), peer(10)]), 8);
        assert_eq!(session.seats_with(&[peer(3)]), 5, "an invited guest is not counted twice");
    }

    #[test]
    fn a_connected_guest_is_not_invited_again() {
        let mut session = invited([1]);
        session.admit_stream(&peer(1), NOW, Instant::now()).unwrap();

        let again = Invitee { peer: peer(1), name: "g1".into(), mc_uuid: None };
        assert_eq!(session.invite(again, "x".into(), NOW + 1), None);
        assert_eq!(state_of(&session, 1), (GuestState::Connected, false));
    }

    #[test]
    fn expired_invites_are_revoked_and_unconnected_guests_leave_the_list() {
        let mut session = invited([1, 2]);
        session.admit_stream(&peer(2), NOW, Instant::now()).unwrap();

        let expired = session.expire_invites(NOW + INVITE_TTL_SECS);

        assert_eq!(expired.len(), 2);
        assert!(session.guest(&peer(1)).is_none());
        assert_eq!(state_of(&session, 2), (GuestState::Connected, false));
    }

    #[test]
    fn stop_revokes_open_invites_and_connected_guests_only() {
        let mut session = invited([1, 2, 3]);
        session.admit_stream(&peer(2), NOW, Instant::now()).unwrap();
        session.kick(&peer(3));

        let revoked: Vec<String> = session.revocable(NOW).into_iter().map(|(_, id)| id).collect();

        assert_eq!(revoked, ["inv1", "inv2"]);
    }

    #[test]
    fn the_mod_sees_invited_and_connected_guests_only() {
        let mut session = invited([1, 2, 3]);
        session.admit_stream(&peer(2), NOW, Instant::now()).unwrap();
        session.kick(&peer(3));

        let states: Vec<ModGuestState> = session.guests.iter().filter_map(Guest::for_mod).map(|g| g.state).collect();

        assert_eq!(states, [ModGuestState::Invited, ModGuestState::Connected]);
    }

    #[test]
    fn view_shows_path_and_rtt_only_for_connected_guests() {
        let mut session = invited([1, 2]);
        session.admit_stream(&peer(2), NOW, Instant::now()).unwrap();

        let view = session.view(|_| (Some(PathKind::Relay), Some(38)));

        assert_eq!((view.guests[0].path, view.guests[0].rtt_ms), (None, None));
        assert_eq!((view.guests[1].path, view.guests[1].rtt_ms), (Some(PathKind::Relay), Some(38)));
        assert_eq!(view.world_name, None);
    }

    #[tokio::test]
    async fn a_session_ended_before_its_announcement_gives_session_not_found() {
        let dir = TempDir::new();
        let sessions = idle_sessions(&dir);
        *lock(&sessions.shared.hosting.session) = Some(session());
        end_session(&sessions.shared, |_| true, SessionEnd::Stopped);

        let err = announce_session(&sessions.shared, "s1").unwrap_err();

        assert_eq!(error_key(&err), "errors.friends.sessionNotFound");
    }

    #[test]
    fn versions_before_1_20_and_unknown_versions_cannot_be_shared() {
        let versions = VersionIndex::new([
            ("26.3".to_owned(), "2026-09-01T10:00:00+00:00".to_owned()),
            ("1.19.4".to_owned(), "2023-03-14T12:56:18+00:00".to_owned()),
        ]);

        assert!(ensure_supported_version("26.3", &versions).is_ok());
        for version in ["1.19.4", "my-custom"] {
            let err = ensure_supported_version(version, &versions).unwrap_err();
            assert_eq!(error_key(&err), "errors.friends.versionUnsupported", "{version}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn liveness_ends_only_after_two_failed_checks_in_a_row() {
        let answers = std::sync::Mutex::new(vec![true, false, true, false, false, true].into_iter());
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let started = Instant::now();

        until_dead(Duration::from_secs(15), || {
            checks.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::future::ready(lock(&answers).next().unwrap())
        })
        .await;

        assert_eq!(checks.load(std::sync::atomic::Ordering::SeqCst), 5);
        assert_eq!(started.elapsed(), Duration::from_secs(75));
    }

    #[tokio::test]
    async fn the_lan_socket_has_tcp_nodelay_and_gets_the_checked_bytes_first() {
        let server = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = server.local_addr().unwrap().port();

        let lan = connect_lan(port, b"opening").await.unwrap();
        let (mut accepted, _) = server.accept().await.unwrap();
        let mut received = [0u8; 7];
        tokio::io::AsyncReadExt::read_exact(&mut accepted, &mut received).await.unwrap();

        assert!(lan.nodelay().unwrap());
        assert_eq!(&received, b"opening");
    }

    #[tokio::test]
    async fn a_closed_lan_port_gives_no_connection() {
        let port = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap().local_addr().unwrap().port();

        assert!(connect_lan(port, b"x").await.is_none());
    }

    #[test]
    fn stream_replies_have_the_wire_shape() {
        let ok = serde_json::to_value(TunnelReply::TunnelOk).unwrap();
        let refused = serde_json::to_value(TunnelReply::Error { code: Refusal::NotInvited.code().into() }).unwrap();
        let request: RequestMessage =
            serde_json::from_value(serde_json::json!({ "type": "manifestRequest", "sessionId": "s1" })).unwrap();

        assert_eq!(ok, serde_json::json!({ "type": "tunnelOk" }));
        assert_eq!(refused, serde_json::json!({ "type": "error", "code": "notInvited" }));
        assert_eq!(request, RequestMessage::ManifestRequest { session_id: "s1".into() });
    }
}
