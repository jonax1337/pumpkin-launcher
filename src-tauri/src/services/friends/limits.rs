//! Grenzen der Freunde (SPEC 5.1, 12.4): Rahmengrößen, gleitende Zählfenster für Ratenbegrenzungen und der Zeitplan
//! erneuter Anwahlversuche (Backoff). Alles lebt nur im Speicher.
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::time::Duration;

use tokio::time::Instant;

pub const HELLO_FRAME_LIMIT: usize = 4 * 1024;
pub const CONTROL_FRAME_LIMIT: usize = 16 * 1024;
pub const REQUEST_FRAME_LIMIT: usize = 512 * 1024;
/// Öffnungsrahmen eines Streams; der größte (Tunnel mit Sitzungs-ID) bleibt weit darunter.
pub const OPEN_FRAME_LIMIT: usize = 1024;

/// Höchstens `max` Ereignisse je `window`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimit {
    pub max: usize,
    pub window: Duration,
}

pub const HELLO_PER_PEER_AND_CODE: RateLimit = RateLimit {
    max: 3,
    window: Duration::from_secs(600),
};
pub const HELLO_PER_CODE: RateLimit = RateLimit {
    max: 10,
    window: Duration::from_secs(3600),
};
pub const CONTROL_FRAMES: RateLimit = RateLimit {
    max: 50,
    window: Duration::from_secs(10),
};
pub const REQUEST_STREAMS: RateLimit = RateLimit {
    max: 5,
    window: Duration::from_secs(60),
};
/// Wie oft eine neue Verbindung eines Freundes seine eingetragene ersetzen darf; mehr ist kein Wiederverbinden mehr.
pub const LINK_REPLACEMENTS: RateLimit = RateLimit {
    max: 5,
    window: Duration::from_secs(60),
};

/// Wartezeiten nach dem ersten, zweiten, … gescheiterten Versuch; danach bleibt es bei der letzten.
const BACKOFF: [Duration; 5] = [
    Duration::from_secs(30),
    Duration::from_secs(120),
    Duration::from_secs(300),
    Duration::from_secs(600),
    Duration::from_secs(1800),
];

/// Gleitendes Zählfenster je Schlüssel.
#[derive(Debug)]
pub struct SlidingWindow<K> {
    limit: RateLimit,
    hits: HashMap<K, VecDeque<Instant>>,
}

impl<K: Eq + Hash> SlidingWindow<K> {
    pub fn new(limit: RateLimit) -> Self {
        Self {
            limit,
            hits: HashMap::new(),
        }
    }

    /// Zählt ein Ereignis für `key`; über der Grenze wird es nicht gezählt und ergibt `false`.
    pub fn try_hit(&mut self, key: K, now: Instant) -> bool {
        let hits = self.hits.entry(key).or_default();
        while hits
            .front()
            .is_some_and(|hit| now.duration_since(*hit) >= self.limit.window)
        {
            hits.pop_front();
        }
        if hits.len() >= self.limit.max {
            return false;
        }
        hits.push_back(now);
        true
    }
}

/// Anwahlversuche je Ziel: wann es wieder dran ist und ob gerade ein Versuch läuft.
#[derive(Debug)]
pub struct Attempts<K> {
    entries: HashMap<K, Attempt>,
}

#[derive(Debug, Default)]
struct Attempt {
    failures: usize,
    /// `None`: noch nie gescheitert oder neu eingeplant, also sofort dran.
    due: Option<Instant>,
    started: Option<Instant>,
    in_flight: bool,
}

impl Attempt {
    fn is_due(&self, now: Instant) -> bool {
        !self.in_flight && self.due.is_none_or(|due| due <= now)
    }
}

impl<K: Eq + Hash + Clone> Default for Attempts<K> {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
}

impl<K: Eq + Hash + Clone> Attempts<K> {
    /// Die Ziele aus `candidates`, die jetzt dran sind und nicht schon laufen.
    pub fn due(&self, candidates: impl IntoIterator<Item = K>, now: Instant) -> Vec<K> {
        candidates
            .into_iter()
            .filter(|key| {
                self.entries
                    .get(key)
                    .is_none_or(|attempt| attempt.is_due(now))
            })
            .collect()
    }

