//! Der Client des Verzeichnis-Workers (BYNAME 4): jede Route ein Aufruf, jede Ablehnung eine [`DirectoryError`].
//! Der Worker liefert nur Fehlercodes (`{"error":"…"}`); Text des Workers erreicht nie den Nutzer.
use std::time::Duration;

use futures::future::BoxFuture;
use futures::FutureExt;
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::json;

use super::wire::{Challenge, DirectorySession, ErrorBody, Inbox, InboxLetter, OutgoingLetter, SentLetter, SessionRequest};
use super::DirectoryError;
use crate::services::friends::sanitize;
use crate::services::transport::read_capped;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const RESPONSE_LIMIT: u64 = 64 * 1024;
/// Fehlercodes, die der Worker bei einer fehlerhaften Anfrage nennt; sie gehen als Text ins Protokoll.
const INVALID_REQUEST_CODES: [&str; 9] =
    ["invalid", "self", "badSignature", "clock", "challengeExpired", "tooLarge", "forbidden", "notFound", "blockListFull"];

pub trait DirectoryApi: Send + Sync + 'static {
    fn challenge<'a>(&'a self, peer_id: &'a str) -> BoxFuture<'a, Result<Challenge, DirectoryError>>;
    fn session<'a>(&'a self, request: &'a SessionRequest) -> BoxFuture<'a, Result<DirectorySession, DirectoryError>>;
    fn register<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn unregister<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn send<'a>(&'a self, token: &'a str, letter: &'a OutgoingLetter) -> BoxFuture<'a, Result<SentLetter, DirectoryError>>;
    fn retract<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn inbox<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<Vec<InboxLetter>, DirectoryError>>;
    fn delete<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn block<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn unblock<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
}

pub struct WorkerApi {
    client: reqwest::Client,
    /// Adresse ohne Schrägstrich am Ende.
    base: String,
    timeout: Duration,
}

impl WorkerApi {
    pub fn new(client: reqwest::Client, base: String) -> Self {
        Self::with_timeout(client, base, REQUEST_TIMEOUT)
    }

    pub fn with_timeout(client: reqwest::Client, base: String, timeout: Duration) -> Self {
        Self { client, base, timeout }
    }

    fn request(&self, method: Method, path: &str, token: Option<&str>) -> reqwest::RequestBuilder {
        let request = self.client.request(method, format!("{}{path}", self.base)).timeout(self.timeout);
        match token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    /// Der Körper einer erfolgreichen Antwort; jede andere Antwort ist ein Fehler.
    async fn finish(request: reqwest::RequestBuilder) -> Result<Vec<u8>, DirectoryError> {
        let mut response = request.send().await.map_err(|_| DirectoryError::Unreachable)?;
        let status = response.status();
        let retry_after = response.headers().get(reqwest::header::RETRY_AFTER).and_then(|value| value.to_str().ok()).map(str::to_owned);
        let body = read_capped(&mut response, RESPONSE_LIMIT, "Antwort zu groß").await.map_err(|_| DirectoryError::Invalid("responseTooLarge"))?;
        if status.is_success() { Ok(body) } else { Err(map_error(status.as_u16(), &body, retry_after.as_deref())) }
    }

    async fn finish_json<T: DeserializeOwned>(request: reqwest::RequestBuilder) -> Result<T, DirectoryError> {
        let body = Self::finish(request).await?;
        serde_json::from_slice(&body).map_err(|_| DirectoryError::Invalid("response"))
    }

    async fn finish_empty(request: reqwest::RequestBuilder) -> Result<(), DirectoryError> {
        Self::finish(request).await.map(drop)
    }
}

impl DirectoryApi for WorkerApi {
    fn challenge<'a>(&'a self, peer_id: &'a str) -> BoxFuture<'a, Result<Challenge, DirectoryError>> {
        let request = self.request(Method::POST, "/v1/auth/challenge", None).json(&json!({ "peerId": peer_id }));
        Self::finish_json(request).boxed()
    }

    fn session<'a>(&'a self, request: &'a SessionRequest) -> BoxFuture<'a, Result<DirectorySession, DirectoryError>> {
        Self::finish_json(self.request(Method::POST, "/v1/auth/session", None).json(request)).boxed()
    }

    fn register<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        Self::finish_empty(self.request(Method::PUT, "/v1/me", Some(token)).json(&json!({}))).boxed()
    }

