//! Refresh-Tokens im OS-Schlüsselbund, ein Eintrag pro Konto (Spieler-UUID).
use super::relogin;
use crate::error::{AppError, AppResult};
use crate::services::secrets::{KeyringSecrets, SecretStore};

pub(super) fn save_refresh_token(account_id: &str, token: &str) -> AppResult<()> {
    KeyringSecrets.save(account_id, token)
}

/// Fehlt der Eintrag, muss sich der Nutzer neu anmelden.
pub(super) fn load_refresh_token(account_id: &str) -> AppResult<String> {
    KeyringSecrets.load(account_id)?.ok_or_else(|| AppError::invalid(relogin()))
}

/// Ein fehlender Eintrag gilt als bereits gelöscht.
pub(super) fn delete_refresh_token(account_id: &str) -> AppResult<()> {
    KeyringSecrets.delete(account_id)
}

pub(super) fn has_refresh_token(account_id: &str) -> bool {
    KeyringSecrets.load(account_id).is_ok_and(|token| token.is_some())
}
