//! Freunde per Minecraft-Namen mit echten Sockets (BYNAME 10.2): Dienste am In-Process-Relay (SPEC 3.7) mit einem
//! geteilten `FakeDirectory` und einem geteilten `FakeMojang`. Echte Zeit mit kurzen Werten; nur der Zeitplan des
//! Postfachs läuft mit angehaltener Zeit und ohne Sockets.
use std::borrow::Cow;
use std::future::{ready, Future};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use data_encoding::HEXLOWER;
use futures::future::BoxFuture;
use futures::FutureExt;
use iroh::test_utils::run_relay_server;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::by_name;
use super::config::{friends_dir, DirectoryJob, FriendsConfig};
use super::contract::{
    DirectoryState, Friend, FriendRequest, FriendsEnableInput, FriendsSettings, NetworkStatus, RequestDirection,
    RequestState, RequestVia,
};
use super::control::WireProfile;
use super::directory::api::DirectoryApi;
use super::directory::fake::{
    draft_letter, log_in, sign_letter, CertificateLifetime, FakeDirectory, FakeMojang, DIRECTORY_HOST,
};
use super::directory::mojang::{MojangError, Privileges};
use super::directory::proof::NameProof;
use super::directory::wire::{InboxLetter, LetterFrom, OutgoingLetter, SentLetter};
use super::directory::{AccountTokens, DirectoryDeps, DirectoryError, McIdentity};
use super::events::{EventSink, FriendsEvent};
use super::hello::{self, Delivery};
use super::identity::{self, Identity};
use super::records::{BlockedRecord, FriendRecord};
use super::service::{now_secs, Core};
use super::test_support::{error_key, TempDir};
use super::{AccountProfile, Friends, NetOptions};
use crate::error::AppResult;
use crate::services::gamesignal::GameSignals;
use crate::services::modbridge::ModBridge;
use crate::services::p2p::{PeerId, RelayEntry, RelayOperator, RelayTls, DIAL_TIMEOUT};
use crate::services::secrets::MemorySecretStore;
use crate::services::{lock, Dirs};

const LIMIT: Duration = Duration::from_secs(20);
const IDLE_TIMEOUT: Duration = Duration::from_secs(40);
/// Lang genug, dass in den Socket-Tests nur ausdrücklich abgeholt wird.
const TEST_POLL: Duration = Duration::from_secs(3600);
const DAY_SECS: u64 = 24 * 3600;

/// The account's Minecraft session. After `serve_stale_token` it hands out a token Mojang no longer accepts, until the
/// launcher forgets the session (as `auth::session` refreshes it then).
struct FakeTokens {
    account: McIdentity,
    stale: AtomicBool,
    forgotten: AtomicUsize,
}

impl FakeTokens {
    fn new(account: McIdentity) -> Self {
        Self { account, stale: AtomicBool::new(false), forgotten: AtomicUsize::new(0) }
    }

    fn serve_stale_token(&self) {
        self.stale.store(true, Ordering::SeqCst);
    }

    fn forgotten(&self) -> usize {
        self.forgotten.load(Ordering::SeqCst)
    }
}

