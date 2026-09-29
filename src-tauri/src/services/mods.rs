//! Globaler Mod-Cache (`cache/mods/<sha1>.jar`, jede JAR einmal) und der `mods/`-Ordner einer
//! Instanz, in den die aktivierten Mods per Hardlink (Fallback: Kopie) gelegt werden.
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::Mod;
use crate::services::download::sha1_hex;
use crate::services::Dirs;

/// Pfad eines Cache-Eintrags. Der Hash wird Teil des Pfads, daher nur echte SHA-1-Hex-Strings.
pub fn cached(dirs: &Dirs, sha1: &str) -> AppResult<PathBuf> {
    if sha1.len() != 40 || !sha1.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Invalid(format!("ungültiger SHA-1 '{sha1}'")));
    }
    Ok(dirs.mod_cache().join(format!("{}.jar", sha1.to_ascii_lowercase())))
}

fn sha1_of(path: &Path) -> io::Result<String> {
    Ok(sha1_hex(&fs::read(path)?))
}

/// Legt eine JAR im Cache ab (falls noch nicht vorhanden) und liefert ihren SHA-1.
pub fn cache_file(dirs: &Dirs, src: &Path) -> AppResult<String> {
    let bytes = fs::read(src)?;
    let sha1 = sha1_hex(&bytes);
    let dest = cached(dirs, &sha1)?;
    if !dest.exists() {
        fs::create_dir_all(dirs.mod_cache())?;
        let tmp = dest.with_extension("jar.part");
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, &dest)?;
    }
    Ok(sha1)
}

/// Dateiname aus der Instanz-JSON: ein einzelner `.jar`-Name, kein Pfad.
fn file_name(m: &Mod) -> AppResult<&str> {
    let name = m.file_name.as_str();
    let plain = Path::new(name).file_name().is_some_and(|f| f == name) && !name.contains(['/', '\\', ':']);
    if !plain || !name.ends_with(".jar") {
        return Err(AppError::Invalid(format!("ungültiger Dateiname '{name}' für Mod {}", m.name)));
    }
    Ok(name)
}

/// Hardlink auf den Cache-Eintrag; klappt das nicht (anderes Laufwerk, FAT32), eine Kopie.
fn place(src: &Path, dest: &Path) -> io::Result<()> {
    match fs::remove_file(dest) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    fs::hard_link(src, dest).or_else(|_| fs::copy(src, dest).map(|_| ()))
}

/// Bringt `mods/` auf den Stand der Mod-Liste: aktivierte Mods mit SHA-1 kommen aus dem Cache,
/// deaktivierte werden entfernt, sofern die Datei dort wirklich diese Mod ist. Dateien, die der
/// Nutzer selbst in `mods/` gelegt hat, bleiben unberührt. Liefert die Zahl der aktiven Mods.
pub fn sync(dirs: &Dirs, instance_id: &str, mods: &[Mod]) -> AppResult<usize> {
    let dir = dirs.mods_dir(instance_id);
    fs::create_dir_all(&dir)?;
    let mut active = 0;
    for m in mods {
        let Some(sha1) = &m.sha1 else { continue };
        let target = dir.join(file_name(m)?);
        let current = sha1_of(&target).ok();
        let is_ours = current.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(sha1));
        if m.enabled {
            active += 1;
            if !is_ours {
                let src = cached(dirs, sha1)?;
                if !src.exists() {
                    return Err(AppError::NotFound { kind: "Mod im Cache", id: format!("{} ({sha1})", m.name) });
                }
                place(&src, &target)?;
            }
        } else if is_ours {
            fs::remove_file(&target)?;
        }
    }
    Ok(active)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ModSource;

    #[test]
    fn cache_and_sync() {
        let dirs = Dirs::new(std::env::temp_dir().join(format!("launcher-mods-{}", crate::models::new_id())));
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
        // … die eigene schon.
        m.enabled = true;
        sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap();
        m.enabled = false;
        sync(&dirs, "i1", std::slice::from_ref(&m)).unwrap();
        assert!(!installed.exists());

        for bad in ["../x.jar", "a/b.jar", "x.zip"] {
            let bad_mod = Mod { file_name: bad.into(), enabled: true, ..m.clone() };
            assert!(sync(&dirs, "i1", &[bad_mod]).is_err(), "{bad}");
        }
        let missing = Mod { sha1: Some("0".repeat(40)), enabled: true, ..m.clone() };
        assert!(matches!(sync(&dirs, "i1", &[missing]), Err(AppError::NotFound { .. })));
        assert!(cached(&dirs, "../../x").is_err());

        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
