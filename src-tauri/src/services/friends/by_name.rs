//! Freunde per Minecraft-Namen (BYNAME 3, 6, 7): die Sitzung am Verzeichnis, das Senden eines Briefs, das Postfach mit
//! seinem Zeitplan, die Aufträge ans Verzeichnis und beide Seiten der Einlösung mit dem Mojang-Nachweis.
//! Das Verzeichnis stellt nur zu; ob jemand das Konto hat, das er angibt, bestätigt Mojang beiden Launchern direkt.
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use data_encoding::HEXLOWER;
use tokio::sync::Notify;
use tokio::time::{sleep_until, timeout, Instant};
use tokio_util::sync::CancellationToken;

use super::code::{self, CodeParts};
use super::config::DirectoryJob;
use super::contract::{
    DirectoryState, DirectoryStatus, FriendRequest, FriendRequestEvent, RequestDirection,
    RequestState, RequestVia, MAX_NAME_REQUESTS, REQUEST_TTL_SECS,
};
use super::control::WireProfile;
use super::directory::api::DirectoryApi;
use super::directory::certificate::PlayerCertificate;
use super::directory::mojang::{MojangError, MojangProfile, Privileges};
use super::directory::proof::{self, LetterFields, NameProof, Recipient, Rejection, StampedLetter};
use super::directory::wire::{InboxLetter, OutgoingLetter, SentLetter};
use super::directory::{DirectoryDeps, DirectoryError, McIdentity};
use super::events::FriendsEvent;
use super::hello::{self, Delivery, HelloRefusal, HELLO_NAME_WAIT};
use super::identity::Identity;
use super::records::{CodeRecord, FriendRecord, RequestRecord};
use super::requests;
use super::sanitize;
use super::service::{now_secs, Core, Friends, HandlerAlreadySet, Runtime};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{new_id, now_ms};
use crate::services::auth::relogin;
use crate::services::lock;
use crate::services::p2p::{find_relay, PeerId};

/// Das erste Postfach-Abholen nach dem Start, und wie oft `friends_retry_now` höchstens vorzieht (BYNAME 7.2).
const FIRST_POLL_DELAY: Duration = Duration::from_secs(10);
const RETRY_POLL_GAP: Duration = Duration::from_secs(60);
/// Der Eintrag im Verzeichnis wird höchstens einmal am Tag aufgefrischt (BYNAME 5.2).
const REFRESH_SECS: u64 = 24 * 3600;
/// Ein Token, das in dieser Zeit abläuft, wird nicht mehr benutzt.
const SESSION_MARGIN_SECS: u64 = 60;
/// So lange darf das Abschalten auf das Abmelden beim Verzeichnis warten (BYNAME 7.5).
const LEAVE_BUDGET: Duration = Duration::from_secs(2);
/// Ein frisch per Name eingelöster Freund trägt uns erst noch ein; bis dahin ist sein `NOT_FRIEND` kein Entfernen.
const REDEMPTION_GRACE: Duration = Duration::from_secs(60);
const NONCE_LEN: usize = 16;
/// A letter is deleted only after Mojang knew no account for its sender on this many polls in a row: one odd answer
/// must not destroy a request (review finding 9 on BYNAME-ATTEST).
const MISSING_SENDER_POLLS: u8 = 2;

/// Was der Dienst über das Verzeichnis im Speicher hält; nichts davon liegt auf der Platte.
#[derive(Default)]
pub(super) struct DirectoryClient {
    session: Mutex<Option<CachedSession>>,
    /// Mojang's player certificate of the account; its private key never reaches the disk.
    certificate: Mutex<Option<PlayerCertificate>>,
    /// Letter id → polls in a row on which Mojang knew no account for the sender.
    missing_senders: Mutex<HashMap<String, u8>>,
    /// Ausgang der letzten Anmeldung oder Abfrage; `None`, solange es keine gab.
    health: Mutex<Option<DirectoryState>>,
    /// At most one login at a time, so concurrent calls share one certificate fetch and one token.
    auth_lock: tokio::sync::Mutex<()>,
    polling: tokio::sync::Mutex<()>,
    running_jobs: tokio::sync::Mutex<()>,
    clock: Mutex<PollClock>,
    wake: Notify,
    /// Peer-IDs frisch per Name eingelöster Freunde und wann sie eingelöst haben.
    redeemed: Mutex<HashMap<String, Instant>>,
    /// Fragt, ob irgendein Spiel mit der Mod verbunden ist; fehlt, bis die Sitzungen es einsetzen.
    game_links: OnceLock<GameLinkProbe>,
    /// Der Dienst hat ein Zertifikat gebraucht, durfte keins holen und gibt keine Fehlermeldung ab, bis das letzte Spiel
    /// mit der Mod zu Ende ist.
    awaiting_games: AtomicBool,
}

/// Ob irgendein laufendes Spiel über die Brücke mit dem Launcher verbunden ist.
pub(super) type GameLinkProbe = Arc<dyn Fn() -> bool + Send + Sync>;

/// Woher das Zertifikat einer Anmeldung kommen darf. Ein Abruf bei Mojang kann den Chat-Schlüssel eines laufenden Spiels
/// ersetzen; ob er das tut, klärt der Eigentümertest O-5 (BYNAME-ATTEST). Bis dahin holt der Launcher während eines Spiels
/// mit verbundener Mod kein neues Zertifikat (INGAME 5.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CertificateSource {
    /// Das gemerkte, solange Mojang keine Erneuerung will, sonst ein frisches.
    CachedOrFetched,
    /// Nur das gemerkte, solange es benutzbar ist; ohne ein solches scheitert die Anmeldung.
    CachedOnly,
}

impl DirectoryClient {
    fn game_link_active(&self) -> bool {
        self.game_links.get().is_some_and(|probe| probe())
    }

    fn certificate_source(&self) -> CertificateSource {
        if self.game_link_active() {
            CertificateSource::CachedOnly
        } else {
            CertificateSource::CachedOrFetched
        }
    }

    /// Ob die Schleife auf das Ende der Spiele wartet: ihr fehlt ein Zertifikat, und solange ein Spiel mit der Mod läuft,
    /// holt sie keins.
    fn is_awaiting_games(&self) -> bool {
        self.awaiting_games.load(Ordering::SeqCst) && self.game_link_active()
    }

    /// Setzt den Zustand „wartet auf die Spiele“; `true`, wenn er sich geändert hat.
    fn set_awaiting_games(&self, awaiting: bool) -> bool {
        self.awaiting_games.swap(awaiting, Ordering::SeqCst) != awaiting
    }
}

/// Ein Token des Verzeichnisses; steht in keiner Debug-Ausgabe und in keinem Protokoll.
#[derive(Clone)]
struct CachedSession {
    token: String,
    expires_at: u64,
    /// Proven by Mojang's certificate, accepted by the directory.
    uuid: String,
    /// Die Peer-ID, an die das Token gebunden ist.
    peer_id: String,
    /// What Mojang's account attributes said at this login.
    privileges: Privileges,
}

/// Wann das Postfach dran ist: 10 s nach dem Start, dann im Takt; `friends_retry_now` zieht höchstens jede Minute vor.
struct PollClock {
    next: Instant,
    last: Option<Instant>,
}