impl AccountTokens for FakeTokens {
    fn minecraft_session(&self) -> BoxFuture<'_, AppResult<McIdentity>> {
        let stale = self.stale.load(Ordering::SeqCst).then(|| "abgelaufen".to_owned());
        let access_token = stale.unwrap_or_else(|| self.account.access_token.clone());
        ready(Ok(McIdentity { access_token, ..self.account.clone() })).boxed()
    }

    fn forget_minecraft_session(&self) {
        self.forgotten.fetch_add(1, Ordering::SeqCst);
        self.stale.store(false, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct RecordingEvents {
    events: Mutex<Vec<FriendsEvent>>,
}

impl EventSink for RecordingEvents {
    fn emit(&self, event: FriendsEvent) {
        lock(&self.events).push(event);
    }
}

impl RecordingEvents {
    fn any(&self, matches: impl Fn(&FriendsEvent) -> bool) -> bool {
        lock(&self.events).iter().any(matches)
    }
}

/// Mojang, das Verzeichnis und das Relay, die sich alle Dienste eines Tests teilen.
struct World {
    mojang: Arc<FakeMojang>,
    directory: Arc<FakeDirectory>,
    relay: RelayEntry,
    _server: Box<dyn Send>,
}

impl World {
    async fn new() -> Self {
        let (map, url, server) = run_relay_server().await.unwrap();
        let quic_port = map.get(&url).unwrap().quic.as_ref().map(|quic| quic.port);
        let url = Cow::Owned(url.to_string());
        let relay = RelayEntry { index: 0, url, operator: RelayOperator::Pumpkin, quic_port };
        let mojang = Arc::new(FakeMojang::default());
        let directory = Arc::new(FakeDirectory::new(mojang.clone()));
        Self { mojang, directory, relay, _server: Box::new(server) }
    }

    fn options(&self) -> NetOptions {
        NetOptions {
            relay_map: vec![self.relay.clone()],
            hello_relay_only: true,
            relay_tls: RelayTls::InsecureForTests,
            idle_timeout: IDLE_TIMEOUT,
        }
    }

    /// Ein aktivierter Dienst mit eigenem Minecraft-Konto, online am Relay; auffindbar heißt: schon eingetragen.
    async fn online(&self, name: &str, findable: bool) -> Node {
        let account = self.mojang.add_account(name);
        let node = Node::start(self, account, TempDir::new(), Arc::new(MemorySecretStore::new())).await;
        node.friends.enable(enable_input(name, findable), Some(node.profile())).await.unwrap();
        node.wait_online().await;
        if findable {
            node.wait_registered(self).await;
        }
        node
    }

    /// Ein Konto, das im Verzeichnis steht, ohne eigenen Dienst: ein Empfänger, der nie antwortet.
    async fn listed_account(&self, name: &str) -> McIdentity {
        let account = self.mojang.add_account(name);
        let token = self.token_for(&Identity::generate(), &account).await;
        self.directory.register(&token).await.unwrap();
        account
    }

    /// The login by hand, as any other client can perform it.
    async fn token_for(&self, identity: &Identity, account: &McIdentity) -> String {
        log_in(&self.directory, identity, account).await.unwrap().token
    }

    /// Ein frisch angemeldeter Brief von `node` an `to`, vorbei an dessen Dienst.
    async fn send_as(&self, node: &Node, to: &str) -> Result<SentLetter, DirectoryError> {
        let identity = node.identity();
        let token = self.token_for(&identity, &node.account).await;
        let letter = sign_letter(&identity, &node.account.uuid, draft_letter(to, self.directory.now()));
        self.directory.send(&token, &letter).await
    }

    fn letters_to(&self, node: &Node) -> Vec<InboxLetter> {
        self.directory.stored_letters_to(&node.account.uuid)
    }

    /// Wie oft das Konto bei Mojang `join` aufgerufen hat.
    fn joins_of(&self, account: &McIdentity) -> usize {
        self.mojang.joins().iter().filter(|(uuid, _)| *uuid == account.uuid).count()
    }

    fn deps(&self, tokens: Arc<FakeTokens>, poll_interval: Duration) -> DirectoryDeps {
        DirectoryDeps {
            api: self.directory.clone(),
            mojang: self.mojang.clone(),
            tokens,
            poll_interval,
            host: DIRECTORY_HOST.into(),
        }
    }

    fn certificates_of(&self, node: &Node) -> usize {
        self.mojang.certificates_issued_to(&node.account.uuid)
    }
}

fn enable_input(name: &str, findable: bool) -> FriendsEnableInput {
    FriendsEnableInput {
        display_name: name.to_owned(),
        always_relay: false,
        accept_third_party_relays: false,
        findable_by_name: findable,
    }
}

/// Ein Freunde-Dienst mit eigenem Ordner, Schlüsselbund und Minecraft-Konto.
struct Node {
    friends: Friends,
    account: McIdentity,
    tokens: Arc<FakeTokens>,
    secrets: Arc<MemorySecretStore>,
    events: Arc<RecordingEvents>,
    dir: TempDir,
    /// Die Spielsignale und die Brücke, mit denen der Dienst gebaut ist; Spiele mit der Mod hängen sich daran.
    signals: GameSignals,
    bridge: ModBridge,
}

impl Node {
    /// Gestartet wie beim App-Start, mit eingehängtem Verzeichnis.
    async fn start(world: &World, account: McIdentity, dir: TempDir, secrets: Arc<MemorySecretStore>) -> Self {
        let signals = GameSignals::default();
        let bridge = ModBridge::new(signals.clone());
        let friends = Friends::new(&Dirs::new(dir.path()), secrets.clone(), signals.clone(), bridge.clone(), world.options()).unwrap();
        let tokens = Arc::new(FakeTokens::new(account.clone()));
        friends.attach_directory(world.deps(tokens.clone(), TEST_POLL)).unwrap();
        let events = Arc::new(RecordingEvents::default());
        let node = Self { friends, account, tokens, secrets, events, dir, signals, bridge };
        node.friends.start(node.events.clone(), Some(node.profile())).await;
        node
    }

    /// Beendet den Dienst und startet einen neuen auf denselben Daten.
    async fn restart(self, world: &World) -> Self {
        self.friends.shutdown().await;
        let restarted = Self::start(world, self.account, self.dir, self.secrets).await;
        restarted.wait_online().await;
        restarted
    }

    fn profile(&self) -> AccountProfile {
        AccountProfile::new(&self.account.name, &self.account.uuid)
    }

    fn core(&self) -> &Arc<Core> {
        &self.friends.core
    }

    fn identity(&self) -> Identity {
        identity::load(&*self.secrets).unwrap().unwrap()
    }

    fn id(&self) -> PeerId {
        PeerId::from_str(&self.identity().peer_id()).unwrap()
    }

    fn directory_state(&self) -> DirectoryState {
        self.friends.state().directory.state
    }

    fn jobs(&self) -> Vec<DirectoryJob> {
        FriendsConfig::load(&friends_dir(&Dirs::new(self.dir.path()))).unwrap().directory.jobs
    }

    async fn poll(&self) {
        by_name::poll_inbox(self.core()).await;
    }

    async fn requests(&self) -> Vec<FriendRequest> {
        self.friends.requests().await.unwrap()
    }

    async fn only_request(&self) -> FriendRequest {
        let requests = self.requests().await;
        assert_eq!(requests.len(), 1, "{requests:?}");
        requests.into_iter().next().unwrap()
    }

    /// Die eingehende Anfrage per Name von diesem Minecraft-Konto.
    async fn letter_from(&self, account: &McIdentity) -> FriendRequest {
        let is_from_account = |request: &FriendRequest| {
            let stored = self.core().stores.requests.get(&request.id).unwrap();
            stored.via == RequestVia::Name && stored.mc_uuid.as_deref() == Some(account.uuid.as_str())
        };
        self.requests().await.into_iter().find(is_from_account).unwrap()
    }

    async fn friend(&self, peer: &PeerId) -> Option<Friend> {
        let id = peer.to_string();
        self.friends.list().await.unwrap().into_iter().find(|friend| friend.id == id)
    }

    async fn wait_online(&self) {
        let online = || async move { matches!(self.friends.state().network, NetworkStatus::Online { .. }) };
        until("network online", online).await;
    }

    async fn wait_registered(&self, world: &World) {
        until_true("registered", || world.directory.is_registered(&self.account.uuid)).await;
    }

    async fn wait_friend(&self, peer: &PeerId, what: &str, matches: impl Fn(&Friend) -> bool) {
        let matches = &matches;
        until(what, || async move { self.friend(peer).await.is_some_and(|friend| matches(&friend)) }).await;
    }
}

async fn until<F, Fut>(what: &str, mut condition: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let deadline = std::time::Instant::now() + LIMIT;
    while !condition().await {
        assert!(std::time::Instant::now() < deadline, "{what}: not reached within {LIMIT:?}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn until_true(what: &str, condition: impl Fn() -> bool) {
    until(what, || ready(condition())).await;
}

async fn both_confirmed(a: &Node, b: &Node) {
    let (a_id, b_id) = (a.id(), b.id());
    until("both confirmed", || async move {
        let confirmed = |friend: Option<Friend>| friend.is_some_and(|friend| friend.confirmed);
        confirmed(a.friend(&b_id).await) && confirmed(b.friend(&a_id).await)
    })
    .await;
}

/// Die `serverId`, mit der `redeemer` den Code im Brief bei Mojang einlöst.
fn redeemer_server_id(letter: &InboxLetter, redeemer: &PeerId) -> String {
    let hello_id: [u8; 32] = HEXLOWER.decode(letter.hello_id.as_bytes()).unwrap().try_into().unwrap();
    let secret: [u8; 9] = HEXLOWER.decode(letter.secret.as_bytes()).unwrap().try_into().unwrap();
    NameProof { hello_id: &hello_id, redeemer_peer_id: redeemer.as_bytes(), secret: &secret }.server_id_redeemer()
}

/// Was ein kompromittierter Worker kann: einen Brief mit `forger`s Schlüssel und beliebigem Stempel einlegen.
fn forged_copy(original: &InboxLetter, forger: &Identity, claimed: LetterFrom) -> InboxLetter {
    let draft = OutgoingLetter {
        to: original.to.clone(),
        nonce: original.nonce.clone(),
        hello_id: original.hello_id.clone(),
        relay_index: original.relay_index,
        secret: original.secret.clone(),
        display_name: original.display_name.clone(),
        created_at: original.created_at,
        signature: String::new(),
    };
    let signed = sign_letter(forger, &claimed.uuid, draft);
    InboxLetter { id: uuid::Uuid::new_v4().to_string(), from: claimed, signature: signed.signature, ..original.clone() }
}

// 1

#[tokio::test]
async fn a_request_by_name_ends_in_two_confirmed_friends_with_the_accounts_mojang_confirmed() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);

    let sent = alex.friends.add_by_name(" sTEVE ").await.unwrap();
    steve.poll().await;
    let incoming = steve.only_request().await;
    steve.friends.answer_request(&incoming.id, true).await.unwrap();
    both_confirmed(&alex, &steve).await;

    assert_eq!((sent.via, sent.state, sent.peer_id), (RequestVia::Name, RequestState::AwaitingAnswer, None));
    assert_eq!(sent.mc_name.as_deref(), Some("Steve"), "Mojang's spelling");
    assert_eq!((incoming.via, incoming.state), (RequestVia::Name, RequestState::Pending));
    assert_eq!(incoming.mc_name.as_deref(), Some("Alex"));
    assert_eq!(incoming.peer_id, Some(alex.id().to_string()), "the stamp names the sender");
    assert!(steve.events.any(|event| matches!(event, FriendsEvent::Request(_))));
    let at_alex = alex.friend(&steve.id()).await.unwrap();
    let at_steve = steve.friend(&alex.id()).await.unwrap();
    assert_eq!((at_alex.mc_name.as_deref(), at_alex.mc_uuid), (Some("Steve"), Some(steve.account.uuid.clone())));
    assert_eq!((at_steve.mc_name.as_deref(), at_steve.mc_uuid), (Some("Alex"), Some(alex.account.uuid.clone())));
    assert!(alex.requests().await.is_empty() && steve.requests().await.is_empty());
    until_true("letter deleted", || world.letters_to(&steve).is_empty()).await;
}

// 2

#[tokio::test]
async fn an_acceptance_while_the_sender_is_offline_is_delivered_by_retry_now_once_it_is_back() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    alex.friends.disable().await.unwrap();
    steve.poll().await;
    steve.friends.answer_request(&steve.only_request().await.id, true).await.unwrap();
    // Erst wenn der erste Versuch über 10 s her ist, wählt `friends_retry_now` sofort neu an.
    tokio::time::sleep(DIAL_TIMEOUT + Duration::from_secs(3)).await;
    let waiting = steve.only_request().await;
    assert_eq!((waiting.direction, waiting.state), (RequestDirection::Outgoing, RequestState::Delivering));

    alex.friends.enable(enable_input("Alex", false), Some(alex.profile())).await.unwrap();
    alex.wait_online().await;
    let pressed = Instant::now();
    steve.friends.retry_now().await.unwrap();
    let steve_id = steve.id();
    alex.wait_friend(&steve_id, "redeemer stored", |_| true).await;

    assert!(pressed.elapsed() <= Duration::from_secs(5), "delivered after {:?}", pressed.elapsed());
    both_confirmed(&alex, &steve).await;
}

// 3

#[tokio::test]
async fn declining_deletes_the_letter_and_the_sender_never_hears_from_the_recipient() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    steve.poll().await;
    let letter = world.letters_to(&steve).remove(0);

    steve.friends.answer_request(&steve.only_request().await.id, false).await.unwrap();
    until_true("letter deleted", || world.letters_to(&steve).is_empty()).await;
    tokio::time::sleep(Duration::from_secs(1)).await;

    assert_eq!(alex.only_request().await.state, RequestState::AwaitingAnswer);
    assert!(steve.requests().await.is_empty());
    let redeemed = redeemer_server_id(&letter, &steve.id());
    assert!(world.mojang.joins().iter().all(|(_, server_id)| *server_id != redeemed), "no redemption was attempted");
    assert!(alex.friend(&steve.id()).await.is_none());
}

