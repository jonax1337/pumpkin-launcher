//! Konten: Offline (UUID aus dem Namen) und Microsoft per Browser oder Gerätecode → Xbox Live → XSTS →
//! Minecraft-Token. Refresh-Tokens liegen im OS-Schlüsselbund (`keyring`), nie in JSON;
//! Minecraft-Tokens nur im Speicher und mit Ablaufzeit. Anleitung: `CONTRIBUTING.md#microsoft-sign-in-for-forks`.
mod callback_server;
mod keyring;
mod oauth;
mod xbox;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use md5::{Digest, Md5};
use serde::Serialize;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use self::oauth::{AuthorizationCode, Poll, Tokens};
use self::xbox::{McLogin, MinecraftLogin, Profile};
use super::lock;
use crate::coded;
use crate::error::{AppError, AppResult, Coded};
use crate::models::{Account, AccountKind, MsAccount};
use crate::state::AppState;

pub(crate) const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

/// Das Refresh-Token fehlt oder gilt nicht mehr: der Nutzer muss sich neu anmelden.
pub(crate) fn relogin() -> Coded {
    coded!("errors.app.auth.relogin")
}

/// Client-ID der Azure-App „Pumpkin Launcher“ (öffentlicher Client, kein Geheimnis). Forks müssen eine eigene
/// Azure-App registrieren und von Microsoft freischalten lassen (`CONTRIBUTING.md#microsoft-sign-in-for-forks`) und diese Konstante ändern.
const DEFAULT_CLIENT_ID: &str = "5e27ee41-3be2-4c3a-a156-a3c61dbef8dc";
/// So lange wartet die Browser-Anmeldung auf den Rücksprung.
const BROWSER_TIMEOUT: Duration = Duration::from_secs(600);
/// Puffer vor dem Ablauf des Minecraft-Tokens, damit er nicht mitten im Start abläuft.
const SESSION_MARGIN: Duration = Duration::from_secs(300);
/// Wartezeit, um die Microsoft bei `slow_down` das Abfrage-Intervall zu verlängern verlangt.
const SLOW_DOWN_STEP_SECS: u64 = 5;

/// Laufende Anmeldung und Minecraft-Sitzungen (nur im Speicher).
#[derive(Default)]
pub struct MsState {
    pending: Mutex<Option<Pending>>,
    sessions: Mutex<HashMap<String, McSession>>,
}

/// Wie die Anmeldung läuft: Browser mit Rücksprung auf localhost (Standard) oder Gerätecode (Rückfall).
#[derive(Clone)]
enum Flow {
    Device {
        device_code: String,
        interval: u64,
    },
    /// Lokaler Listener für den Rücksprung, PKCE-Verifier und `state` gegen fremde Aufrufe.
    Browser {
        listener: Arc<TcpListener>,
        verifier: String,
        state: String,
        redirect_uri: String,
    },
}

#[derive(Clone)]
struct Pending {
    /// Unterscheidet Anmeldungen, damit `finish_login` nur die eigene aufräumt.
    id: String,
    client_id: String,
    flow: Flow,
    expires_at: Instant,
    cancel: CancellationToken,
    /// Von `finish_login` übernommen; bleibt im Slot, damit `cancel_login` sie noch erreicht.
    claimed: bool,
}

impl Pending {
    fn new(client_id: String, flow: Flow, lifetime: Duration) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            client_id,
            flow,
            expires_at: Instant::now() + lifetime,
            cancel: CancellationToken::new(),
            claimed: false,
        }
    }
}

#[derive(Clone)]
pub struct McSession {
    pub access_token: String,
    pub xuid: String,
    expires_at: Instant,
}

impl McSession {
    fn new(login: McLogin, xuid: String) -> Self {
        Self {
            access_token: login.access_token,
            xuid,
            expires_at: Instant::now() + Duration::from_secs(login.expires_in),
        }
    }

    fn valid(&self) -> bool {
        Instant::now() + SESSION_MARGIN < self.expires_at
    }
}

pub(crate) async fn send(request: reqwest::RequestBuilder) -> AppResult<(u16, Vec<u8>)> {
    let response = request
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;
    let status = response.status().as_u16();
    Ok((status, response.bytes().await?.to_vec()))
}