impl Default for PollClock {
    fn default() -> Self {
        Self {
            next: Instant::now() + FIRST_POLL_DELAY,
            last: None,
        }
    }
}

impl PollClock {
    fn restart(&mut self, now: Instant) {
        *self = Self {
            next: now + FIRST_POLL_DELAY,
            last: None,
        };
    }

    /// `true`, wenn jetzt abgeholt wird; der nächste Termin steht dann schon fest.
    fn take_due(&mut self, now: Instant, interval: Duration) -> bool {
        let due = now >= self.next;
        if due {
            self.next = now + interval;
            self.last = Some(now);
        }
        due
    }

    /// Das Abholen ist ab jetzt fällig, ohne die Mindestzeit von `hurry`.
    fn make_due(&mut self, now: Instant) {
        self.next = now;
    }

    /// Die Restzeit, bis `hurry` wieder wirkt (Rest der Minute nach dem letzten Abholen); 0, wenn jetzt.
    fn cooldown_ms(&self, now: Instant) -> u64 {
        self.last
            .filter(|last| now.duration_since(*last) < RETRY_POLL_GAP)
            .map_or(0, |last| {
                (RETRY_POLL_GAP - now.duration_since(last)).as_millis() as u64
            })
    }

    /// `true`, wenn das Abholen auf jetzt vorgezogen wurde.
    fn hurry(&mut self, now: Instant) -> bool {
        if self
            .last
            .is_some_and(|last| now.duration_since(last) < RETRY_POLL_GAP)
        {
            return false;
        }
        self.next = now;
        true
    }
}

/// Warum ein Schritt mit dem Verzeichnis scheiterte.
#[derive(Debug)]
enum Failure {
    Directory(DirectoryError),
    Mojang(MojangError),
    /// Im Launcher selbst: kein Konto, keine Identität, kein Zufall.
    Local(AppError),
    /// Eine Anmeldung brauchte ein neues Zertifikat, während ein Spiel mit der Mod verbunden ist ([`CertificateSource`]).
    /// Das ist kein Fehler des Verzeichnisses: die Schleife wartet, bis das letzte Spiel zu Ende ist.
    CertificateWithheld,
}

impl Failure {
    /// Die Meldung für den Nutzer (BYNAME 9.6); `name` ist der Minecraft-Name, an den die Anfrage ging.
    fn into_app_error(self, name: &str) -> AppError {
        match self {
            Self::Directory(error) => error.into_app_error(name),
            Self::Mojang(MojangError::NotAllowed) => {
                AppError::invalid(coded!("errors.friends.directoryNotAllowed"))
            }
            Self::Mojang(MojangError::InvalidSession) => AppError::invalid(relogin()),
            Self::Mojang(MojangError::Unreachable | MojangError::RateLimited)
            | Self::CertificateWithheld => directory_unavailable(),
            Self::Local(error) => error,
        }
    }

    /// Ein Auftrag bleibt bei Netzfehlern, 5xx und 429 liegen; jede andere Antwort des Verzeichnisses erledigt ihn.
    fn keeps_job(&self) -> bool {
        match self {
            Self::Directory(error) => matches!(
                error,
                DirectoryError::Unreachable
                    | DirectoryError::RateLimited { .. }
                    | DirectoryError::Unauthorized
                    | DirectoryError::BadCertificate
                    | DirectoryError::CertificateExpired
            ),
            Self::Mojang(_) | Self::Local(_) | Self::CertificateWithheld => true,
        }
    }
}

impl Friends {
    /// Hängt das Verzeichnis ein (BYNAME 9.1); genau einmal, vor oder nach dem Start.
    pub fn attach_directory(&self, deps: DirectoryDeps) -> Result<(), HandlerAlreadySet> {
        self.core
            .directory
            .set(deps)
            .map_err(|_| HandlerAlreadySet)?;
        if let Some(runtime) = self.core.runtime() {
            spawn_directory_loop(&self.core, &runtime.stop);
        }
        Ok(())
    }

    /// Ob die Schleife des Verzeichnisses gerade auf das Ende der Spiele mit der Mod wartet.
    #[cfg(test)]
    pub(super) fn directory_awaits_games(&self) -> bool {
        self.core.by_name.is_awaiting_games()
    }

    /// Die Restzeit der Sperre von „Jetzt zustellen“ in Millisekunden (Rest der Minute nach dem letzten Abholen des
    /// Postfachs, BYNAME 7.2); 0, wenn ein Druck sofort wirkt. Das Thema `requests` trägt sie in die Mod.
    pub(super) fn retry_cooldown_ms(&self) -> u64 {
        let now = Instant::now();
        lock(&self.core.by_name.clock).cooldown_ms(now)
    }

    /// Ein Spiel mit der Mod ist nicht mehr verbunden: wartet die Schleife des Verzeichnisses auf das Ende der Spiele, holt
    /// sie ihre Arbeit nach.
    pub(super) fn game_link_ended(&self) {
        self.core.by_name.wake.notify_one();
    }

    /// Sagt dem Dienst, woher er erfährt, ob ein Spiel mit der Mod verbunden ist; genau einmal.
    pub(super) fn watch_game_links(&self, probe: GameLinkProbe) -> Result<(), HandlerAlreadySet> {
        self.core
            .by_name
            .game_links
            .set(probe)
            .map_err(|_| HandlerAlreadySet)
    }

    /// Schickt eine Freundschaftsanfrage an den Spieler mit genau diesem Minecraft-Namen (BYNAME 7.1). Solange ein Spiel mit
    /// der Mod verbunden ist, meldet sich der Dienst nur mit dem gemerkten Zertifikat an; gibt es keines, das noch
    /// taugt, bleibt es bei `directoryUnavailable`.
    pub async fn add_by_name(&self, name: &str) -> AppResult<FriendRequest> {
        let core = &self.core;
        core.ensure_enabled()?;
        let identity = core.identity().ok_or_else(identity_lost)?;
        let deps = core.directory.get().ok_or_else(directory_unavailable)?;
        let name = sanitize::mc_name(Some(name.trim()))
            .ok_or_else(|| AppError::invalid(coded!("errors.friends.nameInvalid")))?;
        let target = look_up(deps, &name).await?;
        ensure_may_request(core, &target)?;
        let (parts, record) = issue_code(core, &identity, &target)?;
        let sent = match send_letter(core, deps, &identity, &parts, &target.uuid).await {
            Ok(sent) => sent,
            Err(failure) => {
                let _ = core.stores.codes.remove(&record.id);
                return Err(failure.into_app_error(&target.name));
            }
        };
        if let Some(runtime) = core.runtime() {
            hello::bind_code(core, &runtime, &record).await;
        }
        let request = core
            .stores
            .requests
            .insert(awaiting_answer(&record, target, sent))?;
        core.emit(FriendsEvent::Changed);
        Ok(requests::request_view(request))
    }
}

