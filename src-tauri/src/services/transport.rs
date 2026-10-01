//! Gemeinsame Bausteine der Downloads: Client-Grundlage, begrenztes Lesen, Weiterleitungen und Prüfsummen.
use std::{future::Future, io::Read};

use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use tokio::io::{AsyncWrite, AsyncWriteExt};

use super::progress::CountFn;
use crate::error::{AppError, AppResult};

const READ_BUFFER: usize = 256 * 1024;

/// Grundlage aller Clients, die fremde Server ansprechen: Weiterleitungen folgt nur [`follow_redirects`], jedes Ziel
/// wird dort einzeln geprüft.
pub(crate) fn base_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(concat!("pumpkin-launcher/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15))
}

pub(crate) const DOWNLOAD_TOO_BIG: &str = "Download zu groß";

fn ensure_within(size: u64, limit: u64, too_big: &str) -> AppResult<()> {
    if size > limit {
        return Err(AppError::invalid(too_big));
    }
    Ok(())
}

/// Liest den Body in den Speicher, höchstens `limit` Bytes; ist er größer, ist das ein Fehler mit der Meldung `too_big`.
pub(crate) async fn read_capped(response: &mut reqwest::Response, limit: u64, too_big: &str) -> AppResult<Vec<u8>> {
    ensure_within(response.content_length().unwrap_or(0), limit, too_big)?;
    let mut data = Vec::new();
    copy_capped(response, limit, too_big, &mut data, 0, &|_, _| {}).await?;
    Ok(data)
}

/// Schreibt den Body nach `dest`, höchstens `limit` Bytes. `total` ist die erwartete Größe (0 = unbekannt) und wird
/// vorab gegen `limit` geprüft; `progress(geladen, total)` in Bytes. Eine halb geschriebene Datei bleibt liegen:
/// aufräumen muss der Aufrufer.
pub(crate) async fn save_capped(
    response: &mut reqwest::Response,
    limit: u64,
    total: u64,
    dest: &std::path::Path,
    progress: CountFn<'_>,
) -> AppResult<()> {
    ensure_within(total, limit, DOWNLOAD_TOO_BIG)?;
    let mut file = tokio::fs::File::create(dest).await?;
    copy_capped(response, limit, DOWNLOAD_TOO_BIG, &mut file, total, progress).await
}

async fn copy_capped(
    response: &mut reqwest::Response,
    limit: u64,
    too_big: &str,
    out: &mut (impl AsyncWrite + Unpin),
    total: u64,
    progress: CountFn<'_>,
) -> AppResult<()> {
    let mut done = 0u64;
    while let Some(chunk) = response.chunk().await? {
        done += chunk.len() as u64;
        ensure_within(done, limit, too_big)?;
        out.write_all(&chunk).await?;
        progress(done, total);
    }
    out.flush().await?;
    Ok(())
}

/// Liest höchstens `limit` Bytes; enthält die Quelle mehr, ist das ein Fehler mit der Meldung `too_big`.
pub(crate) fn read_capped_io(reader: impl Read, limit: u64, too_big: &str) -> AppResult<Vec<u8>> {
    let mut data = Vec::new();
    reader.take(limit.saturating_add(1)).read_to_end(&mut data)?;
    if data.len() as u64 > limit {
        return Err(AppError::invalid(too_big));
    }
    Ok(data)
}

/// GET mit handgeführten Weiterleitungen: `send` schickt die Anfrage an eine Adresse und prüft sie vorher selbst, damit
/// jedes Ziel einzeln erlaubt sein muss. `max_requests` zählt die erste Anfrage mit.
pub(crate) async fn follow_redirects<Fut>(
    start: &str,
    max_requests: usize,
    mut send: impl FnMut(reqwest::Url) -> Fut,
) -> AppResult<reqwest::Response>
where
    Fut: Future<Output = AppResult<reqwest::Response>>,
{
    let mut url = reqwest::Url::parse(start).map_err(|e| AppError::invalid(e.to_string()))?;
    for _ in 0..max_requests {
        let response = send(url.clone()).await?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::invalid("Weiterleitung ohne Ziel"))?;
        url = url.join(location).map_err(|e| AppError::invalid(e.to_string()))?;
    }
    Err(AppError::invalid("Zu viele Weiterleitungen"))
}

