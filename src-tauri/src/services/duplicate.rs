//! Instanz duplizieren: neuer Eintrag mit eigener ID und eine Kopie des Instanzordners. Verwaltete Inhalte
//! legt `mods::sync` per Hardlink aus dem Cache ab, statt sie Byte für Byte zu kopieren.
use std::path::PathBuf;

use super::progress::{Phase, SharedProgress};
use super::{check_cancelled, content, copy_files, mods, walk, Dirs};
use crate::{
    error::AppResult,
    models::{new_id, now_ms, Instance, Mod},
    state::AppState,
};

/// Kopiert die Instanz samt Spielordner; Fortschritt kommt als Phase `copy`.
/// Schlägt etwas fehl oder wird abgebrochen, verschwindet die halbe Kopie wieder.
pub async fn duplicate(
    state: &AppState,
    instance_id: &str,
    progress: SharedProgress,
) -> AppResult<Instance> {
    let source = state.instances.get(instance_id)?;
    let taken: Vec<String> = state.instances.list().into_iter().map(|i| i.name).collect();
    let copy = Instance {
        id: new_id(),
        name: copy_name(&source.name, &taken),
        created_at: now_ms(),
        last_played_at: None,
        playtime_secs: 0,
        ..source
    };
    let dirs = state.dirs.clone();
    let (from, to, mods) = (instance_id.to_owned(), copy.id.clone(), copy.mods.clone());
    let (guard, ()) = content::populate_new_dir(&state.dirs, dirs.instance(&copy.id), move |stop| {
        copy_instance(&dirs, &from, &to, &mods, &|done, total| {
            check_cancelled(stop)?;
            progress(Phase::Copy, done, total);
            Ok(())
        })
    })
    .await?;
    let copy = state.instances.insert(copy)?;
    guard.disarm();
    tracing::info!(source = %instance_id, id = %copy.id, "Instanz dupliziert");
    Ok(copy)
}

/// „<Name> (Kopie)“, bei Bedarf durchnummeriert, damit die Kopie in der Bibliothek unterscheidbar bleibt.
fn copy_name(name: &str, taken: &[String]) -> String {
    let mut candidate = format!("{name} (Kopie)");
    let mut n = 1;
    while taken.contains(&candidate) {
        n += 1;
        candidate = format!("{name} (Kopie {n})");
    }
    candidate
}

/// Was von Instanz `from` nach `to` kopiert wird, als (Ziel, Quelle): der Spielordner ohne Neuerzeugtes und
/// ohne die Dateien verwalteter Inhalte, dazu Natives und Installiert-Marker. Der Marker hängt nur an Version
/// und Loader, so startet die Kopie einer installierten Instanz ohne Neuinstallation.
fn files_to_copy(dirs: &Dirs, from: &str, to: &str, mods: &[Mod]) -> AppResult<Vec<(PathBuf, PathBuf)>> {
    let game = dirs.game_dir(to);
    let mut files: Vec<(PathBuf, PathBuf)> = mods::unmanaged_files(dirs, from, &dirs.game_entries(from)?, mods)?
        .into_iter()
        .map(|(rel, path)| (game.join(rel), path))
        .collect();
    let base = dirs.instance(from);
    let mut rest = Vec::new();
    walk(&base, &dirs.natives_dir(from), &mut rest)?;
    walk(&base, &dirs.installed_marker(from), &mut rest)?;
    let instance = dirs.instance(to);
    files.extend(rest.into_iter().map(|(rel, path)| (instance.join(rel), path)));
    Ok(files)
}