// 4

#[tokio::test]
async fn blocking_a_request_by_name_blocks_the_account_in_the_directory_and_later_letters_vanish() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    steve.poll().await;

    steve.friends.block(&alex.id().to_string()).await.unwrap();
    let blocked_in_directory = || world.directory.is_blocked(&steve.account.uuid, &alex.account.uuid);
    until_true("blocked in the directory", blocked_in_directory).await;
    let blocked = steve.core().stores.blocked.get(&alex.id().to_string()).unwrap();
    assert_eq!(blocked.mc_uuid.as_deref(), Some(alex.account.uuid.as_str()));
    until_true("pending letter deleted", || world.letters_to(&steve).is_empty()).await;

    world.directory.advance(7 * DAY_SECS);
    assert!(world.send_as(&alex, &steve.account.uuid).await.is_ok(), "a blocked sender sees a delivery");
    steve.poll().await;

    assert!(world.letters_to(&steve).is_empty());
    assert!(steve.requests().await.is_empty());
}

// 5

#[tokio::test]
async fn a_cancelled_request_vanishes_at_the_recipient_and_a_late_acceptance_gets_no_answer() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    let (steve, notch) = (world.online("Steve", true).await, world.online("Notch", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    alex.friends.add_by_name("Notch").await.unwrap();
    steve.poll().await;
    notch.poll().await;
    let letter_to_notch = world.letters_to(&notch).remove(0);

    for request in alex.requests().await {
        alex.friends.cancel_request(&request.id).await.unwrap();
    }
    let retracted = || world.letters_to(&steve).is_empty() && world.letters_to(&notch).is_empty();
    until_true("letters retracted", retracted).await;
    assert!(alex.core().stores.codes.list().is_empty(), "the codes are gone with the requests");
    steve.poll().await;
    notch.friends.answer_request(&notch.only_request().await.id, true).await.unwrap();
    let redeemed = redeemer_server_id(&letter_to_notch, &notch.id());
    let attempted = || world.mojang.joins().iter().any(|(_, server_id)| *server_id == redeemed);
    until_true("redemption attempted", attempted).await;
    tokio::time::sleep(DIAL_TIMEOUT + Duration::from_secs(2)).await;

    assert!(steve.requests().await.is_empty(), "the pending copy disappeared on the next poll");
    assert_eq!(notch.only_request().await.state, RequestState::Delivering);
    assert!(alex.friends.list().await.unwrap().is_empty());
}

// 6: ein kompromittiertes Verzeichnis

#[tokio::test]
async fn a_forged_stamp_with_a_victims_account_never_becomes_a_friend() {
    let world = World::new().await;
    let (mallory, steve) = (world.online("Mallory", false).await, world.online("Steve", true).await);
    let victim = world.listed_account("Victim").await;
    mallory.friends.add_by_name("Steve").await.unwrap();
    let genuine = world.letters_to(&steve).remove(0);
    let peer_id = mallory.id().to_string();
    let claimed = LetterFrom { uuid: victim.uuid.clone(), peer_id };
    world.directory.inject_letter(forged_copy(&genuine, &mallory.identity(), claimed));
    steve.poll().await;
    let forged = steve.letter_from(&victim).await;

    steve.friends.answer_request(&forged.id, true).await.unwrap();
    let steve_id = steve.id();
    mallory.wait_friend(&steve_id, "the attacker answered", |_| true).await;
    tokio::time::sleep(Duration::from_secs(2)).await;

    assert!(steve.friend(&mallory.id()).await.is_none(), "Mojang names Mallory, not the victim");
    assert_eq!(steve.core().stores.requests.get(&forged.id).unwrap().state, RequestState::Delivering);
}

#[tokio::test]
async fn redeeming_a_stolen_secret_gets_silence_and_no_friend() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    let mallory = world.online("Mallory", false).await;
    alex.friends.add_by_name("Steve").await.unwrap();
    let stolen = world.letters_to(&steve).remove(0);
    let hello_id = PeerId::from_str(&stolen.hello_id).unwrap();
    let claimed = WireProfile {
        display_name: "Steve".into(),
        mc_name: Some("Steve".into()),
        mc_uuid: Some(steve.account.uuid.clone()),
    };

    let main = mallory.core().runtime().unwrap().main.clone();
    let delivery = hello::send_request(&main, hello_id, &stolen.secret, claimed).await;

    assert_eq!(delivery, Delivery::Failed);
    assert!(alex.friends.list().await.unwrap().is_empty());
    assert_eq!(alex.only_request().await.state, RequestState::AwaitingAnswer);
    assert!(alex.core().stores.codes.list().iter().all(|code| code.used_by.is_none()));
}

