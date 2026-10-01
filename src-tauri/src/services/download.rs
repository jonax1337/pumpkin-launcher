//! HTTP-Downloads mit SHA-1-Prüfung, Retry und begrenzter Parallelität.
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures::{StreamExt, TryStreamExt};
use reqwest::header::{CONTENT_RANGE, RANGE};
use serde::de::DeserializeOwned;
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::progress::CountFn;
use crate::error::{AppError, AppResult};
use crate::services::blocking;
use crate::services::mojang::Download;

const PARALLEL: usize = 16;
/// Versuche je Adresse; die Pause davor wächst mit jedem Fehlversuch (`retry_pause`).
pub(crate) const ATTEMPTS: u32 = 3;
/// Puffer beim Hashen vorhandener Dateien.
const HASH_BUFFER: usize = 64 * 1024;

/// Pause nach dem `failed`-ten Fehlversuch; gilt für alle Download-Wege, damit sie gleich wiederholen.
pub(crate) fn retry_pause(failed: u32) -> Duration {
    Duration::from_millis(500) * failed
}

/// Eine herunterzuladende Datei. Ohne `sha1` gilt eine vorhandene Datei als aktuell.
#[derive(Debug, Clone)]
pub struct Job {
    pub url: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
}

impl Job {
    /// Datei aus einer Versions- oder Runtime-JSON, die ihre SHA-1 mitbringt.
    pub fn from_download(download: &Download, path: PathBuf) -> Self {
        Self { url: download.url.clone(), path, sha1: Some(download.sha1.clone()) }
    }
}

/// Jede Zieldatei nur einmal (die erste gewinnt); mehrere Libraries teilen sich manchmal ein JAR.
pub fn dedup_by_path(mut jobs: Vec<Job>) -> Vec<Job> {
    jobs.sort_by(|a, b| a.path.cmp(&b.path));
    jobs.dedup_by(|later, first| later.path == first.path);
    jobs
}

pub fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("pumpkin-launcher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()?)
}

pub fn sha1_hex(bytes: &[u8]) -> String {
    hex(&Sha1::digest(bytes))
}

/// Ein SHA-1 als 40 Hex-Zeichen? Solche Hashes werden auch Teil von Pfaden.
pub fn is_sha1(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub async fn get_json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> AppResult<T> {
    Ok(client.get(url).send().await?.error_for_status()?.json().await?)
}

/// Liest eine lokale JSON-Datei (z. B. eine vorher geladene Versions-JSON).
pub async fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    Ok(serde_json::from_slice(&tokio::fs::read(path).await?)?)
}

async fn is_current(job: &Job) -> bool {
    let path = job.path.clone();
    match (&job.sha1, blocking(move |_| Ok(sha1_file(&path)?)).await) {
        (Some(sha1), Ok(actual)) => actual.eq_ignore_ascii_case(sha1),
        (None, Ok(_)) => true,
        (_, Err(_)) => false,
    }
}

/// SHA-1 einer Datei, gestreamt statt ganz in den Speicher.
pub fn sha1_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha1::new();
    let mut buffer = vec![0u8; HASH_BUFFER];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(hex(&hash.finalize()))
}

/// Entfernt Datei bzw. Ordner beim Verwerfen, solange nicht entschärft (`disarm`). Greift, wenn
/// ein laufender Vorgang abgebrochen wird (Future verworfen) und kein normaler Fehlerpfad aufräumt.
pub struct RemoveOnDrop(Option<PathBuf>);

impl RemoveOnDrop {
    pub fn new(path: PathBuf) -> Self {
        Self(Some(path))
    }

    /// Der Vorgang ist gelungen (oder räumt selbst auf): `path` bleibt liegen.
    pub fn disarm(mut self) {
        self.0 = None;
    }
}

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            super::remove_logged(&path);
        }
    }
}

/// Teildatei zu `path`: erst sie vollständig schreiben, dann umbenennen, so hinterlässt ein Abbruch keine halbe
/// Datei. `.part` wird angehängt statt die Endung zu ersetzen: `java.exe` und `java.dll` bekämen sonst dieselbe.
pub(crate) fn part_path(path: &Path) -> PathBuf {
    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    PathBuf::from(part)
}

/// Schreibt `reader` über die Teildatei nach `target`; bei Fehler oder Abbruch bleibt keine Teildatei liegen.
pub(crate) fn write_stream_atomic(reader: &mut impl Read, target: &Path) -> AppResult<()> {
    let part = part_path(target);
    let guard = RemoveOnDrop::new(part.clone());
    std::io::copy(reader, &mut std::fs::File::create(&part)?)?;
    std::fs::rename(&part, target)?;
    guard.disarm();
    Ok(())
}

/// Ab welchem Byte die Antwort an eine `.part`-Datei der Länge `part_len` anschließt.
/// Nicht-206 schreibt neu (`0`); ein 206 muss genau bei `part_len` ansetzen, sonst `None`
/// (Teilinhalt passt nicht, `.part` verwerfen).
fn resume_offset(status: u16, content_range: Option<&str>, part_len: u64) -> Option<u64> {
    let start = content_range
        .and_then(|r| r.strip_prefix("bytes "))
        .and_then(|r| r.split('-').next())
        .and_then(|s| s.trim().parse::<u64>().ok());
    match status {
        206 => (start == Some(part_len)).then_some(part_len),
        _ => Some(0),
    }
}

