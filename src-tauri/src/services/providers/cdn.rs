//! Downloads von den CDNs, auf die FTB-Packs verweisen: nur feste Hosts, Weiterleitungen einzeln geprüft.
use crate::{
    coded,
    error::{AppError, AppResult},
    services::transport::{follow_redirects, read_capped, DOWNLOAD_TOO_BIG},
};

/// Anfragen je Download einschließlich der ersten, also höchstens drei Weiterleitungen.
const MAX_REQUESTS: usize = 4;

/// Hosts, von denen Pack-Dateien geladen werden dürfen: FTB selbst und das CurseForge-CDN,
/// auf das FTB für Mods verweist, die es nicht selbst hostet.
const HOSTS: &[&str] = &[
    "files.feed-the-beast.com",
    "cdn.feed-the-beast.com",
    "edge.forgecdn.net",
    "mediafilez.forgecdn.net",
    "media.forgecdn.net",
];

pub(super) fn check_url(url: &reqwest::Url) -> AppResult<()> {
    if url.scheme() != "https"
        || !url.host_str().is_some_and(|h| HOSTS.contains(&h))
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::invalid(coded!("errors.game.downloadOriginNotAllowed")));
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
        return Err(AppError::Refused(coded!("errors.game.curseForgeNeedsKey", file = file_name(response.url())).into()));
    }
    Ok(response.error_for_status()?)
}

/// GET mit handgeführten Weiterleitungen, jedes Ziel gegen die Host-Liste geprüft.
pub(super) async fn get(client: &reqwest::Client, start: &str) -> AppResult<reqwest::Response> {
    let response = follow_redirects(start, MAX_REQUESTS, |url| async move {
        check_url(&url)?;
        Ok(client.get(url).send().await?)
    })
    .await?;
    ensure_success(response)
}

/// Lädt höchstens `limit` Bytes in den Speicher.
pub(super) async fn fetch(client: &reqwest::Client, start: &str, limit: u64) -> AppResult<Vec<u8>> {
    let mut response = get(client, start).await?;
    read_capped(&mut response, limit, DOWNLOAD_TOO_BIG).await
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