/// Der Zustand für die Oberfläche (BYNAME 9.3); auch bei abgeschalteter Funktion.
pub(super) fn directory_status(core: &Core) -> DirectoryStatus {
    let Some(deps) = core.directory.get() else {
        return DirectoryStatus {
            state: DirectoryState::Unavailable,
            host: None,
        };
    };
    let state = if core.config().settings.findable_by_name {
        lock(&core.by_name.health).unwrap_or(DirectoryState::Off)
    } else {
        DirectoryState::Off
    };
    DirectoryStatus {
        state,
        host: Some(deps.host.clone()),
    }
}

/// Forgets the token and the certificate (identity renewed, account changed, friends switched off).
pub(super) fn forget_session(core: &Core) {
    forget_token(core);
    forget_certificate(core);
}

fn forget_token(core: &Core) {
    *lock(&core.by_name.session) = None;
}

fn forget_certificate(core: &Core) {
    *lock(&core.by_name.certificate) = None;
}

/// Das gültige Token für die eigene Peer-ID, sonst eine neue Anmeldung. Woher deren Zertifikat kommen darf, hängt davon ab,
/// ob ein Spiel mit der Mod verbunden ist ([`CertificateSource`]); das gilt für jeden Weg zum Verzeichnis: Namen, Anmeldung
/// der Schleife, Aufträge und `friends_retry_now`.
async fn session(core: &Core, deps: &DirectoryDeps) -> Result<CachedSession, Failure> {
    let identity = core
        .identity()
        .ok_or_else(|| Failure::Local(identity_lost()))?;
    let _auth = core.by_name.auth_lock.lock().await;
    let peer_id = identity.peer_id();
    let source = core.by_name.certificate_source();
    resume_after_games(core, source);
    if let Some(cached) = cached_session(core, &peer_id) {
        return Ok(cached);
    }
    let opened = log_in(core, deps, &identity, source).await;
    if matches!(opened, Err(Failure::Mojang(MojangError::NotAllowed))) {
        set_health(core, DirectoryState::NotAllowed);
    }
    let opened = opened?;
    *lock(&core.by_name.session) = Some(opened.clone());
    Ok(opened)
}

fn cached_session(core: &Core, peer_id: &str) -> Option<CachedSession> {
    let still_valid =
        |session: &CachedSession| session.expires_at > now_secs() + SESSION_MARGIN_SECS;
    lock(&core.by_name.session)
        .clone()
        .filter(|session| session.peer_id == peer_id && still_valid(session))
}

/// One handshake, and one more after a refusal that a fresh Minecraft token or a fresh certificate can cure
/// (BYNAME-ATTEST 5.4). A token refused again although it was just refreshed means Mojang refuses the account.
async fn log_in(
    core: &Core,
    deps: &DirectoryDeps,
    identity: &Identity,
    source: CertificateSource,
) -> Result<CachedSession, Failure> {
    match handshake(core, deps, identity, source).await {
        Err(Failure::Mojang(MojangError::InvalidSession)) => {
            deps.tokens.forget_minecraft_session();
            handshake(core, deps, identity, source)
                .await
                .map_err(|failure| match failure {
                    Failure::Mojang(MojangError::InvalidSession) => {
                        Failure::Mojang(MojangError::NotAllowed)
                    }
                    other => other,
                })
        }
        // Ein frisches Zertifikat gibt es nur, wo der Abruf erlaubt ist; sonst bleibt es bei der Ablehnung.
        Err(Failure::Directory(
            DirectoryError::BadCertificate | DirectoryError::CertificateExpired,
        )) if source == CertificateSource::CachedOrFetched => {
            forget_certificate(core);
            handshake(core, deps, identity, source)
                .await
                .inspect_err(warn_refused_certificate)
        }
        first => first,
    }
}

/// Distinct lines, so that a key rotation the Worker missed shows up in the logs users send.
fn warn_refused_certificate(failure: &Failure) {
    match failure {
        Failure::Directory(DirectoryError::BadCertificate) => {
            tracing::warn!("The directory does not accept Mojang's player certificate; Mojang may have new certificate keys")
        }
        Failure::Directory(DirectoryError::CertificateExpired) => {
            tracing::warn!("The directory considers even a fresh player certificate expired")
        }
        _ => {}
    }
}

/// The login of BYNAME-ATTEST 5.4: account attributes, certificate, challenge, both signatures. The certificate comes
/// before the challenge so that its fetch does not eat into the challenge's lifetime. No Mojang `join` happens here.
/// A token for another account than the own is never used: it decides which letters count as addressed to me.
async fn handshake(
    core: &Core,
    deps: &DirectoryDeps,
    identity: &Identity,
    source: CertificateSource,
) -> Result<CachedSession, Failure> {
    let account = deps
        .tokens
        .minecraft_session()
        .await
        .map_err(Failure::Local)?;
    let privileges = deps.mojang.privileges(&account).await;
    if privileges == Privileges::Refused {
        return Err(Failure::Mojang(MojangError::NotAllowed));
    }
    let certificate = current_certificate(core, deps, &account, source).await?;
    let peer_id = identity.peer_id();
    let challenge = deps
        .api
        .challenge(&peer_id)
        .await
        .map_err(Failure::Directory)?;
    let parts = proof::login_parts(
        &deps.host,
        &challenge.server_id,
        &peer_id,
        &certificate.uuid,
    )
    .ok_or(Failure::Directory(DirectoryError::Invalid("serverId")))?;
    let request = proof::session_request(challenge.challenge, &parts, identity, &certificate)
        .ok_or_else(|| Failure::Local(local_error("the player certificate could not sign")))?;
    let opened = deps
        .api
        .session(&request)
        .await
        .map_err(Failure::Directory)?;
    if opened.uuid != account.uuid {
        return Err(Failure::Directory(DirectoryError::Invalid(
            "sessionAccount",
        )));
    }
    Ok(CachedSession {
        token: opened.token,
        expires_at: opened.expires_at,
        uuid: account.uuid,
        peer_id,
        privileges,
    })
}

/// The cached certificate until Mojang wants it refreshed, then a fresh one. While Mojang cannot be reached, a cached
/// certificate that is still usable serves; never after Mojang refused the account (review finding 1).
///
/// With [`CertificateSource::CachedOnly`] Mojang is not asked at all: a certificate that is usable serves even when
/// Mojang wants it refreshed, and without one the login is withheld ([`Failure::CertificateWithheld`]).
async fn current_certificate(
    core: &Core,
    deps: &DirectoryDeps,
    account: &McIdentity,
    source: CertificateSource,
) -> Result<PlayerCertificate, Failure> {
    let now = clock_ms();
    let cached = lock(&core.by_name.certificate)
        .clone()
        .filter(|certificate| certificate.uuid == account.uuid);
    if source == CertificateSource::CachedOnly {
        return cached
            .filter(|certificate| certificate.is_usable(now))
            .ok_or(Failure::CertificateWithheld);
    }
    if let Some(fresh) = cached
        .clone()
        .filter(|certificate| !certificate.needs_refresh(now))
    {
        return Ok(fresh);
    }
    match deps.mojang.certificate(account).await {
        Ok(fetched) => {
            *lock(&core.by_name.certificate) = Some(fetched.clone());
            Ok(fetched)
        }
        Err(MojangError::NotAllowed) => {
            forget_certificate(core);
            Err(Failure::Mojang(MojangError::NotAllowed))
        }
        Err(error) => cached
            .filter(|certificate| certificate.is_usable(now))
            .ok_or(Failure::Mojang(error)),
    }
}

