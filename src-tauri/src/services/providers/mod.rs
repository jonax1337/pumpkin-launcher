//! Kataloge ohne API-Key: FTB (öffentliche API, installierbar), Technic und CurseForge (nur lesend).
//! Alle liefern dieselben Formen wie Modrinth (`Hit`, `Project`, `Version`), damit die Oberfläche sie gleich zeigt.
use super::modrinth::{self, invalid};
use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256, Sha512};
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
            _ => Err(invalid("Unbekannter Anbieter")),
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

const JSON_LIMIT: u64 = 16 * 1024 * 1024;
pub(crate) const MIB: u64 = 1024 * 1024;
/// Größtes Pack-Zip, das geladen wird, und Grenzen fürs Entpacken.
pub(crate) const ZIP_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const EXPANDED_LIMIT: u64 = 8 * 1024 * 1024 * 1024;
/// Versuche je Download-Adresse.
const ATTEMPTS: u32 = 3;
const MAX_ENTRIES: usize = 20_000;

/// Dateien eines Pack-Zips wie bei `zip_paths`, dazu Größen- und Kompressionsgrenzen gegen ZIP-Bomben
/// (Regeln wie beim `.mrpack`).
pub(crate) fn zip_files(zip: &mut zip::ZipArchive<std::fs::File>, prefix: &str, skip: &[&str]) -> AppResult<Vec<(std::path::PathBuf, usize)>> {
    if zip.len() > MAX_ENTRIES {
        return Err(invalid("Zu viele ZIP-Einträge"));
    }
    let files = zip_paths(zip, prefix, skip)?;
    let mut expanded = 0u64;
    for (_, index) in &files {
        let entry = zip.by_index_raw(*index)?;
        expanded = expanded.checked_add(entry.size()).ok_or_else(|| invalid("ZIP-Größenüberlauf"))?;
        if expanded > EXPANDED_LIMIT
            || entry.size() > modrinth::FILE_LIMIT
            || entry.size() > entry.compressed_size().saturating_mul(200).saturating_add(MIB)
        {
            return Err(invalid("ZIP-Limit überschritten"));
        }
    }
    Ok(files)
}

/// Dateien eines ZIPs unterhalb von `prefix`, ohne die Ordner in `skip` (Namen der obersten Ebene):
/// `(Zielpfad, Eintrags-Nummer)`. Nur Pfadregeln: sichere Pfade, keine Sonderdateien, keine Doppelten,
/// keine Datei, die zugleich Ordner einer anderen ist.
pub(crate) fn zip_paths(zip: &mut zip::ZipArchive<std::fs::File>, prefix: &str, skip: &[&str]) -> AppResult<Vec<(std::path::PathBuf, usize)>> {
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
        if entry.unix_mode().is_some_and(|m| matches!(m & 0o170000, 0o120000 | 0o060000 | 0o020000 | 0o010000 | 0o140000)) {
            return Err(invalid("ZIP-Symlink/Spezialdatei"));
        }
        if !seen.insert(rel.to_lowercase()) {
            return Err(invalid("Doppelter ZIP-Pfad"));
        }
        files.push((path, index));
    }
    // Windows unterscheidet keine Groß-/Kleinschreibung, daher kleingeschrieben vergleichen.
    for path in &seen {
        for (at, _) in path.match_indices('/') {
            if seen.contains(&path[..at]) {
                return Err(invalid("Datei/Verzeichnis-Konflikt"));
            }
        }
    }
    Ok(files)
}

