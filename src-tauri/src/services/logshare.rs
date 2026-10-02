//! Protokolle teilen über mclo.gs (https://api.mclo.gs/). Hochgeladen wird nur das Ende der Datei,
//! vorher lokal bereinigt: Zugangstokens, Benutzername in Pfaden, E-Mail-Adressen.
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::{gamelog, Dirs};

const UPLOAD_URL: &str = "https://api.mclo.gs/1/log";
/// Zeilengrenze von mclo.gs.
const MAX_LINES: usize = 25_000;
/// Zeilen des Protokolls; eine weitere braucht der Kürzungshinweis.
const LOG_LINES: usize = MAX_LINES - 1;
/// Die Hälfte der 10 MiB von mclo.gs: Die Ersetzungen machen den Text höchstens knapp doppelt so lang.
const MAX_BYTES: u64 = 5 * 1024 * 1024;
/// Steht im geteilten Log, liest also jeder: deshalb Englisch.
const OMITTED_NOTE: &str = "[Pumpkin Launcher] The beginning of this log was omitted to fit the upload limit.";

/// Welches Protokoll einer Instanz geteilt wird.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogKind {
    /// `logs/latest.log` des letzten Starts.
    Latest,
    /// Neuester Absturzbericht aus `crash-reports/`.
    CrashReport,
}

/// Lädt das Protokoll `kind` der Instanz bereinigt zu mclo.gs hoch und liefert den öffentlichen Link.
pub async fn share(http: &reqwest::Client, dirs: &Dirs, instance_id: &str, kind: LogKind) -> AppResult<String> {
    let (raw, cut_at_read) = read_tail(&log_path(dirs, instance_id, kind)?).await?;
    let redacted = redact(&raw);
    let (text, cut_lines) = last_lines(&redacted, LOG_LINES);
    let content = if cut_at_read || cut_lines { format!("{OMITTED_NOTE}\n{text}") } else { text.to_owned() };
    upload(http, &content).await
}

fn log_path(dirs: &Dirs, instance_id: &str, kind: LogKind) -> AppResult<PathBuf> {
    match kind {
        LogKind::Latest => Some(dirs.latest_log(instance_id))
            .filter(|path| path.is_file())
            .ok_or_else(|| AppError::invalid(coded!("errors.app.logshare.noLog"))),
        LogKind::CrashReport => gamelog::crash_report(&dirs.game_dir(instance_id), SystemTime::UNIX_EPOCH)
            .ok_or_else(|| AppError::invalid(coded!("errors.app.logshare.noCrashReport"))),
    }
}

/// Liest höchstens die letzten `MAX_BYTES`, denn der Fehler steht am Ende. Liefert auch, ob vorne etwas fehlt;
/// die dabei angeschnittene erste Zeile fällt weg.
async fn read_tail(path: &Path) -> AppResult<(String, bool)> {
    let mut file = tokio::fs::File::open(path).await?;
    let start = file.metadata().await?.len().saturating_sub(MAX_BYTES);
    file.seek(SeekFrom::Start(start)).await?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).await?;
    // Verlustbehaftet: Das Spiel schreibt nicht garantiert gültiges UTF-8.
    let text = String::from_utf8_lossy(&bytes);
    let cut = start > 0;
    let text = if cut { text.split_once('\n').map_or("", |(_, rest)| rest) } else { text.as_ref() };
    Ok((text.to_owned(), cut))
}

