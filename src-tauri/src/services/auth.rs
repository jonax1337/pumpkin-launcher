//! Konten: Offline (UUID aus dem Namen) und Microsoft per Gerätecode → Xbox Live → XSTS →
//! Minecraft-Token. Refresh-Tokens liegen im OS-Schlüsselbund (`keyring`), nie in JSON;
//! Minecraft-Tokens nur im Speicher und mit Ablaufzeit. Anleitung: `docs/ACCOUNT-SETUP.md`.
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::models::{Account, AccountKind, MsAccount};
use crate::state::AppState;

const LOGIN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE: &str = "XboxLive.signin offline_access";
const XBOX_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";
const KEYRING_SERVICE: &str = "dev.laux.launcher";
const RELOGIN: &str = "Die Anmeldung ist abgelaufen. Bitte melde dich erneut mit deinem Microsoft-Konto an.";

/// Laufende Anmeldung und Minecraft-Sitzungen (nur im Speicher).
#[derive(Default)]
pub struct MsState {
    pending: Mutex<Option<Pending>>,
    sessions: Mutex<HashMap<String, McSession>>,
}

#[derive(Clone)]
struct Pending {
    client_id: String,
    device_code: String,
    interval: u64,
    expires_at: Instant,
    cancel: CancellationToken,
    /// Von `finish_login` übernommen; bleibt im Slot, damit `cancel_login` sie noch erreicht.
    claimed: bool,
}

#[derive(Clone)]
pub struct McSession {
    pub access_token: String,
    pub xuid: String,
    expires_at: Instant,
}

impl McSession {
    fn new(login: McLogin, xuid: String) -> Self {
        Self { access_token: login.access_token, xuid, expires_at: Instant::now() + Duration::from_secs(login.expires_in) }
    }

