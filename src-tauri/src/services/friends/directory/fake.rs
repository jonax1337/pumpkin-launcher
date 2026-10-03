//! Doppel für die Tests: [`FakeDirectory`] verhält sich wie der Worker in `directory/` (alle Regeln von BYNAME 4, im
//! Speicher), [`FakeMojang`] wie Mojangs Session-Server und Namenssuche. Beide sind geteilt zwischen den Diensten
//! eines Tests; die Fälle ihrer Tests spiegeln `directory/test.mjs`, damit Worker und Doppel dieselben Regeln haben.
use std::collections::{HashMap, HashSet};
use std::future::ready;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use data_encoding::HEXLOWER;
use futures::future::BoxFuture;
use futures::FutureExt;

use super::api::DirectoryApi;
use super::mojang::{MojangError, MojangProfile, MojangSessions};
use super::proof::{auth_parts, letter_parts, LetterFields, AUTH_DOMAIN, LETTER_DOMAIN};
use super::wire::{Challenge, DirectorySession, InboxLetter, LetterFrom, OutgoingLetter, SentLetter, SessionRequest};
use super::{DirectoryError, McIdentity};
use crate::services::friends::contract::REQUEST_TTL_SECS;
use crate::services::friends::identity::{self, Identity};
use crate::services::friends::sanitize;
use crate::services::friends::service::now_secs;

const DAY: u64 = 86_400;
const CHALLENGE_TTL: u64 = 120;
const TOKEN_TTL: u64 = 6 * 3600;
const CLOCK_SKEW: u64 = 600;
const DAILY_LIMIT: usize = 10;
const MAX_PENDING: usize = 20;
const MAX_BLOCKS: usize = 1000;
const INBOX_PAGE: usize = 20;
const DISPLAY_NAME_MAX_UNITS: usize = 64;
/// `sends.to_uuid` für einen Versuch bei jemandem ohne Eintrag: kostet das Tageskontingent, startet keine Wartezeit.
const PROBE: &str = "-";

fn random_hex(len: usize) -> String {
    let mut text = String::new();
    while text.len() < len {
        text.push_str(&uuid::Uuid::new_v4().simple().to_string());
    }
    text.truncate(len);
    text
}

fn is_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2 && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Mojangs Session-Server und Namenssuche mit den Konten, die ein Test anlegt.
#[derive(Default)]
pub struct FakeMojang {
    state: Mutex<MojangState>,
    unreachable: AtomicBool,
}

#[derive(Default)]
struct MojangState {
    accounts: Vec<McIdentity>,
    /// (UUID, serverId) in der Reihenfolge der Aufrufe.
    joins: Vec<(String, String)>,
    refusals: HashMap<String, MojangError>,
}

impl FakeMojang {
    pub fn add_account(&self, name: &str) -> McIdentity {
        let account = McIdentity { uuid: random_hex(32), name: name.to_owned(), access_token: random_hex(64) };
        self.state().accounts.push(account.clone());
        account
    }

    /// Ab jetzt lehnt `join` dieses Konto mit `error` ab; `None` hebt das auf.
    pub fn refuse_joins(&self, uuid: &str, error: Option<MojangError>) {
        let mut state = self.state();
        match error {
            Some(error) => state.refusals.insert(uuid.to_owned(), error),
            None => state.refusals.remove(uuid),
        };
    }

    pub fn set_unreachable(&self, unreachable: bool) {
        self.unreachable.store(unreachable, Ordering::SeqCst);
    }

    /// Jeder erfolgreiche `join` als (UUID, serverId).
    pub fn joins(&self) -> Vec<(String, String)> {
        self.state().joins.clone()
    }

    fn state(&self) -> MutexGuard<'_, MojangState> {
        self.state.lock().unwrap()
    }

    fn ensure_reachable(&self) -> Result<(), MojangError> {
        if self.unreachable.load(Ordering::SeqCst) { Err(MojangError::Unreachable) } else { Ok(()) }
    }

    fn join_now(&self, session: &McIdentity, server_id: &str) -> Result<(), MojangError> {
        self.ensure_reachable()?;
        let mut state = self.state();
        if let Some(error) = state.refusals.get(&session.uuid) {
            return Err(error.clone());
        }
        let known = state.accounts.iter().any(|account| account.uuid == session.uuid && account.access_token == session.access_token);
        if !known {
            return Err(MojangError::InvalidSession);
        }
        state.joins.push((session.uuid.clone(), server_id.to_owned()));
        Ok(())
    }

    fn has_joined_now(&self, name: &str, server_id: &str) -> Result<Option<MojangProfile>, MojangError> {
        self.ensure_reachable()?;
        let state = self.state();
        let joined = state.joins.iter().filter(|(_, joined_server)| joined_server == server_id).map(|(uuid, _)| uuid);
        let profile = joined
            .filter_map(|uuid| state.accounts.iter().find(|account| &account.uuid == uuid))
            .find(|account| account.name.eq_ignore_ascii_case(name))
            .map(profile_of);
        Ok(profile)
    }

    fn lookup_now(&self, name: &str) -> Result<Option<MojangProfile>, MojangError> {
        self.ensure_reachable()?;
        Ok(self.state().accounts.iter().find(|account| account.name.eq_ignore_ascii_case(name)).map(profile_of))
    }
}

fn profile_of(account: &McIdentity) -> MojangProfile {
    MojangProfile { uuid: account.uuid.clone(), name: account.name.clone() }
}

impl MojangSessions for FakeMojang {
    fn join<'a>(&'a self, session: &'a McIdentity, server_id: &'a str) -> BoxFuture<'a, Result<(), MojangError>> {
        ready(self.join_now(session, server_id)).boxed()
    }

    fn has_joined<'a>(&'a self, name: &'a str, server_id: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>> {
        ready(self.has_joined_now(name, server_id)).boxed()
    }

    fn lookup_name<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>> {
        ready(self.lookup_now(name)).boxed()
    }
}

struct IssuedChallenge {
    peer_id: String,
    server_id: String,
    expires_at: u64,
}

#[derive(Clone)]
struct Claims {
    uuid: String,
    name: String,
    peer_id: String,
    expires_at: u64,
}

struct SendLogEntry {
    from: String,
    to: String,
    at: u64,
}

#[derive(Default)]
struct DirectoryState {
    challenges: HashMap<String, IssuedChallenge>,
    tokens: HashMap<String, Claims>,
    /// UUID → letzte Auffrischung.
    users: HashMap<String, u64>,
    letters: Vec<InboxLetter>,
    /// (Besitzer, Gesperrter).
    blocks: HashSet<(String, String)>,
    sends: Vec<SendLogEntry>,
    sessions_opened: usize,
    inbox_reads: usize,
}

