//! Verbindung zur Mod im Spiel (INGAME 5, SPEC 7), Launcher-Seite: Themen (Freunde, Anfragen, Sitzung, Einladungen,
//! Beitritt, Spiel, Codes, Gesperrte, ich) und Hinweise an die Mod, ihre Vorgänge als nicht vertrauenswürdig behandelt.
//! Die Brücke (`modbridge`) prüft Rahmen, Ratenfenster und Zustimmungen je Spielstart; was ein Vorgang bewirkt, steht in
//! `mod_link_ops` (Einteilung), `mod_link_social` (Freunde und Anfragen), `mod_link_join` (Beitreten) und im Teilen
//! von `hosting`, was die Themen enthalten, in `mod_link_topics`. Die Rückfrage im Launcher und die Spur in der
//! Aktivitätsliste gehören zu jedem Vorgang eines Bereichs (`mod_link_consent`, `mod_link_activity`).
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use tokio::sync::oneshot;

use super::contract::{
    Friend, FriendRequest, ModActivityEntry, ModConnectionEvent, ModOpenEvent, Presence,
    RequestDirection, RequestState,
};
use super::session_events::SessionEvent;
use super::sessions::{shown_name, FriendSessions, Shared};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::new_id;
use crate::services::gamesignal::ModRequest;
use crate::services::lock;
use crate::services::modbridge::protocol::ModNotify;

#[path = "mod_link_activity.rs"]
mod activity;
#[path = "mod_link_consent.rs"]
mod consent;
#[path = "mod_link_errors.rs"]
mod errors;
#[path = "mod_link_events.rs"]
mod events;
#[path = "mod_link_join.rs"]
mod join;
#[path = "mod_link_ops.rs"]
mod ops;
#[path = "mod_link_social.rs"]
mod social;
#[path = "mod_link_topics.rs"]
mod topics;

pub use events::{ModAppEvents, TauriModAppEvents};

/// So lange wartet ein Vorgang der Mod auf die Antwort im Launcher (SPEC 7.4).
const CONFIRM_WAIT: Duration = Duration::from_secs(120);
/// So oft werden die Themen für verbundene Mods neu gebaut; die Brücke sendet je Thema höchstens alle 250 ms.
const REFRESH_INTERVAL: Duration = Duration::from_secs(1);

/// Offene Rückfragen im Launcher, die Präsenz beim letzten Abgleich und die Spur der Vorgänge aus dem Spiel. Zustimmungen
/// und Zähler gehören dem Spielstart in der Brücke.
#[derive(Default)]
pub(super) struct ModLink {
    pending: Mutex<HashMap<String, Pending>>,
    /// Präsenz der Freunde beim letzten Abgleich; `None` vor dem ersten.
    presence: Mutex<Option<HashMap<String, Presence>>>,
    /// Eingehende Anfragen beim letzten Abgleich; `None` vor dem ersten.
    incoming_seen: Mutex<Option<HashSet<String>>>,
    activity: activity::ActivityLog,
    app_events: events::AppEventSink,
    /// Wer gerade einen Beitritt aus dem Spiel vorbereitet, hält das Tor: es gibt höchstens einen zugleich.
    join_gate: tokio::sync::Mutex<()>,
}

struct Pending {
    instance_id: String,
    answer: oneshot::Sender<bool>,
}

impl ModLink {
    /// Ein neuer Spielstart beginnt ohne offene Rückfrage.
    pub(super) fn new_launch(&self, instance_id: &str) {
        self.drop_questions(instance_id);
    }

    /// Das Spiel ist beendet: offene Rückfragen verfallen (eine wartende gilt als abgelehnt).
    pub(super) fn forget_launch(&self, instance_id: &str) {
        self.drop_questions(instance_id);
    }

    fn drop_questions(&self, instance_id: &str) {
        lock(&self.pending).retain(|_, pending| pending.instance_id != instance_id);
    }