    /// Mit fünf Minuten Puffer, damit der Token nicht mitten im Start abläuft.
    fn valid(&self) -> bool {
        Instant::now() + Duration::from_secs(300) < self.expires_at
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn say(text: impl Into<String>) -> AppError {
    AppError::Invalid(text.into())
}

/// Eingebaute Client-ID der Azure-App „Pumpkin Launcher“ (öffentlicher Client, kein Geheimnis).
const DEFAULT_CLIENT_ID: &str = "5e27ee41-3be2-4c3a-a156-a3c61dbef8dc";

/// Client-ID der eigenen Azure-App: Argument, sonst Compile-Vorgabe `PUMPKIN_MS_CLIENT_ID`, sonst die eingebaute.
fn client_id(arg: Option<String>) -> AppResult<String> {
    let id = arg
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .or_else(|| option_env!("PUMPKIN_MS_CLIENT_ID").map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_owned());
    uuid::Uuid::parse_str(&id).map_err(|_| say("Die hinterlegte Client-ID ist ungültig. Sie sieht so aus: 00000000-0000-0000-0000-000000000000."))?;
    Ok(id)
}

/// `application/x-www-form-urlencoded` ohne zusätzliches Crate.
fn form(pairs: &[(&str, &str)]) -> String {
    let enc = |s: &str| -> String {
        s.bytes()
            .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
            .collect()
    };
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

async fn send(request: reqwest::RequestBuilder) -> AppResult<(u16, Vec<u8>)> {
    let response = request.header(reqwest::header::ACCEPT, "application/json").send().await?;
    let status = response.status().as_u16();
    Ok((status, response.bytes().await?.to_vec()))
}

async fn post_form(client: &reqwest::Client, url: &str, pairs: &[(&str, &str)]) -> AppResult<(u16, Vec<u8>)> {
    send(client.post(url).header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded").body(form(pairs))).await
}

fn ok(status: u16) -> bool {
    (200..300).contains(&status)
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    #[serde(default = "five")]
    interval: u64,
    #[serde(default)]
    message: String,
}

fn five() -> u64 {
    5
}

/// Was das Frontend anzeigt: Code und Adresse zum Eingeben.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize, Default)]
struct OAuthError {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_description: String,
}

fn oauth_text(e: &OAuthError) -> String {
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

enum Poll {
    Pending,
    SlowDown,
    Done(Tokens),
}

/// Antwort des Token-Endpunkts beim Warten auf die Bestätigung im Browser.
fn parse_poll(status: u16, body: &[u8]) -> AppResult<Poll> {
    if ok(status) {
        return Ok(Poll::Done(serde_json::from_slice(body)?));
    }
    let err: OAuthError = serde_json::from_slice(body).unwrap_or_default();
    match err.error.as_str() {
        "authorization_pending" => Ok(Poll::Pending),
        "slow_down" => Ok(Poll::SlowDown),
        _ => Err(say(oauth_text(&err))),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XboxToken {
    token: String,
    display_claims: Claims,
}

#[derive(Deserialize)]
struct Claims {
    xui: Vec<Xui>,
}

#[derive(Deserialize)]
struct Xui {
    uhs: String,
    #[serde(default)]
    xid: Option<String>,
}

/// XSTS-Fehlercodes (`XErr`) in Alltagssprache.
pub fn xerr_text(code: u64) -> &'static str {
    match code {
        2148916233 => "Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil. Melde dich einmal auf xbox.com an, lege dort ein Profil an und versuch es dann erneut.",
        2148916238 => "Das Konto gehört einem Kind und muss erst von einem Erwachsenen zu einer Microsoft-Familie hinzugefügt werden (account.microsoft.com/family).",
        2148916235 => "Xbox Live ist in deinem Land nicht verfügbar.",
        2148916236 | 2148916237 => "Das Konto muss auf xbox.com erst noch bestätigt werden (Altersnachweis). Danach klappt die Anmeldung.",
        2148916227 => "Dieses Konto ist bei Xbox gesperrt.",
        2148916229 => "Die Jugendschutz-Einstellungen des Kontos erlauben kein Online-Spielen. Ein Erziehungsberechtigter kann das ändern.",
        2148916234 => "Die Xbox-Nutzungsbedingungen wurden noch nicht akzeptiert. Melde dich einmal auf xbox.com an.",
        _ => "Xbox Live hat die Anmeldung abgelehnt.",
    }
}

fn parse_xbox(status: u16, body: &[u8]) -> AppResult<XboxToken> {
    if ok(status) {
        return Ok(serde_json::from_slice(body)?);
    }
    #[derive(Deserialize)]
    struct XErr {
        #[serde(rename = "XErr")]
        code: u64,
    }
    Err(say(match serde_json::from_slice::<XErr>(body) {
        Ok(XErr { code }) => format!("{} (Fehler {code})", xerr_text(code)),
        Err(_) => format!("Xbox Live hat die Anmeldung abgelehnt (Fehler {status})."),
    }))
}

#[derive(Deserialize)]
struct McLogin {
    access_token: String,
    expires_in: u64,
}

fn parse_mc_login(status: u16, body: &[u8]) -> AppResult<McLogin> {
    match status {
        s if ok(s) => Ok(serde_json::from_slice(body)?),
        403 => Err(say("Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet. Die Freigabe der App steht noch aus.")),
        429 => Err(say("Zu viele Anmeldeversuche in kurzer Zeit. Warte ein paar Minuten und versuch es erneut.")),
        s => Err(say(format!("Die Anmeldung bei Minecraft ist fehlgeschlagen (Fehler {s})."))),
    }
}

/// Besitzt das Konto Minecraft laut `entitlements/mcstore`?
fn owns_game(body: &[u8]) -> bool {
    #[derive(Deserialize)]
    struct Entitlements {
        #[serde(default)]
        items: Vec<Item>,
    }
    #[derive(Deserialize)]
    struct Item {
        name: String,
    }
    serde_json::from_slice::<Entitlements>(body)
        .is_ok_and(|e| e.items.iter().any(|i| i.name == "product_minecraft" || i.name == "game_minecraft"))
}

#[derive(Deserialize)]
struct Profile {
    id: String,
    name: String,
}

/// Profil mit UUID (mit Bindestrichen). Ohne Profil: kein Spiel gekauft bzw. noch kein Name gewählt.
fn parse_profile(status: u16, body: &[u8], owns: bool) -> AppResult<Profile> {
    match status {
        s if ok(s) => {
            let p: Profile = serde_json::from_slice(body)?;
            let id = uuid::Uuid::parse_str(&p.id).map_err(|_| say("Minecraft hat ein ungültiges Profil geliefert."))?;
            Ok(Profile { id: id.hyphenated().to_string(), name: p.name })
        }
        404 if owns => Err(say("Zu diesem Konto gibt es noch kein Minecraft-Profil. Starte einmal den offiziellen Minecraft Launcher und wähle einen Spielernamen.")),
        404 => Err(say("Dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht.")),
        s => Err(say(format!("Das Minecraft-Profil konnte nicht geladen werden (Fehler {s})."))),
    }
}

/// Ein Claim aus dem (unsignierten) Payload eines JWT, z. B. `xuid` im Minecraft-Token.
fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    match serde_json::from_slice::<serde_json::Value>(&bytes).ok()?.get(claim)? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Microsoft-Token → Xbox Live → XSTS → Minecraft-Token, Besitz und Profil.
async fn minecraft(client: &reqwest::Client, ms_access_token: &str) -> AppResult<(McLogin, Profile, String)> {
    let body = json!({
        "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access_token}") },
        "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT",
    });
    let (status, bytes) = send(client.post(XBOX_AUTH).json(&body)).await?;
    let xbox = parse_xbox(status, &bytes)?;
    let body = json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbox.token] },
        "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT",
    });
    let (status, bytes) = send(client.post(XSTS_AUTH).json(&body)).await?;
    let xsts = parse_xbox(status, &bytes)?;
    let xui = xsts.display_claims.xui.first().ok_or_else(|| say("Xbox Live hat kein Profil geliefert."))?;
    let body = json!({ "identityToken": format!("XBL3.0 x={};{}", xui.uhs, xsts.token) });
    let (status, bytes) = send(client.post(MC_LOGIN).json(&body)).await?;
    let login = parse_mc_login(status, &bytes)?;
    let (status, bytes) = send(client.get(MC_ENTITLEMENTS).bearer_auth(&login.access_token)).await?;
    let owns = ok(status) && owns_game(&bytes);
    let (status, bytes) = send(client.get(MC_PROFILE).bearer_auth(&login.access_token)).await?;
    let profile = parse_profile(status, &bytes, owns)?;
    let xuid = xui.xid.clone().or_else(|| jwt_claim(&login.access_token, "xuid")).unwrap_or_else(|| "0".into());
    Ok((login, profile, xuid))
}