fn clock_ms() -> i64 {
    i64::try_from(now_ms()).unwrap_or(i64::MAX)
}

/// The session for being listed: only an account whose attributes Mojang explicitly allows (review finding 1). Unknown
/// attributes count as refused until owner test O-7 has shown what restricted accounts receive; the next attempt logs
/// in and asks Mojang again.
async fn listed_session(core: &Core, deps: &DirectoryDeps) -> Result<CachedSession, Failure> {
    let me = session(core, deps).await?;
    if me.privileges == Privileges::Allowed {
        return Ok(me);
    }
    tracing::warn!(
        "Mojang's account attributes are unreadable; the account stays out of the directory"
    );
    forget_token(core);
    Err(Failure::Mojang(MojangError::Unreachable))
}

/// Ein Aufruf mit Token; ein `401` verwirft das Token, meldet sich genau einmal neu an und wiederholt den Aufruf.
async fn authorized<T, F, Fut>(core: &Core, deps: &DirectoryDeps, call: F) -> Result<T, Failure>
where
    F: Fn(Arc<dyn DirectoryApi>, String) -> Fut,
    Fut: Future<Output = Result<T, DirectoryError>>,
{
    let first = call(deps.api.clone(), session(core, deps).await?.token).await;
    if !matches!(first, Err(DirectoryError::Unauthorized)) {
        return first.map_err(Failure::Directory);
    }
    forget_token(core);
    let second = call(deps.api.clone(), session(core, deps).await?.token).await;
    if matches!(second, Err(DirectoryError::Unauthorized)) {
        forget_token(core);
    }
    second.map_err(Failure::Directory)
}

fn set_health(core: &Core, state: DirectoryState) {
    let previous = lock(&core.by_name.health).replace(state);
    if previous != Some(state) {
        core.emit(FriendsEvent::Changed);
    }
}

/// Eine Mojang-Sperre bleibt sichtbar, bis der Nutzer die Einstellung umschaltet; alles andere heißt „nicht
/// erreichbar“.
fn note_failure(core: &Core, failure: &Failure) {
    if matches!(failure, Failure::CertificateWithheld) {
        await_end_of_games(core);
        return;
    }
    tracing::debug!(?failure, "Verzeichnis nicht erreicht");
    if !matches!(failure, Failure::Mojang(MojangError::NotAllowed)) {
        set_health(core, DirectoryState::Unreachable);
    }
}

/// Ohne Zertifikat und ohne Erlaubnis, eins zu holen, ist das Verzeichnis weder erreichbar noch unerreichbar: der Zustand bleibt,
/// der Postfach-Termin bleibt fällig, und die Schleife wartet, bis das letzte Spiel mit der Mod zu Ende ist.
fn await_end_of_games(core: &Core) {
    lock(&core.by_name.clock).make_due(Instant::now());
    if core.by_name.set_awaiting_games(true) {
        tracing::info!("Verzeichnis wartet auf das Ende der Spiele mit der Mod: kein brauchbares gemerktes Zertifikat, und währenddessen holt der Launcher keins");
    }
}

/// Die Anmeldung darf wieder ein Zertifikat holen: war der Dienst am Warten, geht es jetzt weiter.
fn resume_after_games(core: &Core, source: CertificateSource) {
    if source == CertificateSource::CachedOrFetched && core.by_name.set_awaiting_games(false) {
        tracing::info!("Verzeichnis arbeitet weiter: kein Spiel mit der Mod ist mehr verbunden");
    }
}

async fn look_up(deps: &DirectoryDeps, name: &str) -> AppResult<MojangProfile> {
    match deps.mojang.lookup_name(name).await {
        Ok(Some(profile)) => Ok(profile),
        Ok(None) => Err(AppError::invalid(coded!(
            "errors.friends.nameUnknown",
            name = name
        ))),
        Err(_) => Err(directory_unavailable()),
    }
}

fn ensure_may_request(core: &Core, target: &MojangProfile) -> AppResult<()> {
    let own_uuid = core.account_uuid();
    if own_uuid.as_deref() == Some(target.uuid.as_str()) {
        return Err(AppError::invalid(coded!("errors.friends.nameOwn")));
    }
    let is_target = |mc_uuid: &Option<String>| mc_uuid.as_deref() == Some(target.uuid.as_str());
    if core
        .stores
        .friends
        .list()
        .iter()
        .any(|friend| is_target(&friend.mc_uuid))
    {
        return Err(AppError::invalid(coded!("errors.friends.alreadyFriends")));
    }
    let open = open_name_requests(core);
    if open.iter().any(|request| is_target(&request.mc_uuid)) {
        return Err(AppError::invalid(coded!(
            "errors.friends.alreadyRequestedName",
            name = target.name
        )));
    }
    if open.len() >= MAX_NAME_REQUESTS {
        return Err(AppError::invalid(coded!(
            "errors.friends.tooManyNameRequests",
            max = MAX_NAME_REQUESTS
        )));
    }
    requests::ensure_friend_capacity(core)
}

fn open_name_requests(core: &Core) -> Vec<RequestRecord> {
    let is_open = |request: &RequestRecord| {
        request.via == RequestVia::Name && request.direction == RequestDirection::Outgoing
    };
    core.stores
        .requests
        .list()
        .into_iter()
        .filter(is_open)
        .collect()
}

/// Ein Code nur für diese Anfrage, so lange gültig wie der Brief; er zählt nicht zu den eigenen Codes.
fn issue_code(
    core: &Core,
    identity: &Identity,
    target: &MojangProfile,
) -> AppResult<(CodeParts, CodeRecord)> {
    let relay_index = hello::code_relay(core)?;
    let issued = code::issue(identity, relay_index)?;
    let record = hello::code_record(&issued, REQUEST_TTL_SECS, Some(target.uuid.clone()));
    core.stores.codes.insert(record.clone())?;
    Ok((issued.parts, record))
}

async fn send_letter(
    core: &Core,
    deps: &DirectoryDeps,
    identity: &Identity,
    parts: &CodeParts,
    to: &str,
) -> Result<SentLetter, Failure> {
    let me = session(core, deps).await?;
    let letter = &signed_letter(core, identity, &me.uuid, parts, to)?;
    authorized(core, deps, |api, token| async move {
        api.send(&token, letter).await
    })
    .await
}

fn signed_letter(
    core: &Core,
    identity: &Identity,
    from_uuid: &str,
    parts: &CodeParts,
    to: &str,
) -> Result<OutgoingLetter, Failure> {
    let mut nonce = [0; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|err| Failure::Local(local_error(&err.to_string())))?;
    let letter = OutgoingLetter {
        to: to.to_owned(),
        nonce: HEXLOWER.encode(&nonce),
        hello_id: HEXLOWER.encode(&parts.hello_id),
        relay_index: parts.relay_index,
        secret: parts.secret_hex(),
        display_name: core.own_profile().display_name,
        created_at: now_secs(),
        signature: String::new(),
    };
    let fields = LetterFields {
        to: &letter.to,
        from_uuid,
        nonce: &letter.nonce,
        hello_id: &letter.hello_id,
        relay_index: letter.relay_index,
        secret: &letter.secret,
        created_at: letter.created_at,
        display_name: &letter.display_name,
    };
    let signed = proof::letter_parts(&fields)
        .ok_or(Failure::Directory(DirectoryError::Invalid("letter")))?;
    let signature = HEXLOWER.encode(&identity.sign(proof::LETTER_DOMAIN, &signed.as_slices()));
    Ok(OutgoingLetter {
        signature,
        ..letter
    })
}