#[tokio::test]
async fn an_answer_from_another_peer_than_the_stamped_one_fails() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    let mallory = world.online("Mallory", false).await;
    alex.friends.add_by_name("Steve").await.unwrap();
    let genuine = world.letters_to(&steve).remove(0);
    let peer_id = mallory.id().to_string();
    let claimed = LetterFrom { uuid: alex.account.uuid.clone(), peer_id };
    world.directory.inject_letter(forged_copy(&genuine, &mallory.identity(), claimed));
    steve.poll().await;
    let mallory_id = mallory.id().to_string();
    let forged = steve.requests().await.into_iter().find(|request| request.peer_id.as_deref() == Some(&mallory_id));

    steve.friends.answer_request(&forged.unwrap().id, true).await.unwrap();
    let steve_id = steve.id();
    alex.wait_friend(&steve_id, "the real sender answered", |_| true).await;
    tokio::time::sleep(Duration::from_secs(2)).await;

    assert!(steve.friend(&alex.id()).await.is_none());
    assert!(steve.friend(&mallory.id()).await.is_none());
    let delivering = steve.requests().await.into_iter().filter(|request| request.state == RequestState::Delivering);
    assert_eq!(delivering.count(), 1, "the acceptance is still undelivered");
}

// 7

#[tokio::test]
async fn rotation_retracts_own_letters_but_keeps_letters_from_others() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    steve.poll().await;

    steve.friends.rotate_identity().await.unwrap();
    let kept = steve.only_request().await;
    assert_eq!((kept.via, kept.state), (RequestVia::Name, RequestState::Pending));

    alex.friends.rotate_identity().await.unwrap();
    assert!(alex.requests().await.is_empty());
    assert!(alex.core().stores.codes.list().is_empty());
    until_true("letter retracted", || world.letters_to(&steve).is_empty()).await;
}