fn keyring_entry(account_id: &str) -> AppResult<keyring::Entry> {
    Ok(keyring::Entry::new(KEYRING_SERVICE, account_id)?)
}

/// Token als UTF-8-Bytes ablegen: `set_password` speichert unter Windows UTF-16 und halbiert so
/// das Limit (2560 Byte) auf 1280 Zeichen; Microsoft-Refresh-Tokens können länger sein.
// ponytail: bis 2560 Byte (ASCII-Token = 2560 Zeichen); länger bräuchte Aufteilen auf mehrere Einträge.
fn store_token(entry: &keyring::Entry, token: &str) -> keyring::Result<()> {
    entry.set_secret(token.as_bytes())
}

fn load_token(entry: &keyring::Entry) -> keyring::Result<String> {
    let bytes = entry.get_secret()?;
    // Ältere Einträge per `set_password` (UTF-16, enthält Nullbytes bei ASCII-Token).
    if bytes.contains(&0) {
        return entry.get_password();
    }
    String::from_utf8(bytes).map_err(|e| keyring::Error::BadEncoding(e.into_bytes()))
}

/// Startet den Gerätecode-Flow; eine vorherige, noch wartende Anmeldung wird abgebrochen.
pub async fn start_login(state: &AppState, client_id_arg: Option<String>) -> AppResult<DeviceCode> {
    let client_id = client_id(client_id_arg)?;
    let (status, body) =
        post_form(&state.http, &format!("{LOGIN}/devicecode"), &[("client_id", &client_id), ("scope", SCOPE)]).await?;
    if !ok(status) {
        return Err(say(oauth_text(&serde_json::from_slice(&body).unwrap_or_default())));
    }
    let r: DeviceCodeResponse = serde_json::from_slice(&body)?;
    let pending = Pending {
        client_id,
        device_code: r.device_code,
        interval: r.interval,
        expires_at: Instant::now() + Duration::from_secs(r.expires_in),
        cancel: CancellationToken::new(),
        claimed: false,
    };
    if let Some(old) = lock(&state.ms.pending).replace(pending) {
        old.cancel.cancel();
    }
    Ok(DeviceCode {
        user_code: r.user_code,
        verification_uri: r.verification_uri,
        expires_in: r.expires_in,
        interval: r.interval,
        message: r.message,
    })
}

