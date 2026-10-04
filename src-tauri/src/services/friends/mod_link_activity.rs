//! Die Aktivitätsliste (INGAME 5.7): jeder `social`- und `share`-Vorgang, der aus dem Spiel kam, mit Zeit, Person und
//! Ausgang. Nur im Speicher, die letzten 100, neueste zuerst; ein Neustart des Launchers leert sie (die Ablage kommt in R-C).
use std::collections::VecDeque;
use std::sync::Mutex;

use time::OffsetDateTime;

use crate::services::friends::contract::ModActivityEntry;
use crate::services::lock;

const MAX_ENTRIES: usize = 100;

#[derive(Default)]
pub(super) struct ActivityLog {
    entries: Mutex<VecDeque<ModActivityEntry>>,
}

impl ActivityLog {
    pub(super) fn record(&self, entry: ModActivityEntry) {
        let mut entries = lock(&self.entries);
        entries.push_front(entry);
        entries.truncate(MAX_ENTRIES);
    }

    /// Neueste zuerst.
    pub(super) fn list(&self) -> Vec<ModActivityEntry> {
        lock(&self.entries).iter().cloned().collect()
    }
}

/// `2026-10-04T12:30:05Z` für Sekunden seit 1970; eine Zeit außerhalb dessen, was die Bibliothek darstellt, wird zur Epoche.
pub(super) fn iso_utc(epoch_secs: u64) -> String {
    let secs = i64::try_from(epoch_secs).unwrap_or_default();
    let at = OffsetDateTime::from_unix_timestamp(secs).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::contract::ModScope;

    fn entry(number: usize) -> ModActivityEntry {
        ModActivityEntry {
            at: iso_utc(0),
            instance_id: "i1".into(),
            scope: ModScope::Social,
            op: format!("op{number}"),
            target_name: None,
            ok: true,
        }
    }

    #[test]
    fn only_the_last_hundred_entries_are_kept_and_the_newest_comes_first() {
        let log = ActivityLog::default();

        (0..130).for_each(|number| log.record(entry(number)));

        let listed = log.list();
        assert_eq!(listed.len(), MAX_ENTRIES);
        assert_eq!((listed[0].op.as_str(), listed[99].op.as_str()), ("op129", "op30"));
    }

    #[test]
    fn an_empty_log_lists_nothing() {
        assert!(ActivityLog::default().list().is_empty());
    }

    #[test]
    fn times_are_iso_8601_in_utc() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_790_000_000), "2026-09-21T14:13:20Z");
        assert_eq!(iso_utc(u64::MAX), "1970-01-01T00:00:00Z", "unbrauchbare Zeiten werden nicht zur Panne");
    }
}