/// Ersetzungen in dieser Reihenfolge: erst Tokens (auch in Pfaden oder Adressen), dann Benutzerordner und E-Mails.
static REDACTIONS: LazyLock<Vec<(Regex, &str)>> = LazyLock::new(|| {
    [
        // Startargument `--accessToken <token>`
        (r"(?i)(--accessToken\s+)\S+", "${1}<redacted>"),
        // accessToken=…, "accessToken": "…", access_token=…
        (r#"(?i)(access_?token["']?\s*[:=]\s*["']?)[^\s"',;&]+"#, "${1}<redacted>"),
        // JWTs (Minecraft- und Xbox-Tokens): Der Header beginnt immer mit `{"`, Base64 also mit `eyJ`.
        (r"\beyJ[\w-]+\.[\w-]+\.[\w-]*", "<token>"),
        // Der Name darf Leerzeichen enthalten; er endet erst an einem Trenner, dem Zeilenende oder einem
        // Zeichen, das Windows in Ordnernamen verbietet (etwa dem schließenden `"` in JSON).
        (r#"(?i)\b([a-z]:[\\/]+users[\\/]+)[^\\/\r\n"<>|:*?]+"#, "${1}<user>"),
        // Linux (`/home/<name>`, auch `/var/home/…`) und macOS (`/Users/<name>`): Namen ohne Leerzeichen.
        (r#"(/(?:home|Users)/)[^/\s"']+"#, "${1}<user>"),
        // Endung aus Buchstaben: Mod-Kennungen wie `fabric-loader@0.16.5` bleiben stehen.
        (r"[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b", "<email>"),
    ]
    .into_iter()
    .map(|(pattern, replacement)| (Regex::new(pattern).expect("Muster ist gültig"), replacement))
    .collect()
});

/// Entfernt Zugangstokens, den Benutzernamen in Pfaden und E-Mail-Adressen.
fn redact(text: &str) -> String {
    REDACTIONS
        .iter()
        .fold(text.to_owned(), |text, (pattern, replacement)| pattern.replace_all(&text, *replacement).into_owned())
}

/// Die letzten `max` Zeilen von `text` und ob davor etwas wegfiel.
fn last_lines(text: &str, max: usize) -> (&str, bool) {
    let text = text.trim_end_matches(['\r', '\n']);
    // Die letzten `max` Zeilen beginnen nach dem `max`-ten Zeilenumbruch von hinten (`nth` zählt ab 0).
    let Some(last_break) = max.checked_sub(1) else { return ("", !text.is_empty()) };
    match text.rmatch_indices('\n').nth(last_break) {
        Some((newline, _)) => (&text[newline + 1..], true),
        None => (text, false),
    }
}

#[derive(Serialize)]
struct Upload<'a> {
    content: &'a str,
    source: &'a str,
}

#[derive(Deserialize)]
struct UploadReply {
    success: bool,
    url: Option<String>,
    error: Option<String>,
}

async fn upload(http: &reqwest::Client, content: &str) -> AppResult<String> {
    let response = http.post(UPLOAD_URL).json(&Upload { content, source: "Pumpkin Launcher" }).send().await?;
    // mclo.gs begründet Fehler im JSON; nur ohne lesbare Antwort zählt der HTTP-Status.
    let status = response.error_for_status_ref().err();
    match response.json::<UploadReply>().await {
        Ok(UploadReply { success: true, url: Some(url), .. }) => Ok(url),
        Ok(reply) => Err(AppError::Upload(match reply.error {
            Some(error) => error.into(),
            None => coded!("errors.app.logshare.noLink").into(),
        })),
        Err(err) => Err(status.unwrap_or(err).into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_access_tokens() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl_-x";
        assert_eq!(redact(&format!("--username Tom --accessToken {jwt} --version 1.21")), "--username Tom --accessToken <redacted> --version 1.21");
        assert_eq!(redact("url?accessToken=abc123&lang=de"), "url?accessToken=<redacted>&lang=de");
        assert_eq!(redact(r#"{"access_token": "abc123", "x": 1}"#), r#"{"access_token": "<redacted>", "x": 1}"#);
        assert_eq!(redact(&format!("Bearer {jwt}")), "Bearer <token>");
    }

    #[test]
    fn redacts_windows_user_names_in_paths() {
        assert_eq!(redact(r"C:\Users\Max Mustermann\AppData\Roaming\x"), r"C:\Users\<user>\AppData\Roaming\x");
        assert_eq!(redact("Loading c:/users/max/.minecraft/mods"), "Loading c:/users/<user>/.minecraft/mods");
        assert_eq!(redact(r#""path": "C:\\Users\\max\\x""#), r#""path": "C:\\Users\\<user>\\x""#);
        assert_eq!(redact("home=C:\\Users\\max\nnext"), "home=C:\\Users\\<user>\nnext");
        assert_eq!(redact(r#"{"home":"C:\\Users\\max","x":1}"#), r#"{"home":"C:\\Users\\<user>","x":1}"#);
    }

    #[test]
    fn redacts_linux_and_macos_user_names_in_paths() {
        assert_eq!(redact("Loading /home/max/.local/share/x"), "Loading /home/<user>/.local/share/x");
        assert_eq!(redact("cwd=/var/home/max next"), "cwd=/var/home/<user> next");
        assert_eq!(redact(r#"{"dir":"/Users/max","x":1}"#), r#"{"dir":"/Users/<user>","x":1}"#);
        assert_eq!(redact("C:/Users/max/x"), "C:/Users/<user>/x");
    }

    #[test]
    fn redacts_email_addresses_but_not_mod_ids() {
        assert_eq!(redact("contact max.mustermann+mc@example.co.uk now"), "contact <email> now");
        let untouched = "fabric-loader@0.16.5 net.minecraft.Foo@1a2b3c";
        assert_eq!(redact(untouched), untouched);
    }

    #[test]
    fn keeps_the_last_lines() {
        assert_eq!(last_lines("a\nb\nc\n", 2), ("b\nc", true));
        assert_eq!(last_lines("a\r\nb\r\n", 2), ("a\r\nb", false));
        assert_eq!(last_lines("", 2), ("", false));
        assert_eq!(last_lines("a\nb", 0), ("", true));
    }

    #[tokio::test]
    async fn reads_only_the_tail_without_a_cut_line() {
        let path = std::env::temp_dir().join(crate::models::new_id());
        let head = "x".repeat(MAX_BYTES as usize);
        std::fs::write(&path, format!("{head}\nfirst full line\nerror")).unwrap();
        assert_eq!(read_tail(&path).await.unwrap(), ("first full line\nerror".to_owned(), true));
        std::fs::write(&path, "short\n").unwrap();
        assert_eq!(read_tail(&path).await.unwrap(), ("short\n".to_owned(), false));
        std::fs::remove_file(path).unwrap();
    }
}
