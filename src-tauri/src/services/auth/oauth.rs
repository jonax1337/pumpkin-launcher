//! Microsoft-OAuth: Gerätecode, Autorisierungs-URL mit PKCE und der Token-Endpunkt mit seinen drei Grants.
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{is_success, send, RELOGIN};
use crate::error::{AppError, AppResult};

const LOGIN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE: &str = "XboxLive.signin offline_access";
/// Wie RFC 3986 „unreserved“: alles außer `A-Z a-z 0-9 - . _ ~` wird kodiert.
const FORM_ESCAPED: &percent_encoding::AsciiSet =
    &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');

#[derive(Deserialize)]
pub(super) struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    #[serde(default = "default_poll_interval")]
    pub interval: u64,
    #[serde(default)]
    pub message: String,
}

fn default_poll_interval() -> u64 {
    5
}

#[derive(Deserialize)]
pub(super) struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Deserialize, Default)]
pub(super) struct OAuthError {
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub error_description: String,
}

pub(super) fn oauth_text(e: &OAuthError) -> String {
    let text = match e.error.as_str() {
        "authorization_declined" | "access_denied" => "Die Anmeldung wurde im Browser abgelehnt.",
        "expired_token" | "bad_verification_code" => "Der Anmeldecode ist abgelaufen. Starte die Anmeldung neu.",
        "invalid_grant" => RELOGIN,
        "invalid_client" | "unauthorized_client" => {
            "Microsoft kennt diese Launcher-App nicht oder erlaubt ihr die Anmeldung per Code nicht."
        }
        _ => "Microsoft hat die Anmeldung abgelehnt.",
    };
    let detail = e.error_description.lines().next().unwrap_or_default();
    if e.error.is_empty() { text.into() } else { format!("{text} – Details: {} {detail}", e.error).trim_end().into() }
}

pub(super) enum Poll {
    Pending,
    SlowDown,
    Done(Tokens),
}

pub(super) async fn request_device_code(http: &reqwest::Client, client_id: &str) -> AppResult<DeviceCodeResponse> {
    let (status, body) =
        post_form(http, &format!("{LOGIN}/devicecode"), &[("client_id", client_id), ("scope", SCOPE)]).await?;
    if !is_success(status) {
        return Err(AppError::invalid(oauth_text(&serde_json::from_slice(&body).unwrap_or_default())));
    }
    Ok(serde_json::from_slice(&body)?)
}

/// Fragt nach, ob der Gerätecode inzwischen im Browser bestätigt wurde.
pub(super) async fn poll_device_code(http: &reqwest::Client, client_id: &str, device_code: &str) -> AppResult<Poll> {
    let grant = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("client_id", client_id),
        ("device_code", device_code),
    ];
    token_request(http, &grant).await
}

/// Der Browser-Rücksprung hat Code und `redirect_uri`; der Verifier beweist, dass wir die Anmeldung gestartet haben.
pub(super) struct AuthorizationCode<'a> {
    pub client_id: &'a str,
    pub code: &'a str,
    pub redirect_uri: &'a str,
    pub verifier: &'a str,
}

pub(super) async fn redeem_code(http: &reqwest::Client, auth: &AuthorizationCode<'_>) -> AppResult<Poll> {
    let grant = [
        ("grant_type", "authorization_code"),
        ("client_id", auth.client_id),
        ("code", auth.code),
        ("redirect_uri", auth.redirect_uri),
        ("code_verifier", auth.verifier),
        ("scope", SCOPE),
    ];
    token_request(http, &grant).await
}

pub(super) async fn redeem_refresh_token(http: &reqwest::Client, client_id: &str, refresh_token: &str) -> AppResult<Poll> {
    let grant = [
        ("grant_type", "refresh_token"),
        ("client_id", client_id),
        ("refresh_token", refresh_token),
        ("scope", SCOPE),
    ];
    token_request(http, &grant).await
}

async fn token_request(http: &reqwest::Client, grant: &[(&str, &str)]) -> AppResult<Poll> {
    let (status, body) = post_form(http, &format!("{LOGIN}/token"), grant).await?;
    parse_poll(status, &body)
}

