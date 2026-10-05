//! Der gemeinsame Zustand der Brücke: die Datensätze der Spielstarts und die Zulassung einer Verbindung
//! (docs/friends/INGAME.md, 5.2).
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::connection::Admitted;
use super::handler::{NoOps, OpHandler};
use super::launch::{Launch, Link, PromptRefusal};
use super::limits::Timing;
use super::ops::{RateClass, Scope};
use super::owner::OwnerCheck;
use super::protocol::{ClosingReason, Hello, RejectReason, PROTOCOL_VERSION};
use super::queue::LinkQueue;
use super::topics::{Topic, TopicValue};
use crate::services::gamesignal::GameSignals;
use crate::services::lock;

/// So viele Zeichen vom Anfang des SHA-256 muss eine Mod mindestens nennen, damit der Vergleich etwas beweist.
const MIN_BUILD_CHARS: usize = 8;

pub(super) struct Inner {
    pub signals: GameSignals,
    pub timing: Timing,
    pub state: Mutex<State>,
    pub next_link_id: AtomicU64,
    /// Verbindungen, die ihr `hello` noch nicht geschickt haben oder noch geprüft werden.
    pub unauthenticated: AtomicUsize,
    pub handler: Mutex<Arc<dyn OpHandler>>,
    pub owner: Arc<dyn OwnerCheck>,
}

#[derive(Default)]
pub(super) struct State {
    pub listening: Option<Listening>,
    pub friends_enabled: Option<bool>,
    pub friends_generation: u64,
    /// Die gestarteten Spiele je Instanz-ID.
    pub launches: HashMap<String, Launch>,
}

/// Was ein Vorgang über den Start wissen muss, ohne den Datensatz selbst zu sehen.
pub(super) struct LaunchFacts {
    pub online_account: bool,
    pub pid: Option<u32>,
}

pub(super) struct Listening {
    pub port: u16,
    pub stop: CancellationToken,
    pub tasks: Vec<JoinHandle<()>>,
}

impl Inner {
    pub fn new(signals: GameSignals, timing: Timing, owner: Arc<dyn OwnerCheck>) -> Self {
        Self {
            signals,
            timing,
            state: Mutex::default(),
            next_link_id: AtomicU64::new(1),
            unauthenticated: AtomicUsize::new(0),
            handler: Mutex::new(Arc::new(NoOps)),
            owner,
        }
    }

    pub fn handler(&self) -> Arc<dyn OpHandler> {
        lock(&self.handler).clone()
    }

    fn with_launch<T>(&self, instance_id: &str, f: impl FnOnce(&mut Launch) -> T) -> Option<T> {
        lock(&self.state).launches.get_mut(instance_id).map(f)
    }

    pub fn set_friends_enabled(&self, enabled: bool) {
        let mut state = lock(&self.state);
        state.friends_enabled = Some(enabled);
        if !enabled {
            state.friends_generation += 1;
        }
        for launch in state.launches.values_mut() {
            if launch.expectations.friends_enabled == enabled {
                continue;
            }
            launch.expectations.friends_enabled = enabled;
            if enabled {
                launch.friends_stop = CancellationToken::new();
                if let Some(link) = &launch.link {
                    link.queue.set_friends_enabled(true);
                }
            } else {
                launch.friends_stop.cancel();
                launch.grants.revoke();
                launch.topics.revoke_friends();
                if let Some(link) = &launch.link {
                    link.queue.set_friends_enabled(false);
                    link.queue.mark_topics(launch.topics.valued());
                }
            }
        }
    }

    pub fn friends_enabled(&self, instance_id: &str) -> bool {
        self.with_launch(instance_id, |launch| launch.expectations.friends_enabled).unwrap_or(false)
    }

    pub fn friends_stop(&self, instance_id: &str) -> CancellationToken {
        self.with_launch(instance_id, |launch| launch.friends_stop.clone()).unwrap_or_else(|| {
            let stop = CancellationToken::new();
            stop.cancel();
            stop
        })
    }
    pub fn scope_allowed(&self, instance_id: &str, scope: Scope) -> bool {
        self.with_launch(instance_id, |launch| launch.expectations.friends_enabled && launch.grants.is_allowed(scope)).unwrap_or(false)
    }

