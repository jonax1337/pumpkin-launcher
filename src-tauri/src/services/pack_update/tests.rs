use std::{collections::BTreeMap, io::Write, path::PathBuf};

use tokio_util::sync::CancellationToken;

use super::*;
use crate::{
    models::new_id,
    services::{download::sha1_hex, progress::ignored, walk, write_files},
};

const LOADER: &str = r#""fabric-loader":"0.16.10""#;

/// `.mrpack` mit Index (Name, Version, Minecraft) und Overrides.
fn mrpack(version: &str, mc: &str, files: &[(&str, &str)]) -> Vec<u8> {
    let index = format!(
        r#"{{"formatVersion":1,"game":"minecraft","name":"Abenteuer","versionId":"{version}","files":[],"dependencies":{{"minecraft":"{mc}",{LOADER}}}}}"#
    );
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("modrinth.index.json", options).unwrap();
    zip.write_all(index.as_bytes()).unwrap();
    for (path, data) in files {
        zip.start_file(format!("overrides/{path}"), options).unwrap();
        zip.write_all(data.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

const V1: &[(&str, &str)] = &[
    ("mods/alt.jar", "alt"),
    ("mods/bleibt.jar", "bleibt"),
    ("mods/weg.jar", "weg"),
    ("mods/aus.jar", "aus-1"),
    ("config/pack.toml", "a=1"),
    ("config/eigen.toml", "b=1"),
    ("options.txt", "fov:70"),
];

const V2: &[(&str, &str)] = &[
    ("mods/neu.jar", "neu"),
    ("mods/bleibt.jar", "bleibt"),
    ("mods/aus.jar", "aus-2"),
    ("config/pack.toml", "a=2"),
    ("config/eigen.toml", "b=3"),
    ("options.txt", "fov:70"),
    ("saves/Welt/level.dat", "Welt aus dem Pack"),
];

struct Played {
    root: PathBuf,
    state: AppState,
    id: String,
    game: PathBuf,
}

/// Instanz aus `V1`, in der der Spieler eine eigene Mod hat, eine Konfiguration geändert, eine Pack-Mod
/// ausgeschaltet und eine Welt angelegt hat.
async fn played_instance() -> Played {
    let root = std::env::temp_dir().join(new_id());
    let state = AppState::load(&root).unwrap();
    let instance = content::import_file(&state, &mrpack("1.0", "1.21.1", V1), "Abenteuer", &|_, _, _| {}).await.unwrap();
    let game = state.dirs.game_dir(&instance.id);
    write_files(&game, &[("mods/meine.jar", "meine"), ("config/eigen.toml", "b=2"), ("saves/Welt/level.dat", "Spielstand")]);
    let mods: Vec<Mod> =
        instance.mods.iter().map(|m| Mod { enabled: m.file_name != "aus.jar", ..m.clone() }).collect();
    mods::sync(&state.dirs, &instance.id, &mods).unwrap();
    state.instances.modify(&instance.id, |i| i.mods = mods).unwrap();
    Played { root, state, id: instance.id, game }
}

fn write_pack(root: &Path, data: &[u8]) -> String {
    let path = root.join(format!("{}.mrpack", new_id()));
    fs::write(&path, data).unwrap();
    path.to_string_lossy().into_owned()
}

/// Der Dateiwechsel auf das Pack `pack` (als Datei), geplant gegen den Stand `installed`.
fn applying(state: &AppState, instance: &Instance, installed: &Option<PackFiles>, pack: &[u8]) -> Apply {
    let release = Release::of(
        content::unpack(pack, "x", &state.dirs).unwrap(),
        ModpackOrigin::File { name: "Abenteuer".into(), version: "2.0".into() },
    )
    .unwrap();
    let installed: Vec<(String, String)> =
        installed.iter().flat_map(PackFiles::iter).map(|(p, s)| (p.to_owned(), s.to_owned())).collect();
    let game = state.dirs.game_dir(&instance.id);
    let steps = plan_steps(&game, installed, &release.files, &instance.mods).unwrap();
    Apply {
        dirs: state.dirs.clone(),
        instances: state.instances.clone(),
        instance: instance.clone(),
        plan: Plan { release, steps, recognition: Recognition::default() },
        progress: ignored(),
    }
}

fn read(game: &Path, rel: &str) -> Option<String> {
    fs::read_to_string(game.join(rel)).ok()
}

fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    walk(dir, dir).unwrap().into_iter().map(|(rel, path)| (rel, fs::read(path).unwrap())).collect()
}

#[tokio::test]
async fn update_follows_the_pack_and_keeps_what_the_player_did() {
    let Played { root, state, id, game } = played_instance().await;
    let path = write_pack(&root, &mrpack("2.0", "1.21.4", V2));

    let outcome = update(&state, &id, PackTarget::File { path: path.clone() }, ignored()).await.unwrap();

    let expected = PackChanges {
        added: vec!["mods/neu.jar".into()],
        updated: vec!["config/pack.toml".into(), "mods/aus.jar".into()],
        removed: vec!["mods/alt.jar".into(), "mods/weg.jar".into()],
        kept: vec!["config/eigen.toml".into()],
    };
    assert_eq!(outcome.changes, expected);
    assert_eq!(outcome.world_backups, 1);
    assert_eq!(read(&game, "config/pack.toml").as_deref(), Some("a=2"));
    assert_eq!(read(&game, "config/eigen.toml").as_deref(), Some("b=2"), "Konfiguration des Spielers bleibt");
    assert_eq!(read(&game, "mods/meine.jar").as_deref(), Some("meine"), "eigene Mod bleibt");
    assert_eq!(read(&game, "saves/Welt/level.dat").as_deref(), Some("Spielstand"), "Welten fasst das Update nicht an");
    assert!(read(&game, "mods/alt.jar").is_none() && read(&game, "mods/aus.jar").is_none());
    assert!(!state.dirs.instance(&id).join(WORK_DIR).exists());

    let instance = outcome.instance;
    assert_eq!(instance.minecraft_version, "1.21.4");
    assert_eq!(instance.modpack, Some(ModpackOrigin::File { name: "Abenteuer".into(), version: "2.0".into() }));
    let mut listed: Vec<(&str, bool)> = instance.mods.iter().map(|m| (m.file_name.as_str(), m.enabled)).collect();
    listed.sort();
    assert_eq!(listed, [("aus.jar", false), ("bleibt.jar", true), ("neu.jar", true)]);
    // Die ausgeschaltete Mod liegt in neuer Fassung im Cache: Einschalten bringt sie zurück.
    let on: Vec<Mod> = instance.mods.iter().map(|m| Mod { enabled: true, ..m.clone() }).collect();
    mods::sync(&state.dirs, &id, &on).unwrap();
    assert_eq!(read(&game, "mods/aus.jar").as_deref(), Some("aus-2"));
    mods::sync(&state.dirs, &id, &instance.mods).unwrap();

    // Noch einmal dieselbe Version: es gibt nichts mehr zu tun, die geänderte Konfiguration bleibt.
    let again = update(&state, &id, PackTarget::File { path }, ignored()).await.unwrap();
    assert_eq!(again.changes, PackChanges { kept: vec!["config/eigen.toml".into()], ..PackChanges::default() });
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn pinned_content_stays_and_what_the_update_brings_is_pack_managed() {
    let Played { root, state, id, game } = played_instance().await;
    state.instances.modify(&id, |i| i.mods.iter_mut().filter(|m| m.file_name == "alt.jar").for_each(|m| m.pinned = true)).unwrap();
    let path = write_pack(&root, &mrpack("2.0", "1.21.4", V2));

    let outcome = update(&state, &id, PackTarget::File { path }, ignored()).await.unwrap();

    assert!(outcome.changes.kept.contains(&"mods/alt.jar".to_string()));
    assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"), "festgehaltene Mod bleibt");
    let flags = |name: &str| outcome.instance.mods.iter().find(|m| m.file_name == name).map(|m| (m.pack_managed, m.pinned));
    assert_eq!(flags("alt.jar"), Some((true, true)));
    assert_eq!(flags("neu.jar"), Some((true, false)));
    assert_eq!(flags("aus.jar"), Some((true, false)), "auch die ersetzte Mod bleibt vom Pack");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_pinned_file_is_listed_as_it_lies_so_a_later_update_can_replace_it() {
    let Played { root, state, id, .. } = played_instance().await;
    state.instances.modify(&id, |i| i.mods.iter_mut().filter(|m| m.file_name == "aus.jar").for_each(|m| m.pinned = true)).unwrap();
    let path = write_pack(&root, &mrpack("2.0", "1.21.4", V2));

    update(&state, &id, PackTarget::File { path }, ignored()).await.unwrap();

    let listed = PackFiles::load(&state.dirs, &id).unwrap().unwrap();
    let sha1_of = |rel: &str| listed.iter().find(|(path, _)| *path == rel).map(|(_, sha1)| sha1.to_owned());
    assert_eq!(sha1_of("mods/aus.jar"), Some(sha1_hex(b"aus-1")));
    assert_eq!(sha1_of("mods/neu.jar"), Some(sha1_hex(b"neu")));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn only_a_changing_origin_is_noted_as_the_target() {
    let Played { root, state, id, .. } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    let failing = |instance: &Instance| {
        let mut apply = applying(&state, instance, &PackFiles::load(&state.dirs, &id).unwrap(), &mrpack("2.0", "1.21.4", V2));
        apply.plan.steps.push(Step::new("config/fehlt.toml".into(), None, Some(sha1_hex(b"x")), OnDisk::Absent));
        apply.run(&CancellationToken::new())
    };

    assert!(failing(&state.instances.get(&id).unwrap()).is_err());
    assert!(work.join(TARGET).exists());
    fs::remove_dir_all(&work).unwrap();
    let same_origin = Instance { modpack: Some(ModpackOrigin::File { name: "Abenteuer".into(), version: "2.0".into() }), ..state.instances.get(&id).unwrap() };
    assert!(failing(&same_origin).is_err());
    assert!(!work.join(TARGET).exists());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn recovery_brings_back_the_files_list_of_an_update_the_instance_does_not_carry() {
    let Played { root, state, id, .. } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    let before = PackFiles::load(&state.dirs, &id).unwrap();
    write_files(&work, &[(PREVIOUS_FILES, serde_json::to_vec(&before).unwrap())]);
    // Absturz nach dem Speichern der neuen Liste, vor dem der Instanz.
    PackFiles::default().save(&state.dirs, &id).unwrap();

    assert_eq!(recover_interrupted(&state).await.unwrap(), 1);

    assert_eq!(PackFiles::load(&state.dirs, &id).unwrap(), before);
    assert!(!work.exists());
    fs::remove_dir_all(root).unwrap();
}

/// Dieselbe Version noch einmal: die Herkunft der Instanz ändert sich nicht, die Marke zeigt das Speichern.
#[tokio::test]
async fn recovery_keeps_a_saved_update_of_the_same_version() {
    let Played { root, state, id, game } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    write_files(&work.join("old"), &[("mods/alt.jar", "alt")]);
    write_files(&work, &[("placed", "mods/neu.jar\n"), (SAVED, "")]);
    write_files(&game, &[("mods/neu.jar", "neu")]);
    fs::remove_file(game.join("mods/alt.jar")).unwrap();

    assert_eq!(recover_interrupted(&state).await.unwrap(), 0);

    assert_eq!(read(&game, "mods/neu.jar").as_deref(), Some("neu"));
    assert!(read(&game, "mods/alt.jar").is_none() && !work.exists());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_failed_update_leaves_files_list_and_instance_as_they_were() {
    let Played { root, state, id, game } = played_instance().await;
    let instance = state.instances.get(&id).unwrap();
    let before = (snapshot(&game), PackFiles::load(&state.dirs, &id).unwrap());
    let mut apply = applying(&state, &instance, &before.1, &mrpack("2.0", "1.21.4", V2));
    // Zuletzt eine Datei, die es im neuen Pack nicht gibt: alles davor ist schon geändert.
    apply.plan.steps.push(Step::new("config/fehlt.toml".into(), None, Some(sha1_hex(b"x")), OnDisk::Absent));

    let result = apply.run(&CancellationToken::new());

    assert!(result.unwrap_err().to_string().contains("config/fehlt.toml"));
    assert_eq!((snapshot(&game), PackFiles::load(&state.dirs, &id).unwrap()), before);
    assert_eq!(state.instances.get(&id).unwrap(), instance);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_cancelled_switch_changes_nothing() {
    let Played { root, state, id, game } = played_instance().await;
    let instance = state.instances.get(&id).unwrap();
    let before = (snapshot(&game), PackFiles::load(&state.dirs, &id).unwrap());
    let apply = applying(&state, &instance, &before.1, &mrpack("2.0", "1.21.4", V2));
    let stop = CancellationToken::new();
    stop.cancel();

    let result = apply.run(&stop);

    assert!(matches!(result, Err(AppError::Cancelled)));
    assert_eq!((snapshot(&game), PackFiles::load(&state.dirs, &id).unwrap()), before);
    assert_eq!(state.instances.get(&id).unwrap(), instance);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_pack_file_update_needs_an_instance_from_a_file() {
    let root = std::env::temp_dir().join(new_id());
    let state = AppState::load(&root).unwrap();
    let plain = content::import(&state, &mrpack("1.0", "1.21.1", V1), "Vorlage", None, &|_, _, _| {}).await.unwrap();
    let path = write_pack(&root, &mrpack("2.0", "1.21.4", V2));

    let refused = update(&state, &plain.id, PackTarget::File { path }, ignored()).await;

    assert!(refused.is_err());
    assert_eq!(state.instances.get(&plain.id).unwrap(), plain);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn worlds_belong_to_the_player() {
    assert!(is_world_data("saves/Welt/level.dat") && is_world_data("Saves/x"));
    assert!(!is_world_data("config/saves.toml") && !is_world_data("savesx/a"));
}

#[tokio::test]
async fn startup_recovery_restores_the_state_before_a_crashed_update() {
    let Played { root, state, id, game } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    write_files(&work.join("old"), &[("mods/alt.jar", "alt"), ("config/pack.toml", "a=0")]);
    write_files(&work, &[("placed", "mods/neu.jar\n")]);
    write_files(&game, &[("mods/neu.jar", "neu")]);
    fs::remove_file(game.join("mods/alt.jar")).unwrap();

    assert_eq!(recover_interrupted(&state).await.unwrap(), 1);

    assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
    assert_eq!(read(&game, "config/pack.toml").as_deref(), Some("a=0"), "die ersetzte Datei kommt zurück");
    assert!(read(&game, "mods/neu.jar").is_none(), "die neu abgelegte Mod verschwindet");
    assert!(!work.exists());
    assert_eq!(recover_interrupted(&state).await.unwrap(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_launch_first_restores_an_interrupted_update() {
    let Played { root, state, id, game } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    write_files(&work.join("old"), &[("mods/alt.jar", "alt")]);
    fs::remove_file(game.join("mods/alt.jar")).unwrap();

    let instance = state.instances.get(&id).unwrap();

    assert!(recover_instance(&state.dirs, &instance).unwrap());

    assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
    assert!(!recover_instance(&state.dirs, &instance).unwrap());
    fs::remove_dir_all(root).unwrap();
}

/// Das Update hat die Instanz gespeichert, der Prozess endete aber vor dem Aufräumen oder das Aufräumen scheiterte.
#[tokio::test]
async fn recovery_never_undoes_an_update_the_instance_already_carries() {
    let Played { root, state, id, game } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    let origin = ModpackOrigin::File { name: "Abenteuer".into(), version: "2.0".into() };
    let target = serde_json::to_string(&origin).unwrap();
    state.instances.modify(&id, |i| i.modpack = Some(origin.clone())).unwrap();
    write_files(&work.join("old"), &[("mods/alt.jar", "alt")]);
    write_files(&work, &[("placed", "mods/neu.jar\n"), ("target", target.as_str())]);
    write_files(&game, &[("mods/neu.jar", "neu")]);
    fs::remove_file(game.join("mods/alt.jar")).unwrap();

    assert_eq!(recover_interrupted(&state).await.unwrap(), 0);

    assert_eq!(read(&game, "mods/neu.jar").as_deref(), Some("neu"), "die Dateien des gespeicherten Updates bleiben");
    assert!(read(&game, "mods/alt.jar").is_none());
    assert!(!work.exists());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn recovery_undoes_an_update_the_instance_does_not_carry_yet() {
    let Played { root, state, id, game } = played_instance().await;
    let work = state.dirs.instance(&id).join(WORK_DIR);
    let origin = ModpackOrigin::File { name: "Abenteuer".into(), version: "2.0".into() };
    let target = serde_json::to_string(&origin).unwrap();
    write_files(&work.join("old"), &[("mods/alt.jar", "alt")]);
    write_files(&work, &[("placed", "mods/neu.jar\n"), ("target", target.as_str())]);
    write_files(&game, &[("mods/neu.jar", "neu")]);
    fs::remove_file(game.join("mods/alt.jar")).unwrap();

    assert_eq!(recover_interrupted(&state).await.unwrap(), 1);

    assert_eq!(read(&game, "mods/alt.jar").as_deref(), Some("alt"));
    assert!(read(&game, "mods/neu.jar").is_none());
    fs::remove_dir_all(root).unwrap();
}