/// Die eigene Anfrage trägt die ID ihres Codes; sie lebt höchstens so lange wie der Code.
fn awaiting_answer(code: &CodeRecord, target: MojangProfile, sent: SentLetter) -> RequestRecord {
    RequestRecord {
        id: code.id.clone(),
        direction: RequestDirection::Outgoing,
        state: RequestState::AwaitingAnswer,
        peer_id: None,
        hello_id: None,
        relay_index: None,
        secret: None,
        display_name: None,
        mc_name: Some(target.name),
        mc_uuid: Some(target.uuid),
        code_tail: None,
        created_at: code.created_at,
        expires_at: sent.expires_at.min(code.expires_at),
        via: RequestVia::Name,
        mail_id: Some(sent.id),
    }
}

/// Holt das Postfach nach Plan ab und arbeitet die Aufträge ab, solange diese Aktivierung läuft.
pub(super) fn spawn_directory_loop(core: &Arc<Core>, stop: &CancellationToken) {
    if core.directory.get().is_none() {
        return;
    }
    lock(&core.by_name.clock).restart(Instant::now());
    tokio::spawn(
        stop.clone()
            .run_until_cancelled_owned(directory_loop(core.clone())),
    );
}

/// `friends_retry_now`: das Postfach jetzt abholen, wenn das letzte Abholen über 60 s her ist.
pub(super) fn poll_soon(core: &Core) {
    if lock(&core.by_name.clock).hurry(Instant::now()) {
        core.by_name.wake.notify_one();
    }
}

async fn directory_loop(core: Arc<Core>) {
    loop {
        tick(&core).await;
        wait_for_next_tick(&core).await;
    }
}

/// Bis zum nächsten Termin des Postfachs oder bis jemand weckt; wer auf das Ende der Spiele wartet, wartet nur aufs Wecken.
async fn wait_for_next_tick(core: &Core) {
    if core.by_name.is_awaiting_games() {
        core.by_name.wake.notified().await;
        return;
    }
    let next_poll = lock(&core.by_name.clock).next;
    tokio::select! {
        () = sleep_until(next_poll) => {}
        () = core.by_name.wake.notified() => {}
    }
}

async fn tick(core: &Arc<Core>) {
    let Some(deps) = core.directory.get() else {
        return;
    };
    run_jobs(core).await;
    let poll_due = lock(&core.by_name.clock).take_due(Instant::now(), deps.poll_interval);
    if is_listed(core) && ensure_registered(core, deps).await && poll_due {
        poll_inbox(core).await;
    }
}

/// Auffindbar und nicht von Mojang gesperrt; eine Sperre pausiert bis zum Umschalten oder Neustart.
fn is_listed(core: &Core) -> bool {
    core.config().settings.findable_by_name
        && *lock(&core.by_name.health) != Some(DirectoryState::NotAllowed)
}

/// Trägt das Konto ein oder frischt den Eintrag auf, wenn er älter als einen Tag ist; `true`, wenn er steht.
async fn ensure_registered(core: &Core, deps: &DirectoryDeps) -> bool {
    match register(core, deps).await {
        Ok(()) => {
            set_health(core, DirectoryState::Active);
            true
        }
        Err(failure) => {
            note_failure(core, &failure);
            false
        }
    }
}

async fn register(core: &Core, deps: &DirectoryDeps) -> Result<(), Failure> {
    let me = listed_session(core, deps).await?;
    let listed = core.config().directory;
    let is_fresh = listed.registered_uuid.as_deref() == Some(me.uuid.as_str())
        && listed
            .refreshed_at
            .is_some_and(|at| now_secs().saturating_sub(at) < REFRESH_SECS);
    if is_fresh {
        return Ok(());
    }
    authorized(core, deps, |api, token| async move {
        api.register(&token).await
    })
    .await?;
    core.update_config(|config| {
        config.directory.registered_uuid = Some(me.uuid);
        config.directory.refreshed_at = Some(now_secs());
    })
    .map_err(Failure::Local)
}

/// Holt das Postfach ab und gleicht die wartenden Anfragen per Name damit ab.
pub(super) async fn poll_inbox(core: &Arc<Core>) {
    let Some(deps) = core.directory.get() else {
        return;
    };
    let _polling = core.by_name.polling.lock().await;
    match fetch_inbox(core, deps).await {
        Ok((letters, own_uuid)) => {
            set_health(core, DirectoryState::Active);
            let filed = file_letters(core, deps, &letters, &own_uuid).await;
            if filed | drop_vanished(core, &letters) {
                core.emit(FriendsEvent::Changed);
            }
        }
        Err(failure) => {
            if matches!(failure, Failure::Directory(DirectoryError::NotRegistered)) {
                forget_registration(core);
            }
            note_failure(core, &failure);
        }
    }
}

async fn fetch_inbox(
    core: &Core,
    deps: &DirectoryDeps,
) -> Result<(Vec<InboxLetter>, String), Failure> {
    let me = listed_session(core, deps).await?;
    let letters = authorized(
        core,
        deps,
        |api, token| async move { api.inbox(&token).await },
    )
    .await?;
    Ok((letters, me.uuid))
}

/// Legt neue, glaubwürdige Briefe als eingehende Anfragen ab; `true`, wenn eine dazukam.
async fn file_letters(
    core: &Core,
    deps: &DirectoryDeps,
    letters: &[InboxLetter],
    own_uuid: &str,
) -> bool {
    let Some(identity) = core.identity() else {
        return false;
    };
    let peer_id = identity.peer_id();
    let me = Recipient {
        uuid: own_uuid,
        peer_id: &peer_id,
        now: now_secs(),
    };
    lock(&core.by_name.missing_senders)
        .retain(|id, _| letters.iter().any(|letter| letter.id == *id));
    let mut filed = false;
    for letter in letters
        .iter()
        .filter(|letter| is_new_request(core, letter, &me))
    {
        filed |= file_with_sender_name(core, deps, letter).await;
    }
    filed
}

/// Whether the letter can become a new request: valid, not from a blocked sender or a friend, not filed yet, and
/// there is room. Letters that can never become one are deleted on the way. Only these letters cause a lookup at
/// Mojang (review finding 9).
fn is_new_request(core: &Core, letter: &InboxLetter, me: &Recipient) -> bool {
    let is_known_relay = |index| find_relay(&core.options.relay_map, index).is_some();
    match proof::validate_letter(&stamped(letter), me, is_known_relay) {
        Ok(()) => {}
        Err(Rejection::Malformed) => return delete_mail(core, letter),
        Err(Rejection::UnknownRelay) => return false,
    }
    let sender = &letter.from;
    if is_blocked_sender(core, &sender.peer_id, &sender.uuid) {
        queue_job(
            core,
            DirectoryJob::Block {
                uuid: sender.uuid.clone(),
            },
        );
        return delete_mail(core, letter);
    }
    if core.stores.friends.get(&sender.peer_id).is_ok() {
        return delete_mail(core, letter);
    }
    let is_filed = core
        .stores
        .requests
        .list()
        .iter()
        .any(|request| request.mail_id.as_deref() == Some(&letter.id));
    !is_filed && requests::has_room_for_incoming(core)
}

