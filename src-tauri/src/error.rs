use serde::{Serialize, Serializer};

/// Zentraler Fehlertyp des Backends. Wird an das Frontend als String serialisiert.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("E/A-Fehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON-Fehler: {0}")]
    Json(#[from] serde_json::Error),
    #[error("HTTP-Fehler: {0}")]
    Http(#[from] reqwest::Error),
    #[error("ZIP-Fehler: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Download fehlgeschlagen: {0}")]
    Download(String),
    #[error("Tauri-Fehler: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("{kind} '{id}' nicht gefunden")]
    NotFound { kind: &'static str, id: String },
    #[error("Ungültige Eingabe: {0}")]
    Invalid(String),
    #[error("Noch nicht implementiert: {0}")]
    NotImplemented(&'static str),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