/// Der Worker im Speicher. Die Uhr ist die echte, vorgestellt um [`FakeDirectory::advance`].
pub struct FakeDirectory {
    mojang: Arc<FakeMojang>,
    state: Mutex<DirectoryState>,
    clock_offset: AtomicU64,
    unreachable: AtomicBool,
}

impl FakeDirectory {
    pub fn new(mojang: Arc<FakeMojang>) -> Self {
        Self { mojang, state: Mutex::default(), clock_offset: AtomicU64::new(0), unreachable: AtomicBool::new(false) }
    }

    pub fn now(&self) -> u64 {
        now_secs() + self.clock_offset.load(Ordering::SeqCst)
    }

    pub fn advance(&self, secs: u64) {
        self.clock_offset.fetch_add(secs, Ordering::SeqCst);
    }

    /// Solange gesetzt, antwortet jeder Aufruf mit [`DirectoryError::Unreachable`].
    pub fn set_unreachable(&self, unreachable: bool) {
        self.unreachable.store(unreachable, Ordering::SeqCst);
    }

    /// Alle ausgegebenen Tokens sind danach ungültig (der Worker hat den `TOKEN_KEY` gewechselt).
    pub fn revoke_tokens(&self) {
        self.state().tokens.clear();
    }

    /// Wie oft ein Konto sich angemeldet hat.
    pub fn sessions_opened(&self) -> usize {
        self.state().sessions_opened
    }

    pub fn inbox_reads(&self) -> usize {
        self.state().inbox_reads
    }

    pub fn is_registered(&self, uuid: &str) -> bool {
        self.state().users.contains_key(uuid)
    }

    pub fn is_blocked(&self, owner: &str, blocked: &str) -> bool {
        self.state().blocks.contains(&(owner.to_owned(), blocked.to_owned()))
    }

    /// Was ein kompromittierter Worker kann: Briefe mit beliebigem Stempel ins Postfach legen (ohne Prüfung).
    pub fn inject_letter(&self, letter: InboxLetter) {
        self.state().letters.push(letter);
    }

    /// Was ein kompromittierter Worker sieht: jeder Brief an `uuid` samt Geheimnis, auch abgelaufene.
    pub fn stored_letters_to(&self, uuid: &str) -> Vec<InboxLetter> {
        self.state().letters.iter().filter(|letter| letter.to == uuid).cloned().collect()
    }

