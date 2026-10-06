use std::path::PathBuf;
use std::sync::Arc;

use launcher_lib::error::{AppError, AppResult};
use launcher_lib::models::Instance;
use launcher_lib::services::friends::events::NoEvents;
use launcher_lib::services::friends::lookup::{ModrinthHttp, ModrinthLookup};
use launcher_lib::services::friends::session_events::NoSessionEvents;
use launcher_lib::services::friends::{
    FriendSessions, Friends, JoinTimers, MojangVersions, NetOptions, SessionContext,
    PRODUCTION_LIVENESS,
};
use launcher_lib::services::gamesignal::GameSignals;
use launcher_lib::services::modbridge::ModBridge;
use launcher_lib::services::secrets::SecretStore;
use launcher_lib::services::store::JsonStore;
use launcher_lib::services::Dirs;

pub struct SmokeFriends {
    root: PathBuf,
    friends: Friends,
    sessions: FriendSessions,
}

impl SmokeFriends {
    pub fn new(
        dirs: &Dirs,
        instance: &Instance,
        client: reqwest::Client,
        signals: GameSignals,
        bridge: ModBridge,
    ) -> Result<Self, String> {
        let root = dirs.root.join(format!("smoke-friends-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).map_err(|error| format!("{}: {error}", root.display()))?;
        let setup = || -> AppResult<(Friends, FriendSessions)> {
            let friends = Friends::new(
                &Dirs::new(&root),
                Arc::new(NoSmokeCredentials),
                signals.clone(),
                bridge.clone(),
                NetOptions::production(),
            )?;
            let instances = Arc::new(JsonStore::open(root.join("instances.json"))?);
            instances.insert(instance.clone())?;
            let sessions = FriendSessions::new(SessionContext {
                friends: friends.clone(),
                signals,
                bridge,
                instances,
                dirs: dirs.clone(),
                lookup: Arc::new(ModrinthLookup::new(ModrinthHttp::new()?)),
                versions: Arc::new(MojangVersions::new(client)),
                timers: JoinTimers::production(),
                liveness: PRODUCTION_LIVENESS,
            });
            Ok((friends, sessions))
        };
        match setup() {
            Ok((friends, sessions)) => Ok(Self { root, friends, sessions }),
            Err(error) => {
                let reason = error.to_string();
                std::fs::remove_dir_all(&root)
                    .map_err(|cleanup| format!("{reason}; cleanup {}: {cleanup}", root.display()))?;
                Err(reason)
            }
        }
    }

    pub async fn start(&self) -> Result<(), String> {
        self.friends.start(Arc::new(NoEvents), None).await;
        self.sessions.start(Arc::new(NoSessionEvents)).map_err(|error| error.to_string())?;
        let state = self.friends.state();
        eprintln!("[smoke] real Friends backend: enabled={}, availability={:?}, network={:?}; no Microsoft account or smoke credentials", state.enabled, state.availability, state.network);
        Ok(())
    }

    pub async fn shutdown(self) -> Result<(), String> {
        self.friends.shutdown().await;
        let Self { root, friends, sessions } = self;
        drop(sessions);
        drop(friends);
        std::fs::remove_dir_all(&root).map_err(|error| format!("cleanup {}: {error}", root.display()))
    }
}

// The production keyring namespace is global, not scoped by Dirs. Smoke has no credential
// provider: report that real limitation through Friends' availability gate, never read user keys.
struct NoSmokeCredentials;

impl SecretStore for NoSmokeCredentials {
    fn load(&self, _name: &str) -> AppResult<Option<String>> {
        Err(AppError::invalid("smoke has no isolated credential provider"))
    }

    fn save(&self, _name: &str, _value: &str) -> AppResult<()> {
        Err(AppError::invalid("smoke has no isolated credential provider"))
    }

    fn delete(&self, _name: &str) -> AppResult<()> {
        Err(AppError::invalid("smoke has no isolated credential provider"))
    }
}
