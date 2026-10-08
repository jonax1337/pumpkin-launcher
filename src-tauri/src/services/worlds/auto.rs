//! Sicherung der Welten vor dem Spielstart: nur Welten, die sich seit ihrer letzten Sicherung geändert haben;
//! je Welt bleiben die neuesten automatischen Sicherungen erhalten, eigene und die vor dem Löschen nie angetastet.
use std::{fs, path::Path, time::UNIX_EPOCH};

use super::backup::{backup_automatic, is_automatic, SESSION_LOCK};
use super::{backups, delete_backup, is_world};
use crate::error::AppResult;
use crate::models::{Instance, LaunchOptions};
use crate::services::{entries, walk, Dirs};
use crate::state::AppState;

/// So viele automatische Sicherungen je Welt bleiben, wenn der Launcher keine Zahl mitgibt.
const DEFAULT_KEEP: usize = 5;
/// Mehr als das hebt keine Einstellung auf: sonst füllte „vor jedem Start“ die Platte.
const MAX_KEEP: usize = 50;

/// Wie viele Sicherungen je Welt bleiben, wenn vor dem Start gesichert wird; `None`, wenn nicht gesichert wird.
/// Die Wahl der Instanz geht vor der Einstellung des Launchers.
fn keep_for(instance: &Instance, options: &LaunchOptions) -> Option<usize> {
    instance.backup_worlds.or(options.backup_worlds).unwrap_or(false).then(|| {
        options.backup_keep.map_or(DEFAULT_KEEP, |keep| usize::try_from(keep).unwrap_or(MAX_KEEP).clamp(1, MAX_KEEP))
    })
}

/// Sichert die geänderten Welten der Instanz, falls das gewünscht ist. Ein Fehler hält den Start nicht auf: eine
/// fehlende Sicherung ist schlimm, aber kein Grund, das Spiel zu verweigern.
pub async fn backup_before_launch(state: &AppState, instance: &Instance, options: &LaunchOptions) {
    let Some(keep) = keep_for(instance, options) else { return };
    let id = instance.id.clone();
    match state.blocking_with_dirs(move |dirs| Ok(backup_changed(dirs, &id, keep))).await {
        Ok(0) => {}
        Ok(saved) => tracing::info!(instance = %instance.id, saved, "Welten vor dem Start gesichert"),
        Err(err) => tracing::warn!(instance = %instance.id, %err, "Sicherung vor dem Start fehlgeschlagen"),
    }
}

/// Sichert jede geänderte Welt; was bei einer Welt schiefgeht, hält die übrigen nicht auf. Liefert, wie viele
/// Welten gesichert wurden.
fn backup_changed(dirs: &Dirs, instance_id: &str, keep: usize) -> usize {
    let worlds = match world_ids(dirs, instance_id) {
        Ok(worlds) => worlds,
        Err(err) => {
            tracing::warn!(instance = %instance_id, %err, "Welten nicht lesbar");
            return 0;
        }
    };
    let mut saved = 0;
    for world in worlds {
        match backup_if_changed(dirs, instance_id, &world, keep) {
            Ok(true) => saved += 1,
            Ok(false) => {}
            Err(err) => tracing::warn!(instance = %instance_id, %world, %err, "Welt nicht gesichert"),
        }
    }
    saved
}

fn world_ids(dirs: &Dirs, instance_id: &str) -> AppResult<Vec<String>> {
    let worlds = entries(&dirs.saves(instance_id))?;
    Ok(worlds.iter().filter(|entry| is_world(&entry.path())).filter_map(|entry| entry.file_name().into_string().ok()).collect())
}

fn backup_if_changed(dirs: &Dirs, instance_id: &str, world: &str, keep: usize) -> AppResult<bool> {
    if !changed_since_last_backup(dirs, instance_id, world)? {
        return Ok(false);
    }
    backup_automatic(dirs, instance_id, world)?;
    prune(dirs, instance_id, world, keep)?;
    Ok(true)
}

/// Hat eine Datei der Welt (ohne die Sperrdatei, die jeder Start berührt) sich nach der letzten Sicherung, ob
/// automatisch oder eigene, geändert? Ohne Sicherung gilt die Welt als geändert.
fn changed_since_last_backup(dirs: &Dirs, instance_id: &str, world: &str) -> AppResult<bool> {
    let last_backup = backups(dirs, instance_id)?.into_iter().filter(|b| b.world == world).map(|b| b.created_at).max();
    let Some(last_backup) = last_backup else { return Ok(true) };
    Ok(last_change(dirs, instance_id, world)?.is_none_or(|changed| changed > last_backup))
}