/// Wartet, bis die Anmeldung im Browser bestätigt ist, und speichert das Konto.
pub async fn finish_login(state: &AppState) -> AppResult<Account> {
    // Nicht `take`: `cancel_login`/`start_login` müssen die laufende Anmeldung noch abbrechen können.
    // `claimed` sorgt dafür, dass ein zweiter paralleler Aufruf sofort „keine Anmeldung“ bekommt.
    let pending = claim(&mut lock(&state.ms.pending)).ok_or_else(|| say("Es läuft gerade keine Anmeldung. Starte sie bitte neu."))?;
    let result = poll(state, &pending).await;
    // Nur die eigene Anmeldung aufräumen, nicht eine inzwischen neu gestartete.
    let mut slot = lock(&state.ms.pending);
    if slot.as_ref().is_some_and(|p| p.device_code == pending.device_code) {
        *slot = None;
    }
    result
}

fn claim(slot: &mut Option<Pending>) -> Option<Pending> {
    let p = slot.as_mut().filter(|p| !p.claimed)?;
    p.claimed = true;
    Some(p.clone())
}

async fn poll(state: &AppState, p: &Pending) -> AppResult<Account> {
    let mut interval = p.interval.max(1);
    loop {
        if p.cancel.run_until_cancelled(tokio::time::sleep(Duration::from_secs(interval))).await.is_none() {
            return Err(say("Anmeldung abgebrochen."));
        }
        if Instant::now() >= p.expires_at {
            return Err(say("Der Anmeldecode ist abgelaufen. Starte die Anmeldung neu."));
        }
        let grant = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", p.client_id.as_str()),
            ("device_code", p.device_code.as_str()),
        ];
        let (status, body) = post_form(&state.http, &format!("{LOGIN}/token"), &grant).await?;
        match parse_poll(status, &body)? {
            Poll::Pending => {}
            Poll::SlowDown => interval += 5,
            Poll::Done(tokens) => return complete(state, &p.client_id, tokens).await,
        }
    }
}

async fn complete(state: &AppState, client_id: &str, tokens: Tokens) -> AppResult<Account> {
    let refresh = tokens.refresh_token.ok_or_else(|| say("Microsoft hat keine dauerhafte Anmeldung erlaubt."))?;
    let (login, profile, xuid) = minecraft(&state.http, &tokens.access_token).await?;
    store_token(&keyring_entry(&profile.id)?, &refresh)?;
    let account = MsAccount { id: profile.id, username: profile.name, kind: AccountKind::Microsoft, client_id: client_id.into() };
    let account = match state.accounts.get(&account.id) {
        Ok(_) => state.accounts.update(account)?,
        Err(_) => state.accounts.insert(account)?,
    };
    lock(&state.ms.sessions).insert(account.id.clone(), McSession::new(login, xuid));
    tracing::info!(user = %account.username, "Microsoft-Konto angemeldet");
    Ok(account.account())
}

pub fn cancel_login(state: &AppState) {
    if let Some(p) = lock(&state.ms.pending).take() {
        p.cancel.cancel();
    }
}

pub fn accounts(state: &AppState) -> Vec<Account> {
    state.accounts.list().iter().map(MsAccount::account).collect()
}

/// Entfernt Konto, Schlüsselbund-Eintrag und Sitzung.
pub fn remove_account(state: &AppState, id: &str) -> AppResult<()> {
    state.accounts.get(id)?;
    match keyring_entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(err) => return Err(err.into()),
    }
    lock(&state.ms.sessions).remove(id);
    state.accounts.remove(id)
}

