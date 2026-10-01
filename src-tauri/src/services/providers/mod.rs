//! Kataloge ohne API-Key: FTB (öffentliche API, installierbar), Technic und CurseForge (nur lesend).
//! Alle liefern dieselben Formen wie Modrinth (`Hit`, `Project`, `Version`), damit die Oberfläche sie gleich zeigt.
use super::{
    download,
    limits::{FILE_LIMIT, MIB, PROVIDER_JSON_LIMIT, PROVIDER_ZIP_ENTRIES, PROVIDER_ZIP_EXPANDED_LIMIT, ZIP_LIMIT},
    modrinth,
    progress::{CountFn, Phase, ProgressFn},
    transport::{follow_redirects, read_capped, save_capped, Digests, DOWNLOAD_TOO_BIG},
    zip_guard::{check_entry_count, ensure_no_file_dir_conflict, reject_special, ExpandedSize},
};
use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use std::collections::BTreeMap;

pub mod curseforge;
pub mod ftb;
pub mod net;
pub mod technic;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Ftb,
    Technic,
    CurseForge,
}

impl Source {
    pub fn parse(s: &str) -> AppResult<Self> {
        match s {
            "ftb" => Ok(Self::Ftb),
            "technic" => Ok(Self::Technic),
            "curseforge" => Ok(Self::CurseForge),
            _ => Err(AppError::invalid("Unbekannter Anbieter")),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Ftb => "ftb",
            Self::Technic => "technic",
            Self::CurseForge => "curseforge",
        }
    }
}

/// Anfragen je Download einschließlich der ersten, also höchstens drei Weiterleitungen.
const MAX_REQUESTS: usize = 4;

/// Dateien eines Pack-Zips wie bei `zip_paths`, dazu Größen- und Kompressionsgrenzen gegen ZIP-Bomben
/// (Regeln wie beim `.mrpack`).
pub(crate) fn zip_files(zip: &mut zip::ZipArchive<impl std::io::Read + std::io::Seek>, prefix: &str, skip: &[&str]) -> AppResult<Vec<(std::path::PathBuf, usize)>> {
    check_entry_count(zip.len(), PROVIDER_ZIP_ENTRIES)?;
    let files = zip_paths(zip, prefix, skip)?;
    let mut expanded = ExpandedSize::new(PROVIDER_ZIP_EXPANDED_LIMIT);
    for (_, index) in &files {
        expanded.add_entry(&zip.by_index_raw(*index)?)?;
    }
    Ok(files)
}

/// Dateien eines ZIPs unterhalb von `prefix`, ohne die Ordner in `skip` (Namen der obersten Ebene):
/// `(Zielpfad, Eintrags-Nummer)`. Nur Pfadregeln: sichere Pfade, keine Sonderdateien, keine Doppelten,
/// keine Datei, die zugleich Ordner einer anderen ist.
pub(crate) fn zip_paths(zip: &mut zip::ZipArchive<impl std::io::Read + std::io::Seek>, prefix: &str, skip: &[&str]) -> AppResult<Vec<(std::path::PathBuf, usize)>> {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for index in 0..zip.len() {
        let entry = zip.by_index_raw(index)?;
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = entry.name().strip_prefix(prefix) else { continue };
        if skip.iter().any(|s| rel == *s || rel.strip_prefix(s).is_some_and(|r| r.starts_with('/'))) {
            continue;
        }
        let rel = rel.to_string();
        let path = super::content::safe_path(&rel)?;
        reject_special(&entry)?;
        if !seen.insert(rel.to_lowercase()) {
            return Err(AppError::invalid("Doppelter ZIP-Pfad"));
        }
        files.push((path, index));
    }
    ensure_no_file_dir_conflict(&seen)?;
    Ok(files)
}

/// JSON-GET gegen eine feste API; Weiterleitungen und Fehlerstatus sind Fehler.
pub(crate) async fn json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> AppResult<T> {
    Ok(serde_json::from_slice(&modrinth::bytes(client.get(url), PROVIDER_JSON_LIMIT).await?)?)
}

/// Ein Pfadstück einer Anbieter-URL: nur Buchstaben, Ziffern, `-`, `_`, `.`.
pub(crate) fn segment(s: &str) -> AppResult<&str> {
    modrinth::identifier(s)?;
    Ok(s)
}

/// Hosts, von denen Pack-Dateien geladen werden dürfen: FTB selbst und das CurseForge-CDN,
/// auf das FTB für Mods verweist, die es nicht selbst hostet.
const HOSTS: &[&str] = &[
    "files.feed-the-beast.com",
    "cdn.feed-the-beast.com",
    "edge.forgecdn.net",
    "mediafilez.forgecdn.net",
    "media.forgecdn.net",
];

fn check_url(url: &reqwest::Url) -> AppResult<()> {
    if url.scheme() != "https"
        || !url.host_str().is_some_and(|h| HOSTS.contains(&h))
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::invalid("Download-Origin nicht erlaubt"));
    }
    Ok(())
}

/// CurseForge hat angekündigt, Downloads vom CDN nur noch mit API-Schlüssel auszuliefern (sonst 401). Dann soll der
/// Nutzer erfahren, was zu tun ist, statt einen nackten HTTP-Fehler zu sehen. 403 zählt nicht: So antwortet das CDN
/// schon heute auf gelöschte Dateien, da hilft kein Update.
fn cdn_wants_key(url: &reqwest::Url, status: reqwest::StatusCode) -> bool {
    url.host_str().is_some_and(|h| h.ends_with(".forgecdn.net")) && status == reqwest::StatusCode::UNAUTHORIZED
}