    fn state(&self) -> MutexGuard<'_, DirectoryState> {
        self.state.lock().unwrap()
    }

    fn ensure_reachable(&self) -> Result<(), DirectoryError> {
        if self.unreachable.load(Ordering::SeqCst) { Err(DirectoryError::Unreachable) } else { Ok(()) }
    }

    fn claims_of(&self, token: &str) -> Result<Claims, DirectoryError> {
        self.ensure_reachable()?;
        let claims = self.state().tokens.get(token).cloned();
        claims.filter(|claims| claims.expires_at > self.now()).ok_or(DirectoryError::Unauthorized)
    }

    fn issue_challenge(&self, peer_id: &str) -> Result<Challenge, DirectoryError> {
        self.ensure_reachable()?;
        if !is_hex(peer_id, 32) {
            return Err(DirectoryError::Invalid("invalid"));
        }
        let expires_at = self.now() + CHALLENGE_TTL;
        let challenge = format!("challenge-{}", random_hex(32));
        let server_id = random_hex(40);
        let issued = IssuedChallenge { peer_id: peer_id.to_owned(), server_id: server_id.clone(), expires_at };
        self.state().challenges.insert(challenge.clone(), issued);
        Ok(Challenge { challenge, server_id, expires_at })
    }

    /// Prüft Form, Herausforderung und Signatur; liefert die `serverId` und die Peer-ID, an die die Sitzung gebunden wird.
    fn verified_challenge(&self, request: &SessionRequest) -> Result<(String, String), DirectoryError> {
        self.ensure_reachable()?;
        if sanitize::mc_name(Some(&request.name)).is_none() || !is_hex(&request.signature, 64) {
            return Err(DirectoryError::Invalid("invalid"));
        }
        let state = self.state();
        let issued = state.challenges.get(&request.challenge).ok_or(DirectoryError::Invalid("invalid"))?;
        if issued.expires_at <= self.now() {
            return Err(DirectoryError::Invalid("challengeExpired"));
        }
        let parts = auth_parts(&issued.server_id, &issued.peer_id).ok_or(DirectoryError::Invalid("invalid"))?;
        let signature = decode_signature(&request.signature).ok_or(DirectoryError::Invalid("invalid"))?;
        if !identity::verify(&issued.peer_id, AUTH_DOMAIN, &parts.as_slices(), &signature) {
            return Err(DirectoryError::Invalid("badSignature"));
        }
        Ok((issued.server_id.clone(), issued.peer_id.clone()))
    }

    async fn open_session(&self, request: &SessionRequest) -> Result<DirectorySession, DirectoryError> {
        let (server_id, peer_id) = self.verified_challenge(request)?;
        let profile = match self.mojang.has_joined(&request.name, &server_id).await {
            Ok(Some(profile)) => profile,
            Ok(None) => return Err(DirectoryError::NotJoined),
            Err(_) => return Err(DirectoryError::MojangUnavailable),
        };
        let expires_at = self.now() + TOKEN_TTL;
        let token = format!("v1.{}", random_hex(48));
        let claims = Claims { uuid: profile.uuid.clone(), name: profile.name.clone(), peer_id, expires_at };
        let mut state = self.state();
        state.tokens.insert(token.clone(), claims);
        state.sessions_opened += 1;
        Ok(DirectorySession { token, expires_at, uuid: profile.uuid, name: profile.name })
    }

    fn register_now(&self, token: &str) -> Result<(), DirectoryError> {
        let claims = self.claims_of(token)?;
        let now = self.now();
        self.state().users.insert(claims.uuid, now);
        Ok(())
    }

    fn unregister_now(&self, token: &str) -> Result<(), DirectoryError> {
        let claims = self.claims_of(token)?;
        let mut state = self.state();
        state.users.remove(&claims.uuid);
        state.letters.retain(|letter| letter.to != claims.uuid);
        state.blocks.retain(|(owner, _)| owner != &claims.uuid);
        Ok(())
    }

    /// O1. Die Reihenfolge der Prüfungen ist die des Workers (`directory/src/letters.js`).
    fn send_now(&self, token: &str, letter: &OutgoingLetter) -> Result<SentLetter, DirectoryError> {
        let claims = self.claims_of(token)?;
        let now = self.now();
        validate_outgoing(letter, &claims, now)?;
        let expires_at = letter.created_at + REQUEST_TTL_SECS;
        let mut state = self.state();
        let sent_today = state.sends.iter().filter(|send| send.from == claims.uuid && send.at + DAY > now).count();
        if sent_today >= DAILY_LIMIT {
            return Err(DirectoryError::SendQuota);
        }
        let in_cooldown = state.sends.iter().any(|send| send.from == claims.uuid && send.to == letter.to && send.at + 7 * DAY > now);
        if in_cooldown {
            return Err(DirectoryError::PairCooldown);
        }
        if !state.users.contains_key(&letter.to) {
            state.sends.push(SendLogEntry { from: claims.uuid, to: PROBE.to_owned(), at: now });
            return Err(DirectoryError::NotFindable);
        }
        if state.blocks.contains(&(letter.to.clone(), claims.uuid.clone())) {
            state.letters.retain(|stored| !(stored.to == letter.to && stored.from.uuid == claims.uuid));
            state.sends.push(SendLogEntry { from: claims.uuid, to: letter.to.clone(), at: now });
            return Ok(SentLetter { id: uuid::Uuid::new_v4().to_string(), expires_at });
        }
        let pending = state.letters.iter().filter(|stored| stored.to == letter.to && stored.from.uuid != claims.uuid && stored.expires_at > now);
        if pending.count() >= MAX_PENDING {
            return Err(DirectoryError::RecipientFull);
        }
        let id = uuid::Uuid::new_v4().to_string();
        state.letters.retain(|stored| !(stored.to == letter.to && stored.from.uuid == claims.uuid));
        state.sends.push(SendLogEntry { from: claims.uuid.clone(), to: letter.to.clone(), at: now });
        state.letters.push(stamped(&id, letter, &claims, expires_at));
        Ok(SentLetter { id, expires_at })
    }

    fn retract_now(&self, token: &str, id: &str) -> Result<(), DirectoryError> {
        let claims = self.claims_of(token)?;
        self.state().letters.retain(|letter| !(letter.id == id && letter.from.uuid == claims.uuid));
        Ok(())
    }

    fn inbox_now(&self, token: &str) -> Result<Vec<InboxLetter>, DirectoryError> {
        let claims = self.claims_of(token)?;
        let now = self.now();
        let mut state = self.state();
        state.inbox_reads += 1;
        if !state.users.contains_key(&claims.uuid) {
            return Err(DirectoryError::NotRegistered);
        }
        let mut letters: Vec<InboxLetter> = state.letters.iter().filter(|letter| letter.to == claims.uuid && letter.expires_at > now).cloned().collect();
        letters.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        letters.truncate(INBOX_PAGE);
        Ok(letters)
    }

    fn delete_now(&self, token: &str, id: &str) -> Result<(), DirectoryError> {
        let claims = self.claims_of(token)?;
        self.state().letters.retain(|letter| !(letter.id == id && letter.to == claims.uuid));
        Ok(())
    }

    fn block_now(&self, token: &str, uuid: &str) -> Result<(), DirectoryError> {
        let claims = self.claims_of(token)?;
        let mut state = self.state();
        if !state.users.contains_key(&claims.uuid) {
            return Err(DirectoryError::NotRegistered);
        }
        let entry = (claims.uuid.clone(), uuid.to_owned());
        let owned = state.blocks.iter().filter(|(owner, _)| owner == &claims.uuid).count();
        if !state.blocks.contains(&entry) && owned >= MAX_BLOCKS {
            return Err(DirectoryError::Invalid("blockListFull"));
        }
        state.blocks.insert(entry);
        state.letters.retain(|letter| !(letter.to == claims.uuid && letter.from.uuid == uuid));
        Ok(())
    }

    fn unblock_now(&self, token: &str, uuid: &str) -> Result<(), DirectoryError> {
        let claims = self.claims_of(token)?;
        self.state().blocks.remove(&(claims.uuid, uuid.to_owned()));
        Ok(())
    }
}

fn decode_signature(hex: &str) -> Option<[u8; 64]> {
    HEXLOWER.decode(hex.as_bytes()).ok()?.try_into().ok()
}

fn is_valid_display_name(name: &str) -> bool {
    (1..=DISPLAY_NAME_MAX_UNITS).contains(&name.encode_utf16().count()) && !name.chars().any(char::is_control)
}

/// Form, Selbstzustellung, Uhr und Signatur des Briefs (die ersten Schritte von O1).
fn validate_outgoing(letter: &OutgoingLetter, claims: &Claims, now: u64) -> Result<(), DirectoryError> {
    let well_formed = is_hex(&letter.to, 16)
        && is_hex(&letter.nonce, 16)
        && is_hex(&letter.hello_id, 32)
        && is_hex(&letter.secret, 9)
        && is_hex(&letter.signature, 64)
        && is_valid_display_name(&letter.display_name);
    if !well_formed {
        return Err(DirectoryError::Invalid("invalid"));
    }
    if letter.to == claims.uuid {
        return Err(DirectoryError::Invalid("self"));
    }
    if letter.created_at.abs_diff(now) > CLOCK_SKEW {
        return Err(DirectoryError::Invalid("clock"));
    }
    let signed = LetterFields {
        to: &letter.to,
        from_uuid: &claims.uuid,
        nonce: &letter.nonce,
        hello_id: &letter.hello_id,
        relay_index: letter.relay_index,
        secret: &letter.secret,
        created_at: letter.created_at,
        display_name: &letter.display_name,
    };
    let parts = letter_parts(&signed).ok_or(DirectoryError::Invalid("invalid"))?;
    let signature = decode_signature(&letter.signature).ok_or(DirectoryError::Invalid("invalid"))?;
    if identity::verify(&claims.peer_id, LETTER_DOMAIN, &parts.as_slices(), &signature) {
        Ok(())
    } else {
        Err(DirectoryError::Invalid("badSignature"))
    }
}

fn stamped(id: &str, letter: &OutgoingLetter, claims: &Claims, expires_at: u64) -> InboxLetter {
    InboxLetter {
        id: id.to_owned(),
        from: LetterFrom { uuid: claims.uuid.clone(), name: claims.name.clone(), peer_id: claims.peer_id.clone() },
        to: letter.to.clone(),
        nonce: letter.nonce.clone(),
        hello_id: letter.hello_id.clone(),
        relay_index: letter.relay_index,
        secret: letter.secret.clone(),
        display_name: letter.display_name.clone(),
        created_at: letter.created_at,
        expires_at,
        signature: letter.signature.clone(),
    }
}