/// The directory stamps no names: the sender's current name comes from Mojang by the proven UUID (BYNAME-ATTEST 4.3).
/// Without an answer the letter waits for the next poll.
async fn file_with_sender_name(core: &Core, deps: &DirectoryDeps, letter: &InboxLetter) -> bool {
    match deps.mojang.profile(&letter.from.uuid).await {
        Ok(Some(sender)) => {
            lock(&core.by_name.missing_senders).remove(&letter.id);
            file_request(core, letter, sender)
        }
        Ok(None) if count_missing_sender(core, &letter.id) >= MISSING_SENDER_POLLS => {
            delete_mail(core, letter)
        }
        Ok(None) => false,
        Err(error) => {
            tracing::debug!(?error, "sender of a letter not looked up at Mojang");
            lock(&core.by_name.missing_senders).remove(&letter.id);
            false
        }
    }
}

/// Counts one more poll in a row on which Mojang knew no account for this letter's sender.
fn count_missing_sender(core: &Core, mail_id: &str) -> u8 {
    let mut missing = lock(&core.by_name.missing_senders);
    let polls = missing.entry(mail_id.to_owned()).or_default();
    *polls = polls.saturating_add(1);
    *polls
}

fn file_request(core: &Core, letter: &InboxLetter, sender: MojangProfile) -> bool {
    match core.stores.requests.insert(incoming_letter(letter, sender)) {
        Ok(request) => {
            core.emit(FriendsEvent::Request(FriendRequestEvent {
                request: requests::request_view(request),
            }));
            true
        }
        Err(err) => {
            tracing::warn!(%err, "Anfrage per Name nicht gespeichert");
            false
        }
    }
}

/// Immer `false`: ein gelöschter Brief wird keine Anfrage.
fn delete_mail(core: &Core, letter: &InboxLetter) -> bool {
    queue_job(
        core,
        DirectoryJob::DeleteMail {
            mail_id: letter.id.clone(),
            until: letter.expires_at,
        },
    );
    false
}

fn stamped(letter: &InboxLetter) -> StampedLetter<'_> {
    StampedLetter {
        fields: LetterFields {
            to: &letter.to,
            from_uuid: &letter.from.uuid,
            nonce: &letter.nonce,
            hello_id: &letter.hello_id,
            relay_index: letter.relay_index,
            secret: &letter.secret,
            created_at: letter.created_at,
            display_name: &letter.display_name,
        },
        from_peer_id: &letter.from.peer_id,
        expires_at: letter.expires_at,
        signature: &letter.signature,
    }
}

fn is_blocked_sender(core: &Core, peer_id: &str, uuid: &str) -> bool {
    core.stores.blocked.get(peer_id).is_ok()
        || core
            .stores
            .blocked
            .list()
            .iter()
            .any(|blocked| blocked.mc_uuid.as_deref() == Some(uuid))
}

/// `sender` is Mojang's answer for the stamped UUID.
fn incoming_letter(letter: &InboxLetter, sender: MojangProfile) -> RequestRecord {
    let peer_id = &letter.from.peer_id;
    RequestRecord {
        id: new_id(),
        direction: RequestDirection::Incoming,
        state: RequestState::Pending,
        peer_id: Some(peer_id.clone()),
        hello_id: Some(letter.hello_id.clone()),
        relay_index: Some(letter.relay_index),
        secret: Some(letter.secret.clone()),
        display_name: Some(sender.name.clone()),
        mc_name: Some(sender.name),
        mc_uuid: Some(sender.uuid),
        code_tail: None,
        created_at: letter.created_at,
        expires_at: letter.expires_at,
        via: RequestVia::Name,
        mail_id: Some(letter.id.clone()),
    }
}

/// Wartende Anfragen per Name, deren Brief nicht mehr im Postfach liegt (zurückgezogen, anderswo beantwortet,
/// abgelaufen), verschwinden; `true`, wenn eine verschwand.
fn drop_vanished(core: &Core, letters: &[InboxLetter]) -> bool {
    let present: HashSet<&str> = letters.iter().map(|letter| letter.id.as_str()).collect();
    let vanished = core.stores.requests.list().into_iter().filter(|request| {
        let is_waiting_letter =
            request.via == RequestVia::Name && request.state == RequestState::Pending;
        is_waiting_letter
            && request
                .mail_id
                .as_deref()
                .is_some_and(|id| !present.contains(id))
    });
    vanished.fold(false, |dropped, request| {
        core.stores.requests.remove(&request.id).is_ok() | dropped
    })
}

fn forget_registration(core: &Core) {
    let forgotten = core.update_config(|config| {
        config.directory.registered_uuid = None;
        config.directory.refreshed_at = None;
    });
    if let Err(err) = forgotten {
        tracing::warn!(%err, "Eintrag im Verzeichnis nicht vergessen");
    }
}

/// Merkt sich den Auftrag (er überlebt einen Neustart) und weckt die Schleife, die ihn sofort versucht.
fn queue_job(core: &Core, job: DirectoryJob) {
    if core.directory.get().is_none() {
        return;
    }
    let queued = core.update_config(|config| {
        if !config.directory.jobs.contains(&job) {
            config.directory.jobs.push(job);
        }
    });
    if let Err(err) = queued {
        tracing::warn!(%err, "Auftrag ans Verzeichnis nicht gespeichert");
    }
    core.by_name.wake.notify_one();
}

/// Arbeitet die Aufträge der Reihe nach ab; was erledigt oder überholt ist, verschwindet.
pub(super) async fn run_jobs(core: &Core) {
    let Some(deps) = core.directory.get() else {
        return;
    };
    let _running = core.by_name.running_jobs.lock().await;
    for job in core.config().directory.jobs {
        if is_settled(core, deps, &job).await {
            let removed =
                core.update_config(|config| config.directory.jobs.retain(|queued| *queued != job));
            if let Err(err) = removed {
                tracing::warn!(%err, "erledigter Auftrag ans Verzeichnis nicht entfernt");
            }
        }
    }
}

async fn is_settled(core: &Core, deps: &DirectoryDeps, job: &DirectoryJob) -> bool {
    let outcome = match job {
        DirectoryJob::DeleteMail { until, .. } | DirectoryJob::Retract { until, .. }
            if *until <= now_secs() =>
        {
            return true;
        }
        DirectoryJob::DeleteMail { mail_id, .. } => {
            authorized(core, deps, |api, token| async move {
                api.delete(&token, mail_id).await
            })
            .await
        }
        DirectoryJob::Retract { mail_id, .. } => {
            authorized(core, deps, |api, token| async move {
                api.retract(&token, mail_id).await
            })
            .await
        }
        DirectoryJob::Block { uuid } => {
            authorized(core, deps, |api, token| async move {
                api.block(&token, uuid).await
            })
            .await
        }
        DirectoryJob::Unblock { uuid } => {
            authorized(core, deps, |api, token| async move {
                api.unblock(&token, uuid).await
            })
            .await
        }
        DirectoryJob::Unregister { uuid } => return unregister(core, deps, uuid).await,
    };
    settles(outcome)
}