// 8

#[tokio::test]
async fn findability_registers_disable_unregisters_and_queued_jobs_survive_a_restart() {
    let world = World::new().await;
    let steve = world.online("Steve", false).await;
    let findable = FriendsSettings { display_name: "Steve".into(), always_relay: false, findable_by_name: true };

    steve.friends.update_settings(findable.clone()).await.unwrap();
    steve.wait_registered(&world).await;
    until_true("active", || steve.directory_state() == DirectoryState::Active).await;
    steve.friends.disable().await.unwrap();
    assert!(!world.directory.is_registered(&steve.account.uuid), "unregistered before disable returns");
    assert!(steve.friends.state().settings.findable_by_name, "the setting stays");

    steve.friends.enable(enable_input("Steve", true), Some(steve.profile())).await.unwrap();
    steve.wait_registered(&world).await;
    world.directory.set_unreachable(true);
    steve.friends.update_settings(FriendsSettings { findable_by_name: false, ..findable }).await.unwrap();
    assert_eq!(steve.directory_state(), DirectoryState::Off, "off is effective locally at once");
    let unregister = DirectoryJob::Unregister { uuid: steve.account.uuid.clone() };
    until_true("job kept", || steve.jobs().contains(&unregister)).await;
    steve.friends.shutdown().await;
    world.directory.set_unreachable(false);
    let restarted = steve.restart(&world).await;

    until_true("unregistered after the restart", || !world.directory.is_registered(&restarted.account.uuid)).await;
    until_true("job done", || restarted.jobs().is_empty()).await;
}

// 9

#[tokio::test]
async fn without_the_directory_by_name_is_unavailable_but_codes_still_work() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", false).await);
    world.directory.set_unreachable(true);

    let refused = alex.friends.add_by_name("Steve").await.unwrap_err();

    assert_eq!(error_key(&refused), "errors.friends.directoryUnavailable");
    assert!(alex.core().stores.codes.list().is_empty(), "the code of the failed request is gone");
    let code = alex.friends.code_create().await.unwrap().code.unwrap();
    steve.friends.add(&code).await.unwrap();
    until("incoming request", || async { !alex.requests().await.is_empty() }).await;
    alex.friends.answer_request(&alex.only_request().await.id, true).await.unwrap();
    both_confirmed(&alex, &steve).await;
}

// 10

#[tokio::test]
async fn a_mojang_refusal_shows_not_allowed_and_pauses_polling() {
    let world = World::new().await;
    let kind = world.online("Kind", false).await;
    world.mojang.refuse_certificates(&kind.account.uuid, Some(MojangError::NotAllowed));
    let findable = FriendsSettings { display_name: "Kind".into(), always_relay: false, findable_by_name: true };

    kind.friends.update_settings(findable).await.unwrap();
    until_true("not allowed", || kind.directory_state() == DirectoryState::NotAllowed).await;
    let reads = world.directory.inbox_reads();
    kind.friends.retry_now().await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;

    assert_eq!(world.directory.inbox_reads(), reads, "no poll while Mojang refuses");
    assert!(!world.directory.is_registered(&kind.account.uuid));
    world.listed_account("Steve").await;
    let refused = kind.friends.add_by_name("Steve").await.unwrap_err();
    assert_eq!(error_key(&refused), "errors.friends.directoryNotAllowed");
}

// 11

#[tokio::test]
async fn concurrent_sends_share_one_login_a_cached_token_is_reused_and_a_401_logs_in_once_more() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    for name in ["Eins", "Zwei", "Drei", "Vier"] {
        world.listed_account(name).await;
    }
    let logins_before = world.directory.sessions_opened();
    let logins = || world.directory.sessions_opened() - logins_before;

    let (first, second) = tokio::join!(alex.friends.add_by_name("Eins"), alex.friends.add_by_name("Zwei"));
    first.unwrap();
    second.unwrap();
    assert_eq!(logins(), 1, "the auth lock lets one login through");
    alex.friends.add_by_name("Drei").await.unwrap();
    assert_eq!(logins(), 1, "the cached token is reused");
    world.directory.revoke_tokens();
    alex.friends.add_by_name("Vier").await.unwrap();

    assert_eq!(logins(), 2, "exactly one new login after the 401");
    assert_eq!(world.certificates_of(&alex), 1, "both logins share one certificate");
    assert_eq!(alex.requests().await.len(), 4);
}