async fn download_once(client: &reqwest::Client, job: &Job) -> AppResult<()> {
    if let Some(parent) = job.path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let part = part_path(&job.path);
    // Abbruch durch den Nutzer (Future verworfen) räumt die `.part` weg; Netzfehler lassen sie für Resume liegen.
    let guard = RemoveOnDrop::new(part.clone());
    let result = transfer(client, job, &part).await;
    guard.disarm();
    result
}

/// Lädt in die Teildatei, wo möglich ab ihrem Ende, und übernimmt sie nach der Prüfung.
async fn transfer(client: &reqwest::Client, job: &Job, part: &Path) -> AppResult<()> {
    let part_len = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut request = client.get(&job.url);
    if part_len > 0 {
        request = request.header(RANGE, format!("bytes={part_len}-"));
    }
    let mut response = request.send().await?;
    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        tokio::fs::remove_file(part).await?;
        return Err(AppError::Download(format!("{}: Teildatei passt nicht, lade neu", job.url)));
    }
    response = response.error_for_status()?;
    let range = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok());
    let Some(offset) = resume_offset(response.status().as_u16(), range, part_len) else {
        // Nächster Versuch ohne Range.
        super::none_if_missing(tokio::fs::remove_file(part).await)?;
        return Err(AppError::Download(format!("{}: Server setzt an falscher Stelle fort, lade neu", job.url)));
    };
    let (mut file, mut hash) = if offset > 0 {
        hash_existing_part(part).await?
    } else {
        (tokio::fs::File::create(part).await?, Sha1::new())
    };
    while let Some(chunk) = response.chunk().await? {
        hash.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);
    verify_and_commit(job, part, hash).await
}

/// Öffnet die Teildatei zum Anhängen; der Hash enthält schon ihren bisherigen Inhalt.
async fn hash_existing_part(part: &Path) -> AppResult<(tokio::fs::File, Sha1)> {
    let mut file = tokio::fs::OpenOptions::new().read(true).append(true).open(part).await?;
    let mut hash = Sha1::new();
    let mut buffer = vec![0u8; HASH_BUFFER];
    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok((file, hash))
}

/// Benennt die vollständige Teildatei um, wenn ihr Hash passt; eine falsche wird nicht weiter fortgesetzt.
async fn verify_and_commit(job: &Job, part: &Path, hash: Sha1) -> AppResult<()> {
    if let Some(expected) = &job.sha1 {
        let actual = hex(&hash.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            tokio::fs::remove_file(part).await?;
            return Err(AppError::Download(format!("{}: SHA-1 {actual} statt {expected}", job.url)));
        }
    }
    tokio::fs::rename(part, &job.path).await?;
    Ok(())
}

/// Lädt eine Datei, sofern sie nicht schon mit passendem Hash vorliegt.
pub async fn fetch(client: &reqwest::Client, job: &Job) -> AppResult<()> {
    if is_current(job).await {
        return Ok(());
    }
    let mut attempt = 1;
    loop {
        match download_once(client, job).await {
            Ok(()) => return Ok(()),
            Err(err) if attempt < ATTEMPTS && err.is_retryable() => {
                tracing::warn!(url = %job.url, attempt, %err, "Download fehlgeschlagen, neuer Versuch");
                tokio::time::sleep(retry_pause(attempt)).await;
                attempt += 1;
            }
            Err(err) => return Err(err),
        }
    }
}

/// Lädt alle Jobs parallel und meldet nach jeder Datei `(erledigt, gesamt)`.
/// Bricht beim ersten endgültigen Fehler ab.
pub async fn fetch_all(client: &reqwest::Client, jobs: Vec<Job>, on_done: CountFn<'_>) -> AppResult<()> {
    let total = jobs.len() as u64;
    let done = AtomicU64::new(0);
    on_done(0, total);
    futures::stream::iter(jobs)
        .map(|job| async move { fetch(client, &job).await })
        .buffer_unordered(PARALLEL)
        .try_for_each(|()| {
            on_done(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            async { Ok(()) }
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_hex_known_value() {
        assert_eq!(sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert!(is_sha1(&sha1_hex(b"abc")));
        assert!(!is_sha1("a9993e36") && !is_sha1(&"g".repeat(40)));
        let path = std::env::temp_dir().join(crate::models::new_id());
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha1_file(&path).unwrap(), sha1_hex(b"abc"));
        drop(RemoveOnDrop::new(path.clone()));
        assert!(!path.exists());
    }

    #[test]
    fn resume_only_on_matching_partial_content() {
        assert_eq!(resume_offset(206, Some("bytes 100-199/200"), 100), Some(100));
        // Server ignoriert Range (200): neu schreiben.
        assert_eq!(resume_offset(200, None, 100), Some(0));
        assert_eq!(resume_offset(206, Some("bytes 0-199/200"), 0), Some(0));
        // 206 an falscher Stelle oder ohne lesbaren Content-Range: nur Teilinhalt, verwerfen.
        assert_eq!(resume_offset(206, Some("bytes 0-199/200"), 100), None);
        assert_eq!(resume_offset(206, Some("kaputt"), 100), None);
        assert_eq!(resume_offset(206, None, 100), None);
    }

    #[test]
    fn duplicate_targets_are_fetched_once() {
        let job = |url: &str, path: &str| Job { url: url.into(), path: path.into(), sha1: None };
        let jobs = dedup_by_path(vec![job("b", "/l/b.jar"), job("a1", "/l/a.jar"), job("a2", "/l/a.jar")]);
        let urls: Vec<_> = jobs.iter().map(|j| j.url.as_str()).collect();
        assert_eq!(urls, ["a1", "b"]);
    }
}