async fn post_form(http: &reqwest::Client, url: &str, pairs: &[(&str, &str)]) -> AppResult<(u16, Vec<u8>)> {
    send(http.post(url).header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded").body(form(pairs))).await
}

/// `application/x-www-form-urlencoded`.
fn form(pairs: &[(&str, &str)]) -> String {
    let encode = |s: &str| percent_encoding::utf8_percent_encode(s, FORM_ESCAPED).to_string();
    pairs.iter().map(|(k, v)| format!("{}={}", encode(k), encode(v))).collect::<Vec<_>>().join("&")
}

/// Antwort des Token-Endpunkts beim Warten auf die Bestätigung im Browser.
fn parse_poll(status: u16, body: &[u8]) -> AppResult<Poll> {
    if is_success(status) {
        return Ok(Poll::Done(serde_json::from_slice(body)?));
    }
    let err: OAuthError = serde_json::from_slice(body).unwrap_or_default();
    match err.error.as_str() {
        "authorization_pending" => Ok(Poll::Pending),
        "slow_down" => Ok(Poll::SlowDown),
        _ => Err(AppError::invalid(oauth_text(&err))),
    }
}

pub(super) fn authorize_url(client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> String {
    let query = form(&[
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("response_mode", "query"),
        ("scope", SCOPE),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("prompt", "select_account"),
    ]);
    format!("{LOGIN}/authorize?{query}")
}

/// PKCE (RFC 7636): Base64url des SHA-256 vom Verifier.
pub(super) fn pkce_challenge(verifier: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn form_encoding_escapes_all_but_unreserved() {
        assert_eq!(form(&[("scope", SCOPE), ("t", "a*b/c=")]), "scope=XboxLive.signin%20offline_access&t=a%2Ab%2Fc%3D");
        assert_eq!(form(&[("k", "A-z.0_9~ä+")]), "k=A-z.0_9~%C3%A4%2B");
    }

    #[test]
    fn device_code_and_token_polling() {
        let r: DeviceCodeResponse = serde_json::from_value(json!({
            "user_code": "ABCD-EFGH", "device_code": "geheim", "verification_uri": "https://www.microsoft.com/link",
            "expires_in": 900, "interval": 5, "message": "To sign in, use a web browser…"
        }))
        .unwrap();
        assert_eq!((r.user_code.as_str(), r.device_code.as_str(), r.expires_in, r.interval), ("ABCD-EFGH", "geheim", 900, 5));
        let body = |v: serde_json::Value| serde_json::to_vec(&v).unwrap();
        assert!(matches!(parse_poll(400, &body(json!({"error": "authorization_pending"}))), Ok(Poll::Pending)));
        assert!(matches!(parse_poll(400, &body(json!({"error": "slow_down"}))), Ok(Poll::SlowDown)));
        let done = parse_poll(200, &body(json!({"access_token": "a", "refresh_token": "r", "expires_in": 3600})));
        assert!(matches!(done, Ok(Poll::Done(Tokens { refresh_token: Some(_), .. }))));
        let expired = parse_poll(400, &body(json!({"error": "expired_token", "error_description": "AADSTS70020: expired\nTrace"})));
        assert_eq!(expired.err().unwrap().to_string(), "Der Anmeldecode ist abgelaufen. Starte die Anmeldung neu. – Details: expired_token AADSTS70020: expired");
        assert_eq!(parse_poll(400, &body(json!({"error": "invalid_grant"}))).err().unwrap().to_string().split(" – ").next(), Some(RELOGIN));
        assert!(parse_poll(500, b"<html>").is_err());
    }

    #[test]
    fn pkce_matches_rfc7636_example() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn authorize_url_carries_pkce_and_state() {
        let url = authorize_url("cid", "http://localhost:5000", "chal", "st");
        assert!(url.starts_with("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=cid&response_type=code"));
        for part in ["redirect_uri=http%3A%2F%2Flocalhost%3A5000", "code_challenge=chal", "code_challenge_method=S256", "state=st", "scope=XboxLive.signin%20offline_access"] {
            assert!(url.contains(part), "{part} fehlt in {url}");
        }
    }
}
