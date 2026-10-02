//! Anfragen an den CurseForge-Proxy: Adresse, Wartezeit bei „zu viele Anfragen“ (429) und die Abfragen einzelner und
//! vieler Projekte und Dateien.
use super::dto::{CfFile, CfMod, One, Page};
use crate::{
    coded,
    error::{AppError, AppResult},
    services::{limits::PROVIDER_JSON_LIMIT, transport::read_capped},
};
use serde::de::DeserializeOwned;
use std::{collections::HashMap, time::Duration};

/// Der Worker dieses Projekts. Die Adresse ist kein Geheimnis (der Schlüssel liegt nur bei Cloudflare), aber der
/// Schlüssel ist an Pumpkin Launcher vergeben: Forks nutzen diesen Worker nicht, sondern beantragen bei CurseForge einen
/// eigenen Schlüssel, betreiben einen eigenen Worker (`proxy/`) und setzen `PUMPKIN_CF_PROXY` (Laufzeit oder beim Bauen).
const DEFAULT_PROXY: &str = "https://pumpkin-curseforge.jonas-laux.workers.dev";
/// Größte Liste für `POST /v1/mods` und `/v1/mods/files`, die der Worker annimmt.
const BATCH: usize = 200;
/// Pause nach der ersten 429-Antwort ohne `Retry-After` in Sekunden; sie verdoppelt sich je Versuch.
const BASE_WAIT_SECS: u64 = 5;
/// Neue Versuche nach „zu viele Anfragen“ (429), bevor der Fehler beim Nutzer landet.
const RATE_LIMIT_RETRIES: u32 = 3;
/// Längste Pause, die ein `Retry-After` erzwingen darf; länger soll die Oberfläche nicht hängen.
const MAX_WAIT: Duration = Duration::from_secs(30);

/// Adresse des Proxys ohne Schrägstrich am Ende; ein ungültig gesetzter Wert fällt auf den Standard zurück.
fn proxy() -> String {
    std::env::var("PUMPKIN_CF_PROXY")
        .ok()
        .or_else(|| option_env!("PUMPKIN_CF_PROXY").map(str::to_string))
        .and_then(|raw| parse_proxy(&raw))
        .unwrap_or_else(|| DEFAULT_PROXY.to_string())
}

/// Nur eine https-Adresse ohne Zugangsdaten, Pfad, Suchteil und Anker; sonst würde ein falsch gesetzter Wert alles dorthin leiten.
fn parse_proxy(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let plain = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
        && matches!(url.path(), "" | "/")
        && url.query().is_none()
        && url.fragment().is_none();
    plain.then(|| url.as_str().trim_end_matches('/').to_string())
}

/// Sendet die Anfrage, die `build` jedes Mal neu zusammensetzt, und wartet bei 429 auf einen neuen Versuch, statt
/// sofort zu scheitern: Große Installationen stoßen an das Minutenlimit des Workers.
async fn send<T: DeserializeOwned>(build: impl Fn() -> reqwest::RequestBuilder) -> AppResult<T> {
    let mut attempt = 0;
    loop {
        let response = build().header(reqwest::header::ACCEPT, "application/json").send().await?;
        if response.status() != reqwest::StatusCode::TOO_MANY_REQUESTS {
            return parse_response(response).await;
        }
        let retry_after = response.headers().get(reqwest::header::RETRY_AFTER).and_then(|v| v.to_str().ok());
        let Some(wait) = rate_limit_wait(retry_after, attempt) else {
            return Err(AppError::invalid(coded!("errors.providers.tooManyRequests")));
        };
        tracing::info!(?wait, attempt, "CurseForge-Proxy drosselt, neuer Versuch");
        tokio::time::sleep(wait).await;
        attempt += 1;
    }
}

/// Pause vor dem nächsten Versuch nach einer 429-Antwort, `None` = aufgeben. `Retry-After` (Sekunden) gilt, sonst wächst
/// die Pause (5, 10, 20 s), damit das Minutenfenster des Workers wieder Luft hat.
fn rate_limit_wait(retry_after: Option<&str>, attempt: u32) -> Option<Duration> {
    if attempt >= RATE_LIMIT_RETRIES {
        return None;
    }
    let wait = retry_after.and_then(|s| s.trim().parse().ok()).map_or(Duration::from_secs(BASE_WAIT_SECS << attempt), Duration::from_secs);
    Some(wait.min(MAX_WAIT))
}

/// Übersetzt die Ablehnungen des Workers in verständliche Meldungen und liest die (begrenzte) JSON-Antwort.
async fn parse_response<T: DeserializeOwned>(response: reqwest::Response) -> AppResult<T> {
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403) {
        return Err(AppError::invalid(coded!("errors.providers.serviceRejected")));
    }
    if status.as_u16() == 404 {
        return Err(AppError::invalid(coded!("errors.providers.notFoundOnCurseForge")));
    }
    let mut response = response.error_for_status()?;
    Ok(serde_json::from_slice(&read_capped(&mut response, PROVIDER_JSON_LIMIT, "Antwort zu groß").await?)?)
}

pub(super) async fn get<T: DeserializeOwned>(client: &reqwest::Client, path: &str, query: &[(&str, String)]) -> AppResult<T> {
    get_at(client, &proxy(), path, query).await
}