/// Abmelden geht nur mit dem eigenen Konto; ist es nicht mehr das erste Microsoft-Konto, löscht die Aufbewahrungsfrist
/// des Verzeichnisses den Eintrag nach 30 Tagen.
async fn unregister(core: &Core, deps: &DirectoryDeps, uuid: &str) -> bool {
    let is_own_account = core.account_uuid().as_deref() == Some(uuid);
    if !is_own_account {
        return true;
    }
    let outcome = authorized(core, deps, |api, token| async move {
        api.unregister(&token).await
    })
    .await;
    if outcome.is_ok() && core.config().directory.registered_uuid.as_deref() == Some(uuid) {
        forget_registration(core);
    }
    settles(outcome)
}

fn settles(outcome: Result<(), Failure>) -> bool {
    outcome
        .as_ref()
        .err()
        .is_none_or(|failure| !failure.keeps_job())
}

/// Eine angenommene oder abgelehnte Anfrage per Name: ihr Brief wird im Verzeichnis gelöscht.
pub(super) fn delete_letter(core: &Core, request: &RequestRecord) {
    if let (RequestVia::Name, Some(mail_id)) = (request.via, &request.mail_id) {
        queue_job(
            core,
            DirectoryJob::DeleteMail {
                mail_id: mail_id.clone(),
                until: request.expires_at,
            },
        );
    }
}

/// Eine eigene Anfrage per Name ist zurückgezogen: ihr Brief verschwindet aus dem Postfach des Empfängers.
pub(super) fn retract_letter(core: &Core, request: &RequestRecord) {
    if let (RequestVia::Name, Some(mail_id)) = (request.via, &request.mail_id) {
        queue_job(
            core,
            DirectoryJob::Retract {
                mail_id: mail_id.clone(),
                until: request.expires_at,
            },
        );
    }
}

/// Vor einem neuen Schlüssel: Briefe mit Codes des alten Schlüssels taugen nichts mehr (BYNAME 7.5).
pub(super) fn retract_own_letters(core: &Core) {
    let own = open_name_requests(core)
        .into_iter()
        .filter(|request| core.stores.codes.get(&request.id).is_ok());
    for request in own {
        retract_letter(core, &request);
    }
}

/// Gesperrt wegen einer Anfrage per Name: auch das Verzeichnis nimmt von diesem Konto nichts mehr an.
pub(super) fn block_sender(core: &Core, request: &RequestRecord) {
    if let Some(uuid) = &request.mc_uuid {
        queue_job(core, DirectoryJob::Block { uuid: uuid.clone() });
    }
    delete_letter(core, request);
}

pub(super) fn unblock_sender(core: &Core, uuid: String) {
    queue_job(core, DirectoryJob::Unblock { uuid });
}

/// Auffindbar an: eintragen und die Sperren erneut hinterlegen (sie gelten nur mit Eintrag). Aus: sofort austragen.
/// Beides hebt eine Mojang-Sperre auf, bis der nächste Versuch sie wieder zeigt.
pub(super) fn findability_changed(core: &Core, findable: bool) {
    *lock(&core.by_name.health) = None;
    if findable {
        for blocked in core.stores.blocked.list() {
            if let Some(uuid) = blocked.mc_uuid {
                queue_job(core, DirectoryJob::Block { uuid });
            }
        }
    } else if let Some(uuid) = core.config().directory.registered_uuid {
        queue_job(core, DirectoryJob::Unregister { uuid });
    }
    core.by_name.wake.notify_one();
}

/// Das erste Microsoft-Konto hat sich geändert: das Token gehört zum alten, der Eintrag wechselt zum neuen (BYNAME
/// 7.5).
pub(super) fn account_changed(core: &Core) {
    forget_session(core);
    let account_uuid = core.account_uuid();
    let config = core.config();
    let registered = config.directory.registered_uuid;
    let other_registration =
        registered.filter(|registered| Some(registered) != account_uuid.as_ref());
    if let Some(old) = other_registration.filter(|_| config.settings.findable_by_name) {
        queue_job(core, DirectoryJob::Unregister { uuid: old });
        forget_registration(core);
    }
    core.by_name.wake.notify_one();
}

/// Beim Abschalten: austragen und es kurz versuchen; die Einstellung bleibt, damit erneutes Aktivieren wieder einträgt.
pub(super) async fn leave_directory(core: &Core) {
    forget_session(core);
    if let Some(uuid) = core.config().directory.registered_uuid {
        queue_job(core, DirectoryJob::Unregister { uuid });
    }
    if timeout(LEAVE_BUDGET, run_jobs(core)).await.is_err() {
        tracing::debug!("Abmelden beim Verzeichnis läuft beim nächsten Start weiter");
    }
}

/// Die Eingaben beider `serverId`s als Bytes.
struct ProofInputs {
    hello_id: [u8; 32],
    redeemer: [u8; 32],
    secret: [u8; 9],
}

impl ProofInputs {
    fn new(hello_id: &PeerId, redeemer: &PeerId, secret_hex: &str) -> Option<Self> {
        let secret = HEXLOWER
            .decode(secret_hex.as_bytes())
            .ok()?
            .try_into()
            .ok()?;
        Some(Self {
            hello_id: *hello_id.as_bytes(),
            redeemer: *redeemer.as_bytes(),
            secret,
        })
    }

    fn proof(&self) -> NameProof<'_> {
        NameProof {
            hello_id: &self.hello_id,
            redeemer_peer_id: &self.redeemer,
            secret: &self.secret,
        }
    }
}

/// Eine Anfrage an den Hello-Endpunkt eines eigenen Codes per Name.
pub(super) struct Redemption<'a> {
    pub(super) code: &'a CodeRecord,
    pub(super) hello_id: &'a PeerId,
    /// Die authentifizierte ID der Verbindung.
    pub(super) redeemer: &'a PeerId,
    pub(super) secret_hex: &'a str,
}

/// Der Absender prüft den Einlöser bei Mojang und weist sich selbst aus (BYNAME 7.4, Code-Besitzer). `None` heißt
/// Schweigen; sonst das eigene Profil mit dem bestätigten Konto oder eine Ablehnung.
pub(super) async fn answer_redemption(
    core: &Arc<Core>,
    redemption: &Redemption<'_>,
    profile: WireProfile,
) -> Option<Result<WireProfile, HelloRefusal>> {
    let deps = core.directory.get()?;
    let inputs = ProofInputs::new(
        redemption.hello_id,
        redemption.redeemer,
        redemption.secret_hex,
    )?;
    let redeemer_id = redemption.redeemer.to_string();
    let newly_confirmed = match redemption.code.used_by.as_deref() {
        Some(user) if user != redeemer_id => return Some(Err(HelloRefusal::CodeUsed)),
        // Eine Wiederholung: der Einlöser ist schon geprüft und gespeichert.
        Some(_) => None,
        None => match confirm_redeemer(core, deps, redemption, &inputs, &profile).await? {
            Ok(account) => Some(account),
            Err(refusal) => return Some(Err(refusal)),
        },
    };
    let own = join_mojang(core, deps, &inputs.proof().server_id_owner()).await?;
    if let Some(account) = newly_confirmed {
        befriend_redeemer(core, redemption.code, &redeemer_id, account).ok()?;
    }
    Some(Ok(WireProfile {
        display_name: own.name.clone(),
        mc_name: Some(own.name),
        mc_uuid: Some(own.uuid),
    }))
}