impl DirectoryApi for FakeDirectory {
    fn challenge<'a>(&'a self, peer_id: &'a str) -> BoxFuture<'a, Result<Challenge, DirectoryError>> {
        ready(self.issue_challenge(peer_id)).boxed()
    }

    fn session<'a>(&'a self, request: &'a SessionRequest) -> BoxFuture<'a, Result<DirectorySession, DirectoryError>> {
        self.open_session(request).boxed()
    }

    fn register<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        ready(self.register_now(token)).boxed()
    }

    fn unregister<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        ready(self.unregister_now(token)).boxed()
    }

    fn send<'a>(&'a self, token: &'a str, letter: &'a OutgoingLetter) -> BoxFuture<'a, Result<SentLetter, DirectoryError>> {
        ready(self.send_now(token, letter)).boxed()
    }

    fn retract<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        ready(self.retract_now(token, id)).boxed()
    }

    fn inbox<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<Vec<InboxLetter>, DirectoryError>> {
        ready(self.inbox_now(token)).boxed()
    }

    fn delete<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        ready(self.delete_now(token, id)).boxed()
    }

    fn block<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        ready(self.block_now(token, uuid)).boxed()
    }

    fn unblock<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>> {
        ready(self.unblock_now(token, uuid)).boxed()
    }
}

/// Ein Brief an `to` mit festen Feldern und leerer Signatur; `sign_letter` setzt sie.
pub fn draft_letter(to: &str, created_at: u64) -> OutgoingLetter {
    OutgoingLetter {
        to: to.to_owned(),
        nonce: "000102030405060708090a0b0c0d0e0f".to_owned(),
        hello_id: "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f".to_owned(),
        relay_index: 0,
        secret: "a0a1a2a3a4a5a6a7a8".to_owned(),
        display_name: "Alex".to_owned(),
        created_at,
        signature: String::new(),
    }
}