/// Legt die Kopie an: erst die verwalteten Inhalte einzeln aus dem Cache (der Abgleich prüft jede JAR per SHA-1,
/// das dauert und soll als Fortschritt sichtbar sein), dann die übrigen Dateien. `step(done, total)` folgt jedem
/// Schritt; ein Fehler daraus bricht ab.
fn copy_instance(dirs: &Dirs, from: &str, to: &str, mods: &[Mod], step: &dyn Fn(u64, u64) -> AppResult<()>) -> AppResult<()> {
    let files = files_to_copy(dirs, from, to, mods)?;
    let total = (mods.len() + files.len()) as u64;
    step(0, total)?;
    for (done, m) in (1..).zip(mods) {
        let one = std::slice::from_ref(m);
        mods::recache(dirs, from, one)?;
        mods::sync(dirs, to, one)?;
        step(done, total)?;
    }
    let cached = mods.len() as u64;
    copy_files(&files, &|done, _| step(cached + done, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use crate::models::{ModKind, ModLoader, ModSource, NewInstance};
    use crate::services::{progress::ignored, write_files};

    fn local_mod(state: &AppState, name: &str) -> Mod {
        Mod {
            id: name.into(),
            name: name.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{name}.jar"),
            sha1: Some(mods::cache_bytes(&state.dirs, name.as_bytes()).unwrap()),
            enabled: true,
            kind: ModKind::Mod,
            required_by: Vec::new(),
        }
    }

    fn source_instance(state: &AppState, mods: Vec<Mod>) -> Instance {
        let mut source = Instance::from_new(NewInstance {
            name: "Quelle".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.10".into()),
        });
        source.mods = mods;
        source.last_played_at = Some(1);
        source.playtime_secs = 3600;
        state.instances.insert(source).unwrap()
    }

    #[test]
    fn copy_names_stay_unique() {
        let taken = ["Welt (Kopie)".to_string(), "Welt (Kopie 2)".to_string()];
        assert_eq!(copy_name("Welt", &[]), "Welt (Kopie)");
        assert_eq!(copy_name("Welt", &taken), "Welt (Kopie 3)");
    }

    #[tokio::test]
    async fn duplicate_copies_game_dir_and_relinks_mods() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let source = source_instance(&state, vec![local_mod(&state, "own")]);
        mods::sync(&state.dirs, &source.id, &source.mods).unwrap();
        write_files(
            &state.dirs.instance(&source.id),
            &[
                ("minecraft/saves/w/level.dat", "welt"),
                ("minecraft/config/a.toml", "x=1"),
                ("minecraft/mods/extra.jar", "eigene"),
                ("minecraft/logs/latest.log", "log"),
                ("minecraft/crash-reports/c.txt", "absturz"),
                ("minecraft/.fabric/remapped.jar", "cache"),
                ("natives/lwjgl.dll", "dll"),
                ("installed", "1.21.1 Fabric 0.16.10"),
            ],
        );

        let copy = duplicate(&state, &source.id, ignored()).await.unwrap();
        let again = duplicate(&state, &source.id, ignored()).await.unwrap();

        assert_eq!((copy.name.as_str(), again.name.as_str()), ("Quelle (Kopie)", "Quelle (Kopie 2)"));
        assert_ne!(copy.id, source.id);
        assert_eq!(
            (copy.mods.clone(), copy.loader_version.clone(), copy.last_played_at, copy.playtime_secs),
            (source.mods, source.loader_version, None, 0)
        );
        let dir = state.dirs.instance(&copy.id);
        for (path, data) in [
            ("minecraft/saves/w/level.dat", "welt"),
            ("minecraft/config/a.toml", "x=1"),
            ("minecraft/mods/own.jar", "own"),
            ("minecraft/mods/extra.jar", "eigene"),
            ("natives/lwjgl.dll", "dll"),
            ("installed", "1.21.1 Fabric 0.16.10"),
        ] {
            assert_eq!(fs::read_to_string(dir.join(path)).unwrap(), data, "{path}");
        }
        for skipped in ["logs", "crash-reports", ".fabric"] {
            assert!(!dir.join("minecraft").join(skipped).exists(), "{skipped}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn failed_duplicate_leaves_nothing_behind() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let missing = Mod { sha1: Some("0".repeat(40)), ..local_mod(&state, "gone") };
        let source = source_instance(&state, vec![missing]);
        write_files(&state.dirs.game_dir(&source.id), &[("options.txt", "fov:1")]);

        assert!(duplicate(&state, &source.id, ignored()).await.is_err());

        assert_eq!(state.instances.list(), vec![source]);
        assert_eq!(fs::read_dir(root.join("instances")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancelled_duplicate_leaves_nothing_behind() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let source = source_instance(&state, Vec::new());
        write_files(&state.dirs.game_dir(&source.id), &[("options.txt", "fov:1")]);

        let result = content::cancel_at_step(&state, 0, |progress| duplicate(&state, &source.id, progress)).await;

        assert!(matches!(result, Err(crate::error::AppError::Cancelled)));
        assert_eq!(state.instances.list(), vec![source]);
        assert_eq!(fs::read_dir(root.join("instances")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
