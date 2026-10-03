//! Hilfen für die Tests der Freunde-Module.
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::models::new_id;

/// Temporärer Ordner, der beim Fallenlassen verschwindet.
pub(super) struct TempDir(PathBuf);

impl TempDir {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!("launcher-test-{}", new_id()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Schlüssel des Fehlercodes, so wie ihn das Frontend bekommt.
pub(super) fn error_key(err: &AppError) -> String {
    serde_json::to_value(err).unwrap()["key"].as_str().unwrap_or_default().to_owned()
}
