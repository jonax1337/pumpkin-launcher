//! Profile der Inhalte: benannte Schnappschüsse, welche Mods und Shader einer Instanz an sind. Anwenden schaltet wie
//! ein Schalter der Inhaltsliste (`mods::sync_commit`: Dateien und Metadaten gemeinsam), ändert aber sonst nichts,
//! auch nicht das Festhalten. Ressourcenpakete schaltet das Spiel selbst, sie gehören in kein Profil.
use std::collections::HashSet;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{new_id, require_name, Instance, Mod, ModKind, ModProfile};
use crate::services::store::JsonStore;
use crate::services::{mods, Dirs};

/// Längster Profilname in Zeichen.
pub const MAX_NAME_LEN: usize = 40;
/// So viele Profile hat eine Instanz höchstens.
pub const MAX_PROFILES: usize = 20;

/// Speichert den jetzigen Stand unter `name` und macht das Profil aktiv. Ein Profil gleichen Namens (ohne Rücksicht
/// auf Groß- und Kleinschreibung) wird überschrieben.
pub fn save(instances: &JsonStore<Instance>, instance_id: &str, name: &str) -> AppResult<Instance> {
    let name = valid_name(name)?;
    modify_checked(instances, instance_id, |instance| store_snapshot(instance, name))
}

/// Schaltet die Inhalte auf den Stand des Profils: Was es als an kennt, geht an, was es kannte und als aus
/// speicherte, geht aus. Spätere Inhalte bleiben, wie sie sind; was inzwischen fehlt, wird übergangen.
pub fn apply(dirs: &Dirs, instances: &JsonStore<Instance>, instance_id: &str, profile_id: &str) -> AppResult<Instance> {
    let instance = instances.get(instance_id)?;
    let profile = instance.mod_profiles[position_of(&instance, profile_id)?].clone();
    let mut desired = instance.mods;
    set_states(&mut desired, &profile);
    mods::sync_commit(dirs, instance_id, &desired, |_| {
        instances.modify(instance_id, |current| {
            set_states(&mut current.mods, &profile);
            current.active_mod_profile = Some(profile.id.clone());
        })
    })
}

pub fn rename(instances: &JsonStore<Instance>, instance_id: &str, profile_id: &str, name: &str) -> AppResult<Instance> {
    let name = valid_name(name)?;
    modify_checked(instances, instance_id, |instance| {
        let position = position_of(instance, profile_id)?;
        require_free_name(instance, name, profile_id)?;
        instance.mod_profiles[position].name = name.to_owned();
        Ok(())
    })
}

pub fn delete(instances: &JsonStore<Instance>, instance_id: &str, profile_id: &str) -> AppResult<Instance> {
    modify_checked(instances, instance_id, |instance| {
        let position = position_of(instance, profile_id)?;
        instance.mod_profiles.remove(position);
        if instance.active_mod_profile.as_deref() == Some(profile_id) {
            instance.active_mod_profile = None;
        }
        Ok(())
    })
}

/// Verwirft alle Profile: nach einem Wechsel von Minecraft-Version oder Loader beschreiben sie Mods des alten Spiels.
pub fn forget_all(instance: &mut Instance) {
    instance.mod_profiles.clear();
    instance.active_mod_profile = None;
}

/// Ändert die Instanz unter dem Lock des Stores. Scheitert `change`, hat es die Instanz nicht verändert.
fn modify_checked(
    instances: &JsonStore<Instance>,
    instance_id: &str,
    change: impl FnOnce(&mut Instance) -> AppResult<()>,
) -> AppResult<Instance> {
    let mut outcome = Ok(());
    let instance = instances.modify(instance_id, |current| outcome = change(current))?;
    outcome.map(|()| instance)
}

fn store_snapshot(instance: &mut Instance, name: &str) -> AppResult<()> {
    let existing = instance.mod_profiles.iter().position(|p| same_name(&p.name, name));
    if existing.is_none() && instance.mod_profiles.len() >= MAX_PROFILES {
        return Err(AppError::invalid(coded!("errors.profiles.tooMany", max = MAX_PROFILES)));
    }
    let id = existing.map_or_else(new_id, |position| instance.mod_profiles[position].id.clone());
    let profile = capture(id, name, &instance.mods);
    instance.active_mod_profile = Some(profile.id.clone());
    match existing {
        Some(position) => instance.mod_profiles[position] = profile,
        None => instance.mod_profiles.push(profile),
    }
    Ok(())
}

fn capture(id: String, name: &str, mods: &[Mod]) -> ModProfile {
    let switchable = || mods.iter().filter(|m| is_switchable(m));
    ModProfile {
        id,
        name: name.to_owned(),
        enabled_ids: switchable().filter(|m| m.enabled).map(|m| m.id.clone()).collect(),
        known_ids: switchable().map(|m| m.id.clone()).collect(),
    }
}