    pub(super) fn revoke_friends(&self) {
        lock(&self.pending).clear();
        *lock(&self.presence) = None;
        *lock(&self.incoming_seen) = None;
    }
    /// Ob irgendein Spiel auf eine Antwort des Nutzers wartet; dann bringt `launcher.open` das Fenster nicht nach vorn.
    fn has_open_question(&self) -> bool {
        !lock(&self.pending).is_empty()
    }

    /// Freunde, die seit dem letzten Abgleich von offline auf online oder spielend gewechselt sind; der erste Abgleich
    /// merkt sich nur den Stand.
    fn came_online<'a>(&self, friends: &'a [Friend]) -> Vec<&'a Friend> {
        let now = friends
            .iter()
            .map(|friend| (friend.id.clone(), friend.presence))
            .collect();
        let Some(before) = lock(&self.presence).replace(now) else {
            return Vec::new();
        };
        let was_offline = |friend: &Friend| {
            before
                .get(&friend.id)
                .is_none_or(|before| *before == Presence::Offline)
        };
        friends
            .iter()
            .filter(|friend| friend.presence != Presence::Offline && was_offline(friend))
            .collect()
    }

    /// Eingehende Anfragen, die seit dem letzten Abgleich neu sind; der erste Abgleich merkt sich nur den Stand.
    fn newly_received<'a>(&self, requests: &'a [FriendRequest]) -> Vec<&'a FriendRequest> {
        let waiting = |request: &&FriendRequest| {
            request.direction == RequestDirection::Incoming
                && request.state == RequestState::Pending
        };
        let current: Vec<&FriendRequest> = requests.iter().filter(waiting).collect();
        let now = current.iter().map(|request| request.id.clone()).collect();
        let Some(before) = lock(&self.incoming_seen).replace(now) else {
            return Vec::new();
        };
        current
            .into_iter()
            .filter(|request| !before.contains(&request.id))
            .collect()
    }

    fn ask(&self, instance_id: &str) -> (String, oneshot::Receiver<bool>) {
        let (answer, answered) = oneshot::channel();
        let request_id = new_id();
        lock(&self.pending).insert(
            request_id.clone(),
            Pending {
                instance_id: instance_id.to_owned(),
                answer,
            },
        );
        (request_id, answered)
    }

    /// Trägt den Vorgang in die Aktivitätsliste ein und meldet ihn der Oberfläche.
    fn record_activity(&self, entry: ModActivityEntry) {
        self.activity.record(entry.clone());
        self.app_events.get().activity(entry);
    }

    /// Bittet die Oberfläche, das Fenster des Launchers nach vorn zu holen und zu zeigen, was `event` nennt.
    fn open_launcher(&self, event: ModOpenEvent) {
        self.app_events.get().open_launcher(event);
    }
}

impl FriendSessions {
    /// Die Antwort des Nutzers auf `friends-mod-confirm` (SPEC 7.4).
    pub async fn mod_confirm(&self, request_id: &str, allow: bool) -> AppResult<()> {
        self.shared.ensure_enabled()?;
        let pending = lock(&self.shared.mods.pending).remove(request_id);
        let pending = pending.ok_or_else(|| {
            AppError::NotFound(coded!("errors.friends.notFound.request", id = request_id).into())
        })?;
        let _ = pending.answer.send(allow);
        Ok(())
    }

    /// Die Vorgänge der Bereiche `share` und `social`, die aus dem Spiel kamen (INGAME 5.7), neueste zuerst; höchstens 100.
    pub fn mod_activity(&self) -> Vec<ModActivityEntry> {
        self.shared.mods.activity.list()
    }

    /// Setzt den Empfänger für Aktivitätseinträge und `launcher.open`.
    pub(super) fn attach_app_events(&self, events: Arc<dyn ModAppEvents>) {
        self.shared.mods.app_events.set(events);
    }

