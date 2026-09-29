//! Einfache JSON-Persistenz: eine Datei pro Collection unter dem App-Datenverzeichnis.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{de::DeserializeOwned, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::{Instance, Template};

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
        let items = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(items) => items,
                Err(err) => {
                    let backup = path.with_extension("json.corrupt");
                    tracing::warn!(?path, ?backup, %err, "defekte JSON-Datei gesichert, starte leer");
                    fs::rename(&path, &backup)?;
                    Vec::new()
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(err) => return Err(err.into()),
        };
        Ok(Self { path, items: Mutex::new(items) })
    }

    fn lock(&self) -> MutexGuard<'_, Vec<T>> {
        self.items.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn list(&self) -> Vec<T> {
        self.lock().clone()
    }

    pub fn get(&self, id: &str) -> AppResult<T> {
        self.lock()
            .iter()
            .find(|x| x.id() == id)
            .cloned()
            .ok_or_else(|| not_found::<T>(id))
    }

    pub fn insert(&self, item: T) -> AppResult<T> {
        let mut items = self.lock();
        items.push(item.clone());
        if let Err(err) = persist(&self.path, &items) {
            items.pop();
            return Err(err);
        }
        Ok(item)
    }

    pub fn update(&self, item: T) -> AppResult<T> {
        let mut items = self.lock();
        let idx = items
            .iter()
            .position(|x| x.id() == item.id())
            .ok_or_else(|| not_found::<T>(item.id()))?;
        let old = std::mem::replace(&mut items[idx], item.clone());
        if let Err(err) = persist(&self.path, &items) {
            items[idx] = old;
            return Err(err);
        }
        Ok(item)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut items = self.lock();
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
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(items)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
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
}
