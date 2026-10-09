//! Das Geheimnis dieser Installation, das Verknüpfungen beglaubigt: Ein Link wie `pumpkin://launch/<id>?s=<Token>` startet
//! ohne Rückfrage, wenn der Token zur Instanz passt. Jede Webseite kann Links an den Launcher schicken, den Token kennt
//! aber nur, wer die Verknüpfung oder das Geheimnis gelesen hat. Der Token ist ein HMAC der Instanz-ID: Eine weitergegebene
//! Verknüpfung öffnet so nur ihre eigene Instanz und verrät das Geheimnis nicht.
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use data_encoding::HEXLOWER;
use ring::hmac;

use super::none_if_missing;
use crate::error::AppResult;

const SECRET_FILE: &str = "shortcut-secret.txt";
const SECRET_BYTES: usize = 32;

/// Das Geheimnis aus `shortcut-secret.txt` im Datenordner; es wird beim ersten Gebrauch gelesen oder angelegt, damit ein
/// Datenordner ohne Schreibrecht nur die Verknüpfungen kostet und nicht den Start.
pub struct ShortcutKey {
    path: PathBuf,
    key: OnceLock<hmac::Key>,
}

impl ShortcutKey {
    pub fn in_dir(dir: &Path) -> Self {
        Self { path: dir.join(SECRET_FILE), key: OnceLock::new() }
    }

    /// Der Token für Links auf die Instanz `instance_id`, in Kleinbuchstaben-Hex.
    pub fn token_for(&self, instance_id: &str) -> AppResult<String> {
        let tag = hmac::sign(self.key()?, instance_id.as_bytes());
        Ok(HEXLOWER.encode(tag.as_ref()))
    }

    /// Gehört `token` zu `instance_id`? Die Prüfung läuft in konstanter Zeit; was nicht lesbar ist, gilt als falsch.
    pub fn accepts(&self, instance_id: &str, token: &str) -> bool {
        let Ok(tag) = HEXLOWER.decode(token.as_bytes()) else {
            return false;
        };
        match self.key() {
            Ok(key) => hmac::verify(key, instance_id.as_bytes(), &tag).is_ok(),
            Err(err) => {
                tracing::warn!(%err, "Geheimnis der Verknüpfungen nicht verfügbar");
                false
            }
        }
    }

    fn key(&self) -> AppResult<&hmac::Key> {
        if let Some(key) = self.key.get() {
            return Ok(key);
        }
        let secret = match read_secret(&self.path)? {
            Some(secret) => secret,
            None => create_secret(&self.path)?,
        };
        Ok(self.key.get_or_init(|| hmac::Key::new(hmac::HMAC_SHA256, &secret)))
    }
}

/// Das gespeicherte Geheimnis; `None`, wenn die Datei fehlt oder nicht ein Geheimnis in voller Länge enthält. Dann
/// entsteht ein neues, und ältere Verknüpfungen fragen künftig zurück, statt ohne Rückfrage zu starten.
fn read_secret(path: &Path) -> AppResult<Option<Vec<u8>>> {
    let Some(text) = none_if_missing(fs::read(path))? else {
        return Ok(None);
    };
    Ok(HEXLOWER.decode(text.trim_ascii()).ok().filter(|secret| secret.len() == SECRET_BYTES))
}

fn create_secret(path: &Path) -> AppResult<Vec<u8>> {
    let mut secret = [0; SECRET_BYTES];
    getrandom::fill(&mut secret).map_err(|err| io::Error::other(err.to_string()))?;
    write_private(path, &HEXLOWER.encode(&secret))?;
    Ok(secret.to_vec())
}

/// Schreibt `text` in eine Datei, die unter Unix nur der Nutzer lesen darf.
fn write_private(path: &Path, text: &str) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_token_belongs_to_its_instance_only() {
        let dir = temp_dir();
        let key = ShortcutKey::in_dir(&dir);

        let token = key.token_for("instance-a").unwrap();

        assert_eq!(token.len(), 64);
        assert!(key.accepts("instance-a", &token));
        assert!(!key.accepts("instance-b", &token));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn malformed_or_altered_tokens_are_refused() {
        let dir = temp_dir();
        let key = ShortcutKey::in_dir(&dir);
        let token = key.token_for("a").unwrap();
        let flipped = format!("{}{}", &token[..63], if token.ends_with('0') { '1' } else { '0' });
        let too_long = format!("{token}00");
        let upper = token.to_uppercase();

        for bad in ["", "zz", "ABC", &token[..62], too_long.as_str(), upper.as_str(), flipped.as_str()] {
            assert!(!key.accepts("a", bad), "{bad}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_secret_is_stored_and_reused_by_the_next_start() {
        let dir = temp_dir();
        let token = ShortcutKey::in_dir(&dir).token_for("a").unwrap();

        assert!(ShortcutKey::in_dir(&dir).accepts("a", &token));
        assert_eq!(fs::read(dir.join(SECRET_FILE)).unwrap().len(), SECRET_BYTES * 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn another_installation_does_not_accept_the_token() {
        let (first, second) = (temp_dir(), temp_dir());
        let token = ShortcutKey::in_dir(&first).token_for("a").unwrap();

        assert!(!ShortcutKey::in_dir(&second).accepts("a", &token));
        fs::remove_dir_all(first).unwrap();
        fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn a_damaged_secret_is_replaced_and_old_tokens_stop_working() {
        let dir = temp_dir();
        let old = ShortcutKey::in_dir(&dir).token_for("a").unwrap();
        fs::write(dir.join(SECRET_FILE), "kaputt").unwrap();

        let key = ShortcutKey::in_dir(&dir);

        assert!(!key.accepts("a", &old));
        assert!(key.accepts("a", &key.token_for("a").unwrap()));
        fs::remove_dir_all(dir).unwrap();
    }
}