    /// Wie `attach_app_events`, mit den Tauri-Events der App: `friends-mod-activity` und `friends-mod-open`.
    pub fn forward_mod_events_to(&self, app: tauri::AppHandle) {
        self.attach_app_events(Arc::new(TauriModAppEvents(app)));
    }
}

/// Eine neue Verbindung bekommt von der Brücke sofort den letzten Stand jedes Themas.
pub(super) fn connected(shared: &Shared, instance_id: &str) {
    announce_connection(shared, instance_id, true);
    if !shared.friends.state().enabled {
        topics::publish_unavailable(shared, instance_id);
    }
}

/// Eine beendete Verbindung weckt das Verzeichnis: wartet es auf das Ende der Spiele, macht es jetzt weiter.
pub(super) fn disconnected(shared: &Shared, instance_id: &str) {
    announce_connection(shared, instance_id, false);
    shared.friends.game_link_ended();
}

fn announce_connection(shared: &Shared, instance_id: &str, connected: bool) {
    let event = ModConnectionEvent {
        instance_id: instance_id.to_owned(),
        connected,
    };
    shared.emit(SessionEvent::ModConnection(event));
    shared.mods.app_events.get().link_changed(instance_id);
}

/// Ein Hinweis an die Mod der Instanz; `who` sind Name und Minecraft-UUID der Person, um die es geht (die Mod zeigt
/// nur den Namen).
pub(super) fn notify(
    shared: &Shared,
    instance_id: &str,
    event: ModNotify,
    who: Option<(String, Option<String>)>,
) {
    shared
        .bridge
        .notify(instance_id, event, who.map(|(name, _mc_uuid)| name));
}

/// Vorgänge der Mod laufen über den `OpHandler` der Brücke und ihre Zustimmungen je Spielstart; das Spielsignal
/// `ModRequest` erzeugt die Brücke nicht mehr. Käme eines an, würde es hier nichts ausführen: es hätte keine Zustimmung.
pub(super) async fn handle(_shared: Arc<Shared>, instance_id: String, request: ModRequest) {
    tracing::warn!(instance = %instance_id, ?request, "Spielsignal ModRequest ignoriert: Vorgänge laufen über die Brücke");
}

/// Setzt den Bearbeiter der Vorgänge in die Brücke ein und hält die Themen jeder verbundenen Mod aktuell; meldet
/// auch Freunde, die online kommen, und neue Anfragen.
pub(super) async fn refresh_regularly(shared: Weak<Shared>) {
    let Some(strong) = shared.upgrade() else {
        return;
    };
    strong
        .bridge
        .set_handler(Arc::new(ops::ModOps::new(shared.clone())));
    watch_game_links(&strong);
    drop(strong);
    let mut ticks = tokio::time::interval(REFRESH_INTERVAL);
    loop {
        ticks.tick().await;
        let Some(shared) = shared.upgrade() else {
            return;
        };
        refresh(&shared).await;
    }
}

/// Sagt dem Freunde-Dienst, ob ein Spiel mit der Mod verbunden ist: dann holt er kein neues Zertifikat bei Mojang.
fn watch_game_links(shared: &Shared) {
    let bridge = shared.bridge.clone();
    if shared
        .friends
        .watch_game_links(Arc::new(move || bridge.has_active_link()))
        .is_err()
    {
        tracing::warn!("Die Spielverbindungen wurden dem Freunde-Dienst schon gemeldet");
    }
}

pub(super) fn disabled(shared: &Shared) {
    shared.mods.revoke_friends();
    for instance_id in shared.hosting.running_instances() {
        topics::publish_unavailable(shared, &instance_id);
    }
}

