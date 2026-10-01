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

/// Alle Entitäten tragen ihre ID im Feld `id`; nur der Anzeigename für Fehlermeldungen unterscheidet sich.
macro_rules! entity {
    ($($ty:ty => $kind:literal),* $(,)?) => {$(
        impl Entity for $ty {
            const KIND: &'static str = $kind;
            fn id(&self) -> &str {
                &self.id
            }
        }
    )*};
}

entity!(Instance => "Instanz", Template => "Vorlage", MsAccount => "Konto", LibrarySkin => "Skin");

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
        let items = lock(&self.items);
        Ok(items[index_of(&items, id)?].clone())
    }

    pub fn insert(&self, item: T) -> AppResult<T> {
        self.push(&mut lock(&self.items), item)
    }

    pub fn update(&self, item: T) -> AppResult<T> {
        let id = item.id().to_owned();
        self.modify(&id, |current| *current = item)
    }

    /// Ersetzt den Eintrag mit derselben ID oder legt ihn an, beides unter einem Lock.
    pub fn upsert(&self, item: T) -> AppResult<T> {
        let mut items = lock(&self.items);
        match position(&items, item.id()) {
            Some(idx) => self.change_at(&mut items, idx, |current| *current = item),
            None => self.push(&mut items, item),
        }
    }

    /// Ändert einen Eintrag unter dem Lock des Stores: kein anderer Schreiber kommt zwischen Lesen und
    /// Schreiben. `change` darf den Store nicht selbst aufrufen (Deadlock).
    pub fn modify(&self, id: &str, change: impl FnOnce(&mut T)) -> AppResult<T> {
        let mut items = lock(&self.items);
        let idx = index_of(&items, id)?;
        self.change_at(&mut items, idx, change)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut items = lock(&self.items);
        let idx = index_of(&items, id)?;
        let old = items.remove(idx);
        self.commit(&mut items, |items| items.insert(idx, old))
    }

    fn push(&self, items: &mut Vec<T>, item: T) -> AppResult<T> {
        items.push(item.clone());
        self.commit(items, |items| {
            items.pop();
        })?;
        Ok(item)
    }

    fn change_at(&self, items: &mut Vec<T>, idx: usize, change: impl FnOnce(&mut T)) -> AppResult<T> {
        let old = items[idx].clone();
        change(&mut items[idx]);
        self.commit(items, |items| items[idx] = old)?;
        Ok(items[idx].clone())
    }

    /// Schreibt die geänderte Collection; scheitert das, macht `rollback` die Änderung im Speicher rückgängig,
    /// damit Speicher und Datei nicht auseinanderlaufen.
    fn commit(&self, items: &mut Vec<T>, rollback: impl FnOnce(&mut Vec<T>)) -> AppResult<()> {
        if let Err(err) = persist(&self.path, items) {
            rollback(items);
            return Err(err);
        }
        Ok(())
    }
}

fn position<T: Entity>(items: &[T], id: &str) -> Option<usize> {
    items.iter().position(|x| x.id() == id)
}

fn index_of<T: Entity>(items: &[T], id: &str) -> AppResult<usize> {
    position(items, id).ok_or_else(|| not_found::<T>(id))
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
        let inst = store.insert(new_instance("Test")).unwrap();

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

    fn new_instance(name: &str) -> Instance {
        Instance::from_new(NewInstance { name: name.into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None })
    }

    fn store_with_instance() -> (PathBuf, JsonStore<Instance>, String) {
        let dir = std::env::temp_dir().join(format!("launcher-test-{}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        let store = JsonStore::<Instance>::open(dir.join("instances.json")).unwrap();
        let id = store.insert(new_instance("Test")).unwrap().id;
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

    #[test]
    fn upsert_replaces_existing_and_adds_missing() {
        let (dir, store, id) = store_with_instance();
        let mut renamed = store.get(&id).unwrap();
        renamed.name = "Umbenannt".into();
        store.upsert(renamed).unwrap();
        let second = store.upsert(new_instance("Zweite")).unwrap();
        assert_eq!(store.list().len(), 2);
        assert_eq!(store.get(&id).unwrap().name, "Umbenannt");
        assert_eq!(store.get(&second.id).unwrap().name, "Zweite");
        fs::remove_dir_all(dir).unwrap();
    }
}
