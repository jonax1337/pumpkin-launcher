//! `data:`-URLs, damit die Oberfläche Bilder ohne eigene Datei-Freigabe anzeigen kann.
use base64::Engine;

/// Präfix einer `data:`-URL mit base64-codiertem PNG.
pub(crate) const PNG_DATA_URL: &str = "data:image/png;base64,";

/// Bytes als `data:`-URL.
pub(crate) fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}