/// JSON-GET gegen eine feste API; Weiterleitungen und Fehlerstatus sind Fehler.
pub(crate) async fn json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> AppResult<T> {
    Ok(serde_json::from_slice(&modrinth::bytes(client.get(url), JSON_LIMIT).await?)?)
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
        return Err(invalid("Download-Origin nicht erlaubt"));
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

fn ok_status(response: reqwest::Response) -> AppResult<reqwest::Response> {
    if cdn_wants_key(response.url(), response.status()) {
        return Err(invalid(format!(
            "CurseForge gibt {} nur noch mit Schlüssel heraus. Bitte aktualisiere Pumpkin Launcher oder lade die Datei von Hand auf curseforge.com.",
            file_name(response.url())
        )));
    }
    Ok(response.error_for_status()?)
}

/// GET mit handgeführten Weiterleitungen (höchstens drei), jedes Ziel gegen die Host-Liste geprüft.
async fn fetch(client: &reqwest::Client, start: &str, limit: u64) -> AppResult<Vec<u8>> {
    let mut url = reqwest::Url::parse(start).map_err(|e| invalid(e.to_string()))?;
    for _ in 0..4 {
        check_url(&url)?;
        let response = client.get(url.clone()).send().await?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| invalid("Weiterleitung ohne Ziel"))?;
            url = url.join(location).map_err(|e| invalid(e.to_string()))?;
            continue;
        }
        let mut response = ok_status(response)?;
        if response.content_length().is_some_and(|n| n > limit) {
            return Err(invalid("Download zu groß"));
        }
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if data.len() as u64 + chunk.len() as u64 > limit {
                return Err(invalid("Download zu groß"));
            }
            data.extend_from_slice(&chunk);
        }
        return Ok(data);
    }
    Err(invalid("Zu viele Weiterleitungen"))
}

/// Datei eines Packs mit Ausweich-Adressen. Ohne mindestens einen Hash wird nichts akzeptiert.
#[derive(Debug, Clone)]
pub struct RemoteFile {
    pub urls: Vec<String>,
    pub size: u64,
    pub hashes: BTreeMap<&'static str, String>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl RemoteFile {
    pub fn verify(&self, data: &[u8]) -> AppResult<()> {
        if self.hashes.is_empty() {
            return Err(invalid("Datei ohne Prüfsumme"));
        }
        if self.size != 0 && data.len() as u64 != self.size {
            return Err(invalid("Dateigröße stimmt nicht"));
        }
        for (algorithm, expected) in &self.hashes {
            let actual = match *algorithm {
                "sha1" => super::download::sha1_hex(data),
                "sha256" => hex(&Sha256::digest(data)),
                "sha512" => hex(&Sha512::digest(data)),
                _ => return Err(invalid("Unbekannter Hash")),
            };
            if !expected.eq_ignore_ascii_case(&actual) {
                return Err(invalid(format!("{algorithm} stimmt nicht")));
            }
        }
        Ok(())
    }