/// SHA-1, SHA-256 und SHA-512 derselben Bytes, in einem Durchlauf berechnet.
#[derive(Default)]
pub(crate) struct Digests {
    sha1: Sha1,
    sha256: Sha256,
    sha512: Sha512,
}

impl Digests {
    pub(crate) fn of(bytes: &[u8]) -> Self {
        let mut digests = Self::default();
        digests.update(bytes);
        digests
    }

    /// Liest `reader` bis zum Ende, ohne die Daten im Speicher zu halten.
    pub(crate) fn of_reader(mut reader: impl Read) -> std::io::Result<Self> {
        let mut digests = Self::default();
        let mut buffer = vec![0u8; READ_BUFFER];
        loop {
            let n = reader.read(&mut buffer)?;
            if n == 0 {
                return Ok(digests);
            }
            digests.update(&buffer[..n]);
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        self.sha1.update(bytes);
        self.sha256.update(bytes);
        self.sha512.update(bytes);
    }

    /// Hex-Text des Hashes `algorithm` (`sha1`, `sha256`, `sha512`); jeder andere Name ist unbekannt.
    pub(crate) fn hex(&self, algorithm: &str) -> Option<String> {
        match algorithm {
            "sha1" => Some(hex(&self.sha1.clone().finalize())),
            "sha256" => Some(hex(&self.sha256.clone().finalize())),
            "sha512" => Some(hex(&self.sha512.clone().finalize())),
            _ => None,
        }
    }

    /// Der Hash `algorithm` muss `expected` sein (Groß- und Kleinschreibung egal).
    pub(crate) fn check_one(&self, algorithm: &str, expected: &str) -> AppResult<()> {
        let actual = self.hex(algorithm).ok_or_else(|| AppError::invalid("Unbekannter Hash"))?;
        if !expected.eq_ignore_ascii_case(&actual) {
            return Err(AppError::invalid(format!("{algorithm} stimmt nicht")));
        }
        Ok(())
    }

    /// Alle Paare `(Algorithmus, erwarteter Hash)` müssen stimmen; der erste Fehler gilt.
    pub(crate) fn check<'a>(&self, expected: impl IntoIterator<Item = (&'a str, &'a str)>) -> AppResult<()> {
        expected.into_iter().try_for_each(|(algorithm, hash)| self.check_one(algorithm, hash))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(status: u16, location: Option<&str>, body: &[u8]) -> reqwest::Response {
        let mut builder = tauri::http::Response::builder().status(status);
        if let Some(location) = location {
            builder = builder.header("location", location);
        }
        reqwest::Response::from(builder.body(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn bodies_are_read_up_to_the_limit() {
        assert_eq!(read_capped(&mut response(200, None, b"abcd"), 4, DOWNLOAD_TOO_BIG).await.unwrap(), b"abcd");
        let err = read_capped(&mut response(200, None, b"abcde"), 4, DOWNLOAD_TOO_BIG).await.unwrap_err();
        assert_eq!(err.to_string(), "Download zu groß");
        let err = read_capped(&mut response(200, None, b"abcde"), 4, "Antwort zu groß").await.unwrap_err();
        assert_eq!(err.to_string(), "Antwort zu groß");
    }

    #[tokio::test]
    async fn saved_bodies_report_progress_and_respect_the_limit() {
        let dest = std::env::temp_dir().join(crate::models::new_id());
        let seen = std::sync::Mutex::new(Vec::new());
        let progress = |done, total| seen.lock().unwrap().push((done, total));

        save_capped(&mut response(200, None, b"abcd"), 4, 4, &dest, &progress).await.unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"abcd");
        assert_eq!(*seen.lock().unwrap(), [(4, 4)]);
        let too_big = save_capped(&mut response(200, None, b"abcd"), 3, 4, &dest, &|_, _| {}).await;
        assert_eq!(too_big.unwrap_err().to_string(), "Download zu groß");
        std::fs::remove_file(dest).unwrap();
    }

    #[test]
    fn readers_are_capped_with_the_given_message() {
        assert_eq!(read_capped_io(&b"abc"[..], 3, "zu groß").unwrap(), b"abc");
        assert_eq!(read_capped_io(&b"abcd"[..], 3, "zu groß").unwrap_err().to_string(), "zu groß");
        assert!(read_capped_io(&b""[..], 0, "zu groß").unwrap().is_empty());
    }

    #[tokio::test]
    async fn redirects_are_followed_one_checked_hop_at_a_time() {
        let visited = std::sync::Mutex::new(Vec::new());
        let result = follow_redirects("https://a.example/start", 3, |url| {
            visited.lock().unwrap().push(url.to_string());
            async move {
                match url.path() {
                    "/start" => Ok(response(302, Some("/next"), b"")),
                    "/next" => Ok(response(301, Some("https://b.example/end"), b"")),
                    _ => Ok(response(200, None, b"ok")),
                }
            }
        })
        .await
        .unwrap();

        assert_eq!(result.status().as_u16(), 200);
        assert_eq!(*visited.lock().unwrap(), ["https://a.example/start", "https://a.example/next", "https://b.example/end"]);
    }

    #[tokio::test]
    async fn redirects_end_after_the_allowed_requests() {
        let endless = |_| async { Ok(response(302, Some("/again"), b"")) };
        let err = follow_redirects("https://a.example/", 2, endless).await.unwrap_err();
        assert_eq!(err.to_string(), "Zu viele Weiterleitungen");
        let no_target = |_| async { Ok(response(302, None, b"")) };
        let err = follow_redirects("https://a.example/", 2, no_target).await.unwrap_err();
        assert_eq!(err.to_string(), "Weiterleitung ohne Ziel");
    }

    #[tokio::test]
    async fn a_refused_address_stops_the_chain() {
        let refuse = |_| async { Err(AppError::invalid("nicht erlaubt")) };
        assert!(follow_redirects("https://a.example/", 2, refuse).await.is_err());
        let invalid = |_| async { Ok(response(200, None, b"")) };
        assert!(follow_redirects("kein url", 2, invalid).await.is_err());
    }

    #[test]
    fn digests_match_the_known_values_of_abc() {
        let digests = Digests::of(b"abc");
        assert_eq!(digests.hex("sha1").unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(digests.hex("sha256").unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert!(digests.hex("sha512").unwrap().starts_with("ddaf35a193617abacc417349ae204131"));
        assert!(digests.hex("md5").is_none());
    }

    #[test]
    fn a_reader_gives_the_same_digests_as_the_bytes() {
        let data = vec![7u8; READ_BUFFER * 2 + 5];
        let from_reader = Digests::of_reader(&data[..]).unwrap();
        for algorithm in ["sha1", "sha256", "sha512"] {
            assert_eq!(from_reader.hex(algorithm), Digests::of(&data).hex(algorithm), "{algorithm}");
        }
    }

    #[test]
    fn checks_ignore_case_and_name_the_failing_hash() {
        let digests = Digests::of(b"abc");
        let sha1 = digests.hex("sha1").unwrap();
        assert!(digests.check([("sha1", sha1.to_ascii_uppercase().as_str())]).is_ok());
        assert!(digests.check([]).is_ok());
        let wrong = digests.check([("sha1", sha1.as_str()), ("sha256", "00")]).unwrap_err();
        assert_eq!(wrong.to_string(), "sha256 stimmt nicht");
        assert_eq!(digests.check_one("md5", "x").unwrap_err().to_string(), "Unbekannter Hash");
    }
}