    fn unregister<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        Self::finish_empty(self.request(Method::DELETE, "/v1/me", Some(token))).boxed()
    }

    fn send<'a>(&'a self, token: &'a str, letter: &'a OutgoingLetter) -> BoxFuture<'a, Result<SentLetter, DirectoryError>> {
        Self::finish_json(self.request(Method::POST, "/v1/outbox", Some(token)).json(letter)).boxed()
    }

    fn retract<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        async move {
            let path = format!("/v1/outbox/{}", letter_id(id)?);
            Self::finish_empty(self.request(Method::DELETE, &path, Some(token))).await
        }
        .boxed()
    }

    fn inbox<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<Vec<InboxLetter>, DirectoryError>> {
        async move {
            let inbox: Inbox = Self::finish_json(self.request(Method::GET, "/v1/inbox", Some(token))).await?;
            Ok(inbox.letters)
        }
        .boxed()
    }

    fn delete<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        async move {
            let path = format!("/v1/inbox/{}", letter_id(id)?);
            Self::finish_empty(self.request(Method::DELETE, &path, Some(token))).await
        }
        .boxed()
    }

    fn block<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        async move {
            let path = format!("/v1/blocks/{}", account_id(uuid)?);
            Self::finish_empty(self.request(Method::PUT, &path, Some(token))).await
        }
        .boxed()
    }

    fn unblock<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        async move {
            let path = format!("/v1/blocks/{}", account_id(uuid)?);
            Self::finish_empty(self.request(Method::DELETE, &path, Some(token))).await
        }
        .boxed()
    }
}

/// Die Id eines Briefs wird Teil des Pfads und stammt aus der Antwort des Workers: nur die kanonische UUID-Form geht hinaus.
fn letter_id(id: &str) -> Result<&str, DirectoryError> {
    let hyphens_at = [8, 13, 18, 23];
    let canonical = id.len() == 36
        && id.bytes().enumerate().all(|(at, byte)| {
            if hyphens_at.contains(&at) { byte == b'-' } else { matches!(byte, b'0'..=b'9' | b'a'..=b'f') }
        });
    if canonical { Ok(id) } else { Err(DirectoryError::Invalid("letterId")) }
}

fn account_id(uuid: &str) -> Result<&str, DirectoryError> {
    sanitize::mc_uuid(Some(uuid)).map(|_| uuid).ok_or(DirectoryError::Invalid("uuid"))
}

/// Der Fehlercode des Workers entscheidet; ohne lesbaren Code (etwa eine Fehlerseite von Cloudflare) der Status.
fn map_error(status: u16, body: &[u8], retry_after: Option<&str>) -> DirectoryError {
    let code = serde_json::from_slice::<ErrorBody>(body).ok().map(|body| body.error);
    match code.as_deref() {
        Some("unauthorized") => DirectoryError::Unauthorized,
        Some("notJoined") => DirectoryError::NotJoined,
        Some("notFindable") => DirectoryError::NotFindable,
        Some("notRegistered") => DirectoryError::NotRegistered,
        Some("recipientFull") => DirectoryError::RecipientFull,
        Some("sendQuota") => DirectoryError::SendQuota,
        Some("pairCooldown") => DirectoryError::PairCooldown,
        Some("mojangUnavailable") => DirectoryError::MojangUnavailable,
        Some("rateLimited") => rate_limited(retry_after),
        Some("notConfigured" | "internal") => DirectoryError::Unreachable,
        Some(other) => INVALID_REQUEST_CODES
            .iter()
            .find(|known| **known == other)
            .map_or_else(|| by_status(status, retry_after), |known| DirectoryError::Invalid(known)),
        None => by_status(status, retry_after),
    }
}

fn by_status(status: u16, retry_after: Option<&str>) -> DirectoryError {
    match status {
        401 => DirectoryError::Unauthorized,
        429 => rate_limited(retry_after),
        500..=599 => DirectoryError::Unreachable,
        _ => DirectoryError::Invalid("unexpected"),
    }
}