fn is_success(status: u16) -> bool {
    (200..300).contains(&status)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LoginMode {
    Browser,
    Device,
}

impl LoginMode {
    /// Das Frontend schickt `"device"`, um den Gerätecode zu erzwingen; alles andere meint den Browser.
    pub fn from_method(method: Option<&str>) -> Self {
        match method {
            Some("device") => Self::Device,
            _ => Self::Browser,
        }
    }
}

/// Was das Frontend anzeigt. Browser: `verification_uri` ist die Anmeldeseite (öffnet die App selbst),
/// `user_code` bleibt leer. Gerätecode: Code und Adresse zum Eingeben.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    pub mode: LoginMode,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

/// Startet die Anmeldung; eine vorherige, noch wartende wird abgebrochen. Standard ist der Browser mit
/// Rücksprung auf localhost (kein Code zum Abtippen). Mit `LoginMode::Device` oder wenn der lokale
/// Listener nicht startet, gibt es den Gerätecode.
pub async fn start_login(state: &AppState, mode: LoginMode) -> AppResult<LoginStart> {
    if mode == LoginMode::Browser {
        match start_browser(state, DEFAULT_CLIENT_ID).await {
            Ok(start) => return Ok(start),
            Err(err) => {
                tracing::warn!(%err, "Browser-Anmeldung nicht möglich, weiche auf Gerätecode aus")
            }
        }
    }
    start_device(state, DEFAULT_CLIENT_ID).await
}

fn set_pending(state: &AppState, pending: Pending) {
    if let Some(old) = lock(&state.ms.pending).replace(pending) {
        old.cancel.cancel();
    }
}

async fn start_browser(state: &AppState, client_id: &str) -> AppResult<LoginStart> {
    // Nur Loopback: von außen ist der Listener nicht erreichbar. Microsoft ignoriert den Port von `http://localhost`.
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let redirect_uri = format!("http://localhost:{}", listener.local_addr()?.port());
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let login_state = uuid::Uuid::new_v4().simple().to_string();
    let url = oauth::authorize_url(
        client_id,
        &redirect_uri,
        &oauth::pkce_challenge(&verifier),
        &login_state,
    );
    let flow = Flow::Browser {
        listener: Arc::new(listener),
        verifier,
        state: login_state,
        redirect_uri,
    };
    set_pending(state, Pending::new(client_id.into(), flow, BROWSER_TIMEOUT));
    Ok(LoginStart {
        mode: LoginMode::Browser,
        user_code: String::new(),
        verification_uri: url,
        expires_in: BROWSER_TIMEOUT.as_secs(),
        interval: 0,
        message: "Melde dich im Browser bei Microsoft an.".into(),
    })
}

async fn start_device(state: &AppState, client_id: &str) -> AppResult<LoginStart> {
    let device = oauth::request_device_code(&state.http, client_id).await?;
    let flow = Flow::Device {
        device_code: device.device_code,
        interval: device.interval,
    };
    set_pending(
        state,
        Pending::new(
            client_id.into(),
            flow,
            Duration::from_secs(device.expires_in),
        ),
    );
    Ok(LoginStart {
        mode: LoginMode::Device,
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        expires_in: device.expires_in,
        interval: device.interval,
        message: device.message,
    })
}

/// Wartet, bis die Anmeldung im Browser bestätigt ist, und speichert das Konto.
pub async fn finish_login(state: &AppState) -> AppResult<Account> {
    // Nicht `take`: `cancel_login`/`start_login` müssen die laufende Anmeldung noch abbrechen können.
    // `claimed` sorgt dafür, dass ein zweiter paralleler Aufruf sofort „keine Anmeldung“ bekommt.
    let pending = claim(&mut lock(&state.ms.pending))
        .ok_or_else(|| AppError::invalid(coded!("errors.app.auth.noneRunning")))?;
    let result = poll(state, &pending).await;
    // Nur die eigene Anmeldung aufräumen, nicht eine inzwischen neu gestartete.
    let mut slot = lock(&state.ms.pending);
    if slot.as_ref().is_some_and(|p| p.id == pending.id) {
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
    match &p.flow {
        Flow::Device {
            device_code,
            interval,
        } => poll_device(state, p, device_code, *interval).await,
        Flow::Browser {
            listener,
            verifier,
            state: login_state,
            redirect_uri,
        } => {
            let code = callback_server::wait_for_code(p, listener, login_state).await?;
            let auth = AuthorizationCode {
                client_id: &p.client_id,
                code: &code,
                redirect_uri,
                verifier,
            };
            match oauth::redeem_code(&state.http, &auth).await? {
                Poll::Done(tokens) => complete(state, &p.client_id, tokens).await,
                _ => Err(AppError::invalid(coded!("errors.app.auth.notFinished"))),
            }
        }
    }
}

async fn poll_device(
    state: &AppState,
    p: &Pending,
    device_code: &str,
    first_interval: u64,
) -> AppResult<Account> {
    let mut interval = first_interval.max(1);
    loop {
        if p.cancel
            .run_until_cancelled(tokio::time::sleep(Duration::from_secs(interval)))
            .await
            .is_none()
        {
            return Err(AppError::invalid(coded!("errors.auth.cancelled")));
        }
        if Instant::now() >= p.expires_at {
            return Err(AppError::invalid(coded!("errors.app.auth.codeExpired")));
        }
        match oauth::poll_device_code(&state.http, &p.client_id, device_code).await? {
            Poll::Pending => {}
            Poll::SlowDown => interval += SLOW_DOWN_STEP_SECS,
            Poll::Done(tokens) => return complete(state, &p.client_id, tokens).await,
        }
    }
}

async fn complete(state: &AppState, client_id: &str, tokens: Tokens) -> AppResult<Account> {
    let refresh = tokens
        .refresh_token
        .ok_or_else(|| AppError::invalid(coded!("errors.app.auth.noRefreshToken")))?;
    let MinecraftLogin { profile, session } =
        xbox::login_to_minecraft(&state.http, &tokens.access_token).await?;
    keyring::save_refresh_token(&profile.id, &refresh)?;
    let account = state.accounts.upsert(MsAccount {
        id: profile.id,
        username: profile.name,
        kind: AccountKind::Microsoft,
        client_id: client_id.into(),
    })?;
    lock(&state.ms.sessions).insert(account.id.clone(), session);
    tracing::info!(user = %account.username, "Microsoft-Konto angemeldet");
    Ok(account.account())
}

pub fn cancel_login(state: &AppState) {
    if let Some(p) = lock(&state.ms.pending).take() {
        p.cancel.cancel();
    }
}

pub fn accounts(state: &AppState) -> Vec<Account> {
    state
        .accounts
        .list()
        .iter()
        .map(MsAccount::account)
        .collect()
}

/// Entfernt Konto, Schlüsselbund-Eintrag und Sitzung.
pub fn remove_account(state: &AppState, id: &str) -> AppResult<()> {
    state.accounts.get(id)?;
    keyring::delete_refresh_token(id)?;
    forget_session(state, id);
    state.accounts.remove(id)
}

/// Gültige Minecraft-Sitzung eines gespeicherten Kontos; erneuert sie bei Bedarf per Refresh-Token.
pub async fn session(state: &AppState, id: &str) -> AppResult<(Account, McSession)> {
    let stored = state.accounts.get(id)?;
    if let Some(session) = cached_session(state, id) {
        return Ok((stored.account(), session));
    }
    let (account, session) = refresh_session(state, stored).await?;
    lock(&state.ms.sessions).insert(id.into(), session.clone());
    Ok((account.account(), session))
}

fn cached_session(state: &AppState, id: &str) -> Option<McSession> {
    lock(&state.ms.sessions)
        .get(id)
        .filter(|s| s.valid())
        .cloned()
}

/// Drops the cached Minecraft session of the account; the next [`session`] refreshes it with the refresh token.
pub fn forget_session(state: &AppState, id: &str) {
    lock(&state.ms.sessions).remove(id);
}

/// Neue Sitzung per Refresh-Token; liefert das Konto mit dem aktuellen Spielernamen.
async fn refresh_session(state: &AppState, stored: MsAccount) -> AppResult<(MsAccount, McSession)> {
    let refresh = keyring::load_refresh_token(&stored.id)?;
    let Poll::Done(tokens) =
        oauth::redeem_refresh_token(&state.http, &stored.client_id, &refresh).await?
    else {
        return Err(AppError::invalid(relogin()));
    };
    let MinecraftLogin { profile, session } =
        xbox::login_to_minecraft(&state.http, &tokens.access_token).await?;
    ensure_same_profile(&stored, &profile)?;
    persist_rotated_token(&stored.id, &tokens)?;
    let account = rename_if_changed(state, stored, profile.name)?;
    Ok((account, session))
}

fn ensure_same_profile(stored: &MsAccount, profile: &Profile) -> AppResult<()> {
    if profile.id != stored.id {
        return Err(AppError::invalid(coded!("errors.app.auth.otherProfile")));
    }
    Ok(())
}

/// Microsoft rotiert Refresh-Tokens: den neuen sichern, sonst läuft die Anmeldung bald ab.
fn persist_rotated_token(account_id: &str, tokens: &Tokens) -> AppResult<()> {
    match &tokens.refresh_token {
        Some(token) => keyring::save_refresh_token(account_id, token),
        None => Ok(()),
    }
}

/// Der Spielername kann sich auf minecraft.net geändert haben.
fn rename_if_changed(
    state: &AppState,
    stored: MsAccount,
    username: String,
) -> AppResult<MsAccount> {
    if username == stored.username {
        return Ok(stored);
    }
    let renamed = state.accounts.update(MsAccount { username, ..stored })?;
    state
        .friends
        .update_account(crate::friends_commands::account_profile(state));
    Ok(renamed)
}

/// Spielernamen ohne Konto gibt es nur in Debug-Builds (`pnpm tauri dev`) oder wenn ein Microsoft-Konto
/// angemeldet ist, dessen Besitz beim Login geprüft wurde. Ein offizieller Build startet so nicht für
/// Leute, die das Spiel nicht besitzen. Der Quelltext ist offen: das ist Richtlinie, kein Kopierschutz.
pub fn offline_allowed(state: &AppState) -> bool {
    cfg!(debug_assertions)
        || state
            .accounts
            .list()
            .iter()
            .any(|a| keyring::has_refresh_token(&a.id))
}

/// Wie `offline_allowed`, aber als Fehler mit Anleitung für den Start.
pub fn require_offline(state: &AppState) -> AppResult<()> {
    if offline_allowed(state) {
        return Ok(());
    }
    Err(AppError::invalid(coded!(
        "errors.app.auth.offlineNotAllowed"
    )))
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
    let valid = (3..=16).contains(&username.len())
        && username
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if !valid {
        return Err(AppError::invalid(coded!(
            "errors.app.auth.invalidUsername",
            username = username
        )));
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
        assert_eq!(
            offline_account("Notch").unwrap().id,
            "b50ad385-829d-3141-a216-7e7d7539ba7f"
        );
        assert!(offline_account("ab").is_err());
        assert!(offline_account("bad name").is_err());
    }

    #[test]
    fn default_client_id_is_a_uuid() {
        assert!(
            uuid::Uuid::parse_str(DEFAULT_CLIENT_ID).is_ok(),
            "ein Fork hat die Client-ID falsch eingetragen"
        );
    }

    #[test]
    fn login_mode_defaults_to_browser() {
        assert_eq!(LoginMode::from_method(Some("device")), LoginMode::Device);
        assert_eq!(LoginMode::from_method(Some("browser")), LoginMode::Browser);
        assert_eq!(
            LoginMode::from_method(Some("Device")),
            LoginMode::Browser,
            "nur der exakte Wert erzwingt den Gerätecode"
        );
        assert_eq!(LoginMode::from_method(None), LoginMode::Browser);
    }

    #[test]
    fn second_finish_login_gets_nothing() {
        let p = Pending::new(
            "c".into(),
            Flow::Device {
                device_code: "d".into(),
                interval: 5,
            },
            Duration::ZERO,
        );
        let mut slot = Some(p);
        assert!(claim(&mut slot).is_some());
        assert!(claim(&mut slot).is_none());
        assert!(slot.is_some(), "bleibt für cancel_login erreichbar");
    }
}