/// Gültige Minecraft-Sitzung eines gespeicherten Kontos; erneuert sie bei Bedarf per Refresh-Token.
pub async fn session(state: &AppState, id: &str) -> AppResult<(Account, McSession)> {
    let stored = state.accounts.get(id)?;
    if let Some(s) = lock(&state.ms.sessions).get(id).filter(|s| s.valid()).cloned() {
        return Ok((stored.account(), s));
    }
    let refresh = match load_token(&keyring_entry(id)?) {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Err(say(RELOGIN)),
        Err(err) => return Err(err.into()),
    };
    let grant = [
        ("grant_type", "refresh_token"),
        ("client_id", stored.client_id.as_str()),
        ("refresh_token", refresh.as_str()),
        ("scope", SCOPE),
    ];
    let (status, body) = post_form(&state.http, &format!("{LOGIN}/token"), &grant).await?;
    let Poll::Done(tokens) = parse_poll(status, &body)? else { return Err(say(RELOGIN)) };
    let (login, profile, xuid) = minecraft(&state.http, &tokens.access_token).await?;
    if profile.id != stored.id {
        return Err(say("Microsoft hat ein anderes Minecraft-Profil geliefert. Bitte melde dich erneut an."));
    }
    // Microsoft rotiert Refresh-Tokens: den neuen sichern, sonst läuft die Anmeldung bald ab.
    if let Some(token) = &tokens.refresh_token {
        store_token(&keyring_entry(id)?, token)?;
    }
    let account = if profile.name != stored.username {
        state.accounts.update(MsAccount { username: profile.name, ..stored })?
    } else {
        stored
    };
    let session = McSession::new(login, xuid);
    lock(&state.ms.sessions).insert(id.into(), session.clone());
    Ok((account.account(), session))
}

/// Spielernamen ohne Konto gibt es nur in Debug-Builds (`pnpm tauri dev`) oder wenn ein Microsoft-Konto
/// angemeldet ist, dessen Besitz beim Login geprüft wurde. Ein offizieller Build startet so nicht für
/// Leute, die das Spiel nicht besitzen. Der Quelltext ist offen: das ist Richtlinie, kein Kopierschutz.
pub fn offline_allowed(state: &AppState) -> bool {
    let owner = || state.accounts.list().iter().any(|a| keyring_entry(&a.id).is_ok_and(|e| e.get_secret().is_ok()));
    policy_allows_offline(cfg!(debug_assertions), owner)
}

fn policy_allows_offline(debug_build: bool, owner: impl FnOnce() -> bool) -> bool {
    debug_build || owner()
}

/// Wie `offline_allowed`, aber als Fehler mit Anleitung für den Start.
pub fn require_offline(state: &AppState) -> AppResult<()> {
    if offline_allowed(state) {
        return Ok(());
    }
    Err(say("Spielen ohne Konto ist in dieser Version nicht möglich. Melde dich mit einem Microsoft-Konto an, das Minecraft: Java Edition besitzt."))
}

/// UUID eines Offline-Spielers wie im Spiel selbst: MD5 von `OfflinePlayer:<name>`
/// mit Version 3 (entspricht Javas `UUID.nameUUIDFromBytes`).
pub fn offline_uuid(username: &str) -> uuid::Uuid {
    let hash: [u8; 16] = Md5::digest(format!("OfflinePlayer:{username}")).into();
    uuid::Builder::from_md5_bytes(hash).into_uuid()
}

