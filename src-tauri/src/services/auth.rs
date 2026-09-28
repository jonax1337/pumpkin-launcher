//! Authentifizierung (Stub). Später: Microsoft-OAuth (Auth-Code + PKCE, eigene Azure-App)
//! → Xbox Live → XSTS → Minecraft-Token. Refresh-Tokens kommen in den OS-Keyring (`keyring`-Crate),
//! nie in eine JSON-Datei.
#![allow(dead_code)]

use crate::error::{AppError, AppResult};
use crate::models::{new_id, Account, AccountKind};

pub trait AuthProvider {
    async fn login(&self) -> AppResult<Account>;
    async fn refresh(&self, account: &Account) -> AppResult<Account>;
}

pub struct MicrosoftAuth;

impl AuthProvider for MicrosoftAuth {
    async fn login(&self) -> AppResult<Account> {
        Err(AppError::NotImplemented("Microsoft-Login"))
    }

    async fn refresh(&self, _account: &Account) -> AppResult<Account> {
        Err(AppError::NotImplemented("Token-Refresh"))
    }
}

/// Offline-Account für lokale Tests.
pub fn offline_account(username: &str) -> Account {
    Account { id: new_id(), username: username.to_owned(), kind: AccountKind::Offline, active: true }
}