/// Mojang muss bestätigen, dass der Einlöser genau das Konto ist, an das der Brief ging; sonst Schweigen.
async fn confirm_redeemer(
    core: &Core,
    deps: &DirectoryDeps,
    redemption: &Redemption<'_>,
    inputs: &ProofInputs,
    profile: &WireProfile,
) -> Option<Result<MojangProfile, HelloRefusal>> {
    if core
        .stores
        .friends
        .get(&redemption.redeemer.to_string())
        .is_ok()
    {
        return Some(Err(HelloRefusal::AlreadyFriends));
    }
    let name = sanitize::mc_name(profile.mc_name.as_deref())?;
    let account = deps
        .mojang
        .has_joined(&name, &inputs.proof().server_id_redeemer())
        .await
        .ok()??;
    if redemption.code.name_request_to.as_deref() != Some(account.uuid.as_str()) {
        return None;
    }
    if !requests::has_room_for_redeemer(core, &redemption.code.id) {
        return Some(Err(HelloRefusal::Full));
    }
    Some(Ok(account))
}

/// Der Einlöser wird unbestätigter Freund mit dem Konto, das Mojang bestätigt hat; die eigene Anfrage ist erledigt.
fn befriend_redeemer(
    core: &Core,
    code: &CodeRecord,
    redeemer_id: &str,
    account: MojangProfile,
) -> AppResult<()> {
    core.stores.friends.upsert(FriendRecord {
        id: redeemer_id.to_owned(),
        display_name: account.name.clone(),
        alias: None,
        mc_name: Some(account.name),
        mc_uuid: Some(account.uuid),
        home_relay: None,
        added_at: now_secs(),
        last_seen: None,
        confirmed: false,
        removed_by_peer: false,
        notice: None,
    })?;
    core.stores
        .codes
        .modify(&code.id, |code| code.used_by = Some(redeemer_id.to_owned()))?;
    let _ = core.stores.requests.remove(&code.id);
    remember_redemption(core, redeemer_id);
    core.emit(FriendsEvent::Changed);
    Ok(())
}

pub(super) fn remember_redemption(core: &Core, redeemer_id: &str) {
    let mut redeemed = lock(&core.by_name.redeemed);
    redeemed.retain(|_, at| at.elapsed() < REDEMPTION_GRACE);
    redeemed.insert(redeemer_id.to_owned(), Instant::now());
}

/// Ob ein `NOT_FRIEND` dieses Freundes nur heißt, dass er uns nach seiner Einlösung noch nicht eingetragen hat.
pub(super) fn in_redemption_grace(core: &Core, friend: &FriendRecord) -> bool {
    let redeemed_at = lock(&core.by_name.redeemed).get(&friend.id).copied();
    !friend.confirmed && redeemed_at.is_some_and(|at| at.elapsed() < REDEMPTION_GRACE)
}

/// Der Empfänger löst den Code im Brief ein und prüft dabei den Absender bei Mojang (BYNAME 7.4, Einlöser). Nur ein
/// bestätigter Absender gilt als angekommen; er ist eingetragen, bevor die Verbindung schließt.
pub(super) async fn redeem(
    core: &Arc<Core>,
    runtime: &Runtime,
    request: &RequestRecord,
    hello_id: PeerId,
    secret_hex: &str,
) -> Delivery {
    let Some(deps) = core.directory.get() else {
        return Delivery::Failed;
    };
    let Some(inputs) = ProofInputs::new(&hello_id, &runtime.main.id(), secret_hex) else {
        return Delivery::Failed;
    };
    let Some(account) = join_mojang(core, deps, &inputs.proof().server_id_redeemer()).await else {
        return Delivery::Failed;
    };
    let profile = WireProfile {
        display_name: account.name.clone(),
        mc_name: Some(account.name),
        mc_uuid: Some(account.uuid),
    };
    let answered = hello::request_answer(
        &runtime.main,
        hello_id,
        secret_hex,
        profile,
        HELLO_NAME_WAIT,
    )
    .await;
    let confirmed = match &answered.delivery {
        Delivery::Received { peer, profile } => {
            confirm_sender(core, deps, request, peer, profile, &inputs).await
        }
        Delivery::Refused(_) | Delivery::Failed => true,
    };
    let delivery = answered.close();
    if confirmed {
        delivery
    } else {
        Delivery::Failed
    }
}

/// Die Antwort muss vom gestempelten Absender kommen, und Mojang muss sein Konto bestätigen; dann wird sie eingetragen.
async fn confirm_sender(
    core: &Core,
    deps: &DirectoryDeps,
    request: &RequestRecord,
    peer: &PeerId,
    profile: &WireProfile,
    inputs: &ProofInputs,
) -> bool {
    let is_stamped_sender = request.peer_id.as_deref() == Some(peer.to_string().as_str());
    if !is_stamped_sender {
        return false;
    }
    let Some(name) = profile.mc_name.as_deref() else {
        return false;
    };
    let joined = deps
        .mojang
        .has_joined(name, &inputs.proof().server_id_owner())
        .await;
    let Ok(Some(sender)) = joined.inspect_err(|err| tracing::debug!(?err, "Mojang nicht erreicht"))
    else {
        return false;
    };
    if request.mc_uuid.as_deref() != Some(sender.uuid.as_str()) {
        return false;
    }
    let verified = WireProfile {
        display_name: sender.name.clone(),
        mc_name: Some(sender.name),
        mc_uuid: Some(sender.uuid),
    };
    requests::mark_received(core, &request.id, peer, verified);
    true
}

/// Mojang `join` mit dem eigenen Konto; eine Mehrspieler-Sperre wird als Zustand des Verzeichnisses sichtbar.
async fn join_mojang(core: &Core, deps: &DirectoryDeps, server_id: &str) -> Option<McIdentity> {
    let account = deps.tokens.minecraft_session().await.ok()?;
    match deps.mojang.join(&account, server_id).await {
        Ok(()) => Some(account),
        Err(MojangError::NotAllowed) => {
            set_health(core, DirectoryState::NotAllowed);
            None
        }
        Err(err) => {
            tracing::debug!(?err, "Mojang-Nachweis nicht möglich");
            None
        }
    }
}

fn local_error(message: &str) -> AppError {
    std::io::Error::other(message.to_owned()).into()
}

fn identity_lost() -> AppError {
    AppError::invalid(coded!("errors.friends.identityLost"))
}

fn directory_unavailable() -> AppError {
    AppError::invalid(coded!("errors.friends.directoryUnavailable"))
}