// 12

#[tokio::test]
async fn not_friend_from_a_fresh_name_redemption_is_a_failed_dial_not_a_removal() {
    let world = World::new().await;
    let anna = world.online("Anna", false).await;
    let (redeemer, stranger) = (world.online("Bert", false).await, world.online("Carl", false).await);
    for peer in [redeemer.id(), stranger.id()] {
        anna.core().stores.friends.upsert(unconfirmed_friend(&peer)).unwrap();
    }
    by_name::remember_redemption(anna.core(), &redeemer.id().to_string());

    assert!(anna.friends.dial_friend(&redeemer.id()).await.is_err());
    assert!(anna.friends.dial_friend(&stranger.id()).await.is_err());

    assert!(!anna.friend(&redeemer.id()).await.unwrap().removed_by_peer, "within the grace");
    assert!(anna.friend(&stranger.id()).await.unwrap().removed_by_peer, "outside a name redemption as before");
}

fn unconfirmed_friend(peer: &PeerId) -> FriendRecord {
    FriendRecord {
        id: peer.to_string(),
        display_name: "Bert".into(),
        alias: None,
        mc_name: None,
        mc_uuid: None,
        home_relay: None,
        added_at: now_secs(),
        last_seen: None,
        confirmed: false,
        removed_by_peer: false,
        notice: None,
    }
}

// 13

const PAUSED_POLL: Duration = Duration::from_secs(300);

/// Ein auffindbarer Dienst ohne Endpunkte (nicht aktiviert); nur die Schleife des Verzeichnisses läuft.
async fn directory_loop_alone(directory: &Arc<FakeDirectory>, mojang: &Arc<FakeMojang>) -> (Friends, TempDir) {
    let dir = TempDir::new();
    let secrets = Arc::new(MemorySecretStore::new());
    identity::create(&*secrets).unwrap();
    let settings = FriendsSettings { display_name: "Steve".into(), always_relay: false, findable_by_name: true };
    FriendsConfig { settings, ..FriendsConfig::default() }.save(&friends_dir(&Dirs::new(dir.path()))).unwrap();
    let signals = GameSignals::default();
    let bridge = ModBridge::new(signals.clone());
    let offline = NetOptions {
        relay_map: Vec::new(),
        hello_relay_only: false,
        relay_tls: RelayTls::InsecureForTests,
        idle_timeout: IDLE_TIMEOUT,
    };
    let friends = Friends::new(&Dirs::new(dir.path()), secrets, signals, bridge, offline).unwrap();
    let account = mojang.add_account("Steve");
    let deps = DirectoryDeps {
        api: directory.clone(),
        mojang: mojang.clone(),
        tokens: Arc::new(FakeTokens::new(account.clone())),
        poll_interval: PAUSED_POLL,
        host: DIRECTORY_HOST.into(),
    };
    friends.attach_directory(deps).unwrap();
    friends.start(Arc::new(RecordingEvents::default()), Some(AccountProfile::new(&account.name, &account.uuid))).await;
    (friends, dir)
}

#[tokio::test(start_paused = true)]
async fn the_inbox_is_polled_ten_seconds_after_start_then_per_interval_and_retry_now_at_most_every_minute() {
    let mojang = Arc::new(FakeMojang::default());
    let directory = Arc::new(FakeDirectory::new(mojang.clone()));
    let (friends, _dir) = directory_loop_alone(&directory, &mojang).await;
    let started = Instant::now();
    let at = |secs: u64| started + Duration::from_millis(secs * 1000 + 500);
    by_name::spawn_directory_loop(&friends.core, &CancellationToken::new());

    tokio::time::sleep_until(started + Duration::from_secs(9)).await;
    assert_eq!(directory.inbox_reads(), 0, "registered at once, but no poll before 10 s");
    tokio::time::sleep_until(at(10)).await;
    assert_eq!(directory.inbox_reads(), 1);
    tokio::time::sleep_until(at(10 + PAUSED_POLL.as_secs() - 2)).await;
    assert_eq!(directory.inbox_reads(), 1);
    tokio::time::sleep_until(at(10 + PAUSED_POLL.as_secs())).await;
    assert_eq!(directory.inbox_reads(), 2);

    by_name::poll_soon(&friends.core);
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(directory.inbox_reads(), 2, "the last poll is under a minute old");
    tokio::time::sleep_until(at(10 + PAUSED_POLL.as_secs() + 60)).await;
    by_name::poll_soon(&friends.core);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(directory.inbox_reads(), 3, "a minute later retry_now polls at once");
}

// BYNAME-ATTEST 8.2: the certificate login

const HOUR_MS: i64 = 3_600_000;
/// Long enough for a login or two, short enough to wait for in a test.
const SOON_MS: i64 = 3_000;

fn findable_settings(name: &str) -> FriendsSettings {
    FriendsSettings { display_name: name.to_owned(), always_relay: false, findable_by_name: true }
}

fn launcher_now_ms() -> i64 {
    i64::try_from(crate::models::now_ms()).unwrap()
}

