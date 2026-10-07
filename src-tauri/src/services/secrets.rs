//! Geheimnisspeicher (Schlüsselbund) hinter einer austauschbaren Schnittstelle, auch für die Freunde-Identität.
//! Die Anmeldung (`auth`) und die Freunde teilen sich den Dienst `dev.laux.launcher`; ein Eintrag je Name.
use keyring_core::{api::CredentialStoreApi, Entry, Error};

#[cfg(target_os = "macos")]
use apple_native_keyring_store::keychain::Store;
#[cfg(windows)]
use windows_native_keyring_store::Store;
#[cfg(all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android"))))]
use zbus_secret_service_keyring_store::Store;

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
    Ok(platform_entry(SERVICE, name)?)
}

#[cfg(any(windows, target_os = "macos", all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android")))))]
fn platform_entry(service: &str, name: &str) -> keyring_core::Result<Entry> {
    // A fresh Linux connection lets each operation recover after Secret Service starts or restarts.
    // Never cache initialization failures or install a process-global default store.
    Store::new()?.build(service, name, None)
}

#[cfg(not(any(windows, target_os = "macos", all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android"))))))]
fn platform_entry(_service: &str, _name: &str) -> keyring_core::Result<Entry> {
    Err(Error::NotSupportedByStore("this platform has no supported native credential store".into()))
}

/// Text als UTF-8-Bytes ablegen: `set_password` speichert unter Windows UTF-16 und halbiert so
/// das Limit (2560 Byte) auf 1280 Zeichen; Microsoft-Refresh-Tokens können länger sein.
// ponytail: bis 2560 Byte (ASCII-Token = 2560 Zeichen); länger bräuchte Aufteilen auf mehrere Einträge.
fn store_text(entry: &Entry, text: &str) -> keyring_core::Result<()> {
    entry.set_secret(text.as_bytes())
}

fn load_text(entry: &Entry) -> keyring_core::Result<String> {
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
        let account = uuid::Uuid::new_v4().to_string();
        let entry = platform_entry("pumpkin-test", &account).unwrap();
        assert!(matches!(load_text(&entry), Err(Error::NoEntry)));
        let token = long_test_token();
        store_text(&entry, &token).unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "services::secrets::tests::native_secret_child_reads_and_deletes", "--test-threads=1"])
            .env("PUMPKIN_KEYRING_SMOKE_ACCOUNT", &account)
            .status();
        let remaining = load_text(&entry);
        if !matches!(&remaining, Err(Error::NoEntry)) {
            entry.delete_credential().unwrap();
        }
        assert!(child.unwrap().success());
        assert!(matches!(remaining, Err(Error::NoEntry)));
        // Altbestand im UTF-16-Format bleibt lesbar.
        entry.set_password("alt-ä-🔑").unwrap();
        let back = load_text(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), "alt-ä-🔑");
        assert!(matches!(load_text(&entry), Err(Error::NoEntry)));
        assert!(matches!(entry.delete_credential(), Err(Error::NoEntry)));
    }

    #[test]
    #[ignore = "child process of long_text_survives_keyring; never run the ignored suite unfiltered"]
    fn native_secret_child_reads_and_deletes() {
        let account = std::env::var("PUMPKIN_KEYRING_SMOKE_ACCOUNT").expect("parent smoke account");
        uuid::Uuid::parse_str(&account).expect("synthetic UUID account");
        let entry = platform_entry("pumpkin-test", &account).unwrap();
        let back = load_text(&entry);
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), long_test_token());
    }

    fn long_test_token() -> String {
        "M.C5_xyz-".repeat(300)[..2400].to_string()
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "schreibt einen kurzlebigen Testeintrag in den Windows-Schlüsselbund"]
    fn legacy_utf16_secret_is_read_without_reencoding_the_credential() {
        let account = uuid::Uuid::new_v4().to_string();
        let entry = platform_entry("pumpkin-test", &account).unwrap();
        let text = "alt-ä-🔑";
        let bytes: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        entry.set_secret(&bytes).unwrap();
        let back = load_text(&platform_entry("pumpkin-test", &account).unwrap());
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), text);
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "braucht einen isolierten entsperrten Secret Service; --exact --test-threads=1"]
    fn failed_secret_service_initialization_can_recover() {
        assert_eq!(std::env::var("PUMPKIN_KEYRING_SMOKE_ISOLATED").as_deref(), Ok("1"));
        let address = std::env::var_os("DBUS_SESSION_BUS_ADDRESS").expect("private D-Bus session");
        let account = uuid::Uuid::new_v4().to_string();
        // Run only this test in its own process: the connection address is process-global.
        std::env::set_var("DBUS_SESSION_BUS_ADDRESS", format!("unix:path=/tmp/pumpkin-missing-{account}"));
        let unavailable = platform_entry("pumpkin-test", &account);
        std::env::set_var("DBUS_SESSION_BUS_ADDRESS", address);
        assert!(unavailable.is_err());

        let entry = platform_entry("pumpkin-test", &account).unwrap();
        store_text(&entry, "recovered").unwrap();
        let back = load_text(&platform_entry("pumpkin-test", &account).unwrap());
        entry.delete_credential().unwrap();
        assert_eq!(back.unwrap(), "recovered");
    }
}