fn rate_limited(retry_after: Option<&str>) -> DirectoryError {
    DirectoryError::RateLimited { retry_after: retry_after.and_then(|seconds| seconds.trim().parse().ok()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error_body(code: &str) -> Vec<u8> {
        json!({ "error": code }).to_string().into_bytes()
    }

    #[test]
    fn worker_codes_map_to_directory_errors() {
        let table = [
            (401, "unauthorized", DirectoryError::Unauthorized),
            (401, "notJoined", DirectoryError::NotJoined),
            (404, "notFindable", DirectoryError::NotFindable),
            (404, "notRegistered", DirectoryError::NotRegistered),
            (409, "recipientFull", DirectoryError::RecipientFull),
            (429, "sendQuota", DirectoryError::SendQuota),
            (429, "pairCooldown", DirectoryError::PairCooldown),
            (503, "mojangUnavailable", DirectoryError::MojangUnavailable),
            (503, "notConfigured", DirectoryError::Unreachable),
            (500, "internal", DirectoryError::Unreachable),
        ];
        for (status, code, expected) in table {
            assert_eq!(map_error(status, &error_body(code), None), expected, "{status} {code}");
        }
    }

    #[test]
    fn requests_the_worker_calls_invalid_carry_its_code() {
        let table = [
            (400, "invalid"),
            (400, "self"),
            (400, "badSignature"),
            (401, "badSignature"),
            (400, "clock"),
            (400, "challengeExpired"),
            (413, "tooLarge"),
            (403, "forbidden"),
            (404, "notFound"),
            (409, "blockListFull"),
        ];
        for (status, code) in table {
            assert_eq!(map_error(status, &error_body(code), None), DirectoryError::Invalid(code_of(code)), "{status} {code}");
        }
    }

    fn code_of(code: &str) -> &'static str {
        INVALID_REQUEST_CODES.iter().find(|known| **known == code).copied().unwrap()
    }

    #[test]
    fn rate_limited_reads_retry_after_in_seconds() {
        let body = error_body("rateLimited");
        assert_eq!(map_error(429, &body, Some("60")), DirectoryError::RateLimited { retry_after: Some(60) });
        assert_eq!(map_error(429, &body, Some(" 7 ")), DirectoryError::RateLimited { retry_after: Some(7) });
        assert_eq!(map_error(429, &body, None), DirectoryError::RateLimited { retry_after: None });
        let a_date = Some("Wed, 21 Oct 2026 07:28:00 GMT");
        assert_eq!(map_error(429, &body, a_date), DirectoryError::RateLimited { retry_after: None });
    }

    #[test]
    fn an_answer_without_a_code_falls_back_to_the_status() {
        let html = b"<html>Bad gateway</html>";
        assert_eq!(map_error(401, html, None), DirectoryError::Unauthorized);
        assert_eq!(map_error(429, html, Some("5")), DirectoryError::RateLimited { retry_after: Some(5) });
        for status in [500, 502, 503, 522] {
            assert_eq!(map_error(status, html, None), DirectoryError::Unreachable, "{status}");
        }
        for status in [301, 400, 403, 404] {
            assert_eq!(map_error(status, html, None), DirectoryError::Invalid("unexpected"), "{status}");
        }
    }

    #[test]
    fn an_unknown_code_is_judged_by_its_status() {
        assert_eq!(map_error(502, &error_body("neuerCode"), None), DirectoryError::Unreachable);
        assert_eq!(map_error(400, &error_body("neuerCode"), None), DirectoryError::Invalid("unexpected"));
    }

    #[test]
    fn only_canonical_lowercase_uuids_become_path_parts() {
        assert_eq!(letter_id("7c9e6679-7425-40de-944b-e07fc1f90ae7"), Ok("7c9e6679-7425-40de-944b-e07fc1f90ae7"));
        for bad in ["", "../outbox", "7C9E6679-7425-40DE-944B-E07FC1F90AE7", "7c9e6679742540de944be07fc1f90ae7", "7c9e6679-7425-40de-944b-e07fc1f90ae7/x"] {
            assert_eq!(letter_id(bad), Err(DirectoryError::Invalid("letterId")), "{bad}");
        }
    }

    #[test]
    fn only_32_hex_digits_become_a_block_path_part() {
        assert_eq!(account_id("069a79f444e94726a5befca90e38aaf5"), Ok("069a79f444e94726a5befca90e38aaf5"));
        for bad in ["", "../me", "069A79F444E94726A5BEFCA90E38AAF5", "069a79f4"] {
            assert_eq!(account_id(bad), Err(DirectoryError::Invalid("uuid")), "{bad}");
        }
    }
}