/// Setzt nur `enabled`; ein Inhalt, den das Profil nicht kennt, bleibt unberührt.
fn set_states(mods: &mut [Mod], profile: &ModProfile) {
    let enabled: HashSet<&str> = profile.enabled_ids.iter().map(String::as_str).collect();
    let known: HashSet<&str> = profile.known_ids.iter().map(String::as_str).collect();
    for m in mods.iter_mut().filter(|m| is_switchable(m)) {
        if enabled.contains(m.id.as_str()) {
            m.enabled = true;
        } else if known.contains(m.id.as_str()) {
            m.enabled = false;
        }
    }
}

fn is_switchable(m: &Mod) -> bool {
    m.kind != ModKind::ResourcePack
}

fn valid_name(raw: &str) -> AppResult<&str> {
    require_name(raw, MAX_NAME_LEN, coded!("errors.profiles.nameInvalid", max = MAX_NAME_LEN))
}

fn require_free_name(instance: &Instance, name: &str, own_id: &str) -> AppResult<()> {
    if instance.mod_profiles.iter().any(|p| p.id != own_id && same_name(&p.name, name)) {
        return Err(AppError::invalid(coded!("errors.profiles.nameTaken", name = name)));
    }
    Ok(())
}

fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

fn position_of(instance: &Instance, profile_id: &str) -> AppResult<usize> {
    let found = instance.mod_profiles.iter().position(|p| p.id == profile_id);
    found.ok_or_else(|| AppError::NotFound(coded!("errors.profiles.notFound").into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModLoader, ModSource, NewInstance};
    use std::fs;

    struct Fixture {
        dirs: Dirs,
        instances: JsonStore<Instance>,
        id: String,
    }

    impl Fixture {
        fn with(content: &[(&str, ModKind, bool)]) -> Self {
            let root = std::env::temp_dir().join(new_id());
            let dirs = Dirs::new(&root);
            let instances = JsonStore::open(root.join("instances.json")).unwrap();
            let mut instance = Instance::from_new(NewInstance {
                name: "Profile".into(),
                minecraft_version: "1.21.1".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
            });
            instance.mods = content.iter().map(|&(name, kind, enabled)| entry(&dirs, name, kind, enabled)).collect();
            mods::sync(&dirs, &instance.id, &instance.mods).unwrap();
            let id = instances.insert(instance).unwrap().id;
            Self { dirs, instances, id }
        }

        fn instance(&self) -> Instance {
            self.instances.get(&self.id).unwrap()
        }

        fn change_mods(&self, change: impl FnOnce(&mut Vec<Mod>)) {
            self.instances.modify(&self.id, |i| change(&mut i.mods)).unwrap();
        }

        fn save(&self, name: &str) -> Instance {
            save(&self.instances, &self.id, name).unwrap()
        }

        fn apply(&self, profile_id: &str) -> AppResult<Instance> {
            apply(&self.dirs, &self.instances, &self.id, profile_id)
        }

        fn on_disk(&self, name: &str) -> bool {
            self.dirs.game_dir(&self.id).join("mods").join(format!("{name}.jar")).exists()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dirs.root);
        }
    }

    fn entry(dirs: &Dirs, name: &str, kind: ModKind, enabled: bool) -> Mod {
        Mod {
            id: name.into(),
            name: name.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{name}{}", kind.extension()),
            sha1: Some(mods::cache_bytes(dirs, name.as_bytes()).unwrap()),
            enabled,
            kind,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    fn mod_entry(fixture: &Fixture, name: &str, enabled: bool) -> Mod {
        entry(&fixture.dirs, name, ModKind::Mod, enabled)
    }

    #[test]
    fn saving_snapshots_switchable_content_and_activates_the_profile() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true), ("b", ModKind::Mod, false), ("s", ModKind::Shader, true), ("r", ModKind::ResourcePack, true)]);

        let saved = fixture.save("  Performance ");

        let profile = &saved.mod_profiles[0];
        assert_eq!(profile.name, "Performance");
        assert_eq!(profile.enabled_ids, ["a", "s"]);
        assert_eq!(profile.known_ids, ["a", "b", "s"]);
        assert_eq!(saved.active_mod_profile.as_ref(), Some(&profile.id));
    }

    #[test]
    fn saving_under_an_existing_name_overwrites_it_and_keeps_its_id() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true)]);
        let first_id = fixture.save("Performance").mod_profiles[0].id.clone();
        fixture.change_mods(|mods| mods[0].enabled = false);

        let saved = fixture.save("PERFORMANCE");

        assert_eq!(saved.mod_profiles.len(), 1);
        assert_eq!((saved.mod_profiles[0].id.as_str(), saved.mod_profiles[0].name.as_str()), (first_id.as_str(), "PERFORMANCE"));
        assert!(saved.mod_profiles[0].enabled_ids.is_empty());
    }

    #[test]
    fn names_must_fit_and_stay_unique_and_profiles_are_capped() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true)]);
        let too_long = "x".repeat(MAX_NAME_LEN + 1);
        for invalid in ["", "   ", too_long.as_str()] {
            assert!(matches!(save(&fixture.instances, &fixture.id, invalid), Err(AppError::Invalid(_))), "{invalid:?}");
        }
        assert!(save(&fixture.instances, &fixture.id, &"x".repeat(MAX_NAME_LEN)).is_ok());
        let one = fixture.save("Eins").mod_profiles[1].id.clone();
        fixture.save("Zwei");

        assert!(matches!(rename(&fixture.instances, &fixture.id, &one, " ZWEI"), Err(AppError::Invalid(_))));
        assert_eq!(rename(&fixture.instances, &fixture.id, &one, "eins").unwrap().mod_profiles[1].name, "eins");

        for number in 0..MAX_PROFILES {
            let _ = save(&fixture.instances, &fixture.id, &format!("Profil {number}"));
        }
        assert_eq!(fixture.instance().mod_profiles.len(), MAX_PROFILES);
        assert!(matches!(save(&fixture.instances, &fixture.id, "Zu viel"), Err(AppError::Invalid(_))));
        assert!(save(&fixture.instances, &fixture.id, "eins").is_ok(), "überschreiben braucht keinen Platz");
    }

    #[test]
    fn applying_switches_known_content_and_leaves_newer_content_and_pinning_alone() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true), ("b", ModKind::Mod, false), ("c", ModKind::Mod, true)]);
        let profile_id = fixture.save("Performance").mod_profiles[0].id.clone();
        let newer_off = mod_entry(&fixture, "newer-off", false);
        let newer_on = mod_entry(&fixture, "newer-on", true);
        fixture.change_mods(|mods| {
            mods.iter_mut().for_each(|m| m.enabled = !m.enabled);
            mods[0].pinned = true;
            mods.extend([newer_off, newer_on]);
        });
        mods::sync(&fixture.dirs, &fixture.id, &fixture.instance().mods).unwrap();

        let applied = fixture.apply(&profile_id).unwrap();

        let states: Vec<_> = applied.mods.iter().map(|m| (m.id.as_str(), m.enabled, m.pinned)).collect();
        assert_eq!(states, [("a", true, true), ("b", false, false), ("c", true, false), ("newer-off", false, false), ("newer-on", true, false)]);
        assert_eq!(applied.active_mod_profile.as_deref(), Some(profile_id.as_str()));
        assert_eq!(fixture.instance(), applied);
        let on_disk: Vec<_> = ["a", "b", "c", "newer-off", "newer-on"].into_iter().map(|name| fixture.on_disk(name)).collect();
        assert_eq!(on_disk, [true, false, true, false, true]);
    }

    #[test]
    fn applying_ignores_content_that_is_gone_and_touches_no_resource_pack() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true), ("gone", ModKind::Mod, true), ("r", ModKind::ResourcePack, true)]);
        let profile_id = fixture.save("Alles").mod_profiles[0].id.clone();
        fixture.change_mods(|mods| {
            mods.remove(1);
            mods[0].enabled = false;
            mods[1].enabled = false;
        });

        let applied = fixture.apply(&profile_id).unwrap();

        let states: Vec<_> = applied.mods.iter().map(|m| (m.id.as_str(), m.enabled)).collect();
        assert_eq!(states, [("a", true), ("r", false)]);
    }

    #[test]
    fn a_failed_apply_changes_neither_files_nor_metadata() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true), ("b", ModKind::Mod, true)]);
        let profile_id = fixture.save("Beide").mod_profiles[0].id.clone();
        fixture.change_mods(|mods| mods.iter_mut().for_each(|m| m.enabled = false));
        mods::sync(&fixture.dirs, &fixture.id, &fixture.instance().mods).unwrap();
        let b_hash = fixture.instance().mods[1].sha1.clone().unwrap();
        fs::remove_file(mods::cache_path(&fixture.dirs, &b_hash).unwrap()).unwrap();
        let before = fixture.instance();

        assert!(fixture.apply(&profile_id).is_err());

        assert_eq!(fixture.instance(), before);
        assert!(!fixture.on_disk("a") && !fixture.on_disk("b"));
    }

    #[test]
    fn an_unknown_profile_is_not_found() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true)]);
        assert!(matches!(fixture.apply("none"), Err(AppError::NotFound(_))));
        assert!(matches!(delete(&fixture.instances, &fixture.id, "none"), Err(AppError::NotFound(_))));
        assert!(matches!(rename(&fixture.instances, &fixture.id, "none", "Name"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn deleting_the_active_profile_deactivates_it_and_forgetting_clears_everything() {
        let fixture = Fixture::with(&[("a", ModKind::Mod, true)]);
        let first = fixture.save("Eins").mod_profiles[0].id.clone();
        let second = fixture.save("Zwei").mod_profiles[1].id.clone();

        let after_other = delete(&fixture.instances, &fixture.id, &first).unwrap();
        assert_eq!(after_other.active_mod_profile.as_deref(), Some(second.as_str()));
        let after_active = delete(&fixture.instances, &fixture.id, &second).unwrap();
        assert_eq!((after_active.mod_profiles.len(), after_active.active_mod_profile), (0, None));

        let mut with_profiles = fixture.save("Drei");
        forget_all(&mut with_profiles);
        assert_eq!((with_profiles.mod_profiles.len(), with_profiles.active_mod_profile), (0, None));
    }
}
