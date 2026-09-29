use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::models::{Instance, MsAccount, Template};
use crate::services::auth::MsState;
use crate::services::download::http_client;
use crate::services::launch::Running;
use crate::services::store::JsonStore;
use crate::services::Dirs;

/// Globaler App-State (per `app.manage` registriert). Hält die Fachlogik, die über
/// mehrere Stores geht; Commands reichen nur durch.
pub struct AppState {
    pub instances: JsonStore<Instance>,
    pub templates: JsonStore<Template>,
    /// Microsoft-Konten (nur Metadaten, Tokens im Schlüsselbund bzw. in `ms`).
    pub accounts: JsonStore<MsAccount>,
    pub ms: MsState,
    pub dirs: Dirs,
    pub http: reqwest::Client,
    /// Laufende Spiele je Instanz-ID.
    running: Mutex<HashMap<String, Running>>,
    /// Abbrechbare Vorgänge je Instanz- bzw. operationId.
    cancels: Mutex<HashMap<String, CancellationToken>>,
    // ponytail: global try-lock serialisiert Content/Start/Mutationen; bei Bedarf pro Instanz aufteilen.
    operation: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn load(data_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(data_dir)?;
        Ok(Self {
            instances: JsonStore::open(data_dir.join("instances.json"))?,
            templates: JsonStore::open(data_dir.join("templates.json"))?,
            accounts: JsonStore::open(data_dir.join("accounts.json"))?,
            ms: MsState::default(),
            dirs: Dirs::new(data_dir),
            http: http_client()?,
            running: Mutex::new(HashMap::new()),
            operation: tokio::sync::Mutex::new(()),
            cancels: Mutex::new(HashMap::new()),
        })
    }

    pub fn operation(&self, id: Option<&str>) -> AppResult<tokio::sync::MutexGuard<'_, ()>> {
        let guard = self.operation.try_lock().map_err(|_| AppError::Invalid("Eine Installation/Änderung läuft bereits".into()))?;
        if id.is_some_and(|id| self.running().contains_key(id)) { return Err(AppError::Invalid("Instanz läuft noch".into())); }
        Ok(guard)
    }

    /// Führt `work` abbrechbar unter `key` aus; `cancel(key)` verwirft das Future (Aufräumen
    /// über `RemoveOnDrop`) und liefert `AppError::Cancelled`.
    pub async fn cancellable<T>(&self, key: &str, work: impl Future<Output = AppResult<T>>) -> AppResult<T> {
        let token = CancellationToken::new();
        self.cancels().insert(key.to_owned(), token.clone());
        let result = token.run_until_cancelled(work).await;
        self.cancels().remove(key);
        result.unwrap_or(Err(AppError::Cancelled))
    }

    /// Bricht den Vorgang `key` ab; ist keiner (mehr) aktiv, passiert nichts.
    pub fn cancel(&self, key: &str) {
        if let Some(token) = self.cancels().get(key) {
            token.cancel();
        }
    }

    fn cancels(&self) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
        self.cancels.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn running(&self) -> MutexGuard<'_, HashMap<String, Running>> {
        self.running.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancel_stops_work_and_reports_cancelled() {
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let work = state.cancellable("op", std::future::pending::<AppResult<()>>());
        let (result, ()) = tokio::join!(work, async {
            tokio::task::yield_now().await;
            state.cancel("op");
        });
        assert_eq!(result.unwrap_err().to_string(), "Installation abgebrochen");
        assert!(state.cancels().is_empty());
        assert_eq!(state.cancellable("op", async { Ok(1) }).await.unwrap(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