/// Signiert den Brief für einen Absender mit dieser UUID und diesem Schlüssel (nach jeder Änderung neu nötig).
pub fn sign_letter(identity: &Identity, from_uuid: &str, letter: OutgoingLetter) -> OutgoingLetter {
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
    let parts = letter_parts(&fields).expect("Felder eines Entwurfs sind Hex");
    let signature = HEXLOWER.encode(&identity.sign(LETTER_DOMAIN, &parts.as_slices()));
    OutgoingLetter { signature, ..letter }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID_UNKNOWN: &str = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";

    struct World {
        mojang: Arc<FakeMojang>,
        directory: Arc<FakeDirectory>,
    }

    struct Account {
        identity: Identity,
        mc: McIdentity,
        token: String,
    }

    impl Account {
        fn uuid(&self) -> &str {
            &self.mc.uuid
        }
    }

    impl World {
        fn new() -> Self {
            let mojang = Arc::new(FakeMojang::default());
            Self { directory: Arc::new(FakeDirectory::new(mojang.clone())), mojang }
        }

        /// Ein Konto mit Anmeldung am Verzeichnis, aber noch nicht auffindbar.
        async fn account(&self, name: &str) -> Account {
            let identity = Identity::generate();
            let mc = self.mojang.add_account(name);
            let session = self.handshake(&identity, &mc, &mc.name).await.unwrap();
            Account { identity, mc, token: session.token }
        }

        async fn findable(&self, name: &str) -> Account {
            let account = self.account(name).await;
            self.directory.register(&account.token).await.unwrap();
            account
        }

        /// Der Ablauf von BYNAME 3.1: Herausforderung, Mojang `join`, Signatur, Sitzung.
        async fn handshake(&self, identity: &Identity, mc: &McIdentity, name: &str) -> Result<DirectorySession, DirectoryError> {
            let challenge = self.directory.challenge(&identity.peer_id()).await?;
            self.mojang.join(mc, &challenge.server_id).await.unwrap();
            let request = self.session_request(identity, name, &challenge);
            self.directory.session(&request).await
        }

        fn session_request(&self, identity: &Identity, name: &str, challenge: &Challenge) -> SessionRequest {
            let parts = auth_parts(&challenge.server_id, &identity.peer_id()).unwrap();
            let signature = HEXLOWER.encode(&identity.sign(AUTH_DOMAIN, &parts.as_slices()));
            SessionRequest { challenge: challenge.challenge.clone(), name: name.to_owned(), signature }
        }

        fn letter(&self, from: &Account, to: &str) -> OutgoingLetter {
            sign_letter(&from.identity, from.uuid(), draft_letter(to, self.directory.now()))
        }

        /// Ein frisches Token, denn die Tests stellen die Uhr um Tage vor.
        async fn token_of(&self, account: &Account) -> String {
            self.handshake(&account.identity, &account.mc, &account.mc.name).await.unwrap().token
        }

        async fn send(&self, from: &Account, to: &str) -> Result<SentLetter, DirectoryError> {
            self.directory.send(&self.token_of(from).await, &self.letter(from, to)).await
        }

        async fn inbox(&self, of: &Account) -> Vec<InboxLetter> {
            self.directory.inbox(&self.token_of(of).await).await.unwrap()
        }
    }

    fn rejection(result: Result<SentLetter, DirectoryError>) -> DirectoryError {
        result.expect_err("der Brief hätte abgelehnt werden müssen")
    }

    // Anmeldung (Worker: challenges, sessions, tokens)

    #[tokio::test]
    async fn a_handshake_yields_the_account_mojang_confirms() {
        let world = World::new();
        let mc = world.mojang.add_account("Steve");
        let identity = Identity::generate();
        let session = world.handshake(&identity, &mc, "steve").await.unwrap();
        assert_eq!((session.uuid.as_str(), session.name.as_str()), (mc.uuid.as_str(), "Steve"));
        assert_eq!(session.expires_at, world.directory.now() + TOKEN_TTL);
    }

    #[tokio::test]
    async fn a_challenge_expires_after_120_seconds() {
        let world = World::new();
        let mc = world.mojang.add_account("Alex");
        let identity = Identity::generate();
        let challenge = world.directory.challenge(&identity.peer_id()).await.unwrap();
        world.mojang.join(&mc, &challenge.server_id).await.unwrap();
        let request = world.session_request(&identity, "Alex", &challenge);
        world.directory.advance(CHALLENGE_TTL - 1);
        assert!(world.directory.session(&request).await.is_ok());
        world.directory.advance(1);
        assert_eq!(world.directory.session(&request).await.unwrap_err(), DirectoryError::Invalid("challengeExpired"));
    }

    #[tokio::test]
    async fn malformed_challenge_requests_are_invalid() {
        let world = World::new();
        for peer_id in ["", "ab", &"AB".repeat(32), &"zz".repeat(32)] {
            assert_eq!(world.directory.challenge(peer_id).await.unwrap_err(), DirectoryError::Invalid("invalid"), "{peer_id}");
        }
    }

    #[tokio::test]
    async fn a_session_needs_a_known_challenge_a_valid_name_and_a_well_formed_signature() {
        let world = World::new();
        let identity = Identity::generate();
        let challenge = world.directory.challenge(&identity.peer_id()).await.unwrap();
        let good = world.session_request(&identity, "Alex", &challenge);
        let unknown = SessionRequest { challenge: "nie-ausgegeben".into(), ..good.clone() };
        let bad_name = SessionRequest { name: "../etc".into(), ..good.clone() };
        let short_signature = SessionRequest { signature: "ab".into(), ..good };
        for request in [unknown, bad_name, short_signature] {
            assert_eq!(world.directory.session(&request).await.unwrap_err(), DirectoryError::Invalid("invalid"));
        }
    }

    #[tokio::test]
    async fn a_signature_of_another_key_or_for_another_server_id_is_a_bad_signature() {
        let world = World::new();
        let mc = world.mojang.add_account("Alex");
        let identity = Identity::generate();
        let challenge = world.directory.challenge(&identity.peer_id()).await.unwrap();
        world.mojang.join(&mc, &challenge.server_id).await.unwrap();
        let stranger = Identity::generate();
        let other_server_id = Challenge { server_id: random_hex(40), ..challenge.clone() };
        for forged in [world.session_request(&stranger, "Alex", &challenge), world.session_request(&identity, "Alex", &other_server_id)] {
            assert_eq!(world.directory.session(&forged).await.unwrap_err(), DirectoryError::Invalid("badSignature"));
        }
    }

    #[tokio::test]
    async fn without_a_join_or_under_another_name_the_account_is_not_joined() {
        let world = World::new();
        let never = world.mojang.add_account("Nie");
        let impostor = world.mojang.add_account("Mallory");
        world.mojang.add_account("Herobrine");
        let identity = Identity::generate();
        let skipped_join = world.directory.challenge(&identity.peer_id()).await.unwrap();
        let request = world.session_request(&identity, &never.name, &skipped_join);
        assert_eq!(world.directory.session(&request).await.unwrap_err(), DirectoryError::NotJoined);
        assert_eq!(world.handshake(&identity, &impostor, "Herobrine").await.unwrap_err(), DirectoryError::NotJoined);
    }

    #[tokio::test]
    async fn a_mojang_outage_makes_the_session_unavailable() {
        let world = World::new();
        let mc = world.mojang.add_account("Alex");
        let identity = Identity::generate();
        let challenge = world.directory.challenge(&identity.peer_id()).await.unwrap();
        world.mojang.join(&mc, &challenge.server_id).await.unwrap();
        world.mojang.set_unreachable(true);
        let request = world.session_request(&identity, "Alex", &challenge);
        assert_eq!(world.directory.session(&request).await.unwrap_err(), DirectoryError::MojangUnavailable);
    }

    #[tokio::test]
    async fn a_token_lives_six_hours_and_a_revoked_one_is_unauthorized() {
        let world = World::new();
        let alex = world.account("Alex").await;
        world.directory.advance(TOKEN_TTL - 1);
        assert!(world.directory.register(&alex.token).await.is_ok());
        world.directory.advance(1);
        assert_eq!(world.directory.register(&alex.token).await, Err(DirectoryError::Unauthorized));
        let fresh = world.account("Bob").await;
        world.directory.revoke_tokens();
        assert_eq!(world.directory.register(&fresh.token).await, Err(DirectoryError::Unauthorized));
        assert_eq!(world.directory.register("v1.erfunden").await, Err(DirectoryError::Unauthorized));
    }

    #[tokio::test]
    async fn a_directory_that_is_down_answers_unreachable_everywhere() {
        let world = World::new();
        let alex = world.account("Alex").await;
        world.directory.set_unreachable(true);
        let identity = Identity::generate();
        assert_eq!(world.directory.challenge(&identity.peer_id()).await.unwrap_err(), DirectoryError::Unreachable);
        assert_eq!(world.directory.register(&alex.token).await, Err(DirectoryError::Unreachable));
        assert_eq!(world.directory.inbox(&alex.token).await.unwrap_err(), DirectoryError::Unreachable);
    }

    // Verzeichnis und Postfach (Worker: registry, inboxIsPrivate, strangersCannotDelete, unregisterCascades)

    #[tokio::test]
    async fn registering_refreshes_and_unregistering_removes_inbox_and_blocks_but_not_what_i_sent() {
        let world = World::new();
        let alice = world.findable("Alice").await;
        let bob = world.findable("Bob").await;
        world.send(&alice, bob.uuid()).await.unwrap();
        world.directory.block(&bob.token, UUID_UNKNOWN).await.unwrap();
        let carol = world.findable("Carol").await;
        world.send(&bob, carol.uuid()).await.unwrap();

        world.directory.unregister(&bob.token).await.unwrap();

        assert!(!world.directory.is_registered(bob.uuid()));
        assert!(world.directory.stored_letters_to(bob.uuid()).is_empty());
        assert!(!world.directory.is_blocked(bob.uuid(), UUID_UNKNOWN));
        assert_eq!(world.directory.stored_letters_to(carol.uuid()).len(), 1);
        assert_eq!(world.directory.unregister(&bob.token).await, Ok(()));
    }

    #[tokio::test]
    async fn an_inbox_without_an_entry_is_not_registered() {
        let world = World::new();
        let alex = world.account("Alex").await;
        assert_eq!(world.directory.inbox(&alex.token).await.unwrap_err(), DirectoryError::NotRegistered);
        assert_eq!(world.directory.block(&alex.token, UUID_UNKNOWN).await, Err(DirectoryError::NotRegistered));
    }

    #[tokio::test]
    async fn everyone_sees_only_their_own_letters_oldest_first_with_the_stamp_from_the_token() {
        let world = World::new();
        let (bob, carol) = (world.findable("Bob").await, world.findable("Carol").await);
        let first = world.findable("Eins").await;
        let second = world.findable("Zwei").await;
        let third = world.findable("Drei").await;
        for (sender, created) in [(&third, 0), (&first, 1), (&second, 2)] {
            let letter = sign_letter(&sender.identity, sender.uuid(), draft_letter(bob.uuid(), world.directory.now() - 3 + created));
            world.directory.send(&sender.token, &letter).await.unwrap();
        }
        world.send(&first, carol.uuid()).await.unwrap();

        let bobs = world.inbox(&bob).await;
        assert_eq!(bobs.iter().map(|letter| letter.from.name.as_str()).collect::<Vec<_>>(), ["Drei", "Eins", "Zwei"]);
        assert_eq!(bobs[1].from, LetterFrom { uuid: first.uuid().into(), name: "Eins".into(), peer_id: first.identity.peer_id() });
        assert!(bobs.iter().all(|letter| letter.to == bob.uuid()));
        assert_eq!(world.inbox(&carol).await.len(), 1);
        assert!(world.inbox(&first).await.is_empty());
    }

    #[tokio::test]
    async fn the_inbox_shows_twenty_letters_and_no_expired_ones() {
        let world = World::new();
        let bob = world.findable("Bob").await;
        for index in 0..20 {
            let sender = world.account(&format!("Sender{index}")).await;
            world.send(&sender, bob.uuid()).await.unwrap();
        }
        assert_eq!(world.inbox(&bob).await.len(), 20);
        world.directory.advance(REQUEST_TTL_SECS);
        assert!(world.inbox(&bob).await.is_empty());
    }

    #[tokio::test]
    async fn only_the_sender_can_retract_and_only_the_recipient_can_answer() {
        let world = World::new();
        let (alice, bob, stranger) = (world.findable("Alice").await, world.findable("Bob").await, world.findable("Mallory").await);
        let id = world.send(&alice, bob.uuid()).await.unwrap().id;
        for token in [&stranger.token, &bob.token] {
            world.directory.retract(token, &id).await.unwrap();
        }
        for token in [&stranger.token, &alice.token] {
            world.directory.delete(token, &id).await.unwrap();
        }
        assert_eq!(world.directory.stored_letters_to(bob.uuid()).len(), 1);
        world.directory.retract(&alice.token, &id).await.unwrap();
        assert!(world.directory.stored_letters_to(bob.uuid()).is_empty());
        let second = world.send(&stranger, bob.uuid()).await.unwrap().id;
        world.directory.delete(&bob.token, &second).await.unwrap();
        assert!(world.directory.stored_letters_to(bob.uuid()).is_empty());
    }

    // O1: Prüfungen am Brief (Worker: letterValidation, letterChecks)

    #[tokio::test]
    async fn a_letter_to_myself_is_refused() {
        let world = World::new();
        let alex = world.findable("Alex").await;
        assert_eq!(rejection(world.send(&alex, alex.uuid()).await), DirectoryError::Invalid("self"));
    }

    #[tokio::test]
    async fn a_clock_more_than_600_seconds_off_is_refused_and_leaves_nothing() {
        let world = World::new();
        let (alex, bob) = (world.findable("Alex").await, world.findable("Bob").await);
        for created_at in [world.directory.now() - CLOCK_SKEW - 1, world.directory.now() + CLOCK_SKEW + 1] {
            let letter = sign_letter(&alex.identity, alex.uuid(), draft_letter(bob.uuid(), created_at));
            assert_eq!(rejection(world.directory.send(&alex.token, &letter).await), DirectoryError::Invalid("clock"));
        }
        assert!(world.directory.stored_letters_to(bob.uuid()).is_empty());
    }

    #[tokio::test]
    async fn a_clock_skew_of_exactly_600_seconds_is_tolerated_in_both_directions() {
        let world = World::new();
        let (alex, bob, carol) = (world.findable("Alex").await, world.findable("Bob").await, world.findable("Carol").await);
        for (to, created_at) in [(&bob, world.directory.now() + CLOCK_SKEW), (&carol, world.directory.now() - CLOCK_SKEW)] {
            let letter = sign_letter(&alex.identity, alex.uuid(), draft_letter(to.uuid(), created_at));
            assert!(world.directory.send(&alex.token, &letter).await.is_ok());
        }
    }

    #[tokio::test]
    async fn a_wrong_signature_is_refused_and_leaves_nothing() {
        let world = World::new();
        let (dave, bob, carol) = (world.findable("Dave").await, world.findable("Bob").await, world.findable("Carol").await);
        let now = world.directory.now();
        let forged = OutgoingLetter { signature: "00".repeat(64), ..draft_letter(bob.uuid(), now) };
        let for_stranger = sign_letter(&dave.identity, dave.uuid(), draft_letter(bob.uuid(), now));
        let redirected = OutgoingLetter { to: carol.uuid().to_owned(), ..for_stranger.clone() };
        let by_someone_else = sign_letter(&Identity::generate(), dave.uuid(), draft_letter(bob.uuid(), now));
        let as_someone_else = sign_letter(&dave.identity, bob.uuid(), draft_letter(carol.uuid(), now));
        for letter in [forged, redirected, by_someone_else, as_someone_else] {
            let outcome = world.directory.send(&dave.token, &letter).await;
            assert_eq!(rejection(outcome), DirectoryError::Invalid("badSignature"));
        }
        assert!(world.directory.stored_letters_to(bob.uuid()).is_empty());
        assert_eq!(world.send(&dave, bob.uuid()).await.map(|_| ()), Ok(()), "nichts wurde protokolliert");
    }

    #[tokio::test]
    async fn malformed_letters_are_invalid_and_not_logged() {
        let world = World::new();
        let (dave, bob) = (world.findable("Dave").await, world.findable("Bob").await);
        let base = draft_letter(bob.uuid(), world.directory.now());
        let bad = [
            OutgoingLetter { to: "ABC".into(), ..base.clone() },
            OutgoingLetter { to: bob.uuid().to_uppercase(), ..base.clone() },
            OutgoingLetter { nonce: "00".into(), ..base.clone() },
            OutgoingLetter { hello_id: "ab".repeat(31), ..base.clone() },
            OutgoingLetter { secret: "a0".repeat(8), ..base.clone() },
            OutgoingLetter { signature: "ab".repeat(63), ..base.clone() },
            OutgoingLetter { display_name: String::new(), ..base.clone() },
            OutgoingLetter { display_name: "Al\u{0007}ex".into(), ..base.clone() },
        ];
        for letter in bad {
            assert_eq!(rejection(world.directory.send(&dave.token, &letter).await), DirectoryError::Invalid("invalid"));
        }
        for _ in 0..DAILY_LIMIT {
            let stranger = world.account("Neu").await;
            world.directory.send(&stranger.token, &world.letter(&stranger, bob.uuid())).await.unwrap();
        }
        assert!(world.send(&dave, bob.uuid()).await.is_ok(), "fehlerhafte Briefe verbrauchen kein Tageskontingent");
    }

    #[tokio::test]
    async fn display_names_count_utf16_units() {
        let world = World::new();
        let (sender, other, bob) = (world.account("Eins").await, world.account("Zwei").await, world.findable("Bob").await);
        let emoji = |pairs: usize| "\u{1F383}".repeat(pairs);
        for (account, name, accepted) in [(&sender, emoji(32), true), (&other, emoji(33), false)] {
            let draft = OutgoingLetter { display_name: name, ..draft_letter(bob.uuid(), world.directory.now()) };
            let letter = sign_letter(&account.identity, account.uuid(), draft);
            assert_eq!(world.directory.send(&account.token, &letter).await.is_ok(), accepted);
        }
    }

    // O1: Quoten, Sperren, Auffindbarkeit (Worker: abuse)

    #[tokio::test]
    async fn a_delivered_letter_answers_with_an_id_and_the_expiry_fourteen_days_after_creation() {
        let world = World::new();
        let (alice, bob) = (world.account("Alice").await, world.findable("Bob").await);
        let letter = world.letter(&alice, bob.uuid());
        let sent = world.directory.send(&alice.token, &letter).await.unwrap();
        assert_eq!(sent.expires_at, letter.created_at + REQUEST_TTL_SECS);
        assert_eq!(world.inbox(&bob).await[0].id, sent.id);
    }

    #[tokio::test]
    async fn unregistered_and_unknown_recipients_are_the_same_not_findable() {
        let world = World::new();
        let (alice, bob) = (world.account("Alice").await, world.findable("Bob").await);
        world.directory.unregister(&bob.token).await.unwrap();
        assert_eq!(rejection(world.send(&alice, bob.uuid()).await), DirectoryError::NotFindable);
        assert_eq!(rejection(world.send(&alice, UUID_UNKNOWN).await), DirectoryError::NotFindable);
    }

    #[tokio::test]
    async fn a_blocked_sender_sees_a_delivery_but_nothing_is_stored() {
        let world = World::new();
        let (alice, bob) = (world.findable("Alice").await, world.findable("Bob").await);
        let delivered = world.send(&alice, bob.uuid()).await.unwrap();
        world.directory.advance(7 * DAY);
        world.directory.block(&world.token_of(&bob).await, alice.uuid()).await.unwrap();
        assert!(world.inbox(&bob).await.is_empty(), "Sperren löscht wartende Briefe");

        let blocked = world.send(&alice, bob.uuid()).await.unwrap();

        assert_ne!(blocked.id, delivered.id);
        assert_eq!(blocked.expires_at - REQUEST_TTL_SECS, world.directory.now());
        assert!(world.inbox(&bob).await.is_empty());
        assert_eq!(rejection(world.send(&alice, bob.uuid()).await), DirectoryError::PairCooldown, "die Sperre verrät sich nicht an der Wartezeit");
    }

    #[tokio::test]
    async fn a_block_removes_a_letter_that_is_already_stored_when_the_sender_writes_again() {
        let world = World::new();
        let (alice, bob) = (world.findable("Alice").await, world.findable("Bob").await);
        world.directory.block(&bob.token, alice.uuid()).await.unwrap();
        world.directory.inject_letter(stamped_for_test(&alice, bob.uuid(), world.directory.now()));
        world.send(&alice, bob.uuid()).await.unwrap();
        assert!(world.directory.stored_letters_to(bob.uuid()).iter().all(|letter| letter.from.uuid != alice.uuid()));
    }

    fn stamped_for_test(from: &Account, to: &str, created_at: u64) -> InboxLetter {
        let letter = sign_letter(&from.identity, from.uuid(), draft_letter(to, created_at));
        let claims = Claims { uuid: from.uuid().to_owned(), name: from.mc.name.clone(), peer_id: from.identity.peer_id(), expires_at: 0 };
        stamped("11111111-1111-4111-8111-111111111111", &letter, &claims, created_at + REQUEST_TTL_SECS)
    }

    #[tokio::test]
    async fn the_pair_cooldown_lasts_seven_days_even_after_a_retract_and_a_new_letter_replaces_the_old() {
        let world = World::new();
        let (alice, bob) = (world.findable("Alice").await, world.findable("Bob").await);
        let first = world.send(&alice, bob.uuid()).await.unwrap();
        world.directory.retract(&alice.token, &first.id).await.unwrap();
        assert_eq!(rejection(world.send(&alice, bob.uuid()).await), DirectoryError::PairCooldown);
        world.directory.advance(7 * DAY - 1);
        assert_eq!(rejection(world.send(&alice, bob.uuid()).await), DirectoryError::PairCooldown);
        world.directory.advance(1);
        let second = world.send(&alice, bob.uuid()).await.unwrap();
        let letters = world.inbox(&bob).await;
        assert_eq!(letters.iter().map(|letter| &letter.id).collect::<Vec<_>>(), [&second.id]);
    }

    #[tokio::test]
    async fn the_eleventh_letter_in_24_hours_hits_the_quota_before_findability_is_checked() {
        let world = World::new();
        let alice = world.findable("Alice").await;
        for index in 0..DAILY_LIMIT {
            let recipient = world.findable(&format!("Empfaenger{index}")).await;
            world.send(&alice, recipient.uuid()).await.unwrap();
        }
        let eleventh = world.findable("Elfter").await;
        assert_eq!(rejection(world.send(&alice, eleventh.uuid()).await), DirectoryError::SendQuota);
        assert_eq!(rejection(world.send(&alice, UUID_UNKNOWN).await), DirectoryError::SendQuota);
        world.directory.advance(DAY);
        assert!(world.send(&alice, eleventh.uuid()).await.is_ok());
    }

    #[tokio::test]
    async fn probing_unknown_recipients_costs_the_quota_but_starts_no_cooldown() {
        let world = World::new();
        let (dave, alice) = (world.account("Dave").await, world.account("Alice").await);
        let later_findable = "efefefefefefefefefefefefefefefef";
        for index in 0..DAILY_LIMIT {
            let unknown = format!("{index:032x}");
            assert_eq!(rejection(world.send(&alice, &unknown).await), DirectoryError::NotFindable);
        }
        assert_eq!(rejection(world.send(&alice, later_findable).await), DirectoryError::SendQuota);
        assert_eq!(rejection(world.send(&dave, later_findable).await), DirectoryError::NotFindable);
        let bob = world.findable("Bob").await;
        assert!(world.send(&dave, bob.uuid()).await.is_ok(), "ein Fehlversuch bei einem anderen startet keine Wartezeit");
    }

    #[tokio::test]
    async fn the_twenty_first_pending_letter_is_refused_but_a_resend_replaces_its_own() {
        let world = World::new();
        let bob = world.findable("Bob").await;
        let mut senders = Vec::new();
        for index in 0..=MAX_PENDING {
            senders.push(world.account(&format!("Absender{index}")).await);
        }
        for sender in &senders[..MAX_PENDING] {
            world.send(sender, bob.uuid()).await.unwrap();
        }
        let overflow = &senders[MAX_PENDING];
        assert_eq!(rejection(world.send(overflow, bob.uuid()).await), DirectoryError::RecipientFull);
        world.directory.advance(7 * DAY);
        let again = world.send(&senders[1], bob.uuid()).await;
        assert!(again.is_ok(), "ein erneuter Brief ersetzt seinen alten");
        assert_eq!(world.directory.stored_letters_to(bob.uuid()).len(), MAX_PENDING);
        let first = world.inbox(&bob).await.into_iter().next().unwrap();
        world.directory.delete(&world.token_of(&bob).await, &first.id).await.unwrap();
        assert!(world.send(overflow, bob.uuid()).await.is_ok(), "nach einer Antwort ist wieder Platz");
    }

    #[tokio::test]
    async fn a_full_inbox_refusal_is_not_logged_and_expired_letters_do_not_fill_it() {
        let world = World::new();
        let bob = world.findable("Bob").await;
        let late = world.account("Spaet").await;
        for index in 0..MAX_PENDING {
            let sender = world.account(&format!("Absender{index}")).await;
            world.send(&sender, bob.uuid()).await.unwrap();
        }
        assert_eq!(rejection(world.send(&late, bob.uuid()).await), DirectoryError::RecipientFull);
        world.directory.advance(REQUEST_TTL_SECS);
        assert!(world.send(&late, bob.uuid()).await.is_ok(), "die Ablehnung zählt nicht als Sendung, Abgelaufenes füllt nicht");
    }

    // Sperrliste (Worker: blockList)

    #[tokio::test]
    async fn blocking_is_repeatable_and_capped_at_one_thousand() {
        let world = World::new();
        let bob = world.findable("Bob").await;
        let first = format!("{:032x}", 1);
        for number in 1..=MAX_BLOCKS {
            world.directory.block(&bob.token, &format!("{number:032x}")).await.unwrap();
        }
        let overflow = format!("{:032x}", MAX_BLOCKS + 1);
        assert_eq!(world.directory.block(&bob.token, &overflow).await, Err(DirectoryError::Invalid("blockListFull")));
        assert_eq!(world.directory.block(&bob.token, &first).await, Ok(()));
        world.directory.unblock(&bob.token, &first).await.unwrap();
        assert!(!world.directory.is_blocked(bob.uuid(), &first));
        assert_eq!(world.directory.block(&bob.token, &overflow).await, Ok(()));
        assert_eq!(world.directory.unblock(&bob.token, &format!("{:032x}", MAX_BLOCKS + 7)).await, Ok(()));
    }

    // Kompromittierter Worker

    #[tokio::test]
    async fn a_compromised_worker_can_inject_a_letter_with_any_stamp_and_read_the_secrets() {
        let world = World::new();
        let (victim, bob, attacker) = (world.findable("Victim").await, world.findable("Bob").await, world.account("Mallory").await);
        let mut forged = stamped_for_test(&attacker, bob.uuid(), world.directory.now());
        forged.from = LetterFrom { uuid: victim.uuid().to_owned(), name: "Victim".into(), peer_id: attacker.identity.peer_id() };
        world.directory.inject_letter(forged.clone());
        assert_eq!(world.inbox(&bob).await, [forged]);
        assert_eq!(world.directory.stored_letters_to(bob.uuid())[0].secret, "a0a1a2a3a4a5a6a7a8");
    }

    // FakeMojang

    #[tokio::test]
    async fn mojang_confirms_only_the_account_that_joined_with_that_server_id_ignoring_case() {
        let mojang = FakeMojang::default();
        let steve = mojang.add_account("Steve");
        let alex = mojang.add_account("Alex");
        mojang.join(&steve, "server-1").await.unwrap();
        assert_eq!(mojang.has_joined("sTeVe", "server-1").await, Ok(Some(MojangProfile { uuid: steve.uuid.clone(), name: "Steve".into() })));
        assert_eq!(mojang.has_joined("Alex", "server-1").await, Ok(None));
        assert_eq!(mojang.has_joined("Steve", "server-2").await, Ok(None));
        assert_eq!(mojang.joins(), [(steve.uuid, "server-1".to_owned())]);
        assert_eq!(mojang.lookup_name("ALEX").await, Ok(Some(MojangProfile { uuid: alex.uuid, name: "Alex".into() })));
        assert_eq!(mojang.lookup_name("Herobrine").await, Ok(None));
    }

    #[tokio::test]
    async fn mojang_refuses_unknown_tokens_and_refused_accounts_and_can_be_down() {
        let mojang = FakeMojang::default();
        let child = mojang.add_account("Kind");
        let stolen = McIdentity { access_token: "falsch".into(), ..child.clone() };
        assert_eq!(mojang.join(&stolen, "s").await, Err(MojangError::InvalidSession));
        mojang.refuse_joins(&child.uuid, Some(MojangError::NotAllowed));
        assert_eq!(mojang.join(&child, "s").await, Err(MojangError::NotAllowed));
        mojang.refuse_joins(&child.uuid, None);
        assert_eq!(mojang.join(&child, "s").await, Ok(()));
        mojang.set_unreachable(true);
        assert_eq!(mojang.join(&child, "s").await, Err(MojangError::Unreachable));
        assert_eq!(mojang.has_joined("Kind", "s").await, Err(MojangError::Unreachable));
        assert_eq!(mojang.lookup_name("Kind").await, Err(MojangError::Unreachable));
    }

    #[tokio::test]
    async fn counters_report_sessions_and_inbox_reads() {
        let world = World::new();
        let alex = world.findable("Alex").await;
        world.directory.inbox(&alex.token).await.unwrap();
        world.directory.inbox(&alex.token).await.unwrap();
        assert_eq!((world.directory.sessions_opened(), world.directory.inbox_reads()), (1, 2));
    }
}
