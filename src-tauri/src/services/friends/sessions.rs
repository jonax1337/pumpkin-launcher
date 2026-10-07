//! Geteilte Welten (SPEC 5.3-5.4, 6, 7.3-7.4): [`FriendSessions`] verbindet Gastgeber, Einladungen, Beitritt und Mod
//! mit dem Freunde-Dienst. Es hängt sich nur über die Naht des Dienstes ein (Stream-Handler, Lebenszyklus,
//! Steuernachrichten) und hört auf die Spielsignale.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock, Weak};
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use tokio::sync::{broadcast, mpsc};

use super::control::SessionControl;
use super::hosting::{self, Hosting};
use super::invites::{self, Invites};
use super::joining::{self, JoinTimers, Joins};
use super::lookup::ModLookup;
use super::manifest::{HashCache, VersionIndex};
use super::mod_link::{self, ModLink};
use super::session_events::{NoSessionEvents, SessionEvent, SessionEvents};
use super::{Friends, HandlerAlreadySet, Lifecycle, LifecycleEvent, PeerStreamHandler};
use crate::error::AppResult;
use crate::models::Instance;
use crate::services::download;
use crate::services::gamesignal::{GameSignal, GameSignals};
use crate::services::modbridge::ModBridge;
use crate::services::mojang::{VersionManifest, MANIFEST_URL};
use crate::services::p2p::{BiStream, PeerId};
use crate::services::store::JsonStore;
use crate::services::{lock, Dirs};

/// So oft prüft der Gastgeber, ob der LAN-Port noch dem Spiel gehört (SPEC 6.1).
pub const PRODUCTION_LIVENESS: Duration = Duration::from_secs(15);
/// So lange gilt Mojangs Versionsliste, bevor sie neu geladen wird.
const VERSIONS_TTL: Duration = Duration::from_secs(3600);

/// Erscheinungszeiten der Minecraft-Versionen; in der App aus Mojangs Manifest, in Tests fest.
pub trait VersionCatalog: Send + Sync + 'static {
    fn index(&self) -> BoxFuture<'_, AppResult<VersionIndex>>;
}

/// Minecraft-Version und ihre Erscheinungszeit, wie Mojangs Manifest sie nennt.
type ReleaseTimes = Arc<Vec<(String, String)>>;

/// Mojangs Versionsliste, eine Stunde im Speicher.
pub struct MojangVersions {
    http: reqwest::Client,
    cached: tokio::sync::Mutex<Option<(Instant, ReleaseTimes)>>,
}

impl MojangVersions {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            cached: tokio::sync::Mutex::new(None),
        }
    }

    async fn release_times(&self) -> AppResult<ReleaseTimes> {
        let mut cached = self.cached.lock().await;
        if let Some((_, entries)) = cached
            .as_ref()
            .filter(|(fetched, _)| fetched.elapsed() < VERSIONS_TTL)
        {
            return Ok(entries.clone());
        }
        let manifest: VersionManifest = download::get_json(&self.http, MANIFEST_URL).await?;
        let entries = Arc::new(
            manifest
                .versions
                .into_iter()
                .map(|entry| (entry.id, entry.release_time))
                .collect(),
        );
        *cached = Some((Instant::now(), Arc::clone(&entries)));
        Ok(entries)
    }
}

impl VersionCatalog for MojangVersions {
    fn index(&self) -> BoxFuture<'_, AppResult<VersionIndex>> {
        Box::pin(async move {
            Ok(VersionIndex::new(
                self.release_times().await?.iter().cloned(),
            ))
        })
    }
}

/// Was die Sitzungen brauchen; `lib.rs` baut es mit den Produktionswerten, Tests mit kurzen Zeiten.
pub struct SessionContext {
    pub friends: Friends,
    pub signals: GameSignals,
    pub bridge: ModBridge,
    pub instances: Arc<JsonStore<Instance>>,
    pub dirs: Dirs,
    pub lookup: Arc<dyn ModLookup>,
    pub versions: Arc<dyn VersionCatalog>,
    pub timers: JoinTimers,
    /// Abstand der Port-Prüfungen während einer Sitzung ([`PRODUCTION_LIVENESS`]).
    pub liveness: Duration,
}

