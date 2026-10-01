//! Refresh-Tokens im OS-Schlüsselbund, ein Eintrag pro Konto (Spieler-UUID).
use ::keyring::{Entry, Error};

use super::RELOGIN;
use crate::error::{AppError, AppResult};

const SERVICE: &str = "dev.laux.launcher";

pub(super) fn save_refresh_token(account_id: &str, token: &str) -> AppResult<()> {
    Ok(store_token(&entry(account_id)?, token)?)
}

/// Fehlt der Eintrag, muss sich der Nutzer neu anmelden.
pub(super) fn load_refresh_token(account_id: &str) -> AppResult<String> {
    match load_token(&entry(account_id)?) {
        Ok(token) => Ok(token),
        Err(Error::NoEntry) => Err(AppError::invalid(RELOGIN)),
        Err(err) => Err(err.into()),
    }
}

/// Ein fehlender Eintrag gilt als bereits gelöscht.
pub(super) fn delete_refresh_token(account_id: &str) -> AppResult<()> {
    match entry(account_id)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub(super) fn has_refresh_token(account_id: &str) -> bool {
    entry(account_id).is_ok_and(|e| e.get_secret().is_ok())
}

fn entry(account_id: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, account_id)?)
}

/// Token als UTF-8-Bytes ablegen: `set_password` speichert unter Windows UTF-16 und halbiert so
/// das Limit (2560 Byte) auf 1280 Zeichen; Microsoft-Refresh-Tokens können länger sein.
// ponytail: bis 2560 Byte (ASCII-Token = 2560 Zeichen); länger bräuchte Aufteilen auf mehrere Einträge.
fn store_token(entry: &Entry, token: &str) -> ::keyring::Result<()> {
    entry.set_secret(token.as_bytes())
}

fn load_token(entry: &Entry) -> ::keyring::Result<String> {
    let bytes = entry.get_secret()?;
    // Ältere Einträge per `set_password` (UTF-16, enthält Nullbytes bei ASCII-Token).
    if bytes.contains(&0) {
        return entry.get_password();
    }
    String::from_utf8(bytes).map_err(|e| Error::BadEncoding(e.into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Echter Eintrag im OS-Schlüsselbund; `cargo test -- --ignored long_token_survives_keyring`.
    #[test]
    #[ignore = "schreibt in den Schlüsselbund des Nutzers"]
    fn long_token_survives_keyring() {
        let entry = Entry::new("pumpkin-test", "long-token").unwrap();
        let token = "M.C5_xyz-".repeat(300)[..2400].to_string();
        store_token(&entry, &token).unwrap();
        let back = load_token(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), token);
        // Altbestand im UTF-16-Format bleibt lesbar.
        entry.set_password("alt").unwrap();
        let back = load_token(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), "alt");
    }
}