/// Letztes Pfadstück einer Download-Adresse, lesbar (`a%20b.jar` -> `a b.jar`).
fn file_name(url: &reqwest::Url) -> String {
    let last = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or_default();
    percent_encoding::percent_decode_str(last).decode_utf8_lossy().into_owned()
}

/// Fehlerstatus der Antwort als Fehler; das CDN, das nur noch mit Schlüssel liefert, bekommt eine eigene Meldung.
fn ensure_success(response: reqwest::Response) -> AppResult<reqwest::Response> {
    if cdn_wants_key(response.url(), response.status()) {
        return Err(AppError::Refused(format!(
            "CurseForge gibt {} nur noch mit Schlüssel heraus. Bitte aktualisiere Pumpkin Launcher oder lade die Datei von Hand auf curseforge.com.",
            file_name(response.url())
        )));
    }
    Ok(response.error_for_status()?)
}

/// GET mit handgeführten Weiterleitungen, jedes Ziel gegen die Host-Liste geprüft.
async fn get(client: &reqwest::Client, start: &str) -> AppResult<reqwest::Response> {
    let response = follow_redirects(start, MAX_REQUESTS, |url| async move {
        check_url(&url)?;
        Ok(client.get(url).send().await?)
    })
    .await?;
    ensure_success(response)
}

/// Lädt höchstens `limit` Bytes in den Speicher.
async fn fetch(client: &reqwest::Client, start: &str, limit: u64) -> AppResult<Vec<u8>> {
    let mut response = get(client, start).await?;
    read_capped(&mut response, limit, DOWNLOAD_TOO_BIG).await
}

/// Fortschritt eines Pack-Downloads in MiB, gemeldet nur bei jedem vollen MiB statt bei jedem Netzwerk-Häppchen.
fn mib_progress(progress: ProgressFn<'_>) -> impl Fn(u64, u64) + Send + Sync + '_ {
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
    Err(last.unwrap_or_else(|| AppError::invalid("Keine Download-Adresse")))
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
            return Err(AppError::invalid("Datei ohne Prüfsumme"));
        }
        Ok(())
    }

    /// Ohne angegebene Größe (0) gibt es nichts zu vergleichen.
    fn check_size(&self, actual: u64) -> AppResult<()> {
        if self.size != 0 && actual != self.size {
            return Err(AppError::invalid("Dateigröße stimmt nicht"));
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
                super::remove_logged(dest);
            }
            saved
        })
        .await
    }

    /// Schreibt die Antwort von `url` nach `dest`, höchstens `ZIP_LIMIT` Bytes.
    async fn save(&self, client: &reqwest::Client, url: &str, dest: &std::path::Path, progress: CountFn<'_>) -> AppResult<()> {
        let mut response = get(client, url).await?;
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
            let data = fetch(client, url, limit).await?;
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

    #[test]
    fn parses_sources() {
        assert_eq!(Source::parse("ftb").unwrap(), Source::Ftb);
        assert_eq!(Source::parse("curseforge").unwrap().key(), "curseforge");
        assert!(Source::parse("../x").is_err());
    }

    #[test]
    fn only_known_hosts_are_downloadable() {
        for ok in [
            "https://files.feed-the-beast.com/blob/aa/x.jar",
            "https://edge.forgecdn.net/files/4013/966/a.jar",
            "https://mediafilez.forgecdn.net/files/4013/966/a.jar",
        ] {
            assert!(check_url(&reqwest::Url::parse(ok).unwrap()).is_ok(), "{ok}");
        }
        for bad in [
            "http://files.feed-the-beast.com/a",
            "https://files.feed-the-beast.com.evil/a",
            "https://files.feed-the-beast.com:444/a",
            "https://user@files.feed-the-beast.com/a",
            "https://dropbox.com/a",
            "https://localhost/a",
        ] {
            assert!(check_url(&reqwest::Url::parse(bad).unwrap()).is_err(), "{bad}");
        }
    }

    #[test]
    fn only_a_refusing_curseforge_cdn_asks_for_a_key() {
        let url = |u: &str| reqwest::Url::parse(u).unwrap();
        let cdn = url("https://edge.forgecdn.net/files/4013/966/a.jar");
        assert!(cdn_wants_key(&cdn, reqwest::StatusCode::UNAUTHORIZED));
        // 403 = Datei fehlt (so antwortet mediafilez schon heute), kein Schlüsselproblem.
        assert!(!cdn_wants_key(&url("https://mediafilez.forgecdn.net/files/1/2/a.jar"), reqwest::StatusCode::FORBIDDEN));
        assert!(!cdn_wants_key(&cdn, reqwest::StatusCode::NOT_FOUND));
        assert!(!cdn_wants_key(&url("https://files.feed-the-beast.com/blob/aa/x.jar"), reqwest::StatusCode::UNAUTHORIZED));
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
    fn the_key_message_names_the_file() {
        let url = reqwest::Url::parse("https://edge.forgecdn.net/files/2935/316/Botania r1.16.2-411.jar").unwrap();
        assert_eq!(file_name(&url), "Botania r1.16.2-411.jar");
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
