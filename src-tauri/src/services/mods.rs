//! Globaler Mod-Cache (`cache/mods/<sha1>.jar`, jede JAR einmal) und der `mods/`-Ordner einer
//! Instanz, in den die aktivierten Mods per Hardlink (Fallback: Kopie) gelegt werden.
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::Mod;
use crate::services::download::{sha1_file, sha1_hex};
use crate::services::{none_if_missing, remove_logged, Dirs};

/// Pfad eines Cache-Eintrags. Der Hash wird Teil des Pfads, daher nur echte SHA-1-Hex-Strings.
pub fn cached(dirs: &Dirs, sha1: &str) -> AppResult<PathBuf> {
    if sha1.len() != 40 || !sha1.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::invalid(format!("ungültiger SHA-1 '{sha1}'")));
    }
    Ok(dirs
        .mod_cache()
        .join(format!("{}.jar", sha1.to_ascii_lowercase())))
}

/// Legt eine JAR im Cache ab (falls noch nicht vorhanden) und liefert ihren SHA-1.
pub fn cache_file(dirs: &Dirs, src: &Path) -> AppResult<String> {
    cache_bytes(dirs, &fs::read(src)?)
}

/// Legt bereits verifizierte Bytes im Cache ab und liefert ihren SHA-1.
pub fn cache_bytes(dirs: &Dirs, bytes: &[u8]) -> AppResult<String> {
    let sha1 = sha1_hex(bytes);
    let dest = cached(dirs, &sha1)?;
    if !dest.exists() {
        fs::create_dir_all(dirs.mod_cache())?;
        let tmp = dest.with_extension("jar.part");
        fs::write(&tmp, bytes)?;
        fs::rename(&tmp, &dest)?;
    }
    Ok(sha1)
}

/// Dateiname aus der Instanz-JSON: ein einzelner Name mit der Endung seiner Art, kein Pfad.
fn file_name(m: &Mod) -> AppResult<&str> {
    let name = m.file_name.as_str();
    super::content::safe_path(name)?;
    let plain =
        Path::new(name).file_name().is_some_and(|f| f == name) && !name.contains(['/', '\\', ':']);
    if !plain || !name.ends_with(m.kind.extension()) {
        return Err(AppError::invalid(format!(
            "ungültiger Dateiname '{name}' für Mod {}",
            m.name
        )));
    }
    Ok(name)
}

/// Pfad im Spielordner, z. B. `mods/sodium.jar`.
pub fn game_path(m: &Mod) -> String {
    format!("{}/{}", m.kind.folder(), m.file_name)
}

/// Dateien der Einträge `names` im Spielordner (Pfade relativ mit `/`) ohne die verwalteter Inhalte:
/// die kommen aus dem Cache, [`sync`] legt sie ab.
pub fn unmanaged_files(
    dirs: &Dirs,
    instance_id: &str,
    names: &[String],
    mods: &[Mod],
) -> AppResult<Vec<(String, PathBuf)>> {
    let game = dirs.game_dir(instance_id);
    let managed: Vec<String> = mods.iter().filter(|m| m.sha1.is_some()).map(game_path).collect();
    let mut files = Vec::new();
    for name in names {
        super::walk(&game, &game.join(name), &mut files)?;
    }
    files.retain(|(rel, _)| !managed.iter().any(|m| m.eq_ignore_ascii_case(rel)));
    Ok(files)
}

/// Legt fehlende Cache-Einträge aktiver Inhalte aus der abgelegten Datei der Instanz neu an, sofern ihr
/// Hash passt: die Instanz läuft auch mit geleertem Cache, Kopie und Export brauchen ihn aber.
pub fn recache(dirs: &Dirs, instance_id: &str, mods: &[Mod]) -> AppResult<()> {
    for m in mods.iter().filter(|m| m.enabled) {
        let Some(hash) = m.sha1.as_deref() else { continue };
        if cached(dirs, hash)?.exists() {
            continue;
        }
        let placed = dirs.game_dir(instance_id).join(m.kind.folder()).join(file_name(m)?);
        let placed = none_if_missing(fs::read(&placed))?;
        if let Some(bytes) = placed.filter(|bytes| sha1_hex(bytes).eq_ignore_ascii_case(hash)) {
            cache_bytes(dirs, &bytes)?;
        }
    }
    Ok(())
}

/// Hardlink auf den Cache-Eintrag; klappt das nicht (anderes Laufwerk, FAT32), eine Kopie.
/// Ein vorhandenes Ziel wird niemals ersetzt, auch nicht im Kopier-Fallback.
fn place(src: &Path, dest: &Path) -> io::Result<()> {
    fs::hard_link(src, dest).or_else(|_| {
        let mut source = fs::File::open(src)?;
        let mut target = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest)?;
        if let Err(original) = io::copy(&mut source, &mut target) {
            drop(target);
            if let Err(cleanup) = fs::remove_file(dest) {
                return Err(io::Error::other(format!("{original}; cleanup: {cleanup}")));
            }
            return Err(original);
        }
        Ok(())
    })
}