/// Offline-Account; die ID ist die deterministische Spieler-UUID. Namen wie im Spiel:
/// 3–16 Zeichen aus `A-Z a-z 0-9 _`.
pub fn offline_account(username: &str) -> AppResult<Account> {
    let valid = (3..=16).contains(&username.len()) && username.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if !valid {
        return Err(AppError::Invalid(format!("Ungültiger Spielername '{username}' (3–16 Zeichen, A-Z, 0-9, _)")));
    }
    Ok(Account {
        id: offline_uuid(username).to_string(),
        username: username.to_owned(),
        kind: AccountKind::Offline,
        active: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_uuid_matches_java() {
        // Referenz: Javas UUID.nameUUIDFromBytes("OfflinePlayer:Notch".getBytes(UTF_8)).
        assert_eq!(offline_account("Notch").unwrap().id, "b50ad385-829d-3141-a216-7e7d7539ba7f");
        assert!(offline_account("ab").is_err());
        assert!(offline_account("bad name").is_err());
    }

    #[test]
    fn client_id_and_form_encoding() {
        let id = "8f0c5a3e-1b2d-4c5e-9f00-112233445566";
        assert_eq!(client_id(Some(format!(" {id} "))).unwrap(), id);
        assert!(client_id(Some("kein-uuid".into())).is_err());
        assert_eq!(client_id(None).unwrap(), option_env!("PUMPKIN_MS_CLIENT_ID").unwrap_or(DEFAULT_CLIENT_ID));
        assert_eq!(form(&[("scope", SCOPE), ("t", "a*b/c=")]), "scope=XboxLive.signin%20offline_access&t=a%2Ab%2Fc%3D");
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
    fn xbox_answers_and_xerr() {
        let x = parse_xbox(200, br#"{"IssueInstant":"x","NotAfter":"y","Token":"xbl","DisplayClaims":{"xui":[{"uhs":"123"}]}}"#).unwrap();
        assert_eq!((x.token.as_str(), x.display_claims.xui[0].uhs.as_str()), ("xbl", "123"));
        let err = parse_xbox(401, br#"{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"https://start.ui.xboxlive.com/CreateAccount"}"#);
        assert!(err.err().unwrap().to_string().starts_with("Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil"));
        assert!(xerr_text(2148916238).contains("Kind"));
        assert_eq!(xerr_text(1), "Xbox Live hat die Anmeldung abgelehnt.");
        assert!(parse_xbox(503, b"").err().unwrap().to_string().contains("503"));
    }

    #[test]
    fn minecraft_answers() {
        let login = parse_mc_login(200, br#"{"username":"u","roles":[],"access_token":"eyJ","token_type":"Bearer","expires_in":86400}"#).unwrap();
        assert_eq!((login.access_token.as_str(), login.expires_in), ("eyJ", 86400));
        assert!(parse_mc_login(403, b"{}").err().unwrap().to_string().contains("noch nicht für Minecraft freigeschaltet"));
        assert!(owns_game(br#"{"items":[{"name":"product_minecraft","signature":"s"},{"name":"game_minecraft","signature":"s"}],"signature":"s","keyId":"1"}"#));
        assert!(!owns_game(br#"{"items":[],"signature":"s","keyId":"1"}"#));
        let p = parse_profile(200, br#"{"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch","skins":[],"capes":[]}"#, true).unwrap();
        assert_eq!((p.id.as_str(), p.name.as_str()), ("069a79f4-44e9-4726-a5be-fca90e38aaf5", "Notch"));
        assert!(parse_profile(404, b"{}", false).err().unwrap().to_string().contains("besitzt Minecraft"));
        assert!(parse_profile(200, br#"{"id":"../x","name":"n"}"#, true).is_err());
    }

    #[test]
    fn xuid_from_minecraft_token() {
        use base64::Engine;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"xuid":"2535400000000000","sub":"x"}"#);
        assert_eq!(jwt_claim(&format!("h.{payload}.s"), "xuid").as_deref(), Some("2535400000000000"));
        assert_eq!(jwt_claim("kein-jwt", "xuid"), None);
    }
    #[test]
    fn offline_only_in_debug_or_with_owner() {
        assert!(policy_allows_offline(true, || false), "Debug-Build: immer");
        assert!(policy_allows_offline(false, || true), "Release mit Microsoft-Konto");
        assert!(!policy_allows_offline(false, || false), "Release ohne Konto: gesperrt");
        assert!(policy_allows_offline(true, || panic!("im Debug-Build nicht nötig")));
    }

    #[test]
    fn second_finish_login_gets_nothing() {
        let p = Pending {
            client_id: "c".into(),
            device_code: "d".into(),
            interval: 5,
            expires_at: Instant::now(),
            cancel: CancellationToken::new(),
            claimed: false,
        };
        let mut slot = Some(p);
        assert!(claim(&mut slot).is_some());
        assert!(claim(&mut slot).is_none());
        assert!(slot.is_some(), "bleibt für cancel_login erreichbar");
    }

    /// Echter Eintrag im OS-Schlüsselbund; `cargo test -- --ignored long_token_survives_keyring`.
    #[test]
    #[ignore = "schreibt in den Schlüsselbund des Nutzers"]
    fn long_token_survives_keyring() {
        let entry = keyring::Entry::new("pumpkin-test", "long-token").unwrap();
        let token = "M.C5_xyz-".repeat(300)[..2400].to_string();
        store_token(&entry, &token).unwrap();
        let back = load_token(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), token);
        // Altbestand im UTF-16-Format bleibt lesbar.
        entry.set_password("alt").unwrap();
        let back = load_token(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), "alt");
    }
}
