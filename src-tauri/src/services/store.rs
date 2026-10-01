//! Einfache JSON-Persistenz: eine Datei pro Collection unter dem App-Datenverzeichnis.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{de::DeserializeOwned, Serialize};

use super::{lock, none_if_missing, write_atomic};
use crate::error::{AppError, AppResult};
use crate::models::{Instance, LibrarySkin, MsAccount, Template};

pub trait Entity: Clone + Serialize + DeserializeOwned {
    const KIND: &'static str;
    fn id(&self) -> &str;
}

impl Entity for Instance {
    const KIND: &'static str = "Instanz";
    fn id(&self) -> &str {
        &self.id
    }
}

impl Entity for Template {
    const KIND: &'static str = "Vorlage";
    fn id(&self) -> &str {
        &self.id
    }
}

impl Entity for MsAccount {
    const KIND: &'static str = "Konto";
    fn id(&self) -> &str {
        &self.id
    }
}

impl Entity for LibrarySkin {
    const KIND: &'static str = "Skin";
    fn id(&self) -> &str {
        &self.id
    }
}

// ponytail: hält die ganze Collection im Speicher und schreibt bei jeder Änderung
// die komplette Datei neu. Reicht für Dutzende Einträge; bei Bedarf auf SQLite wechseln.
pub struct JsonStore<T> {
    path: PathBuf,
    items: Mutex<Vec<T>>,
}

impl<T: Entity> JsonStore<T> {
    /// Lädt die Datei. Fehlt sie, startet der Store leer. Ist sie defekt, wird sie
    /// nach `*.json.corrupt` verschoben statt beim nächsten Speichern überschrieben.
    pub fn open(path: PathBuf) -> AppResult<Self> {
        let items = match none_if_missing(fs::read_to_string(&path))? {
            Some(raw) => match serde_json::from_str(&raw) {
                Ok(items) => items,
                Err(err) => {
                    let backup = path.with_extension("json.corrupt");
                    tracing::warn!(?path, ?backup, %err, "defekte JSON-Datei gesichert, starte leer");
                    fs::rename(&path, &backup)?;
                    Vec::new()
                }
            },
            None => Vec::new(),
        };
        Ok(Self { path, items: Mutex::new(items) })
    }

    pub fn list(&self) -> Vec<T> {
        lock(&self.items).clone()
    }

    pub fn get(&self, id: &str) -> AppResult<T> {
        lock(&self.items)
            .iter()
            .find(|x| x.id() == id)
            .cloned()
            .ok_or_else(|| not_found::<T>(id))
    }

    pub fn insert(&self, item: T) -> AppResult<T> {
        let mut items = lock(&self.items);
        items.push(item.clone());
        if let Err(err) = persist(&self.path, &items) {
            items.pop();
            return Err(err);
        }
        Ok(item)
    }

    pub fn update(&self, item: T) -> AppResult<T> {
        let id = item.id().to_owned();
        self.modify(&id, |current| *current = item)
    }

    /// Ändert einen Eintrag unter dem Lock des Stores: kein anderer Schreiber kommt zwischen Lesen und
    /// Schreiben. `change` darf den Store nicht selbst aufrufen (Deadlock).
    pub fn modify(&self, id: &str, change: impl FnOnce(&mut T)) -> AppResult<T> {
        let mut items = lock(&self.items);
        let idx = items.iter().position(|x| x.id() == id).ok_or_else(|| not_found::<T>(id))?;
        let old = items[idx].clone();
        change(&mut items[idx]);
        if let Err(err) = persist(&self.path, &items) {
            items[idx] = old;
            return Err(err);
        }
        Ok(items[idx].clone())
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut items = lock(&self.items);
        let idx = items.iter().position(|x| x.id() == id).ok_or_else(|| not_found::<T>(id))?;
        let old = items.remove(idx);
        if let Err(err) = persist(&self.path, &items) {
            items.insert(idx, old);
            return Err(err);
        }
        Ok(())
    }
}

fn not_found<T: Entity>(id: &str) -> AppError {
    AppError::NotFound { kind: T::KIND, id: id.to_owned() }
}

/// Schreibt atomar: erst in eine Temp-Datei, dann umbenennen.
fn persist<T: Serialize>(path: &Path, items: &[T]) -> AppResult<()> {
    write_atomic(path, &serde_json::to_vec_pretty(items)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, ModLoader, NewInstance};

    #[test]
    fn crud_roundtrip_and_corrupt_file() {
        let dir = std::env::temp_dir().join(format!("launcher-test-{}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("instances.json");

        let store = JsonStore::<Instance>::open(path.clone()).unwrap();
        let inst = store
            .insert(Instance::from_new(NewInstance {
                name: "Test".into(),
                minecraft_version: "1.21.4".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            }))
            .unwrap();

        let mut renamed = inst.clone();
        renamed.name = "Umbenannt".into();
        store.update(renamed).unwrap();

        let reopened = JsonStore::<Instance>::open(path.clone()).unwrap();
        assert_eq!(reopened.get(&inst.id).unwrap().name, "Umbenannt");
        reopened.remove(&inst.id).unwrap();
        assert!(matches!(reopened.get(&inst.id), Err(AppError::NotFound { .. })));

        fs::write(&path, "{kaputt").unwrap();
        assert!(JsonStore::<Instance>::open(path.clone()).unwrap().list().is_empty());
        assert!(path.with_extension("json.corrupt").exists());

        fs::remove_dir_all(dir).unwrap();
    }

    fn store_with_instance() -> (PathBuf, JsonStore<Instance>, String) {
        let dir = std::env::temp_dir().join(format!("launcher-test-{}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        let store = JsonStore::<Instance>::open(dir.join("instances.json")).unwrap();
        let new = NewInstance { name: "Test".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None };
        let id = store.insert(Instance::from_new(new)).unwrap().id;
        (dir, store, id)
    }

    #[test]
    fn concurrent_modifies_lose_no_change() {
        let (dir, store, id) = store_with_instance();
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    for _ in 0..10 {
                        store.modify(&id, |i| i.playtime_secs += 1).unwrap();
                    }
                });
            }
        });
        assert_eq!(store.get(&id).unwrap().playtime_secs, 80);
        assert!(matches!(store.modify("weg", |_| {}), Err(AppError::NotFound { .. })));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_write_rolls_modify_back() {
        let (dir, store, id) = store_with_instance();
        fs::remove_dir_all(&dir).unwrap();
        assert!(store.modify(&id, |i| i.name = "Neu".into()).is_err());
        assert_eq!(store.get(&id).unwrap().name, "Test");
    }
}
