//! Installation (Stub). Später: Version-Manifest, Java, Libraries, Natives, Assets, Loader,
//! Mods (Modrinth). Mod-JARs liegen einmalig im globalen Cache `<data>/cache/mods/<sha1>.jar`
//! und werden pro Instanz eingebunden (Fabric: `-Dfabric.addMods=@datei`, sonst Hardlink nach `mods/`).
#![allow(dead_code)]

use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::models::Instance;

/// Name des Tauri-Events, über das `InstallProgress` ans Frontend geht.
pub const INSTALL_PROGRESS_EVENT: &str = "install-progress";

/// Benannte Installationsschritte in Ausführungsreihenfolge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallStep {
    Java,
    Client,
    Libraries,
    Natives,
    Assets,
    Loader,
    Mods,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub instance_id: String,
    pub step: InstallStep,
    pub done: u64,
    pub total: u64,
}

pub trait Downloader {
    /// Stellt sicher, dass Client, Libraries, Assets, Loader und Mods der Instanz lokal
    /// vorliegen, und meldet jeden Schritt über `on_progress`.
    async fn prepare_instance(
        &self,
        instance: &Instance,
        game_dir: &Path,
        on_progress: &(dyn Fn(InstallProgress) + Send + Sync),
    ) -> AppResult<()>;
}

pub struct HttpDownloader;

impl Downloader for HttpDownloader {
    async fn prepare_instance(
        &self,
        _instance: &Instance,
        _game_dir: &Path,
        _on_progress: &(dyn Fn(InstallProgress) + Send + Sync),
    ) -> AppResult<()> {
        Err(AppError::NotImplemented("Download"))
    }
}
