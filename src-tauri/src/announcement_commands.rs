use std::{num::NonZeroU32, time::Duration};

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    services::transport::read_capped,
    state::AppState,
};

const FEED_URL: &str = "https://github.com/jonax1337/pumpkin-launcher/discussions/categories/announcements.atom";
const FEED_TIMEOUT: Duration = Duration::from_secs(20);
const FEED_LIMIT: u64 = 4 * 1024 * 1024;

#[tauri::command]
pub async fn announcement_feed(state: State<'_, AppState>, page: NonZeroU32) -> AppResult<String> {
    let response = state
        .http
        .get(format!("{FEED_URL}?page={page}"))
        .header(reqwest::header::ACCEPT, "application/atom+xml")
        .timeout(FEED_TIMEOUT)
        .send()
        .await?;
    read_feed(response).await
}

async fn read_feed(response: reqwest::Response) -> AppResult<String> {
    let mut response = response.error_for_status()?;
    // Der gemeinsame Client folgt keinen Weiterleitungen; auch 3xx sind hier keine Feed-Antwort.
    if !response.status().is_success() {
        return Err(AppError::Download(format!("GitHub announcements: HTTP {}", response.status()).into()));
    }
    let bytes = read_capped(&mut response, FEED_LIMIT, "GitHub announcement feed is too large").await?;
    String::from_utf8(bytes).map_err(|_| AppError::invalid("GitHub announcement feed is not UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(status: u16, body: Vec<u8>) -> reqwest::Response {
        reqwest::Response::from(tauri::http::Response::builder().status(status).body(body).unwrap())
    }

    #[tokio::test]
    async fn rejects_http_errors_and_redirects() {
        for status in [301, 302, 403, 404, 429, 500] {
            assert!(read_feed(response(status, Vec::new())).await.is_err());
        }
    }

    #[tokio::test]
    async fn rejects_oversized_or_invalid_text() {
        assert!(read_feed(response(200, vec![b'x'; FEED_LIMIT as usize + 1])).await.is_err());
        assert!(read_feed(response(200, vec![0xff])).await.is_err());
    }
}
