//! Datei eines Anbieter-Packs: Ausweich-Adressen, Wiederholungen und Prüfung gegen Größe und Prüfsummen.
use super::cdn;
use crate::{
    coded,
    error::{AppError, AppResult},
    services::{
        download,
        limits::{FILE_LIMIT, MIB, ZIP_LIMIT},
        progress::{CountFn, Phase, ProgressFn},
        remove_logged,
        transport::{save_capped, Digests},
    },
};
use std::collections::BTreeMap;

/// Fortschritt eines Pack-Downloads in MiB, gemeldet nur bei jedem vollen MiB statt bei jedem Netzwerk-Häppchen.
pub(super) fn mib_progress(progress: ProgressFn<'_>) -> impl Fn(u64, u64) + Send + Sync + '_ {
    let last = std::sync::atomic::AtomicU64::new(u64::MAX);
    move |done, total| {
        if last.swap(done / MIB, std::sync::atomic::Ordering::Relaxed) != done / MIB {
            progress(Phase::Download, done / MIB, total / MIB);
        }
    }
}

/// Probiert die Adressen der Reihe nach, jede bis zu `download::ATTEMPTS`-mal, außer der Server lehnt endgültig ab.
async fn from_any<'a, T, Fut>(urls: &'a [String], mut attempt: impl FnMut(&'a str) -> Fut) -> AppResult<T>
where
    Fut: std::future::Future<Output = AppResult<T>>,
{
    let mut last: Option<AppError> = None;
    for url in urls {
        for n in 0..download::ATTEMPTS {
            if n > 0 {
                tokio::time::sleep(download::retry_pause(n)).await;
            }
            match attempt(url).await {
                Ok(value) => return Ok(value),
                Err(err) => {
                    tracing::warn!(%err, url, attempt = n, "Download fehlgeschlagen");
                    let retry = err.is_retryable();
                    last = Some(err);
                    if !retry {
                        break;
                    }
                }
            }
        }
    }
    Err(last.unwrap_or_else(|| AppError::invalid(coded!("errors.game.noDownloadAddress"))))
}

/// Datei eines Packs mit Ausweich-Adressen. Ohne mindestens einen Hash wird nichts akzeptiert.
#[derive(Debug, Clone)]
pub struct RemoteFile {
    pub urls: Vec<String>,
    pub size: u64,
    pub hashes: BTreeMap<&'static str, String>,
}

impl RemoteFile {
    pub fn verify(&self, data: &[u8]) -> AppResult<()> {
        self.require_hashes()?;
        self.check_size(data.len() as u64)?;
        self.check_hashes(&Digests::of(data))
    }

    fn require_hashes(&self) -> AppResult<()> {
        if self.hashes.is_empty() {
            return Err(AppError::invalid(coded!("errors.game.fileWithoutChecksum")));
        }
        Ok(())
    }

    /// Ohne angegebene Größe (0) gibt es nichts zu vergleichen.
    fn check_size(&self, actual: u64) -> AppResult<()> {
        if self.size != 0 && actual != self.size {
            return Err(AppError::invalid(coded!("errors.game.fileSizeMismatch")));
        }
        Ok(())
    }

    fn check_hashes(&self, digests: &Digests) -> AppResult<()> {
        digests.check(self.hashes.iter().map(|(algorithm, hash)| (*algorithm, hash.as_str())))
    }

    /// Höchstens so viele Bytes werden geladen: die angegebene Größe, aber nie mehr als `max`.
    fn limit(&self, max: u64) -> u64 {
        if self.size == 0 { max } else { self.size.min(max) }
    }

    /// Wie `download`, aber in eine Datei (für große Pack-Zips). Die Prüfsummen werden an der fertigen Datei
    /// gelesen; bei Abweichung verschwindet sie wieder. `progress(geladen, gesamt)` in Bytes.
    pub async fn download_to(&self, client: &reqwest::Client, dest: &std::path::Path, progress: CountFn<'_>) -> AppResult<()> {
        self.require_hashes()?;
        from_any(&self.urls, |url| async move {
            let saved = self.save(client, url, dest, progress).await.and_then(|()| self.verify_file(dest));
            if saved.is_err() {
                remove_logged(dest);
            }
            saved
        })
        .await
    }

    /// Schreibt die Antwort von `url` nach `dest`, höchstens `ZIP_LIMIT` Bytes.
    async fn save(&self, client: &reqwest::Client, url: &str, dest: &std::path::Path, progress: CountFn<'_>) -> AppResult<()> {
        let mut response = cdn::get(client, url).await?;
        let total = response.content_length().unwrap_or(self.size);
        save_capped(&mut response, self.limit(ZIP_LIMIT), total, dest, progress).await
    }

    /// Größe und Prüfsummen einer Datei auf der Platte, in einem Durchlauf gelesen.
    fn verify_file(&self, path: &std::path::Path) -> AppResult<()> {
        let file = std::fs::File::open(path)?;
        self.check_size(file.metadata()?.len())?;
        self.check_hashes(&Digests::of_reader(file)?)
    }

    pub async fn download(&self, client: &reqwest::Client) -> AppResult<Vec<u8>> {
        let limit = self.limit(FILE_LIMIT);
        from_any(&self.urls, |url| async move {
            let data = cdn::fetch(client, url, limit).await?;
            self.verify(&data)?;
            Ok(data)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(size: u64, sha1: &str) -> RemoteFile {
        RemoteFile { urls: vec![], size, hashes: BTreeMap::from([("sha1", sha1.to_string())]) }
    }

    #[test]
    fn pack_download_progress_is_reported_once_per_mib() {
        let seen = std::sync::Mutex::new(Vec::new());
        let progress = |phase: Phase, done, total| seen.lock().unwrap().push((phase, done, total));
        let report = mib_progress(&progress);

        for done in [0, 100, MIB - 1, MIB, MIB + 5, 3 * MIB] {
            report(done, 4 * MIB);
        }

        assert_eq!(*seen.lock().unwrap(), [(Phase::Download, 0, 4), (Phase::Download, 1, 4), (Phase::Download, 3, 4)]);
    }

    #[tokio::test]
    async fn a_refusal_skips_to_the_next_address() {
        let urls = ["https://a.example/x.jar".to_string(), "https://b.example/x.jar".to_string()];
        let mut tried = Vec::new();
        let result = from_any(&urls, |url| {
            tried.push(url);
            async move { if url.contains("a.example") { Err(AppError::Refused("nein".into())) } else { Ok(url) } }
        })
        .await;
        assert_eq!(result.unwrap(), urls[1]);
        assert_eq!(tried, [&urls[0], &urls[1]]);
    }

    #[test]
    fn files_need_a_matching_hash_and_size() {
        let sha1 = Digests::of(b"test").hex("sha1").unwrap();
        assert!(file(4, &sha1).verify(b"test").is_ok());
        assert!(file(0, &sha1).verify(b"test").is_ok());
        assert!(file(3, &sha1).verify(b"test").is_err());
        assert!(file(4, &sha1).verify(b"evil").is_err());
        let unhashed = RemoteFile { urls: vec![], size: 4, hashes: BTreeMap::new() };
        assert!(unhashed.verify(b"test").is_err());
        let sha256 = RemoteFile { urls: vec![], size: 4, hashes: BTreeMap::from([("sha256", Digests::of(b"test").hex("sha256").unwrap())]) };
        assert!(sha256.verify(b"test").is_ok() && sha256.verify(b"tesT").is_err());
    }
}
