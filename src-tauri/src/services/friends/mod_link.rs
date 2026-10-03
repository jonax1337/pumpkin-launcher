//! Verbindung zur Fabric-Mod (SPEC 7.3, 7.4), Launcher-Seite: Stand (Freunde, Gäste, Einladungen) und Hinweise an die
//! Mod, ihre Anfragen als nicht vertrauenswürdig behandelt. Das erste Teilen je Spielstart braucht die Zustimmung im
//! Launcher; Beenden und Rauswerfen verringern nur, was geteilt ist, und gehen ohne.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use tokio::sync::oneshot;
use tokio::time::Instant;

use super::contract::{Friend, ModConfirmEvent, ModConfirmFriend, ModConnectionEvent, ModState, ModStatus, Presence};
use super::limits::{RateLimit, SlidingWindow};
use super::modinstall;
use super::session_events::SessionEvent;
use super::sessions::{shown_name, FriendSessions, Shared};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::new_id;
use crate::services::gamesignal::ModRequest;
use crate::services::lock;
use crate::services::modbridge::protocol::{
    LauncherToMod, ModErrorCode, ModFriend, ModNotify, ModPresence, ModSession, MAX_LINE_BYTES,
};
use crate::services::p2p::PeerId;

/// So lange wartet ein `share` der Mod auf die Antwort im Launcher (SPEC 7.4).
const CONFIRM_WAIT: Duration = Duration::from_secs(120);
const SHARES_AFTER_ALLOW: RateLimit = RateLimit { max: 3, window: Duration::from_secs(60) };
/// So oft wird der Stand für verbundene Mods neu gebaut; die Brücke sendet höchstens alle 250 ms.
const REFRESH_INTERVAL: Duration = Duration::from_secs(1);
const MAX_MOD_FRIENDS: usize = 50;

/// Zustimmungen je Spielstart, offene Rückfragen und was die Mods zuletzt bekamen.
#[derive(Default)]
pub(super) struct ModLink {
    launches: Mutex<HashMap<String, Grant>>,
    pending: Mutex<HashMap<String, Pending>>,
    pushed: Mutex<HashMap<String, LauncherToMod>>,
    /// Präsenz der Freunde beim letzten Abgleich; `None` vor dem ersten.
    presence: Mutex<Option<HashMap<String, Presence>>>,
    /// Ein gekürzter Stand wird nur einmal gemeldet, nicht bei jedem Abgleich.
    trim_reported: AtomicBool,
}

/// Was ein Spielstart (Token-Lebensdauer, `Spawned` bis `Exited`) schon darf.
struct Grant {
    consent: Consent,
    shares: SlidingWindow<()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Consent {
    Unasked,
    Asking,
    Allowed,
}

impl Default for Grant {
    fn default() -> Self {
        Self { consent: Consent::Unasked, shares: SlidingWindow::new(SHARES_AFTER_ALLOW) }
    }
}

struct Pending {
    instance_id: String,
    answer: oneshot::Sender<bool>,
}

impl ModLink {
    /// Ein neuer Spielstart beginnt ohne Zustimmung.
    pub(super) fn new_launch(&self, instance_id: &str) {
        lock(&self.launches).insert(instance_id.to_owned(), Grant::default());
        lock(&self.pushed).remove(instance_id);
    }

    /// Das Spiel ist beendet: Zustimmung und offene Rückfragen verfallen (eine wartende gilt als abgelehnt).
    pub(super) fn forget_launch(&self, instance_id: &str) {
        lock(&self.launches).remove(instance_id);
        lock(&self.pushed).remove(instance_id);
        lock(&self.pending).retain(|_, pending| pending.instance_id != instance_id);
    }

    fn consent(&self, instance_id: &str) -> Consent {
        lock(&self.launches).entry(instance_id.to_owned()).or_default().consent
    }

    fn set_consent(&self, instance_id: &str, consent: Consent) {
        lock(&self.launches).entry(instance_id.to_owned()).or_default().consent = consent;
    }

    /// Nach der Zustimmung höchstens drei `share` je Minute.
    fn take_share(&self, instance_id: &str) -> bool {
        lock(&self.launches).entry(instance_id.to_owned()).or_default().shares.try_hit((), Instant::now())
    }