/// Gastgeber- und Beitrittssitzungen, Einladungen und die Verbindung zur Mod; billig zu klonen.
#[derive(Clone)]
pub struct FriendSessions {
    pub(super) shared: Arc<Shared>,
}

/// Zustand aller Sitzungen; die Teilmodule erweitern [`FriendSessions`] um ihre Befehle.
pub(super) struct Shared {
    pub(super) friends: Friends,
    pub(super) bridge: ModBridge,
    pub(super) instances: Arc<JsonStore<Instance>>,
    pub(super) dirs: Dirs,
    pub(super) lookup: Arc<dyn ModLookup>,
    pub(super) versions: Arc<dyn VersionCatalog>,
    pub(super) hashes: Arc<HashCache>,
    pub(super) timers: JoinTimers,
    pub(super) liveness: Duration,
    pub(super) hosting: Hosting,
    pub(super) invites: Invites,
    pub(super) joins: Joins,
    pub(super) mods: ModLink,
    events: RwLock<Arc<dyn SessionEvents>>,
    signals: Mutex<Option<broadcast::Receiver<GameSignal>>>,
}

impl FriendSessions {
    /// Hört ab sofort auf die Spielsignale, damit kein Spielstart verloren geht; alles Weitere erst mit `start`.
    pub fn new(context: SessionContext) -> Self {
        let shared = Shared {
            signals: Mutex::new(Some(context.signals.subscribe())),
            friends: context.friends,
            bridge: context.bridge,
            instances: context.instances,
            dirs: context.dirs,
            lookup: context.lookup,
            versions: context.versions,
            hashes: Arc::default(),
            timers: context.timers,
            liveness: context.liveness,
            hosting: Hosting::default(),
            invites: Invites::default(),
            joins: Joins::default(),
            mods: ModLink::default(),
            events: RwLock::new(Arc::new(NoSessionEvents)),
        };
        Self {
            shared: Arc::new(shared),
        }
    }

    /// Setzt den Empfänger der Ereignisse und hängt sich in den Freunde-Dienst ein; genau einmal.
    pub fn start(&self, events: Arc<dyn SessionEvents>) -> Result<(), HandlerAlreadySet> {
        let shared = &self.shared;
        *shared
            .events
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = events;
        shared
            .friends
            .register_stream_handler(Arc::new(SessionHandler(Arc::downgrade(shared))))?;
        tokio::spawn(follow_lifecycle(
            Arc::downgrade(shared),
            shared.friends.subscribe_lifecycle(),
        ));
        if let Some(signals) = lock(&shared.signals).take() {
            tokio::spawn(follow_signals(Arc::downgrade(shared), signals));
        }
        tokio::spawn(mod_link::refresh_regularly(Arc::downgrade(shared)));
        Ok(())
    }
}

impl Shared {
    pub(super) fn emit(&self, event: SessionEvent) {
        self.events
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .emit(event);
    }

    /// Sitzungsbefehle gibt es nur bei aktivierter, verfügbarer Funktion (wie die übrigen Freunde-Befehle).
    pub(super) fn ensure_enabled(&self) -> AppResult<()> {
        self.friends.core.ensure_enabled()
    }
}

/// Reicht die Streams und Steuernachrichten der Freunde an Gastgeber und Einladungen weiter.
struct SessionHandler(Weak<Shared>);

