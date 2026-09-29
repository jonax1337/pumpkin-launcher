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
    match (&job.sha1, tokio::fs::read(&job.path).await) {
        (Some(sha1), Ok(bytes)) => sha1_hex(&bytes).eq_ignore_ascii_case(sha1),
        (None, Ok(_)) => true,
        (_, Err(_)) => false,
    }
}

async fn download_once(client: &reqwest::Client, job: &Job) -> AppResult<()> {
    let bytes = client.get(&job.url).send().await?.error_for_status()?.bytes().await?;
    if let Some(expected) = &job.sha1 {
        let actual = sha1_hex(&bytes);
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(AppError::Download(format!("{}: SHA-1 {actual} statt {expected}", job.url)));
        }
    }
    if let Some(parent) = job.path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // Erst vollständig schreiben, dann umbenennen: ein Abbruch hinterlässt keine halbe Datei.
    // `.part` anhängen statt Endung ersetzen: `java.exe` und `java.dll` bekämen sonst dieselbe Temp-Datei.
    let mut tmp = job.path.clone().into_os_string();
    tmp.push(".part");
    tokio::fs::write(&tmp, &bytes).await?;
    tokio::fs::rename(&tmp, &job.path).await?;
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
    #[test]
    fn sha1_hex_known_value() {
        assert_eq!(super::sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    }
}
