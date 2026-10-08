//! Woraus diagnostiziert wird: der Absturzbericht des letzten Starts, sonst das Protokoll der letzten Sitzung.
//! Beides gilt nur, wenn es zum letzten Start gehört; der Bericht oder das Protokoll eines früheren Starts erklärte einen
//! Absturz, der nicht stattfand. Gelesen wird nur bis zur Obergrenze von `crashreport`.
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use crate::models::Instance;
use crate::services::{crashreport, gamelog, sessionlog, Dirs};

/// `last_played_at` wird gleich nach dem Start der Sitzung gespeichert, deren Startzeit das Protokoll trägt; so viel
/// früher darf ein Protokoll beginnen und noch zum letzten Start gehören.
const LAUNCH_RECORD_SLACK_MS: u64 = 10_000;

pub(super) fn crash_text(dirs: &Dirs, instance: &Instance) -> Option<String> {
    last_report(dirs, instance).or_else(|| last_session_log(dirs, instance))
}

fn last_report(dirs: &Dirs, instance: &Instance) -> Option<String> {
    let since = UNIX_EPOCH + Duration::from_millis(instance.last_played_at.unwrap_or_default());
    let report = gamelog::crash_report(&dirs.game_dir(&instance.id), since)?;
    read_logged(&report, crashreport::read_capped)
}

fn last_session_log(dirs: &Dirs, instance: &Instance) -> Option<String> {
    let sessions = sessionlog::list(dirs, &instance.id)
        .inspect_err(|err| tracing::warn!(instance = %instance.id, %err, "Protokolle der Sitzungen nicht lesbar"))
        .ok()?;
    let latest = sessions.first().filter(|session| belongs_to_last_launch(session.started_at, instance))?;
    read_logged(&sessionlog::session_path(dirs, &instance.id, latest.started_at), crashreport::read_tail_capped)
}

fn belongs_to_last_launch(session_started_at: u64, instance: &Instance) -> bool {
    instance.last_played_at.is_none_or(|launched| session_started_at.saturating_add(LAUNCH_RECORD_SLACK_MS) >= launched)
}

/// Liest mit `read`; ein Fehler wird geloggt und gilt als „nichts zu diagnostizieren“.
fn read_logged(path: &Path, read: fn(&Path) -> std::io::Result<String>) -> Option<String> {
    read(path).inspect_err(|err| tracing::warn!(path = %path.display(), %err, "Datei zur Absturzdiagnose nicht lesbar")).ok()
}

#[cfg(test)]
mod tests {
    use super::super::testing::instance;
    use super::*;
    use std::fs;
    use std::time::SystemTime;

    fn dirs() -> Dirs {
        Dirs::new(std::env::temp_dir().join(crate::models::new_id()))
    }

    fn launched_at(instance: &mut Instance, time: SystemTime) {
        let millis = time.duration_since(UNIX_EPOCH).unwrap().as_millis();
        instance.last_played_at = Some(u64::try_from(millis).unwrap());
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn the_crash_report_of_the_last_launch_comes_first() {
        let dirs = dirs();
        let mut instance = instance(Vec::new());
        launched_at(&mut instance, SystemTime::now() - Duration::from_secs(60));
        write(&dirs.game_dir(&instance.id).join("crash-reports/crash-1.txt"), "Report\n");
        write(&sessionlog::session_path(&dirs, &instance.id, millis_ago(30)), "Log\n");

        assert_eq!(crash_text(&dirs, &instance).as_deref(), Some("Report\n"));
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn without_a_report_the_newest_session_log_is_read() {
        let dirs = dirs();
        let mut instance = instance(Vec::new());
        launched_at(&mut instance, SystemTime::now() - Duration::from_secs(60));
        write(&sessionlog::session_path(&dirs, &instance.id, millis_ago(3600)), "Old\n");
        write(&sessionlog::session_path(&dirs, &instance.id, millis_ago(59)), "New\n");

        assert_eq!(crash_text(&dirs, &instance).as_deref(), Some("New\n"));
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn a_log_of_an_earlier_launch_is_not_diagnosed() {
        let dirs = dirs();
        let mut instance = instance(Vec::new());
        launched_at(&mut instance, SystemTime::now());
        write(&sessionlog::session_path(&dirs, &instance.id, millis_ago(3600)), "Old\n");

        assert_eq!(crash_text(&dirs, &instance), None);
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn an_instance_without_files_has_nothing_to_diagnose() {
        let dirs = dirs();
        assert_eq!(crash_text(&dirs, &instance(Vec::new())), None);
    }

    #[test]
    fn a_never_launched_instance_reads_its_newest_log() {
        let dirs = dirs();
        let instance = Instance { last_played_at: None, ..instance(Vec::new()) };
        write(&sessionlog::session_path(&dirs, &instance.id, millis_ago(3600)), "Only\n");

        assert_eq!(crash_text(&dirs, &instance).as_deref(), Some("Only\n"));
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    fn millis_ago(seconds: u64) -> u64 {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        u64::try_from(now).unwrap() - seconds * 1000
    }
}
