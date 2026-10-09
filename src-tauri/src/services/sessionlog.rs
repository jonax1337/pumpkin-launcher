//! Protokolle früherer Spielsitzungen. Minecraft überschreibt `latest.log` beim nächsten Start; deshalb sichert der
//! Launcher es nach jedem Spielende und behält die letzten [`KEPT_SESSIONS`] je Instanz.
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::limits::MIB;
use crate::services::{entries, none_if_missing, remove_logged, write_atomic, Dirs};

/// So viele Sitzungen je Instanz bleiben erhalten; die ältesten fallen weg.
pub const KEPT_SESSIONS: usize = 10;
/// Von einer Sitzung bleibt höchstens das Ende (der Fehler steht dort).
const MAX_BYTES: u64 = 4 * MIB;
const EXTENSION: &str = "log";

/// Eine gesicherte Sitzung; `id` ist ihre Startzeit in Unix-Millisekunden.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSession {
    pub id: String,
    pub started_at: u64,
    pub size: u64,
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}

pub fn session_path(dirs: &Dirs, instance_id: &str, started_at: u64) -> PathBuf {
    dirs.session_logs(instance_id).join(format!("{started_at}.{EXTENSION}"))
}

/// Sichert `latest.log` der Sitzung, die um `started` begann. Hat das Spiel nichts geschrieben (die Datei ist von
/// einer früheren Sitzung), wird nichts gesichert.
pub fn archive(dirs: &Dirs, instance_id: &str, started: SystemTime) -> AppResult<()> {
    let latest = dirs.latest_log(instance_id);
    let Some(meta) = none_if_missing(fs::metadata(&latest))? else { return Ok(()) };
    if meta.modified()? < started {
        return Ok(());
    }
    let mut file = fs::File::open(&latest)?;
    file.seek(SeekFrom::Start(meta.len().saturating_sub(MAX_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    fs::create_dir_all(dirs.session_logs(instance_id))?;
    write_atomic(&session_path(dirs, instance_id, millis(started)), &bytes)?;
    prune(dirs, instance_id)
}

/// Gesicherte Sitzungen der Instanz, neueste zuerst.
pub fn list(dirs: &Dirs, instance_id: &str) -> AppResult<Vec<LogSession>> {
    let mut sessions: Vec<LogSession> = entries(&dirs.session_logs(instance_id))?
        .into_iter()
        .filter_map(|entry| {
            let path = entry.path();
            let started_at = path.file_stem()?.to_str()?.parse::<u64>().ok()?;
            let is_log = path.extension().is_some_and(|ext| ext == EXTENSION);
            is_log.then(|| LogSession { id: started_at.to_string(), started_at, size: entry.metadata().map_or(0, |m| m.len()) })
        })
        .collect();
    sessions.sort_by_key(|session| std::cmp::Reverse(session.started_at));
    Ok(sessions)
}

/// Text einer gesicherten Sitzung. Die Kennung muss eine Zahl sein, so wird sie nie zu einem fremden Pfad.
pub fn read(dirs: &Dirs, instance_id: &str, session_id: &str) -> AppResult<String> {
    let started_at: u64 = session_id.parse().map_err(|_| AppError::invalid(coded!("errors.app.sessionInvalid")))?;
    let bytes = none_if_missing(fs::read(session_path(dirs, instance_id, started_at)))?
        .ok_or_else(|| AppError::NotFound(coded!("errors.app.notFound.log", id = session_id).into()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn prune(dirs: &Dirs, instance_id: &str) -> AppResult<()> {
    for old in list(dirs, instance_id)?.into_iter().skip(KEPT_SESSIONS) {
        remove_logged(&session_path(dirs, instance_id, old.started_at));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn write_latest(dirs: &Dirs, id: &str, text: &str) {
        let latest = dirs.latest_log(id);
        fs::create_dir_all(latest.parent().unwrap()).unwrap();
        fs::write(latest, text).unwrap();
    }

    fn temp_dirs() -> Dirs {
        Dirs::new(std::env::temp_dir().join(crate::models::new_id()))
    }

    #[test]
    fn keeps_the_log_of_a_session_and_lists_newest_first() {
        let dirs = temp_dirs();
        write_latest(&dirs, "i", "erste Sitzung");
        let first = SystemTime::now() - Duration::from_secs(60);
        archive(&dirs, "i", first).unwrap();
        write_latest(&dirs, "i", "zweite Sitzung");
        let second = SystemTime::now() - Duration::from_secs(30);
        archive(&dirs, "i", second).unwrap();

        let sessions = list(&dirs, "i").unwrap();
        assert_eq!(sessions.iter().map(|s| s.started_at).collect::<Vec<_>>(), [millis(second), millis(first)]);
        assert_eq!(read(&dirs, "i", &sessions[0].id).unwrap(), "zweite Sitzung");
        assert_eq!(read(&dirs, "i", &sessions[1].id).unwrap(), "erste Sitzung");
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn a_log_older_than_the_start_is_not_archived() {
        let dirs = temp_dirs();
        write_latest(&dirs, "i", "von früher");
        archive(&dirs, "i", SystemTime::now() + Duration::from_secs(60)).unwrap();
        assert!(list(&dirs, "i").unwrap().is_empty());
        archive(&dirs, "ohne-log", SystemTime::now()).unwrap();
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn only_the_last_sessions_stay() {
        let dirs = temp_dirs();
        write_latest(&dirs, "i", "log");
        let base = SystemTime::now() - Duration::from_secs(3600);
        for n in 0..KEPT_SESSIONS as u64 + 3 {
            archive(&dirs, "i", base + Duration::from_secs(n)).unwrap();
        }
        let sessions = list(&dirs, "i").unwrap();
        assert_eq!(sessions.len(), KEPT_SESSIONS);
        assert_eq!(sessions.last().unwrap().started_at, millis(base + Duration::from_secs(3)));
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn long_logs_keep_their_end() {
        let dirs = temp_dirs();
        let text = format!("{}ENDE", "x".repeat(MAX_BYTES as usize));
        write_latest(&dirs, "i", &text);
        archive(&dirs, "i", SystemTime::now() - Duration::from_secs(5)).unwrap();
        let kept = read(&dirs, "i", &list(&dirs, "i").unwrap()[0].id).unwrap();
        assert_eq!(kept.len(), MAX_BYTES as usize);
        assert!(kept.ends_with("ENDE"));
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn session_ids_cannot_leave_the_folder() {
        let dirs = temp_dirs();
        assert!(read(&dirs, "i", "../../instances").unwrap_err().to_string().contains("Ungültige Sitzung"));
        assert!(read(&dirs, "i", "123").unwrap_err().to_string().contains("nicht gefunden"));
    }
}
