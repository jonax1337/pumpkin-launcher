//! Verbindung zur Mod im Spiel (INGAME 5, SPEC 7), Launcher-Seite: Themen (Freunde, Sitzung, Einladungen, Spiel, ich)
//! und Hinweise an die Mod, ihre Vorgänge als nicht vertrauenswürdig behandelt. Die Brücke (`modbridge`) prüft Rahmen,
//! Ratenfenster und Zustimmungen je Spielstart; was ein Vorgang bewirkt, steht in `mod_link_ops`, was die Themen
//! enthalten, in `mod_link_topics`. Das Teilen braucht beim ersten Mal je Spielstart die Zustimmung im Launcher;
//! Beenden und Rauswerfen verringern nur, was geteilt ist, und gehen ohne.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use tokio::sync::oneshot;

use super::contract::{Friend, ModConnectionEvent, ModState, ModStatus, Presence};
use super::modinstall;
use super::session_events::SessionEvent;
use super::sessions::{shown_name, FriendSessions, Shared};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::new_id;
use crate::services::gamesignal::ModRequest;
use crate::services::lock;
use crate::services::modbridge::protocol::ModNotify;

#[path = "mod_link_ops.rs"]
mod ops;
#[path = "mod_link_topics.rs"]
mod topics;

/// So lange wartet ein Vorgang der Mod auf die Antwort im Launcher (SPEC 7.4).
const CONFIRM_WAIT: Duration = Duration::from_secs(120);
/// So oft werden die Themen für verbundene Mods neu gebaut; die Brücke sendet je Thema höchstens alle 250 ms.
const REFRESH_INTERVAL: Duration = Duration::from_secs(1);

/// Offene Rückfragen im Launcher und die Präsenz beim letzten Abgleich. Zustimmungen und Zähler gehören dem
/// Spielstart in der Brücke.
#[derive(Default)]
pub(super) struct ModLink {
    pending: Mutex<HashMap<String, Pending>>,
    /// Präsenz der Freunde beim letzten Abgleich; `None` vor dem ersten.
    presence: Mutex<Option<HashMap<String, Presence>>>,
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

/// Eine neue Verbindung bekommt von der Brücke sofort den letzten Stand jedes Themas.
pub(super) fn connected(shared: &Shared, instance_id: &str) {
    announce_connection(shared, instance_id, true);
}

pub(super) fn disconnected(shared: &Shared, instance_id: &str) {
    announce_connection(shared, instance_id, false);
}

fn announce_connection(shared: &Shared, instance_id: &str, connected: bool) {
    let event = ModConnectionEvent { instance_id: instance_id.to_owned(), connected };
    shared.emit(SessionEvent::ModConnection(event));
}

/// Ein Hinweis an die Mod der Instanz; `who` sind Name und Minecraft-UUID der Person, um die es geht (die Mod zeigt
/// nur den Namen).
pub(super) fn notify(shared: &Shared, instance_id: &str, event: ModNotify, who: Option<(String, Option<String>)>) {
    shared.bridge.notify(instance_id, event, who.map(|(name, _mc_uuid)| name));
}

/// Vorgänge der Mod laufen über den `OpHandler` der Brücke und ihre Zustimmungen je Spielstart; das Spielsignal
/// `ModRequest` erzeugt die Brücke nicht mehr. Käme eines an, würde es hier nichts ausführen: es hätte keine Zustimmung.
pub(super) async fn handle(_shared: Arc<Shared>, instance_id: String, request: ModRequest) {
    tracing::warn!(instance = %instance_id, ?request, "Spielsignal ModRequest ignoriert: Vorgänge laufen über die Brücke");
}

/// Setzt den Bearbeiter der Vorgänge in die Brücke ein und hält die Themen jeder verbundenen Mod aktuell; meldet
/// auch Freunde, die online kommen.
pub(super) async fn refresh_regularly(shared: Weak<Shared>) {
    let Some(strong) = shared.upgrade() else { return };
    strong.bridge.set_handler(Arc::new(ops::ModOps::new(shared.clone())));
    drop(strong);
    let mut ticks = tokio::time::interval(REFRESH_INTERVAL);
    loop {
        ticks.tick().await;
        let Some(shared) = shared.upgrade() else { return };
        refresh(&shared).await;
    }
}

async fn refresh(shared: &Arc<Shared>) {
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
        topics::publish(shared, instance_id, &friends).await;
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

        assert!(link.came_online(&[friend("a", Presence::Online), friend("b", Presence::Offline)]).is_empty());
        let next = [friend("a", Presence::Playing), friend("b", Presence::Online), friend("c", Presence::Online)];
        let announced: Vec<&str> = link.came_online(&next).into_iter().map(|friend| friend.id.as_str()).collect();

        assert_eq!(announced, ["b", "c"]);
    }
}
