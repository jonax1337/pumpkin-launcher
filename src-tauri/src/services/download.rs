//! HTTP-Downloads mit SHA-1-Prüfung, Retry und begrenzter Parallelität.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures::{StreamExt, TryStreamExt};
use serde::de::DeserializeOwned;
use sha1::{Digest, Sha1};

use crate::error::{AppError, AppResult};

const PARALLEL: usize = 16;
const ATTEMPTS: u32 = 3;

/// Eine herunterzuladende Datei. Ohne `sha1` gilt eine vorhandene Datei als aktuell.
#[derive(Debug, Clone)]
pub struct Job {
    pub url: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
}

pub fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("voxlet/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()?)
}

pub fn sha1_hex(bytes: &[u8]) -> String {
    Sha1::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
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
    match (&job.sha1, tokio::task::spawn_blocking(move || sha1_file(&path)).await) {
        (Some(sha1), Ok(Ok(actual))) => actual.eq_ignore_ascii_case(sha1),
        (None, Ok(Ok(_))) => true,
        _ => false,
    }
}

/// SHA-1 einer Datei, gestreamt statt ganz in den Speicher.
pub fn sha1_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha1::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Entfernt Datei bzw. Ordner beim Verwerfen, solange nicht entschärft (`0 = None`). Greift, wenn
/// ein laufender Vorgang abgebrochen wird (Future verworfen) und kein normaler Fehlerpfad aufräumt.
pub struct RemoveOnDrop(pub Option<PathBuf>);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let Some(path) = self.0.take() else { return };
        let result = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
        if let Err(err) = result.or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }) {
            tracing::warn!(path = %path.display(), %err, "Aufräumen nach Abbruch fehlgeschlagen");
        }
    }
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
    use reqwest::header::{CONTENT_RANGE, RANGE};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    if let Some(parent) = job.path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // Erst vollständig schreiben, dann umbenennen: ein Abbruch hinterlässt keine halbe Datei.
    // `.part` anhängen statt Endung ersetzen: `java.exe` und `java.dll` bekämen sonst dieselbe Temp-Datei.
    let mut tmp = job.path.clone().into_os_string();
    tmp.push(".part");
    let tmp = PathBuf::from(tmp);
    // Abbruch durch den Nutzer (Future verworfen) räumt die `.part` weg; Netzfehler lassen sie für Resume liegen.
    let mut guard = RemoveOnDrop(Some(tmp.clone()));
    let part_len = tokio::fs::metadata(&tmp).await.map(|m| m.len()).unwrap_or(0);
    let mut request = client.get(&job.url);
    if part_len > 0 {
        request = request.header(RANGE, format!("bytes={part_len}-"));
    }
    let result = async {
        let mut response = request.send().await?;
        if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            tokio::fs::remove_file(&tmp).await?;
            return Err(AppError::Download(format!("{}: Teildatei passt nicht, lade neu", job.url)));
        }
        response = response.error_for_status()?;
        let range = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok());
        let Some(offset) = resume_offset(response.status().as_u16(), range, part_len) else {
            // Nächster Versuch ohne Range.
            tokio::fs::remove_file(&tmp).await.or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) })?;
            return Err(AppError::Download(format!("{}: Server setzt an falscher Stelle fort, lade neu", job.url)));
        };
        let mut hash = Sha1::new();
        let mut file = if offset > 0 {
            let mut file = tokio::fs::OpenOptions::new().read(true).append(true).open(&tmp).await?;
            let mut buf = vec![0u8; 65536];
            loop {
                let n = file.read(&mut buf).await?;
                if n == 0 { break; }
                hash.update(&buf[..n]);
            }
            file
        } else {
            tokio::fs::File::create(&tmp).await?
        };
        while let Some(chunk) = response.chunk().await? {
            hash.update(&chunk);
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        drop(file);
        if let Some(expected) = &job.sha1 {
            let actual: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
            if !actual.eq_ignore_ascii_case(expected) {
                // Kaputte Teildatei nicht weiter fortsetzen.
                tokio::fs::remove_file(&tmp).await?;
                return Err(AppError::Download(format!("{}: SHA-1 {actual} statt {expected}", job.url)));
            }
        }
        tokio::fs::rename(&tmp, &job.path).await?;
        Ok(())
    }
    .await;
    guard.0 = None;
    result
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
            Err(err) if attempt < ATTEMPTS => {
                tracing::warn!(url = %job.url, attempt, %err, "Download fehlgeschlagen, neuer Versuch");
                tokio::time::sleep(Duration::from_millis(500 * u64::from(attempt))).await;
                attempt += 1;
            }
            Err(err) => return Err(err),
        }
    }
}

/// Lädt alle Jobs parallel und meldet nach jeder Datei `(erledigt, gesamt)`.
/// Bricht beim ersten endgültigen Fehler ab.
pub async fn fetch_all(
    client: &reqwest::Client,
    jobs: Vec<Job>,
    on_done: &(dyn Fn(u64, u64) + Send + Sync),
) -> AppResult<()> {
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
        let path = std::env::temp_dir().join(crate::models::new_id());
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha1_file(&path).unwrap(), sha1_hex(b"abc"));
        drop(RemoveOnDrop(Some(path.clone())));
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
}