    /// Öffnet die Rückfrage des Spielstarts; ein Start, den es nicht mehr gibt, bekommt keine.
    pub fn begin_prompt(&self, instance_id: &str, now: Instant, permission: &CancellationToken) -> Result<(), PromptRefusal> {
        self.with_launch(instance_id, |launch| {
            if permission.is_cancelled() || !launch.expectations.friends_enabled {
                return Err(PromptRefusal::Exhausted);
            }
            launch.grants.begin_prompt(now)
        }).unwrap_or(Err(PromptRefusal::Exhausted))
    }

    pub fn end_prompt(&self, instance_id: &str, granted: Option<Scope>, permission: &CancellationToken) {
        self.with_launch(instance_id, |launch| {
            if permission.is_cancelled() {
                return;
            }
            launch.grants.end_prompt(granted.filter(|_| launch.expectations.friends_enabled));
        });
    }

    #[cfg(test)]
    pub fn allow_scope(&self, instance_id: &str, scope: Scope) {
        self.end_prompt(instance_id, Some(scope), &self.friends_stop(instance_id));
    }

    /// Zählt einen Vorgang; ein Start, den es nicht mehr gibt, darf nichts mehr.
    pub fn take_rate(&self, instance_id: &str, class: RateClass, now: Instant) -> bool {
        self.with_launch(instance_id, |launch| launch.limits.take(class, now)).unwrap_or(false)
    }

    #[cfg(test)]
    pub fn topic_current(&self, instance_id: &str, topic: Topic) -> Option<(u64, TopicValue)> {
        self.with_launch(instance_id, |launch| launch.topics.current(topic)).flatten()
    }

    pub fn topic_for_link(&self, instance_id: &str, link_id: u64, topic: Topic) -> Option<(u64, TopicValue)> {
        self.with_launch(instance_id, |launch| {
            launch.link.as_ref().filter(|link| link.id == link_id)?;
            launch.topics.current(topic)
        }).flatten()
    }

    /// Setzt das Thema; ändert sich der Wert, geht er an die Verbindung, falls eine besteht.
    pub fn set_topic(&self, instance_id: &str, mut value: TopicValue, generation: Option<u64>) {
        let mut state = lock(&self.state);
        if generation.is_some_and(|generation| generation != state.friends_generation) {
            return;
        }
        let Some(launch) = state.launches.get_mut(instance_id) else { return };
        if !launch.expectations.friends_enabled {
            value.revoke_friends();
        }
        if let (Some(topic), Some(link)) = (launch.topics.set(value), &launch.link) {
            link.queue.mark_topics([topic]);
        }
    }

    /// Schickt der Verbindung alle Themen noch einmal (`state.sync`).
    pub fn resend_topics(&self, instance_id: &str) {
        self.with_launch(instance_id, |launch| {
            if let Some(link) = &launch.link {
                link.queue.mark_topics(launch.topics.valued());
            }
        });
    }

    pub fn set_ready(&self, instance_id: &str, screens: Vec<String>) {
        tracing::debug!(instance = %instance_id, ?screens, "Mod ist bereit");
        self.with_launch(instance_id, |launch| launch.ready = Some(screens));
    }

    /// Lässt die Verbindung zu, deren `hello` den Token eines gestarteten Spiels nennt, Protokoll 2 spricht, die
    /// erwartete Mod meldet und vom Spielprozess kommt. Die Prüfung des Besitzers fragt das Betriebssystem und läuft
    /// deshalb ohne die Sperre des Zustands.
    pub async fn admit(self: &Arc<Self>, hello: &Hello, peer: SocketAddr, local: SocketAddr) -> Result<Admitted, RejectReason> {
        let pid = self.check_credentials(hello)?;
        self.verify_owner(pid, peer, local).await?;
        self.install_link(&hello.token, peer, local)
    }

    /// Ob dieser Start ein Microsoft-Konto hat und welcher Prozess sein Spiel ist, sofern der Launcher ihn kennt.
    pub fn launch_facts(&self, instance_id: &str) -> Option<LaunchFacts> {
        self.with_launch(instance_id, |launch| LaunchFacts { online_account: launch.expectations.online_account, pid: launch.pid })
    }

    /// Token, Protokoll und Mod; liefert den Spielprozess, wenn der Launcher ihn schon kennt.
    fn check_credentials(&self, hello: &Hello) -> Result<u32, RejectReason> {
        let state = lock(&self.state);
        let (instance_id, launch) = state.launches.iter().find(|(_, launch)| launch.token == hello.token).ok_or(RejectReason::Token)?;
        if hello.protocol != PROTOCOL_VERSION {
            return Err(RejectReason::Protocol);
        }
        let expected = &launch.expectations;
        if let Some(build) = &expected.build_id {
            if !build_matches(build, &hello.mod_info.build) {
                tracing::warn!(instance = %instance_id, reported = %hello.mod_info.build, "Mod meldet einen anderen Build als der eingebaute");
                return Err(RejectReason::Build);
            }
        }
        if let Some(node_id) = &expected.node_id {
            warn_if_game_differs(instance_id, node_id, hello);
        }
        launch.pid.ok_or(RejectReason::Retry)
    }

