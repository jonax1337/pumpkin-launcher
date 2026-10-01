//! Was ein Spielstart hinterlässt: Ausgabezeilen, Absturzberichte und die Dauer der Sitzung.
//!
//! Mit Mojangs Logging-Config schreibt das Spiel log4j-XML-Events nach stdout.
//! `XmlLog` macht daraus lesbare Zeilen `[thread/LEVEL] Nachricht`; Nicht-XML-Zeilen bleiben unverändert.
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Längere Sitzungen zählen nicht als Spielzeit: dann wurde eher die Uhr verstellt.
const MAX_SESSION: Duration = Duration::from_secs(7 * 24 * 3600);

#[derive(Debug, Default)]
pub struct XmlLog {
    prefix: String,
    in_cdata: bool,
}

fn attr<'a>(line: &'a str, name: &str) -> &'a str {
    let key = format!("{name}=\"");
    line.find(&key)
        .map(|i| &line[i + key.len()..])
        .and_then(|rest| rest.split('"').next())
        .unwrap_or("")
}

impl XmlLog {
    /// Nimmt eine stdout-Zeile und liefert die anzuzeigende Zeile (oder nichts für XML-Gerüst).
    pub fn line(&mut self, raw: &str) -> Option<String> {
        if self.in_cdata {
            let (text, end) = raw.split_once("]]>").map_or((raw, false), |(t, _)| (t, true));
            self.in_cdata = !end;
            return (!text.is_empty()).then(|| text.to_owned());
        }
        if let Some((_, rest)) = raw.split_once("<![CDATA[") {
            let text = match rest.split_once("]]>") {
                Some((t, _)) => t,
                None => {
                    self.in_cdata = true;
                    rest
                }
            };
            return Some(format!("{}{text}", self.prefix));
        }
        let trimmed = raw.trim_start();
        if trimmed.starts_with("<log4j:Event") {
            self.prefix = format!("[{}/{}] ", attr(trimmed, "thread"), attr(trimmed, "level"));
            return None;
        }
        if trimmed.starts_with("<log4j:") || trimmed.starts_with("</log4j:") {
            return None;
        }
        Some(raw.to_owned())
    }
}

/// Dauer einer beendeten Sitzung in Sekunden; `None`, wenn sie nicht stimmen kann
/// (Uhr zurückgestellt oder länger als `MAX_SESSION`).
pub fn session_secs(started: SystemTime, ended: SystemTime) -> Option<u64> {
    ended.duration_since(started).ok().filter(|d| *d <= MAX_SESSION).map(|d| d.as_secs())
}

/// Neuester Absturzbericht (`crash-reports/*.txt`), der seit `since` entstanden ist.
pub fn crash_report(game_dir: &Path, since: SystemTime) -> Option<PathBuf> {
    std::fs::read_dir(game_dir.join("crash-reports"))
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "txt"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .filter(|(modified, _)| *modified >= since)
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_crash_report_after_start() {
        let game = std::env::temp_dir().join(crate::models::new_id());
        let reports = game.join("crash-reports");
        assert_eq!(crash_report(&game, SystemTime::UNIX_EPOCH), None);
        std::fs::create_dir_all(&reports).unwrap();
        let start = SystemTime::now();
        for (name, age) in [("old.txt", 3600), ("new.txt", 0), ("newer.log", 0)] {
            let file = std::fs::File::create(reports.join(name)).unwrap();
            file.set_modified(start + Duration::from_secs(5) - Duration::from_secs(age)).unwrap();
        }
        assert_eq!(crash_report(&game, start), Some(reports.join("new.txt")));
        assert_eq!(crash_report(&game, start + Duration::from_secs(60)), None);
        std::fs::remove_dir_all(game).unwrap();
    }

    #[test]
    fn implausible_sessions_do_not_count() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert_eq!(session_secs(start, start + Duration::from_secs(5400)), Some(5400));
        assert_eq!(session_secs(start, start - Duration::from_secs(1)), None);
        assert_eq!(session_secs(start, start + MAX_SESSION + Duration::from_secs(1)), None);
    }

    #[test]
    fn xml_events_become_plain_lines() {
        let input = [
            "plain jvm output",
            r#"<log4j:Event logger="ekp" timestamp="1" level="INFO" thread="Render thread">"#,
            "  <log4j:Message><![CDATA[Setting user: Tom]]></log4j:Message>",
            "</log4j:Event>",
            r#"<log4j:Event logger="x" timestamp="2" level="ERROR" thread="main">"#,
            "  <log4j:Message><![CDATA[boom]]></log4j:Message>",
            "  <log4j:Throwable><![CDATA[java.lang.Error",
            "\tat Foo.bar",
            "]]></log4j:Throwable>",
            "</log4j:Event>",
        ];
        let mut log = XmlLog::default();
        let out: Vec<String> = input.iter().filter_map(|l| log.line(l)).collect();
        assert_eq!(
            out,
            [
                "plain jvm output",
                "[Render thread/INFO] Setting user: Tom",
                "[main/ERROR] boom",
                "[main/ERROR] java.lang.Error",
                "\tat Foo.bar"
            ]
        );
    }
}