    /// Wie `download`, aber in eine Datei (für große Pack-Zips). Die Prüfsummen werden an der fertigen Datei
    /// gelesen; bei Abweichung verschwindet sie wieder. `progress(geladen, gesamt)` in Bytes.
    pub async fn download_to(&self, client: &reqwest::Client, dest: &std::path::Path, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> AppResult<()> {
        use tokio::io::AsyncWriteExt;
        if self.hashes.is_empty() {
            return Err(invalid("Datei ohne Prüfsumme"));
        }
        let limit = if self.size == 0 { 2 * 1024 * 1024 * 1024 } else { self.size.min(2 * 1024 * 1024 * 1024) };
        let mut last: Option<AppError> = None;
        for (start, attempt_no) in self.urls.iter().flat_map(|u| (0..ATTEMPTS).map(move |n| (u, n))) {
            if attempt_no > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(1500 * u64::from(attempt_no))).await;
            }
            let attempt: AppResult<()> = async {
                let mut url = reqwest::Url::parse(start).map_err(|e| invalid(e.to_string()))?;
                for _ in 0..4 {
                    check_url(&url)?;
                    let response = client.get(url.clone()).send().await?;
                    if response.status().is_redirection() {
                        let location = response
                            .headers()
                            .get(reqwest::header::LOCATION)
                            .and_then(|v| v.to_str().ok())
                            .ok_or_else(|| invalid("Weiterleitung ohne Ziel"))?;
                        url = url.join(location).map_err(|e| invalid(e.to_string()))?;
                        continue;
                    }
                    let mut response = ok_status(response)?;
                    let total = response.content_length().unwrap_or(self.size);
                    if total > limit {
                        return Err(invalid("Download zu groß"));
                    }
                    let mut file = tokio::fs::File::create(dest).await?;
                    let mut done = 0u64;
                    while let Some(chunk) = response.chunk().await? {
                        done += chunk.len() as u64;
                        if done > limit {
                            return Err(invalid("Download zu groß"));
                        }
                        file.write_all(&chunk).await?;
                        progress(done, total);
                    }
                    file.flush().await?;
                    return Ok(());
                }
                Err(invalid("Zu viele Weiterleitungen"))
            }
            .await;
            let verified = attempt.and_then(|()| self.verify_file(dest));
            match verified {
                Ok(()) => return Ok(()),
                Err(err) => {
                    let _ = tokio::fs::remove_file(dest).await;
                    tracing::warn!(%err, url = start, "Quelle fehlgeschlagen, nächste wird versucht");
                    last = Some(err);
                }
            }
        }
        Err(last.unwrap_or_else(|| invalid("Keine Download-Adresse")))
    }

    /// Größe und Prüfsummen einer Datei auf der Platte, in einem Durchlauf gelesen.
    fn verify_file(&self, path: &std::path::Path) -> AppResult<()> {
        use sha1::Sha1;
        use std::io::Read;
        let mut file = std::fs::File::open(path)?;
        if self.size != 0 && file.metadata()?.len() != self.size {
            return Err(invalid("Dateigröße stimmt nicht"));
        }
        let (mut sha1, mut sha256, mut sha512) = (Sha1::new(), Sha256::new(), Sha512::new());
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            sha1.update(&buffer[..n]);
            sha256.update(&buffer[..n]);
            sha512.update(&buffer[..n]);
        }
        for (algorithm, expected) in &self.hashes {
            let actual = match *algorithm {
                "sha1" => hex(&sha1.clone().finalize()),
                "sha256" => hex(&sha256.clone().finalize()),
                "sha512" => hex(&sha512.clone().finalize()),
                _ => return Err(invalid("Unbekannter Hash")),
            };
            if !expected.eq_ignore_ascii_case(&actual) {
                return Err(invalid(format!("{algorithm} stimmt nicht")));
            }
        }
        Ok(())
    }

    pub async fn download(&self, client: &reqwest::Client) -> AppResult<Vec<u8>> {
        let limit = if self.size == 0 { modrinth::FILE_LIMIT } else { self.size.min(modrinth::FILE_LIMIT) };
        let mut last: Option<AppError> = None;
        for url in &self.urls {
            // Bei Hunderten Dateien fällt mal eine Verbindung aus: dreimal versuchen, bevor die nächste Quelle drankommt.
            for attempt in 0..ATTEMPTS {
                if attempt > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(800 * u64::from(attempt))).await;
                }
                match fetch(client, url, limit).await.and_then(|data| self.verify(&data).map(|()| data)) {
                    Ok(data) => return Ok(data),
                    Err(err) => {
                        tracing::warn!(%err, url, attempt, "Download fehlgeschlagen");
                        last = Some(err);
                    }
                }
            }
        }
        Err(last.unwrap_or_else(|| invalid("Keine Download-Adresse")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(size: u64, sha1: &str) -> RemoteFile {
        RemoteFile { urls: vec![], size, hashes: BTreeMap::from([("sha1", sha1.to_string())]) }
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

    #[test]
    fn the_key_message_names_the_file() {
        let url = reqwest::Url::parse("https://edge.forgecdn.net/files/2935/316/Botania r1.16.2-411.jar").unwrap();
        assert_eq!(file_name(&url), "Botania r1.16.2-411.jar");
    }

    #[test]
    fn files_need_a_matching_hash_and_size() {
        let sha1 = super::super::download::sha1_hex(b"test");
        assert!(file(4, &sha1).verify(b"test").is_ok());
        assert!(file(0, &sha1).verify(b"test").is_ok());
        assert!(file(3, &sha1).verify(b"test").is_err());
        assert!(file(4, &sha1).verify(b"evil").is_err());
        let unhashed = RemoteFile { urls: vec![], size: 4, hashes: BTreeMap::new() };
        assert!(unhashed.verify(b"test").is_err());
        let sha256 = RemoteFile { urls: vec![], size: 4, hashes: BTreeMap::from([("sha256", hex(&Sha256::digest(b"test")))]) };
        assert!(sha256.verify(b"test").is_ok() && sha256.verify(b"tesT").is_err());
    }
}
