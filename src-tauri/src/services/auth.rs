//! Authentifizierung. Microsoft-OAuth ist noch ein Stub (Auth-Code + PKCE, eigene Azure-App
//! → Xbox Live → XSTS → Minecraft-Token; Refresh-Tokens in den OS-Keyring, nie in JSON).
use md5::{Digest, Md5};

use crate::error::{AppError, AppResult};
use crate::models::{Account, AccountKind};

#[allow(dead_code, async_fn_in_trait)]
pub trait AuthProvider {
    async fn login(&self) -> AppResult<Account>;
    async fn refresh(&self, account: &Account) -> AppResult<Account>;
}

#[allow(dead_code)]
pub struct MicrosoftAuth;

impl AuthProvider for MicrosoftAuth {
    async fn login(&self) -> AppResult<Account> {
        Err(AppError::NotImplemented("Microsoft-Login"))
    }

    async fn refresh(&self, _account: &Account) -> AppResult<Account> {
        Err(AppError::NotImplemented("Token-Refresh"))
    }
}

/// UUID eines Offline-Spielers wie im Spiel selbst: MD5 von `OfflinePlayer:<name>`
/// mit Version 3 (entspricht Javas `UUID.nameUUIDFromBytes`).
pub fn offline_uuid(username: &str) -> uuid::Uuid {
    let hash: [u8; 16] = Md5::digest(format!("OfflinePlayer:{username}")).into();
    uuid::Builder::from_md5_bytes(hash).into_uuid()
}

/// Offline-Account; die ID ist die deterministische Spieler-UUID. Namen wie im Spiel:
/// 3–16 Zeichen aus `A-Z a-z 0-9 _`.
pub fn offline_account(username: &str) -> AppResult<Account> {
    let valid = (3..=16).contains(&username.len()) && username.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if !valid {
        return Err(AppError::Invalid(format!("Ungültiger Spielername '{username}' (3–16 Zeichen, A-Z, 0-9, _)")));
    }
    Ok(Account {
        id: offline_uuid(username).to_string(),
        username: username.to_owned(),
        kind: AccountKind::Offline,
        active: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_uuid_matches_java() {
        // Referenz: Javas UUID.nameUUIDFromBytes("OfflinePlayer:Notch".getBytes(UTF_8)).
        assert_eq!(offline_account("Notch").unwrap().id, "b50ad385-829d-3141-a216-7e7d7539ba7f");
        assert!(offline_account("ab").is_err());
        assert!(offline_account("bad name").is_err());
    }
}