/// A node that has logged in once with a certificate Mojang wants refreshed in a moment, and the moment has come.
async fn online_with_a_certificate_due_for_refresh(world: &World, name: &str, first_recipient: &str) -> Node {
    let node = world.online(name, false).await;
    let refresh_at = launcher_now_ms() + SOON_MS;
    let lifetime = CertificateLifetime { refreshed_after_ms: refresh_at, expires_at_ms: refresh_at + 48 * HOUR_MS };
    world.mojang.next_certificate_lifetime(lifetime);
    node.friends.add_by_name(first_recipient).await.unwrap();
    until_true("certificate due for refresh", || launcher_now_ms() >= refresh_at).await;
    world.directory.revoke_tokens();
    node
}

// 14

#[tokio::test]
async fn a_cached_certificate_serves_further_logins_before_its_refresh() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    for name in ["Eins", "Zwei", "Drei"] {
        world.listed_account(name).await;
        world.directory.revoke_tokens();
        alex.friends.add_by_name(name).await.unwrap();
    }
    assert_eq!(world.directory.sessions_opened(), 6, "three listed accounts and three logins of Alex");
    assert_eq!(world.certificates_of(&alex), 1);
}

#[tokio::test]
async fn after_refreshed_after_exactly_one_new_certificate_is_fetched() {
    let world = World::new().await;
    for name in ["Eins", "Zwei", "Drei"] {
        world.listed_account(name).await;
    }
    let alex = online_with_a_certificate_due_for_refresh(&world, "Alex", "Eins").await;
    assert_eq!(world.certificates_of(&alex), 1);

    alex.friends.add_by_name("Zwei").await.unwrap();
    world.directory.revoke_tokens();
    alex.friends.add_by_name("Drei").await.unwrap();

    assert_eq!(world.certificates_of(&alex), 2, "one more fetch, then the new certificate serves");
}

// 15

#[tokio::test]
async fn a_certificate_the_directory_finds_expired_is_fetched_again_once() {
    let world = World::new().await;
    let steve = world.online("Steve", false).await;
    // Still usable for the launcher (over ten minutes left), expired on the directory's clock eleven minutes ahead.
    let expiry = launcher_now_ms() + 10 * 60 * 1000 + 30_000;
    world.mojang.next_certificate_lifetime(CertificateLifetime { refreshed_after_ms: expiry, expires_at_ms: expiry });
    world.directory.advance(11 * 60);

    steve.friends.update_settings(findable_settings("Steve")).await.unwrap();
    steve.wait_registered(&world).await;

    assert_eq!(world.certificates_of(&steve), 2);
    until_true("active", || steve.directory_state() == DirectoryState::Active).await;
}

// 16

#[tokio::test]
async fn a_certificate_the_directory_never_accepts_leaves_by_name_unreachable_and_keeps_jobs() {
    let world = World::new().await;
    let steve = world.online("Steve", false).await;
    world.listed_account("Alex").await;
    let blocked_uuid = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
    let blocked = BlockedRecord {
        id: Identity::generate().peer_id(),
        display_name: "Mallory".into(),
        blocked_at: now_secs(),
        mc_uuid: Some(blocked_uuid.into()),
    };
    steve.core().stores.blocked.upsert(blocked).unwrap();
    world.mojang.sign_with_unpinned_key(true);

    steve.friends.update_settings(findable_settings("Steve")).await.unwrap();
    until_true("unreachable", || steve.directory_state() == DirectoryState::Unreachable).await;

    assert!(steve.jobs().contains(&DirectoryJob::Block { uuid: blocked_uuid.into() }), "the job waits");
    assert!(world.certificates_of(&steve) >= 2, "a fresh certificate was tried before giving up");
    assert!(!world.directory.is_registered(&steve.account.uuid));
    let refused = steve.friends.add_by_name("Alex").await.unwrap_err();
    assert_eq!(error_key(&refused), "errors.friends.directoryUnavailable");
}

// 17

#[tokio::test]
async fn a_refused_minecraft_token_is_refreshed_exactly_once() {
    let world = World::new().await;
    let alex = world.online("Alex", false).await;
    world.listed_account("Steve").await;
    alex.tokens.serve_stale_token();

    alex.friends.add_by_name("Steve").await.unwrap();

    assert_eq!(alex.tokens.forgotten(), 1);
    assert_eq!(world.certificates_of(&alex), 1);
}

#[tokio::test]
async fn a_token_refused_again_after_its_refresh_means_mojang_refuses_the_account() {
    let world = World::new().await;
    let kind = world.online("Kind", false).await;
    world.listed_account("Steve").await;
    world.mojang.refuse_certificates(&kind.account.uuid, Some(MojangError::InvalidSession));

    let refused = kind.friends.add_by_name("Steve").await.unwrap_err();

    assert_eq!(error_key(&refused), "errors.friends.directoryNotAllowed");
    assert_eq!(kind.tokens.forgotten(), 1);
}

// 18

#[tokio::test]
async fn attributes_that_refuse_strangers_show_not_allowed_without_fetching_a_certificate() {
    let world = World::new().await;
    let kind = world.online("Kind", false).await;
    world.mojang.set_privileges(&kind.account.uuid, Privileges::Refused);

    kind.friends.update_settings(findable_settings("Kind")).await.unwrap();
    until_true("not allowed", || kind.directory_state() == DirectoryState::NotAllowed).await;

    assert_eq!(world.certificates_of(&kind), 0);
    assert!(!world.directory.is_registered(&kind.account.uuid));
}

