//! Der Datensatz eines Spielstarts (docs/friends/INGAME.md, 5.2): Token, erwartete Mod, Spielprozess, die (höchstens
//! eine) Verbindung, die Themen und alles, was zählt: Ratenfenster, Zustimmungen und Rückfragen. Der Datensatz lebt
//! von `register_launch` bis `forget`; eine Verbindung kommt und geht in dieser Zeit, ohne dass Zähler oder
//! Zustimmungen zurückgesetzt werden.
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::ops::{windows_of, RateClass, Scope};
use super::protocol::{ClosingReason, Event, LauncherFrame, ScopeState, Scopes};
use super::queue::LinkQueue;
use super::topics::TopicStore;
use super::window::SlidingWindow;

/// So viele Rückfragen im Launcher je Spielstart und `PROMPT_SPAN`; danach gilt jede weitere ohne Frage als abgelehnt.
pub(super) const PROMPTS_PER_SPAN: usize = 3;
pub(super) const PROMPT_SPAN: Duration = Duration::from_secs(600);

/// Was der Launcher von dieser Mod erwartet, wenn er den Start anlegt. `None` heißt: nichts zu vergleichen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expectations {
    /// Die Kennung des gewählten Knotens (`<Minecraft>-<Loader>`); der Loader der Mod muss dazu passen.
    pub node_id: Option<String>,
    /// Nur ein Start mit Microsoft-Konto bekommt Zugang zur Brücke (SPEC 6.1).
    pub online_account: bool,
    /// Der volle SHA-256 der eingebauten Mod-Datei; die Mod meldet in `hello` dessen Anfang.
    pub build_id: Option<String>,
}

impl Expectations {
    /// Der Start ohne Wissen über die Mod: jede Mod mit dem richtigen Token und Prozess wird angenommen.
    pub fn unconstrained() -> Self {
        Self { node_id: None, online_account: true, build_id: None }
    }
}

/// Die Verbindung eines Spielstarts, wie die übrige Brücke sie anfasst.
#[derive(Clone)]
pub(super) struct Link {
    pub id: u64,
    pub queue: Arc<LinkQueue>,
    /// Beendet die Verbindung sofort, ohne die Warteschlange zu leeren.
    pub abort: CancellationToken,
    /// Die Endpunkte des TCP-Sockets, damit der Besitzer später noch einmal geprüft werden kann (INGAME 7, Schritt 4).
    pub peer: SocketAddr,
    pub local: SocketAddr,
}

impl Link {
    /// Reiht eine Antwort ein; ist die Warteschlange voll, liest die Mod nicht mehr, und die Verbindung endet.
    pub fn reply(&self, frame: LauncherFrame) {
        if self.queue.push_reply(frame).is_err() {
            tracing::warn!("Warteschlange der Mod voll: Verbindung getrennt");
            self.abort.cancel();
        }
    }

    /// Meldet den Grund, sendet den Rest der Warteschlange und trennt dann.
    pub fn close(&self, reason: ClosingReason) {
        self.queue.push_event(Event::Closing { reason });
        self.queue.finish();
    }
}

pub(super) struct Launch {
    pub token: String,
    pub expectations: Expectations,
    /// Wird mit `bind_pid` gesetzt, sobald das Kind existiert.
    pub pid: Option<u32>,
    pub link: Option<Link>,
    pub topics: TopicStore,
    pub limits: OpLimits,
    pub grants: Grants,
    /// Die Bildschirme, die die Mod mit `ready` gemeldet hat.
    pub ready: Option<Vec<String>>,
}

impl Launch {
    pub fn new(token: String, expectations: Expectations) -> Self {
        let grants = Grants::with_allowed(pre_granted(&expectations));
        Self {
            token,
            expectations,
            pid: None,
            link: None,
            topics: TopicStore::default(),
            limits: OpLimits::default(),
            grants,
            ready: None,
        }
    }

    pub fn close_link(&self, reason: ClosingReason) {
        if let Some(link) = &self.link {
            link.close(reason);
        }
    }
}