    /// Freunde, die seit dem letzten Abgleich von offline auf online oder spielend gewechselt sind; der erste Abgleich
    /// merkt sich nur den Stand.
    fn came_online<'a>(&self, friends: &'a [Friend]) -> Vec<&'a Friend> {
        let now = friends.iter().map(|friend| (friend.id.clone(), friend.presence)).collect();
        let Some(before) = lock(&self.presence).replace(now) else { return Vec::new() };
        let was_offline = |friend: &Friend| before.get(&friend.id).is_none_or(|before| *before == Presence::Offline);
        friends.iter().filter(|friend| friend.presence != Presence::Offline && was_offline(friend)).collect()
    }

    fn ask(&self, instance_id: &str) -> (String, oneshot::Receiver<bool>) {
        let (answer, answered) = oneshot::channel();
        let request_id = new_id();
        lock(&self.pending).insert(request_id.clone(), Pending { instance_id: instance_id.to_owned(), answer });
        self.set_consent(instance_id, Consent::Asking);
        (request_id, answered)
    }
}

impl FriendSessions {
    /// Zustand der Mod in der Instanz; eine verbundene Mod ist immer `connected`.
    pub async fn mod_status(&self, instance_id: &str) -> AppResult<ModStatus> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let instance = shared.instances.get(instance_id)?;
        if shared.bridge.is_connected(instance_id) {
            return Ok(ModStatus { state: ModState::Connected });
        }
        Ok(ModStatus { state: modinstall::status(&instance) })
    }

    /// Die Antwort des Nutzers auf `friends-mod-confirm` (SPEC 7.4).
    pub async fn mod_confirm(&self, request_id: &str, allow: bool) -> AppResult<()> {
        let pending = lock(&self.shared.mods.pending).remove(request_id);
        let pending = pending.ok_or_else(|| {
            AppError::NotFound(coded!("errors.friends.notFound.request", id = request_id).into())
        })?;
        let _ = pending.answer.send(allow);
        Ok(())
    }
}

/// Eine neue Verbindung bekommt beim nächsten Abgleich den ganzen Stand.
pub(super) fn connected(shared: &Shared, instance_id: &str) {
    lock(&shared.mods.pushed).remove(instance_id);
    announce_connection(shared, instance_id, true);
}

pub(super) fn disconnected(shared: &Shared, instance_id: &str) {
    announce_connection(shared, instance_id, false);
}

fn announce_connection(shared: &Shared, instance_id: &str, connected: bool) {
    let event = ModConnectionEvent { instance_id: instance_id.to_owned(), connected };
    shared.emit(SessionEvent::ModConnection(event));
}

/// Ein Hinweis an die Mod der Instanz; `who` sind Name und Minecraft-UUID der Person, um die es geht.
pub(super) fn notify(shared: &Shared, instance_id: &str, event: ModNotify, who: Option<(String, Option<String>)>) {
    let (name, mc_uuid) = who.map_or((None, None), |(name, mc_uuid)| (Some(name), mc_uuid));
    shared.bridge.push(instance_id, LauncherToMod::Notify { event, name, mc_uuid });
}

