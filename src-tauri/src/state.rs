use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::{Instance, Preset};
use crate::services::store::JsonStore;

/// Globaler App-State (per `app.manage` registriert). Hält die Fachlogik, die über
/// mehrere Stores geht; Commands reichen nur durch.
pub struct AppState {
    pub instances: JsonStore<Instance>,
    pub presets: JsonStore<Preset>,
}

impl AppState {
    pub fn load(data_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(data_dir)?;
        Ok(Self {
            instances: JsonStore::open(data_dir.join("instances.json"))?,
            presets: JsonStore::open(data_dir.join("presets.json"))?,
        })
    }

    /// Preset inkl. aller geerbten Werte. Schlägt fehl bei fehlendem Eltern-Preset oder Zyklus.
    pub fn resolve_preset(&self, preset: &Preset) -> AppResult<Preset> {
        preset.resolve(|id| self.presets.get(id))
    }

    /// Löscht ein Preset, sofern kein anderes davon erbt.
    pub fn delete_preset(&self, id: &str) -> AppResult<()> {
        if let Some(child) = self.presets.list().into_iter().find(|p| p.inherits_from.as_deref() == Some(id)) {
            return Err(AppError::Invalid(format!("Preset '{}' erbt noch davon", child.name)));
        }
        self.presets.remove(id)
    }

    pub fn apply_preset(&self, instance_id: &str, preset_id: &str) -> AppResult<Instance> {
        let preset = self.resolve_preset(&self.presets.get(preset_id)?)?;
        let mut instance = self.instances.get(instance_id)?;
        instance.apply_preset(&preset);
        self.instances.update(instance)
    }
}