/// Die Bereiche, die der Nutzer für diesen Start vorab erlaubt hat (Einstellung „Aktionen im Spiel“ = erlauben,
/// Amendment A13). Das Feld dafür bringt Paket W1 in die Erwartungen; bis dahin erlaubt der Start nichts vorab. Dies ist
/// die einzige Stelle, die W1 anfassen muss.
fn pre_granted(_expectations: &Expectations) -> impl IntoIterator<Item = Scope> {
    std::iter::empty()
}

/// Die Zählfenster der Vorgänge je Klasse (INGAME 5.6).
#[derive(Default)]
pub(super) struct OpLimits {
    windows: HashMap<RateClass, Vec<SlidingWindow>>,
}

impl OpLimits {
    /// Zählt einen Vorgang der Klasse in allen ihren Fenstern, aber nur, wenn jedes noch Platz hat.
    pub fn take(&mut self, class: RateClass, now: Instant) -> bool {
        let windows = self
            .windows
            .entry(class)
            .or_insert_with(|| windows_of(class).iter().map(|(limit, span)| SlidingWindow::new(*limit, *span)).collect());
        if !windows.iter_mut().all(|window| window.has_room(now)) {
            return false;
        }
        for window in windows {
            window.allow(now);
        }
        true
    }
}

/// Warum eine Rückfrage im Launcher nicht gestellt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PromptRefusal {
    /// Es ist schon eine Rückfrage offen.
    Open,
    /// Die Rückfragen dieses Spielstarts sind aufgebraucht.
    Exhausted,
}

/// Zustimmungen und Rückfragen eines Spielstarts (INGAME 5.5).
pub(super) struct Grants {
    allowed: HashSet<Scope>,
    prompt_open: bool,
    prompts: SlidingWindow,
}

impl Grants {
    /// Ein Start, dessen `allowed` der Nutzer schon vor dem Spielstart erlaubt hat: dafür fragt der Launcher nie.
    fn with_allowed(allowed: impl IntoIterator<Item = Scope>) -> Self {
        let prompts = SlidingWindow::new(PROMPTS_PER_SPAN, PROMPT_SPAN);
        Self { allowed: allowed.into_iter().collect(), prompt_open: false, prompts }
    }

    #[cfg(test)]
    fn new() -> Self {
        Self::with_allowed([])
    }

    pub fn is_allowed(&self, scope: Scope) -> bool {
        self.allowed.contains(&scope)
    }

    pub fn scopes(&self) -> Scopes {
        let state = |scope| if self.is_allowed(scope) { ScopeState::Allow } else { ScopeState::Ask };
        Scopes { share: state(Scope::Share), social: state(Scope::Social) }
    }

    /// Öffnet die einzige Rückfrage, die ein Spielstart gleichzeitig haben darf.
    pub fn begin_prompt(&mut self, now: Instant) -> Result<(), PromptRefusal> {
        if self.prompt_open {
            return Err(PromptRefusal::Open);
        }
        if !self.prompts.allow(now) {
            return Err(PromptRefusal::Exhausted);
        }
        self.prompt_open = true;
        Ok(())
    }

    /// Schließt die Rückfrage; bei `Some(scope)` hat der Nutzer erlaubt, bis das Spiel endet.
    pub fn end_prompt(&mut self, granted: Option<Scope>) {
        self.prompt_open = false;
        self.allowed.extend(granted);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, seconds: u64) -> Instant {
        start + Duration::from_secs(seconds)
    }

    #[test]
    fn host_invite_passes_three_times_a_minute() {
        let (start, mut limits) = (Instant::now(), OpLimits::default());
        let passed = (0..4).filter(|_| limits.take(RateClass::HostInvite, start)).count();
        assert_eq!(passed, 3);
        assert!(limits.take(RateClass::HostInvite, at(start, 60)));
    }