async fn refresh(shared: &Arc<Shared>) {
    let publication = shared.bridge.friends_publication();
    let friends = shared.friends.list().await.unwrap_or_default();
    let requests = shared.friends.requests().await.unwrap_or_default();
    if !publication.is_current() {
        return;
    }
    let running = shared.hosting.running_instances().into_iter();
    let instances: Vec<String> = running
        .filter(|instance| shared.bridge.is_connected(instance))
        .collect();
    for friend in shared.mods.came_online(&friends) {
        let who = Some((shown_name(friend), friend.mc_uuid.clone()));
        notify_all(&publication, &instances, ModNotify::FriendOnline, &who);
    }
    for request in shared.mods.newly_received(&requests) {
        let name = request
            .mc_name
            .clone()
            .or_else(|| request.display_name.clone())
            .unwrap_or_default();
        notify_all(
            &publication,
            &instances,
            ModNotify::RequestReceived,
            &Some((name, None)),
        );
    }
    for instance_id in &instances {
        topics::publish(shared, &publication, instance_id, &friends, &requests).await;
    }
}

fn notify_all(
    publication: &crate::services::modbridge::FriendsPublication<'_>,
    instances: &[String],
    event: ModNotify,
    who: &Option<(String, Option<String>)>,
) {
    for instance_id in instances {
        publication.notify(instance_id, event, who.as_ref().map(|(name, _)| name.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn request(id: &str, direction: RequestDirection, state: RequestState) -> FriendRequest {
        FriendRequest {
            id: id.into(),
            direction,
            state,
            peer_id: None,
            fingerprint: None,
            display_name: Some(format!("Name {id}")),
            mc_name: None,
            code_tail: None,
            created_at: 0,
            expires_at: 0,
            via: Default::default(),
        }
    }

    #[test]
    fn a_new_launch_and_an_exit_drop_the_open_questions_of_that_instance_only() {
        let link = ModLink::default();
        let (first, _answered) = link.ask("i1");
        let (second, _also_answered) = link.ask("i2");

        link.new_launch("i1");

        assert!(!lock(&link.pending).contains_key(&first));
        assert!(lock(&link.pending).contains_key(&second));
        link.forget_launch("i2");
        assert!(lock(&link.pending).is_empty());
    }

    #[test]
    fn only_friends_coming_online_after_the_first_look_are_announced() {
        let link = ModLink::default();

        assert!(link
            .came_online(&[
                friend("a", Presence::Online),
                friend("b", Presence::Offline)
            ])
            .is_empty());
        let next = [
            friend("a", Presence::Playing),
            friend("b", Presence::Online),
            friend("c", Presence::Online),
        ];
        let announced: Vec<&str> = link
            .came_online(&next)
            .into_iter()
            .map(|friend| friend.id.as_str())
            .collect();

        assert_eq!(announced, ["b", "c"]);
    }

    #[test]
    fn only_incoming_requests_that_are_new_after_the_first_look_are_announced() {
        let link = ModLink::default();
        let incoming = |id| request(id, RequestDirection::Incoming, RequestState::Pending);

        assert!(
            link.newly_received(&[incoming("r1")]).is_empty(),
            "der erste Abgleich merkt sich nur den Stand"
        );
        let next = [
            incoming("r1"),
            incoming("r2"),
            request("r3", RequestDirection::Outgoing, RequestState::Delivering),
            request("r4", RequestDirection::Incoming, RequestState::Delivering),
        ];
        let announced: Vec<&str> = link
            .newly_received(&next)
            .into_iter()
            .map(|request| request.id.as_str())
            .collect();

        assert_eq!(
            announced,
            ["r2"],
            "nur eingehende, die auf die Antwort des Nutzers warten"
        );
        assert!(
            link.newly_received(&next).is_empty(),
            "dieselbe Anfrage wird nicht noch einmal gemeldet"
        );
    }

    #[test]
    fn a_waiting_question_blocks_launcher_open_until_it_is_answered_or_dropped() {
        let link = ModLink::default();
        assert!(!link.has_open_question());

        let (_id, _answered) = link.ask("i1");
        assert!(link.has_open_question());

        link.forget_launch("i1");
        assert!(!link.has_open_question());
    }
}