    /// Die Ziele aus `candidates`, die nicht laufen und deren letzter Versuch mindestens `gap` zurückliegt.
    pub fn idle_for(
        &self,
        candidates: impl IntoIterator<Item = K>,
        gap: Duration,
        now: Instant,
    ) -> Vec<K> {
        candidates
            .into_iter()
            .filter(|key| self.is_idle_for(key, gap, now))
            .collect()
    }

    /// Macht `key` sofort fällig, ohne den Backoff zurückzusetzen.
    pub fn schedule_now(&mut self, key: K) {
        self.entries.entry(key).or_default().due = None;
    }

    /// Setzt den Backoff von `key` auf den Anfang zurück (`friends_retry_now`).
    pub fn restart(&mut self, key: K) {
        let attempt = self.entries.entry(key).or_default();
        attempt.failures = 0;
        attempt.due = None;
    }

    pub fn begin(&mut self, key: K, now: Instant) {
        let attempt = self.entries.entry(key).or_default();
        attempt.in_flight = true;
        attempt.started = Some(now);
    }

    /// Plant den nächsten Versuch nach dem Backoff ein.
    pub fn failed(&mut self, key: K, now: Instant) {
        let attempt = self.entries.entry(key).or_default();
        attempt.in_flight = false;
        attempt.due = Some(now + BACKOFF[attempt.failures.min(BACKOFF.len() - 1)]);
        attempt.failures += 1;
    }

    pub fn succeeded(&mut self, key: &K) {
        self.entries.remove(key);
    }

    /// Vergisst alle Ziele, die es nicht mehr gibt.
    pub fn retain(&mut self, alive: impl Fn(&K) -> bool) {
        self.entries.retain(|key, _| alive(key));
    }

    fn is_idle_for(&self, key: &K, gap: Duration, now: Instant) -> bool {
        self.entries.get(key).is_none_or(|attempt| {
            !attempt.in_flight
                && attempt
                    .started
                    .is_none_or(|started| now.duration_since(started) >= gap)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMIT: RateLimit = RateLimit {
        max: 2,
        window: Duration::from_secs(10),
    };

    #[tokio::test(start_paused = true)]
    async fn window_refuses_over_the_limit_and_frees_up_after_the_window() {
        let mut window = SlidingWindow::new(LIMIT);
        let start = Instant::now();

        assert!(window.try_hit("a", start));
        assert!(window.try_hit("a", start));
        assert!(!window.try_hit("a", start + Duration::from_secs(9)));
        assert!(window.try_hit("b", start), "keys count separately");
        assert!(window.try_hit("a", start + Duration::from_secs(10)));
    }

    #[tokio::test(start_paused = true)]
    async fn backoff_steps_through_the_schedule_and_stays_at_thirty_minutes() {
        let mut attempts = Attempts::default();
        let now = Instant::now();
        let expected = [30, 120, 300, 600, 1800, 1800];

        for secs in expected {
            attempts.begin("r", now);
            attempts.failed("r", now);
            let wait = Duration::from_secs(secs);
            assert!(attempts
                .due(["r"], now + wait - Duration::from_secs(1))
                .is_empty());
            assert_eq!(attempts.due(["r"], now + wait), ["r"]);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn running_attempt_is_never_due() {
        let mut attempts = Attempts::default();
        let now = Instant::now();

        attempts.begin("r", now);

        assert!(attempts
            .due(["r"], now + Duration::from_secs(3600))
            .is_empty());
        assert!(attempts.idle_for(["r"], Duration::ZERO, now).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn restart_makes_the_next_failure_wait_thirty_seconds_again() {
        let mut attempts = Attempts::default();
        let now = Instant::now();
        for _ in 0..4 {
            attempts.begin("r", now);
            attempts.failed("r", now);
        }

        attempts.restart("r");
        attempts.begin("r", now);
        attempts.failed("r", now);

        assert_eq!(attempts.due(["r"], now + Duration::from_secs(30)), ["r"]);
    }

    #[tokio::test(start_paused = true)]
    async fn idle_for_skips_recently_started_targets() {
        let mut attempts = Attempts::default();
        let now = Instant::now();
        attempts.begin("r", now);
        attempts.failed("r", now);

        assert!(attempts
            .idle_for(["r"], Duration::from_secs(10), now + Duration::from_secs(9))
            .is_empty());
        let later = now + Duration::from_secs(10);
        assert_eq!(
            attempts.idle_for(["r", "new"], Duration::from_secs(10), later),
            ["r", "new"]
        );
    }
}
