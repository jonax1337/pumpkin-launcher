//! Gleitendes Zählfenster: höchstens `limit` Ereignisse je Zeitspanne.
use std::collections::VecDeque;
use std::time::Duration;

use tokio::time::Instant;

#[derive(Debug)]
pub(super) struct SlidingWindow {
    limit: usize,
    span: Duration,
    hits: VecDeque<Instant>,
}

impl SlidingWindow {
    pub fn new(limit: usize, span: Duration) -> Self {
        Self { limit, span, hits: VecDeque::new() }
    }

    /// Zählt ein Ereignis; über der Grenze wird es nicht gezählt und ergibt `false`.
    pub fn allow(&mut self, now: Instant) -> bool {
        self.forget_expired(now);
        if self.hits.len() >= self.limit {
            return false;
        }
        self.hits.push_back(now);
        true
    }

    /// Ob noch ein Ereignis passt, ohne eins zu zählen.
    pub fn has_room(&mut self, now: Instant) -> bool {
        self.forget_expired(now);
        self.hits.len() < self.limit
    }

    fn forget_expired(&mut self, now: Instant) {
        while self.hits.front().is_some_and(|hit| now.duration_since(*hit) >= self.span) {
            self.hits.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_lets_the_limit_through_and_forgets_old_hits() {
        let start = Instant::now();
        let mut window = SlidingWindow::new(3, Duration::from_secs(1));
        assert!((0..3).all(|i| window.allow(start + Duration::from_millis(i * 100))));
        assert!(!window.allow(start + Duration::from_millis(500)));
        assert!(window.allow(start + Duration::from_millis(1000)), "der erste Treffer ist abgelaufen");
        assert!(!window.allow(start + Duration::from_millis(1050)));
    }

    #[test]
    fn asking_for_room_counts_nothing() {
        let start = Instant::now();
        let mut window = SlidingWindow::new(1, Duration::from_secs(1));
        assert!(window.has_room(start) && window.has_room(start));
        assert!(window.allow(start));
        assert!(!window.has_room(start));
    }
}
