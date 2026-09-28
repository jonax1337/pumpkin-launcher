//! Spielstart (Stub). Später: Classpath bauen, JVM-Args zusammensetzen, Prozess starten.
#![allow(dead_code)]

use crate::error::{AppError, AppResult};
use crate::models::{Account, Instance};

pub struct LaunchOptions {
    pub java_path: String,
    pub memory_mb: u32,
}

pub trait Launcher {
    /// Startet die Instanz und liefert die Prozess-ID.
    async fn launch(&self, instance: &Instance, account: &Account, opts: &LaunchOptions) -> AppResult<u32>;
}

pub struct ProcessLauncher;

impl Launcher for ProcessLauncher {
    async fn launch(&self, _instance: &Instance, _account: &Account, _opts: &LaunchOptions) -> AppResult<u32> {
        Err(AppError::NotImplemented("Spielstart"))
    }
}
