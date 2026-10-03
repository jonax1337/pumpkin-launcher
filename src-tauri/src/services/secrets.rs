//! Geheimnisspeicher (Schlüsselbund) hinter einer austauschbaren Schnittstelle, auch für die Freunde-Identität.
//! Die Anmeldung (`auth`) und die Freunde teilen sich den Dienst `dev.laux.launcher`; ein Eintrag je Name.
use ::keyring::{Entry, Error};

use crate::error::AppResult;

const SERVICE: &str = "dev.laux.launcher";

pub trait SecretStore: Send + Sync + 'static {
    /// `None`, wenn es den Eintrag nicht gibt. Jeder andere Fehler heißt: der Schlüsselbund ist nicht nutzbar.
    fn load(&self, name: &str) -> AppResult<Option<String>>;
    fn save(&self, name: &str, value: &str) -> AppResult<()>;
    /// Ein fehlender Eintrag gilt als bereits gelöscht.
    fn delete(&self, name: &str) -> AppResult<()>;
}

/// Der Schlüsselbund des Betriebssystems.
pub struct KeyringSecrets;

impl SecretStore for KeyringSecrets {
    fn load(&self, name: &str) -> AppResult<Option<String>> {
        match load_text(&entry(name)?) {
            Ok(text) => Ok(Some(text)),
            Err(Error::NoEntry) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn save(&self, name: &str, value: &str) -> AppResult<()> {
        Ok(store_text(&entry(name)?, value)?)
    }

    fn delete(&self, name: &str) -> AppResult<()> {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

fn entry(name: &str) -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, name)?)
}

/// Text als UTF-8-Bytes ablegen: `set_password` speichert unter Windows UTF-16 und halbiert so
/// das Limit (2560 Byte) auf 1280 Zeichen; Microsoft-Refresh-Tokens können länger sein.
// ponytail: bis 2560 Byte (ASCII-Token = 2560 Zeichen); länger bräuchte Aufteilen auf mehrere Einträge.
fn store_text(entry: &Entry, text: &str) -> ::keyring::Result<()> {
    entry.set_secret(text.as_bytes())
}

fn load_text(entry: &Entry) -> ::keyring::Result<String> {
    let bytes = entry.get_secret()?;
    // Ältere Einträge per `set_password` (UTF-16, enthält Nullbytes bei ASCII-Text).
    if bytes.contains(&0) {
        return entry.get_password();
    }
    String::from_utf8(bytes).map_err(|e| Error::BadEncoding(e.into_bytes()))
}

#[cfg(test)]
pub use fake::MemorySecretStore;

#[cfg(test)]
mod fake {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{Error, SecretStore};
    use crate::error::AppResult;
    use crate::services::lock;

    /// Schlüsselbund im Speicher für Tests; `unreachable()` spielt ein System ohne Schlüsselbund nach.
    #[derive(Default)]
    pub struct MemorySecretStore {
        entries: Mutex<HashMap<String, String>>,
        reachable: bool,
    }

    impl MemorySecretStore {
        pub fn new() -> Self {
            Self { reachable: true, ..Self::default() }
        }

        pub fn unreachable() -> Self {
            Self::default()
        }

        fn ensure_reachable(&self) -> AppResult<()> {
            if self.reachable {
                return Ok(());
            }
            Err(Error::NoStorageAccess("kein Dienst".into()).into())
        }
    }

    impl SecretStore for MemorySecretStore {
        fn load(&self, name: &str) -> AppResult<Option<String>> {
            self.ensure_reachable()?;
            Ok(lock(&self.entries).get(name).cloned())
        }

        fn save(&self, name: &str, value: &str) -> AppResult<()> {
            self.ensure_reachable()?;
            lock(&self.entries).insert(name.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, name: &str) -> AppResult<()> {
            self.ensure_reachable()?;
            lock(&self.entries).remove(name);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    #[test]
    fn memory_store_saves_loads_and_deletes() {
        let store = MemorySecretStore::new();
        assert_eq!(store.load("a").unwrap(), None);
        store.save("a", "geheim").unwrap();
        assert_eq!(store.load("a").unwrap().as_deref(), Some("geheim"));
        store.delete("a").unwrap();
        store.delete("a").unwrap();
        assert_eq!(store.load("a").unwrap(), None);
    }

    #[test]
    fn unreachable_store_fails_every_call_with_a_keyring_error() {
        let store = MemorySecretStore::unreachable();
        assert!(matches!(store.load("a"), Err(AppError::Keyring(_))));
        assert!(matches!(store.save("a", "x"), Err(AppError::Keyring(_))));
        assert!(matches!(store.delete("a"), Err(AppError::Keyring(_))));
    }

    /// Echter Eintrag im OS-Schlüsselbund; `cargo test -- --ignored long_text_survives_keyring`.
    #[test]
    #[ignore = "schreibt in den Schlüsselbund des Nutzers"]
    fn long_text_survives_keyring() {
        let entry = Entry::new("pumpkin-test", "long-token").unwrap();
        let token = "M.C5_xyz-".repeat(300)[..2400].to_string();
        store_text(&entry, &token).unwrap();
        let back = load_text(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), token);
        // Altbestand im UTF-16-Format bleibt lesbar.
        entry.set_password("alt").unwrap();
        let back = load_text(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), "alt");
    }
}