/// Zeitpunkt (Unix-ms) der jüngsten Änderung an einer Datei der Welt.
fn last_change(dirs: &Dirs, instance_id: &str, world: &str) -> AppResult<Option<u64>> {
    let saves = dirs.saves(instance_id);
    let lock = format!("{world}/{SESSION_LOCK}");
    let mut newest = None;
    for (name, path) in walk(&saves, &saves.join(world))? {
        if name != lock {
            newest = newest.max(modified_ms(&path));
        }
    }
    Ok(newest)
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(u64::try_from(modified.duration_since(UNIX_EPOCH).ok()?.as_millis()).unwrap_or(u64::MAX))
}

/// Löscht die ältesten automatischen Sicherungen der Welt, bis `keep` übrig sind.
fn prune(dirs: &Dirs, instance_id: &str, world: &str, keep: usize) -> AppResult<()> {
    let automatic = backups(dirs, instance_id)?
        .into_iter()
        .filter(|b| b.world == world && is_automatic(dirs, instance_id, &b.id));
    for old in automatic.skip(keep) {
        delete_backup(dirs, instance_id, &old.id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::backup::backup;
    use super::super::fixtures::setup;
    use super::*;
    use crate::models::{ModLoader, NewInstance};
    use std::{thread::sleep, time::Duration};

    fn instance(backup_worlds: Option<bool>) -> Instance {
        let new = NewInstance { name: "Welten".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None };
        Instance { backup_worlds, ..Instance::from_new(new) }
    }

    fn options(backup_worlds: Option<bool>, backup_keep: Option<u32>) -> LaunchOptions {
        LaunchOptions {
            username: String::new(),
            account_id: None,
            java_path: None,
            default_memory_mb: None,
            default_min_memory_mb: None,
            default_jvm_args: Vec::new(),
            default_window: None,
            default_launch: Default::default(),
            discord_presence: None,
            backup_worlds,
            backup_keep,
            quick_play: None,
            friend_join: None,
        }
    }

    #[test]
    fn the_instance_choice_beats_the_launcher_setting() {
        assert_eq!(keep_for(&instance(None), &options(None, None)), None);
        assert_eq!(keep_for(&instance(None), &options(Some(true), None)), Some(DEFAULT_KEEP));
        assert_eq!(keep_for(&instance(Some(true)), &options(Some(false), Some(3))), Some(3));
        assert_eq!(keep_for(&instance(Some(false)), &options(Some(true), Some(3))), None);
    }

    #[test]
    fn the_number_to_keep_stays_between_one_and_the_maximum() {
        let keep = |n| keep_for(&instance(Some(true)), &options(None, Some(n)));
        assert_eq!((keep(0), keep(1), keep(MAX_KEEP as u32 + 1)), (Some(1), Some(1), Some(MAX_KEEP)));
    }

    #[test]
    fn only_changed_worlds_are_saved_and_the_session_lock_does_not_count() {
        let (root, dirs) = setup();
        // Noch nie gesichert: alle Welten mit level.dat, auch die mit unlesbarem Inhalt.
        assert_eq!(backup_changed(&dirs, "i", 5), 3);
        assert_eq!(backups(&dirs, "i").unwrap().len(), 3);

        // Nichts geändert, nur die Sperrdatei berührt: keine neue Sicherung.
        fs::write(dirs.saves("i").join("Neue Welt").join(SESSION_LOCK), b"neu").unwrap();
        assert_eq!(backup_changed(&dirs, "i", 5), 0);

        sleep(Duration::from_millis(20));
        fs::write(dirs.saves("i").join("Alt").join("level.dat"), b"geaendert").unwrap();
        assert_eq!(backup_changed(&dirs, "i", 5), 1);
        assert_eq!(backups(&dirs, "i").unwrap().iter().filter(|b| b.world == "Alt").count(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pruning_keeps_the_newest_automatic_backups_and_every_manual_one() {
        let (root, dirs) = setup();
        let backups_dir = dirs.backups("i");
        let manual = backup(&dirs, "i", "Alt", &|_, _, _| {}).unwrap();
        fs::rename(backups_dir.join(&manual.id), backups_dir.join("Alt-1000000000000.zip")).unwrap();
        for n in 1..=4u64 {
            let automatic = backup_automatic(&dirs, "i", "Alt").unwrap();
            // Eindeutige, aufsteigende Zeitpunkte statt `now_ms`, das hier mehrfach denselben Wert lieferte.
            fs::rename(backups_dir.join(&automatic.id), backups_dir.join(format!("Alt-{}.zip", 2_000_000_000_000 + n))).unwrap();
        }

        prune(&dirs, "i", "Alt", 2).unwrap();

        let left: Vec<_> = backups(&dirs, "i").unwrap().into_iter().map(|b| b.id).collect();
        assert_eq!(left, ["Alt-2000000000004.zip", "Alt-2000000000003.zip", "Alt-1000000000000.zip"]);
        fs::remove_dir_all(root).unwrap();
    }
}