/// Bringt `mods/`, `resourcepacks/` und `shaderpacks/` auf den Stand der Liste: aktivierte Mods mit SHA-1 kommen aus dem Cache,
/// deaktivierte werden entfernt, sofern die Datei dort wirklich diese Mod ist. Dateien, die der
/// Nutzer selbst in `mods/` gelegt hat, bleiben unberührt. Liefert die Zahl der aktiven Mods.
pub fn sync(dirs: &Dirs, instance_id: &str, mods: &[Mod]) -> AppResult<usize> {
    sync_commit(dirs, instance_id, mods, Ok)
}

/// Preflight all targets; journal only actual changes on disk until metadata commits.
pub fn sync_commit<T>(
    dirs: &Dirs,
    instance_id: &str,
    mods: &[Mod],
    commit: impl FnOnce(usize) -> AppResult<T>,
) -> AppResult<T> {
    let mut changes = Vec::new();
    let mut names = std::collections::HashSet::new();
    let mut active = 0;
    for m in mods.iter().filter(|m| m.sha1.is_some()) {
        let path = dirs.game_dir(instance_id).join(m.kind.folder()).join(file_name(m)?);
        if !names.insert(m.file_name.to_lowercase()) {
            return Err(AppError::invalid("Doppelte Mod-Zieldatei"));
        }
        super::content::regular_parents(&dirs.root, &path)?;
        let current = match none_if_missing(fs::symlink_metadata(&path))? {
            Some(meta) if !meta.is_file() => return Err(AppError::invalid("Kein regulaeres Mod-Ziel")),
            Some(_) => Some(sha1_file(&path)?),
            None => None,
        };
        let Some(hash) = m.sha1.as_ref() else { continue };
        let ours = current
            .as_ref()
            .is_some_and(|s| s.eq_ignore_ascii_case(hash));
        if m.enabled {
            active += 1;
            if ours {
                continue;
            }
            if current.is_some() {
                return Err(AppError::invalid("Mod-Konflikt: vorhandene Zieldatei"));
            }
            let cache = cached(dirs, hash)?;
            super::content::regular_parents(&dirs.root, &cache)?;
            if !cache.exists() {
                return Err(AppError::NotFound {
                    kind: "Mod im Cache",
                    id: hash.clone(),
                });
            }
            if !sha1_file(&cache)?.eq_ignore_ascii_case(hash) {
                return Err(AppError::invalid("Mod-Cache-Hash stimmt nicht"));
            }
            changes.push((path, Some(cache)));
        } else if ours {
            changes.push((path, None));
        }
    }
    let mut journal: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
    let result = (|| {
        for (path, source) in changes {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            if let Some(source) = source {
                // place is exclusive; only record a successfully created target.
                place(&source, &path)?;
                journal.push((path, None));
            } else {
                let backup = path.with_file_name(format!(".rollback-{}", crate::models::new_id()));
                place(&path, &backup)?;
                journal.push((path.clone(), Some(backup)));
                fs::remove_file(&path)?;
            }
        }
        commit(active)
    })();
    match result {
        Ok(value) => {
            // Metadata is committed: a cleanup failure must not pretend the operation failed.
            for backup in journal.into_iter().filter_map(|(_, backup)| backup) {
                remove_logged(&backup);
            }
            Ok(value)
        }
        Err(original) => {
            let mut errors = Vec::new();
            for (path, backup) in journal.into_iter().rev() {
                let restore = (|| -> AppResult<()> {
                    if let Some(backup) = backup {
                        match none_if_missing(fs::symlink_metadata(&path))? {
                            None => place(&backup, &path)?,
                            Some(_) if sha1_file(&path)? == sha1_file(&backup)? => {}
                            Some(_) => {
                                return Err(AppError::invalid(format!(
                                    "Rollback-Ziel belegt; Backup: {}",
                                    backup.display()
                                )))
                            }
                        }
                        fs::remove_file(&backup)?;
                    } else {
                        fs::remove_file(&path)?;
                    }
                    Ok(())
                })();
                if let Err(e) = restore {
                    errors.push(e.to_string());
                }
            }
            if errors.is_empty() {
                Err(original)
            } else {
                Err(AppError::invalid(format!(
                    "{original}; Rollback: {}",
                    errors.join("; ")
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModSource;

    #[test]
    fn place_preserves_existing_target() {
        let dir =
            std::env::temp_dir().join(format!("launcher-mods-place-{}", crate::models::new_id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("cache.jar");
        let dest = dir.join("mod.jar");
        fs::write(&src, b"cached").unwrap();
        fs::write(&dest, b"foreign").unwrap();
        assert_eq!(
            place(&src, &dest).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&dest).unwrap(), b"foreign");
        assert_eq!(fs::read(&src).unwrap(), b"cached");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn large_unchanged_instance_and_disk_rollback() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        fs::create_dir_all(dirs.mods_dir("i")).unwrap();
        let path = dirs.mods_dir("i").join("large.jar");
        fs::File::create(&path)
            .unwrap()
            .set_len(257 * 1024 * 1024)
            .unwrap();
        let m = Mod {
            id: "large".into(),
            name: "large".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: "large.jar".into(),
            sha1: Some(sha1_file(&path).unwrap()),
            enabled: true,
            kind: Default::default(),
            required_by: Vec::new(),
        };
        assert_eq!(sync(&dirs, "i", std::slice::from_ref(&m)).unwrap(), 1);
        let disabled = Mod {
            enabled: false,
            ..m.clone()
        };
        let failed: AppResult<()> = sync_commit(&dirs, "i", &[disabled], |_| {
            Err(AppError::invalid("store failure"))
        });
        assert!(failed.is_err());
        assert_eq!(sha1_file(&path).unwrap(), m.sha1.unwrap());
        assert_eq!(fs::read_dir(dirs.mods_dir("i")).unwrap().count(), 1);
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn cache_and_sync() {
        let dirs = Dirs::new(
            std::env::temp_dir().join(format!("launcher-mods-{}", crate::models::new_id())),
        );
        fs::create_dir_all(&dirs.root).unwrap();
        let src = dirs.root.join("sodium.jar");
        fs::write(&src, b"sodium").unwrap();

        let sha1 = cache_file(&dirs, &src).unwrap();
        assert_eq!(sha1, sha1_hex(b"sodium"));
        assert_eq!(cache_file(&dirs, &src).unwrap(), sha1);
        assert_eq!(fs::read(cached(&dirs, &sha1).unwrap()).unwrap(), b"sodium");

        let mut m = Mod {
            id: "sodium".into(),
            name: "Sodium".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: "sodium.jar".into(),
            sha1: Some(sha1.clone()),
            enabled: true,
            kind: Default::default(),
            required_by: Vec::new(),
        };
        let installed = dirs.mods_dir("i1").join("sodium.jar");
        assert_eq!(sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap(), 1);
        assert_eq!(fs::read(&installed).unwrap(), b"sodium");
        assert_eq!(sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap(), 1);

        // Eine fremde Datei gleichen Namens wird beim Deaktivieren nicht gelöscht …
        m.enabled = false;
        fs::remove_file(&installed).unwrap();
        fs::write(&installed, b"eigene").unwrap();
        assert_eq!(sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap(), 0);
        assert_eq!(fs::read(&installed).unwrap(), b"eigene");
        // … und beim Aktivieren auch nicht überschrieben, sondern als Konflikt gemeldet.
        m.enabled = true;
        let err = sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap_err();
        assert!(matches!(&err, AppError::Invalid(message) if message.contains("Mod-Konflikt")));
        assert_eq!(fs::read(&installed).unwrap(), b"eigene");
        assert_eq!(fs::read(cached(&dirs, &sha1).unwrap()).unwrap(), b"sodium");

        // Nach manuellem Auflösen des Konflikts funktionieren Installation und Deaktivierung.
        fs::remove_file(&installed).unwrap();
        assert_eq!(sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap(), 1);
        assert_eq!(fs::read(&installed).unwrap(), b"sodium");
        m.enabled = false;
        let result: AppResult<()> = sync_commit(&dirs, "i1", std::slice::from_ref(&m), |_| {
            Err(AppError::invalid("store failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&installed).unwrap(), b"sodium");
        sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap();
        assert!(!installed.exists());

        for bad in ["../x.jar", "a/b.jar", "x.zip"] {
            let bad_mod = Mod {
                file_name: bad.into(),
                enabled: true,
                ..m.clone()
            };
            assert!(sync(&dirs, "i1", &[bad_mod]).is_err(), "{bad}");
        }
        let missing = Mod {
            sha1: Some("0".repeat(40)),
            enabled: true,
            ..m.clone()
        };
        assert!(matches!(
            sync(&dirs, "i1", &[missing]),
            Err(AppError::NotFound { .. })
        ));
        assert!(cached(&dirs, "../../x").is_err());

        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn recache_restores_entries_from_placed_files() {
        let dirs = Dirs::new(std::env::temp_dir().join(crate::models::new_id()));
        let m = Mod {
            id: "sodium".into(),
            name: "Sodium".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: "sodium.jar".into(),
            sha1: Some(cache_bytes(&dirs, b"sodium").unwrap()),
            enabled: true,
            kind: Default::default(),
            required_by: Vec::new(),
        };
        sync(&dirs, "i", std::slice::from_ref(&m)).unwrap();
        // Liegt unter dem Namen etwas anderes, bleibt der Eintrag weg.
        let replaced = Mod {
            file_name: "other.jar".into(),
            sha1: Some(sha1_hex(b"other")),
            ..m.clone()
        };
        fs::write(dirs.mods_dir("i").join("other.jar"), b"fremd").unwrap();
        fs::remove_dir_all(dirs.mod_cache()).unwrap();

        recache(&dirs, "i", &[m.clone(), replaced.clone()]).unwrap();

        assert_eq!(fs::read(cached(&dirs, m.sha1.as_ref().unwrap()).unwrap()).unwrap(), b"sodium");
        assert!(!cached(&dirs, replaced.sha1.as_ref().unwrap()).unwrap().exists());
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