impl PeerStreamHandler for SessionHandler {
    fn on_request_stream<'a>(&'a self, peer: &'a PeerId, stream: BiStream) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if let Some(shared) = self.0.upgrade() {
                hosting::serve_request(&shared, peer, stream).await;
            }
        })
    }

    fn on_tunnel_stream<'a>(
        &'a self,
        peer: &'a PeerId,
        session_id: String,
        stream: BiStream,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if let Some(shared) = self.0.upgrade() {
                hosting::serve_tunnel(&shared, peer, &session_id, stream).await;
            }
        })
    }

    fn on_control_message<'a>(
        &'a self,
        peer: &'a PeerId,
        message: SessionControl,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let Some(shared) = self.0.upgrade() else {
                return;
            };
            match message {
                SessionControl::Invite(invite) => invites::receive(&shared, peer, invite).await,
                SessionControl::InviteRevoke { invite_id, reason } => {
                    invites::revoked(&shared, peer, &invite_id, reason);
                }
                SessionControl::InviteDecline { invite_id } => {
                    hosting::declined(&shared, peer, &invite_id)
                }
            }
        })
    }
}

/// Räumt vor jedem Abbau der Endpunkte die Sitzungen ab (SPEC 6.1, 6.2); das `inviteRevoke` an die Gäste ist dann
/// schon eingereiht, wenn `done` fällt.
async fn follow_lifecycle(shared: Weak<Shared>, mut events: mpsc::Receiver<LifecycleEvent>) {
    while let Some(LifecycleEvent { kind, done }) = events.recv().await {
        let Some(shared) = shared.upgrade() else {
            return;
        };
        hosting::end_for_lifecycle(&shared, kind);
        joining::end_for_lifecycle(&shared, kind);
        if matches!(kind, Lifecycle::Disabled | Lifecycle::IdentityChanged) {
            shared.invites.clear();
            mod_link::disabled(&shared);
        }
        drop(done);
    }
}

async fn follow_signals(shared: Weak<Shared>, mut signals: broadcast::Receiver<GameSignal>) {
    loop {
        let signal = match signals.recv().await {
            Ok(signal) => signal,
            Err(broadcast::error::RecvError::Lagged(missed)) => {
                tracing::warn!(
                    missed,
                    "Spielsignale verpasst, Sitzungsstand kann veraltet sein"
                );
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => return,
        };
        let Some(shared) = shared.upgrade() else {
            return;
        };
        on_signal(&shared, signal);
    }
}

fn on_signal(shared: &Arc<Shared>, signal: GameSignal) {
    match signal {
        GameSignal::Spawned {
            instance_id,
            pid,
            online_account,
            friend_join,
        } => {
            hosting::game_spawned(shared, &instance_id, pid, online_account);
            shared.mods.new_launch(&instance_id);
            if let Some(join_id) = friend_join {
                shared.joins.spawned(&join_id, pid);
            }
        }
        GameSignal::LaunchProgress { friend_join, .. } => shared.joins.progressed(&friend_join),
        GameSignal::LaunchFailed { friend_join, .. } => {
            joining::launch_failed(shared, &friend_join)
        }
        GameSignal::LanOpened {
            instance_id,
            port,
            source,
        } => hosting::lan_opened(shared, &instance_id, port, source),
        GameSignal::LanClosed { instance_id } => hosting::lan_closed(shared, &instance_id),
        GameSignal::Exited { instance_id } => {
            hosting::game_exited(shared, &instance_id);
            joining::game_exited(shared, &instance_id);
            shared.mods.forget_launch(&instance_id);
        }
        GameSignal::ModConnected { instance_id } => mod_link::connected(shared, &instance_id),
        GameSignal::ModDisconnected { instance_id } => mod_link::disconnected(shared, &instance_id),
    }
}

/// Name eines Freundes: eigener Spitzname vor Minecraft-Namen und dem bereinigten Ersatznamen.
pub(super) fn shown_name(friend: &super::contract::Friend) -> String {
    friend
        .alias
        .clone()
        .or_else(|| super::sanitize::mc_name(friend.mc_name.as_deref()))
        .unwrap_or_else(|| friend.display_name.clone())
}

/// Freunde nach Peer-ID; nur bei aktivierter Funktion.
pub(super) async fn friends_by_id(
    shared: &Shared,
) -> AppResult<HashMap<String, super::contract::Friend>> {
    let friends = shared.friends.list().await?;
    Ok(friends
        .into_iter()
        .map(|friend| (friend.id.clone(), friend))
        .collect())
}