    /// Dieselbe Prüfung wie bei der Anmeldung; jeder Fehler gilt als „gehört nicht“ (INGAME 5.2).
    pub async fn verify_owner(&self, pid: u32, peer: SocketAddr, local: SocketAddr) -> Result<(), RejectReason> {
        let owner = self.owner.clone();
        match tokio::task::spawn_blocking(move || owner.owns(pid, peer, local)).await {
            Ok(Ok(true)) => Ok(()),
            Ok(Ok(false)) => Err(RejectReason::Owner),
            Ok(Err(err)) => {
                tracing::warn!(%err, pid, "Besitzer der Verbindung nicht ermittelbar, abgelehnt");
                Err(RejectReason::Owner)
            }
            Err(err) => {
                tracing::warn!(%err, pid, "Prüfung des Besitzers abgebrochen, abgelehnt");
                Err(RejectReason::Owner)
            }
        }
    }

    /// Trägt die Verbindung ein, wenn der Start sie noch will: Token noch gültig, noch keine andere Verbindung.
    fn install_link(&self, token: &str, peer: SocketAddr, local: SocketAddr) -> Result<Admitted, RejectReason> {
        let mut state = lock(&self.state);
        let (instance_id, launch) = state.launches.iter_mut().find(|(_, launch)| launch.token == token).ok_or(RejectReason::Token)?;
        if launch.link.is_some() {
            return Err(RejectReason::Duplicate);
        }
        let link = Link {
            id: self.next_link_id.fetch_add(1, Ordering::Relaxed),
            queue: Arc::new(LinkQueue::new(self.timing.topic_coalesce)),
            abort: CancellationToken::new(),
            peer,
            local,
        };
        link.queue.set_friends_enabled(launch.expectations.friends_enabled);
        link.queue.mark_topics(launch.topics.valued());
        launch.link = Some(link.clone());
        Ok(Admitted { instance_id: instance_id.clone(), link, scopes: launch.grants.scopes() })
    }

    /// Die Verbindung ist zu Ende; der Start bleibt mit Token, Zählern und Zustimmungen, damit die Mod sich neu
    /// verbinden kann.
    pub fn release(&self, instance_id: &str, link_id: u64) {
        self.with_launch(instance_id, |launch| {
            if launch.link.as_ref().is_some_and(|link| link.id == link_id) {
                launch.link = None;
            }
        });
    }

    /// Beendet alle Verbindungen und verwirft alle Spielstarts.
    pub fn close_all(&self, reason: ClosingReason) {
        let launches = std::mem::take(&mut lock(&self.state).launches);
        launches.values().for_each(|launch| launch.close_link(reason));
    }
}

/// Die Mod nennt den Anfang des SHA-256 ihrer Datei, der Launcher kennt den ganzen.
fn build_matches(expected_sha256: &str, reported: &str) -> bool {
    reported.len() >= MIN_BUILD_CHARS && expected_sha256.starts_with(reported)
}

/// Der Launcher kennt das Spiel; weicht die Angabe der Mod ab, steht das nur im Log.
fn warn_if_game_differs(instance_id: &str, node_id: &str, hello: &Hello) {
    let node_loader = node_id.rsplit_once('-').map(|(_, loader)| loader);
    if node_loader.is_some_and(|loader| !loader.eq_ignore_ascii_case(&hello.game.loader)) {
        tracing::warn!(instance = %instance_id, node = %node_id, reported = %hello.game.loader, "Mod meldet einen anderen Loader als der Knoten");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_must_be_a_long_enough_prefix_of_the_expected_hash() {
        let sha = "ab12cd34ef56".repeat(5);
        assert!(build_matches(&sha, &sha[..8]));
        assert!(build_matches(&sha, &sha[..20]));
        assert!(!build_matches(&sha, &sha[..7]), "zu kurz, um etwas zu beweisen");
        assert!(!build_matches(&sha, "ab12cd35"));
        assert!(!build_matches(&sha, ""));
        assert!(!build_matches(&sha, &format!("{sha}0")), "länger als der Hash");
    }
}