    #[test]
    fn add_by_name_has_a_minute_and_an_hour_window() {
        let (start, mut limits) = (Instant::now(), OpLimits::default());
        let mut taken = 0;
        for minute in 0..10 {
            taken += (0..6).filter(|_| limits.take(RateClass::AddByName, at(start, minute * 60))).count();
        }
        assert_eq!(taken, 20, "5 je Minute, aber höchstens 20 je Stunde");
        assert!(limits.take(RateClass::AddByName, at(start, 3600)));
    }

    #[test]
    fn a_refused_take_counts_nowhere() {
        let (start, mut limits) = (Instant::now(), OpLimits::default());
        for minute in 0..20 {
            for _ in 0..5 {
                limits.take(RateClass::AddByName, at(start, minute * 60));
            }
        }
        assert!(!limits.take(RateClass::AddByName, at(start, 20 * 60)), "die Stunde ist voll");
        assert!(!limits.take(RateClass::AddByName, at(start, 3599)));
        assert!(limits.take(RateClass::AddByName, at(start, 3600)), "nur die ersten fünf sind abgelaufen, die Stunde zählt weiter");
    }

    #[test]
    fn every_class_has_its_own_windows() {
        let (start, mut limits) = (Instant::now(), OpLimits::default());
        assert!(limits.take(RateClass::LauncherOpen, start));
        assert!(!limits.take(RateClass::LauncherOpen, at(start, 9)));
        assert!(limits.take(RateClass::LauncherOpen, at(start, 10)));
        assert!(limits.take(RateClass::Answer, start));
        let others = (0..31).filter(|_| limits.take(RateClass::Other, start)).count();
        assert_eq!(others, 30);
        let answers = (0..25).filter(|_| limits.take(RateClass::Answer, start)).count();
        assert_eq!(answers, 19, "20 je Minute, eine war schon dabei");
    }

    #[test]
    fn one_prompt_at_a_time_and_three_in_ten_minutes() {
        let (start, mut grants) = (Instant::now(), Grants::new());
        assert_eq!(grants.begin_prompt(start), Ok(()));
        assert_eq!(grants.begin_prompt(start), Err(PromptRefusal::Open));
        grants.end_prompt(None);
        assert_eq!(grants.begin_prompt(at(start, 1)), Ok(()));
        grants.end_prompt(None);
        assert_eq!(grants.begin_prompt(at(start, 2)), Ok(()));
        grants.end_prompt(None);
        assert_eq!(grants.begin_prompt(at(start, 3)), Err(PromptRefusal::Exhausted));
        assert_eq!(grants.begin_prompt(at(start, 600)), Ok(()), "die erste Rückfrage ist zehn Minuten her");
    }

    #[test]
    fn a_scope_the_user_allowed_before_the_start_needs_no_prompt_and_shows_as_allow() {
        let mut grants = Grants::with_allowed([Scope::Social]);

        assert!(grants.is_allowed(Scope::Social) && !grants.is_allowed(Scope::Share));
        assert_eq!(grants.scopes(), Scopes { share: ScopeState::Ask, social: ScopeState::Allow });
        assert_eq!(grants.begin_prompt(Instant::now()), Ok(()), "andere Bereiche fragen weiter, mit vollem Kontingent");
    }

    #[test]
    fn without_a_pre_grant_in_the_expectations_nothing_is_allowed_up_front() {
        let launch = Launch::new("t".into(), Expectations::unconstrained());

        assert!(!launch.grants.is_allowed(Scope::Share) && !launch.grants.is_allowed(Scope::Social));
    }

    #[test]
    fn an_allow_lasts_and_shows_in_the_scopes() {
        let (start, mut grants) = (Instant::now(), Grants::new());
        assert_eq!(grants.scopes(), Scopes { share: ScopeState::Ask, social: ScopeState::Ask });
        grants.begin_prompt(start).unwrap();
        grants.end_prompt(Some(Scope::Share));
        assert!(grants.is_allowed(Scope::Share) && !grants.is_allowed(Scope::Social));
        assert_eq!(grants.scopes(), Scopes { share: ScopeState::Allow, social: ScopeState::Ask });
    }
}