fn push_error(shared: &Shared, instance_id: &str, code: ModErrorCode) {
    shared.bridge.push(instance_id, LauncherToMod::Error { code, r#ref: None });
}

/// Eine Anfrage der Mod; die Brücke hat Aliasse schon in Peer-IDs übersetzt und Unpassendes verworfen (SPEC 7.3).
pub(super) async fn handle(shared: Arc<Shared>, instance_id: String, request: ModRequest) {
    let sessions = FriendSessions { shared: shared.clone() };
    let outcome = match request {
        ModRequest::StopSharing => {
            sessions.host_stop_for_instance(&instance_id);
            Ok(())
        }
        ModRequest::Kick { friend_id } => kick(&sessions, &instance_id, &friend_id).await,
        ModRequest::Share { friend_ids } => share(&sessions, &instance_id, friend_ids).await,
    };
    if let Err(code) = outcome {
        push_error(&shared, &instance_id, code);
    }
}

async fn kick(sessions: &FriendSessions, instance_id: &str, friend_id: &str) -> Result<(), ModErrorCode> {
    let Some(session_id) = sessions.shared.hosting.session_of(instance_id) else { return Ok(()) };
    sessions.host_kick(&session_id, friend_id).await.map(drop).map_err(mod_error)
}

/// Teilen aus dem Spiel (SPEC 7.4): nur mit verbundenen, bestätigten Freunden, beim ersten Mal je Start nach
/// Zustimmung im Launcher, danach höchstens dreimal je Minute.
async fn share(sessions: &FriendSessions, instance_id: &str, friend_ids: Vec<String>) -> Result<(), ModErrorCode> {
    let shared = &sessions.shared;
    shared.ensure_enabled().map_err(mod_error)?;
    let friends = online_friends(shared, &friend_ids).await?;
    ensure_consent(shared, instance_id, friends).await?;
    if !shared.mods.take_share(instance_id) {
        return Err(ModErrorCode::Busy);
    }
    let session_id = match shared.hosting.session_of(instance_id) {
        Some(session_id) => session_id,
        None => sessions.host_start(instance_id, None, false).await.map_err(mod_error)?.id,
    };
    sessions.host_invite(&session_id, friend_ids).await.map(drop).map_err(mod_error)
}

/// Die genannten Freunde für die Rückfrage; jeder muss bestätigt und verbunden sein.
async fn online_friends(shared: &Shared, friend_ids: &[String]) -> Result<Vec<ModConfirmFriend>, ModErrorCode> {
    let friends = shared.friends.list().await.map_err(mod_error)?;
    friend_ids
        .iter()
        .map(|id| {
            let friend = friends.iter().find(|friend| friend.id == *id && friend.confirmed);
            let connected = friend.filter(|friend| is_connected(shared, &friend.id));
            let friend = connected.ok_or(ModErrorCode::PeerOffline)?;
            Ok(ModConfirmFriend { friend_id: friend.id.clone(), display_name: shown_name(friend) })
        })
        .collect()
}

fn is_connected(shared: &Shared, friend_id: &str) -> bool {
    friend_id.parse::<PeerId>().is_ok_and(|peer| shared.friends.connection(&peer).is_some())
}

async fn ensure_consent(
    shared: &Shared,
    instance_id: &str,
    friends: Vec<ModConfirmFriend>,
) -> Result<(), ModErrorCode> {
    match shared.mods.consent(instance_id) {
        Consent::Allowed => Ok(()),
        Consent::Asking => Err(ModErrorCode::Busy),
        Consent::Unasked if ask_user(shared, instance_id, friends).await => Ok(()),
        Consent::Unasked => Err(ModErrorCode::Denied),
    }
}

/// Fragt im Launcher nach (`friends-mod-confirm`) und merkt sich ein Erlauben für den Rest des Spielstarts.
async fn ask_user(shared: &Shared, instance_id: &str, friends: Vec<ModConfirmFriend>) -> bool {
    let (request_id, answered) = shared.mods.ask(instance_id);
    let instance_name = shared.instances.get(instance_id).map(|instance| instance.name).unwrap_or_default();
    let instance_id_owned = instance_id.to_owned();
    let request = ModConfirmEvent { request_id: request_id.clone(), instance_id: instance_id_owned, instance_name, friends };
    shared.emit(SessionEvent::ModConfirm(request));
    notify(shared, instance_id, ModNotify::ConfirmInLauncher, None);
    let allowed = answer_within(answered, CONFIRM_WAIT).await;
    lock(&shared.mods.pending).remove(&request_id);
    shared.mods.set_consent(instance_id, if allowed { Consent::Allowed } else { Consent::Unasked });
    allowed
}

/// Keine Antwort in der Zeit oder eine verworfene Rückfrage zählt als Ablehnung.
async fn answer_within(answered: oneshot::Receiver<bool>, wait: Duration) -> bool {
    matches!(tokio::time::timeout(wait, answered).await, Ok(Ok(true)))
}

/// Fehler des Launchers als Code, den die Mod kennt (SPEC 7.3).
fn mod_error(err: AppError) -> ModErrorCode {
    let wire = serde_json::to_value(&err).unwrap_or_default();
    match wire["key"].as_str().unwrap_or_default() {
        "errors.friends.disabled" | "errors.friends.unavailable" | "errors.friends.identityLost" => {
            ModErrorCode::NotEnabled
        }
        "errors.friends.peerOffline" => ModErrorCode::PeerOffline,
        "errors.friends.guestLimit" => ModErrorCode::GuestLimit,
        "errors.friends.lanPortUnknown" | "errors.friends.lanUnreachable" => ModErrorCode::LanPortUnknown,
        "errors.friends.portNotGame" => ModErrorCode::PortNotGame,
        "errors.friends.versionUnsupported" => ModErrorCode::VersionUnsupported,
        "errors.friends.sessionActive" => ModErrorCode::Busy,
        _ => ModErrorCode::Internal,
    }
}

/// Hält den Stand jeder verbundenen Mod aktuell und meldet Freunde, die online kommen.
pub(super) async fn refresh_regularly(shared: Weak<Shared>) {
    let mut ticks = tokio::time::interval(REFRESH_INTERVAL);
    loop {
        ticks.tick().await;
        let Some(shared) = shared.upgrade() else { return };
        refresh(&shared).await;
    }
}

async fn refresh(shared: &Shared) {
    let friends = shared.friends.list().await.unwrap_or_default();
    let running = shared.hosting.running_instances().into_iter();
    let instances: Vec<String> = running.filter(|instance| shared.bridge.is_connected(instance)).collect();
    for friend in shared.mods.came_online(&friends) {
        for instance_id in &instances {
            let who = Some((shown_name(friend), friend.mc_uuid.clone()));
            notify(shared, instance_id, ModNotify::FriendOnline, who);
        }
    }
    for instance_id in &instances {
        push_if_changed(shared, instance_id, snapshot(shared, instance_id, &friends));
    }
}

fn push_if_changed(shared: &Shared, instance_id: &str, snapshot: LauncherToMod) {
    let previous = lock(&shared.mods.pushed).insert(instance_id.to_owned(), snapshot.clone());
    if previous.as_ref() != Some(&snapshot) {
        shared.bridge.push(instance_id, snapshot);
    }
}

/// Der Stand für die Mod mit echten Peer-IDs (die Brücke ersetzt sie durch Aliasse); alle Namen sind bei ihrer
/// Herkunft schon bereinigt (SPEC 12.3), höchstens 50 Freunde und 20 Einladungen und nie länger als eine Zeile.
fn snapshot(shared: &Shared, instance_id: &str, friends: &[Friend]) -> LauncherToMod {
    let confirmed = friends.iter().filter(|friend| friend.confirmed && !friend.removed_by_peer);
    let (snapshot, dropped) = fit_into_line(LauncherToMod::Snapshot {
        friends: confirmed.take(MAX_MOD_FRIENDS).map(mod_friend).collect(),
        session: shared.hosting.guests_for_mod(instance_id).map(|guests| ModSession { guests }),
        invites: shared.invites.for_mod(),
    });
    if dropped > 0 && !shared.mods.trim_reported.swap(true, Ordering::Relaxed) {
        tracing::warn!(dropped, "Stand für die Mod gekürzt, er passte nicht in eine Zeile");
    }
    snapshot
}

/// Lässt am Ende Freunde, dann Einladungen weg, bis der Stand in eine Zeile des Mod-Protokolls passt; die Mod trennte
/// sonst die Verbindung und bekäme beim Wiederverbinden denselben Stand. Gemessen mit den echten Peer-IDs, die länger
/// sind als die Aliasse auf der Leitung. Liefert auch die Zahl der weggelassenen Einträge.
fn fit_into_line(mut snapshot: LauncherToMod) -> (LauncherToMod, usize) {
    let mut dropped = 0;
    while line_bytes(&snapshot) > MAX_LINE_BYTES {
        let LauncherToMod::Snapshot { friends, invites, .. } = &mut snapshot else { break };
        if friends.pop().is_none() && invites.pop().is_none() {
            break;
        }
        dropped += 1;
    }
    (snapshot, dropped)
}

/// Länge der Nachricht als JSON-Zeile samt Zeilenende.
fn line_bytes(message: &LauncherToMod) -> usize {
    serde_json::to_vec(message).map_or(usize::MAX, |json| json.len() + 1)
}

fn mod_friend(friend: &Friend) -> ModFriend {
    let presence = match friend.presence {
        Presence::Offline => ModPresence::Offline,
        Presence::Online => ModPresence::Online,
        Presence::Playing => ModPresence::Playing,
    };
    ModFriend { id: friend.id.clone(), name: shown_name(friend), mc_uuid: friend.mc_uuid.clone(), presence }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::test_support::error_key;
    use crate::services::modbridge::protocol::ModInvite;

    #[tokio::test(start_paused = true)]
    async fn no_answer_within_two_minutes_counts_as_denied() {
        let (_answer, answered) = oneshot::channel::<bool>();
        let started = Instant::now();

        assert!(!answer_within(answered, CONFIRM_WAIT).await);
        assert_eq!(started.elapsed(), CONFIRM_WAIT);
    }

    #[tokio::test(start_paused = true)]
    async fn only_an_explicit_allow_counts() {
        let answers = [Some(true), Some(false), None];
        let mut results = Vec::new();
        for answer in answers {
            let (sender, answered) = oneshot::channel();
            if let Some(allow) = answer {
                sender.send(allow).unwrap();
            }
            results.push(answer_within(answered, CONFIRM_WAIT).await);
        }

        assert_eq!(results, [true, false, false]);
    }

    #[tokio::test(start_paused = true)]
    async fn after_the_allow_three_shares_a_minute_pass() {
        let link = ModLink::default();
        link.new_launch("i1");

        let passed = (0..4).filter(|_| link.take_share("i1")).count();

        assert_eq!(passed, 3);
    }

    #[test]
    fn a_new_launch_needs_consent_again_and_an_exit_drops_the_question() {
        let link = ModLink::default();
        link.new_launch("i1");
        link.set_consent("i1", Consent::Allowed);
        let (request_id, _answered) = link.ask("i2");

        link.new_launch("i1");
        link.forget_launch("i2");

        assert_eq!(link.consent("i1"), Consent::Unasked);
        assert!(!lock(&link.pending).contains_key(&request_id));
    }

    #[test]
    fn launcher_errors_become_mod_error_codes() {
        let cases = [
            (AppError::invalid(coded!("errors.friends.disabled")), ModErrorCode::NotEnabled),
            (AppError::invalid(coded!("errors.friends.peerOffline", name = "Bert")), ModErrorCode::PeerOffline),
            (AppError::invalid(coded!("errors.friends.guestLimit", max = 7)), ModErrorCode::GuestLimit),
            (AppError::invalid(coded!("errors.friends.lanPortUnknown")), ModErrorCode::LanPortUnknown),
            (AppError::invalid(coded!("errors.friends.portNotGame", port = 1)), ModErrorCode::PortNotGame),
            (
                AppError::invalid(coded!("errors.friends.versionUnsupported", min = "1.20")),
                ModErrorCode::VersionUnsupported,
            ),
            (AppError::invalid(coded!("errors.friends.sessionActive")), ModErrorCode::Busy),
            (AppError::Cancelled, ModErrorCode::Internal),
        ];

        for (err, code) in cases {
            let key = error_key(&err);
            assert_eq!(mod_error(err), code, "{key}");
        }
    }

    fn friend(id: &str, presence: Presence) -> Friend {
        Friend {
            id: id.into(),
            display_name: format!("Name {id}"),
            alias: None,
            mc_name: None,
            mc_uuid: None,
            fingerprint: String::new(),
            added_at: 0,
            last_seen: None,
            confirmed: true,
            removed_by_peer: false,
            notice: None,
            presence,
            path: None,
        }
    }

    #[test]
    fn only_friends_coming_online_after_the_first_look_are_announced() {
        let link = ModLink::default();

        assert!(link.came_online(&[friend("a", Presence::Online), friend("b", Presence::Offline)]).is_empty());
        let next = [friend("a", Presence::Playing), friend("b", Presence::Online), friend("c", Presence::Online)];
        let announced: Vec<&str> = link.came_online(&next).into_iter().map(|friend| friend.id.as_str()).collect();

        assert_eq!(announced, ["b", "c"]);
    }

    /// Ein Freund mit 64-stelliger ID und dem längsten Namen aus Zeichen mit vier UTF-8-Bytes.
    fn widest_friend(index: usize) -> ModFriend {
        ModFriend {
            id: format!("{index:064x}"),
            name: "\u{1F383}".repeat(32),
            mc_uuid: Some("0".repeat(32)),
            presence: ModPresence::Playing,
        }
    }

    fn widest_invite(index: usize) -> ModInvite {
        ModInvite { id: format!("{index:036}"), from_name: "\u{1F383}".repeat(32), title: "\u{1F383}".repeat(64) }
    }

    #[test]
    fn a_snapshot_at_the_count_caps_still_fits_into_one_line() {
        let full = LauncherToMod::Snapshot {
            friends: (0..MAX_MOD_FRIENDS).map(widest_friend).collect(),
            session: None,
            invites: (0..20).map(widest_invite).collect(),
        };
        assert!(line_bytes(&full) > MAX_LINE_BYTES, "the caps alone allow oversized lines");

        let (fitted, dropped) = fit_into_line(full);

        assert!(line_bytes(&fitted) <= MAX_LINE_BYTES);
        let LauncherToMod::Snapshot { friends, invites, .. } = fitted else { panic!("{fitted:?}") };
        assert_eq!(friends.len() + invites.len() + dropped, MAX_MOD_FRIENDS + 20);
        assert_eq!(friends[0], widest_friend(0), "the head of the list stays");
        assert_eq!(invites.len(), 20, "friends go first");
    }

    #[test]
    fn a_snapshot_that_fits_stays_whole() {
        let small = LauncherToMod::Snapshot { friends: vec![widest_friend(1)], session: None, invites: Vec::new() };

        assert_eq!(fit_into_line(small.clone()), (small, 0));
    }

    #[test]
    fn presence_maps_one_to_one_and_the_alias_is_the_shown_name() {
        let mut playing = friend("a", Presence::Playing);
        playing.alias = Some("Kumpel".into());

        let shown = mod_friend(&playing);

        assert_eq!((shown.name.as_str(), shown.presence), ("Kumpel", ModPresence::Playing));
        assert_eq!(mod_friend(&friend("b", Presence::Offline)).presence, ModPresence::Offline);
    }
}