async fn post<T: DeserializeOwned>(client: &reqwest::Client, path: &str, body: &serde_json::Value) -> AppResult<T> {
    post_at(client, &proxy(), path, body).await
}

async fn get_at<T: DeserializeOwned>(client: &reqwest::Client, proxy: &str, path: &str, query: &[(&str, String)]) -> AppResult<T> {
    let mut url = reqwest::Url::parse(&format!("{proxy}/v1/{path}")).map_err(|e| AppError::invalid(e.to_string()))?;
    url.query_pairs_mut().extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
    send(|| client.get(url.clone())).await
}

async fn post_at<T: DeserializeOwned>(client: &reqwest::Client, proxy: &str, path: &str, body: &serde_json::Value) -> AppResult<T> {
    let url = format!("{proxy}/v1/{path}");
    send(|| client.post(&url).json(body)).await
}

/// Viele Projekte oder Dateien mit wenigen Sammelabfragen statt einer je Nummer.
async fn batch<T: DeserializeOwned>(client: &reqwest::Client, path: &str, field: &str, ids: &[u64]) -> AppResult<Vec<T>> {
    let mut all = Vec::new();
    for chunk in ids.chunks(BATCH) {
        all.extend(post::<Page<T>>(client, path, &serde_json::json!({ field: chunk })).await?.data);
    }
    Ok(all)
}

pub(super) async fn mods_by_id(client: &reqwest::Client, ids: &[u64]) -> AppResult<HashMap<u64, CfMod>> {
    Ok(batch::<CfMod>(client, "mods", "modIds", ids).await?.into_iter().map(|m| (m.id, m)).collect())
}

pub(super) async fn files_by_id(client: &reqwest::Client, ids: &[u64]) -> AppResult<HashMap<u64, CfFile>> {
    Ok(batch::<CfFile>(client, "mods/files", "fileIds", ids).await?.into_iter().map(|f| (f.id, f)).collect())
}

pub(super) async fn mod_of(client: &reqwest::Client, id: u32) -> AppResult<CfMod> {
    Ok(get::<One<CfMod>>(client, &format!("mods/{id}"), &[]).await?.data)
}

pub(super) async fn file_of(client: &reqwest::Client, project: u32, file: u32) -> AppResult<CfFile> {
    let f = get::<One<CfFile>>(client, &format!("mods/{project}/files/{file}"), &[]).await?.data;
    if f.id != u64::from(file) || f.mod_id != u64::from(project) {
        return Err(AppError::invalid(coded!("errors.providers.fileNotInProject")));
    }
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::modrinth;
    use serde_json::json;

    #[test]
    fn rate_limits_are_waited_out_a_few_times() {
        assert_eq!(rate_limit_wait(Some("7"), 0), Some(Duration::from_secs(7)));
        assert_eq!(rate_limit_wait(None, 0), Some(Duration::from_secs(5)));
        assert_eq!(rate_limit_wait(None, 2), Some(Duration::from_secs(20)));
        // Ein Datum statt Sekunden zählt nicht, ein zu langes Warten wird gekürzt.
        assert_eq!(rate_limit_wait(Some("Wed, 21 Oct 2026 07:28:00 GMT"), 1), Some(Duration::from_secs(10)));
        assert_eq!(rate_limit_wait(Some("3600"), 0), Some(MAX_WAIT));
        assert_eq!(rate_limit_wait(Some("1"), RATE_LIMIT_RETRIES), None);
    }

    #[test]
    fn proxy_address_must_be_plain_https() {
        assert_eq!(parse_proxy(" https://pumpkin-curseforge.jonas.workers.dev/ ").as_deref(), Some("https://pumpkin-curseforge.jonas.workers.dev"));
        for bad in ["", "http://x.workers.dev", "https://user:pw@x.workers.dev", "https://x.workers.dev/v1", "https://x.workers.dev/?a=1", "ftp://x", "nicht-url"] {
            assert_eq!(parse_proxy(bad), None, "{bad}");
        }
    }

    /// Was der Worker durchlässt und was nicht: `cargo test live_curseforge_via_proxy -- --ignored`.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker"]
    async fn live_curseforge_via_proxy() {
        let proxy = proxy();
        let client = modrinth::client().unwrap();
        let q = [
            ("gameId", "432".to_string()),
            ("classId", "6".to_string()),
            ("searchFilter", "just enough items".to_string()),
            ("sortField", "6".to_string()),
            ("sortOrder", "desc".to_string()),
            ("pageSize", "10".to_string()),
        ];
        let page: Page<CfMod> = get_at(&client, &proxy, "mods/search", &q).await.unwrap();
        assert!(page.data.iter().any(|m| m.slug == "jei"), "JEI fehlt über den Proxy");
        let files: Page<CfFile> = post_at(&client, &proxy, "mods/files", &json!({ "fileIds": [9019497] })).await.unwrap();
        assert_eq!(files.data.first().map(|f| f.mod_id), Some(238222));
        eprintln!("Proxy liefert {} Treffer und die Datei 9019497", page.data.len());
        // Was der Proxy nicht durchlässt, kommt als Fehler an.
        assert!(get_at::<serde_json::Value>(&client, &proxy, "games", &[]).await.is_err());
    }
}