#[tokio::test]
async fn the_attributes_are_asked_again_at_every_login() {
    let world = World::new().await;
    let steve = world.online("Steve", true).await;
    world.listed_account("Alex").await;
    world.mojang.set_privileges(&steve.account.uuid, Privileges::Refused);
    world.directory.revoke_tokens();

    let refused = steve.friends.add_by_name("Alex").await.unwrap_err();

    assert_eq!(error_key(&refused), "errors.friends.directoryNotAllowed");
    assert_eq!(steve.directory_state(), DirectoryState::NotAllowed);
}

#[tokio::test]
async fn unknown_attributes_keep_the_account_out_of_the_directory_but_it_can_still_send() {
    let world = World::new().await;
    let kind = world.online("Kind", false).await;
    world.listed_account("Steve").await;
    world.mojang.set_privileges(&kind.account.uuid, Privileges::Unknown);

    kind.friends.update_settings(findable_settings("Kind")).await.unwrap();
    until_true("unreachable", || kind.directory_state() == DirectoryState::Unreachable).await;

    assert!(!world.directory.is_registered(&kind.account.uuid));
    kind.friends.add_by_name("Steve").await.unwrap();
}

// 19

#[tokio::test]
async fn an_incoming_request_shows_the_senders_current_name_at_mojang() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    world.mojang.rename(&alex.account.uuid, "Alexander");

    steve.poll().await;

    assert_eq!(steve.only_request().await.mc_name.as_deref(), Some("Alexander"));
}

#[tokio::test]
async fn a_letter_whose_sender_mojang_cannot_look_up_now_is_filed_on_the_next_poll() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    world.mojang.set_unreachable(true);

    steve.poll().await;
    assert!(steve.requests().await.is_empty());
    assert_eq!(world.letters_to(&steve).len(), 1, "the letter stays");
    world.mojang.set_unreachable(false);
    steve.poll().await;

    assert_eq!(steve.only_request().await.mc_name.as_deref(), Some("Alex"));
}

#[tokio::test]
async fn a_letter_from_an_account_mojang_does_not_know_is_deleted_only_on_the_second_poll_in_a_row() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    world.mojang.delete_account(&alex.account.uuid);

    steve.poll().await;
    assert!(steve.requests().await.is_empty());
    assert!(steve.jobs().is_empty(), "one answer is not enough to delete");
    steve.poll().await;

    until_true("letter deleted", || world.letters_to(&steve).is_empty()).await;
    assert!(steve.requests().await.is_empty());
}

#[tokio::test]
async fn a_lookup_failure_between_two_misses_starts_the_count_again() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    world.mojang.delete_account(&alex.account.uuid);

    steve.poll().await;
    world.mojang.set_unreachable(true);
    steve.poll().await;
    world.mojang.set_unreachable(false);
    steve.poll().await;

    assert!(steve.jobs().is_empty());
    assert_eq!(world.letters_to(&steve).len(), 1);
}

#[tokio::test]
async fn mojang_hears_nothing_about_letters_from_blocked_senders() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    let genuine = world.letters_to(&steve).remove(0);
    steve.poll().await;
    steve.friends.block(&alex.id().to_string()).await.unwrap();
    until_true("letter deleted", || world.letters_to(&steve).is_empty()).await;
    let lookups = world.mojang.profile_lookups_of(&alex.account.uuid);
    let from = LetterFrom { uuid: alex.account.uuid.clone(), peer_id: alex.id().to_string() };
    world.directory.inject_letter(forged_copy(&genuine, &alex.identity(), from));

    steve.poll().await;

    assert_eq!(world.mojang.profile_lookups_of(&alex.account.uuid), lookups);
    assert!(steve.requests().await.is_empty());
}

// 20

#[tokio::test]
async fn logging_in_makes_no_mojang_join_and_accepting_makes_one_on_each_side() {
    let world = World::new().await;
    let (alex, steve) = (world.online("Alex", false).await, world.online("Steve", true).await);
    alex.friends.add_by_name("Steve").await.unwrap();
    steve.poll().await;
    assert_eq!((world.joins_of(&alex.account), world.joins_of(&steve.account)), (0, 0));

    steve.friends.answer_request(&steve.only_request().await.id, true).await.unwrap();
    both_confirmed(&alex, &steve).await;

    assert_eq!((world.joins_of(&alex.account), world.joins_of(&steve.account)), (1, 1));
}

// 21

#[tokio::test]
async fn while_mojang_cannot_issue_a_certificate_a_usable_cached_one_serves() {
    let world = World::new().await;
    for name in ["Eins", "Zwei"] {
        world.listed_account(name).await;
    }
    let alex = online_with_a_certificate_due_for_refresh(&world, "Alex", "Eins").await;
    world.mojang.refuse_certificates(&alex.account.uuid, Some(MojangError::RateLimited));

    alex.friends.add_by_name("Zwei").await.unwrap();

    assert_eq!(world.certificates_of(&alex), 1);
}

#[tokio::test]
async fn after_mojang_refuses_the_account_the_cached_certificate_is_never_used() {
    let world = World::new().await;
    for name in ["Eins", "Zwei"] {
        world.listed_account(name).await;
    }
    let alex = online_with_a_certificate_due_for_refresh(&world, "Alex", "Eins").await;
    world.mojang.refuse_certificates(&alex.account.uuid, Some(MojangError::NotAllowed));

    let refused = alex.friends.add_by_name("Zwei").await.unwrap_err();

    assert_eq!(error_key(&refused), "errors.friends.directoryNotAllowed");
}

// ---- Freunde per Name aus dem Spiel (INGAME 5.4): solange eine Mod verbunden ist, kein neues Zertifikat ----

#[path = "tests_mod_link_by_name.rs"]
mod from_the_game;
