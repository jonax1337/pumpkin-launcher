use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::error::{AppError, AppResult};
use crate::models::{Instance, Template};
use crate::services::download::http_client;
use crate::services::launch::Running;
use crate::services::store::JsonStore;
use crate::services::Dirs;

/// Globaler App-State (per `app.manage` registriert). Hält die Fachlogik, die über
/// mehrere Stores geht; Commands reichen nur durch.
pub struct AppState {
    pub instances: JsonStore<Instance>,
    pub templates: JsonStore<Template>,
    pub dirs: Dirs,
    pub http: reqwest::Client,
    /// Laufende Spiele je Instanz-ID.
    running: Mutex<HashMap<String, Running>>,
    // ponytail: global try-lock serialisiert Content/Start/Mutationen; bei Bedarf pro Instanz aufteilen.
    operation: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn load(data_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(data_dir)?;
        Ok(Self {
            instances: JsonStore::open(data_dir.join("instances.json"))?,
            templates: JsonStore::open(data_dir.join("templates.json"))?,
            dirs: Dirs::new(data_dir),
            http: http_client()?,
            running: Mutex::new(HashMap::new()),
            operation: tokio::sync::Mutex::new(()),
        })
    }

    pub fn operation(&self, id: Option<&str>) -> AppResult<tokio::sync::MutexGuard<'_, ()>> {
        let guard = self.operation.try_lock().map_err(|_| AppError::Invalid("Eine Installation/Änderung läuft bereits".into()))?;
        if id.is_some_and(|id| self.running().contains_key(id)) { return Err(AppError::Invalid("Instanz läuft noch".into())); }
        Ok(guard)
    }

    pub fn running(&self) -> MutexGuard<'_, HashMap<String, Running>> {
        self.running.lock().unwrap_or_else(|e| e.into_inner())
    }
}
