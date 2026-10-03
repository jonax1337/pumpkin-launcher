//! Die Freunde-Mod installieren (SPEC 11.5): nur das gepinnte Modrinth-Projekt, nur gelistete Releases, über den
//! gewöhnlichen Installationsweg mit Hash-Prüfung. Ein Name statt der Projekt-ID wird nirgends benutzt.
use super::contract::ModState;
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{Instance, ModKind, ModLoader, ModSource};
use crate::services::content;
use crate::services::modrinth::{self, Version};
use crate::services::progress::ProgressFn;
use crate::state::AppState;

/// Modrinth-Projekt-ID der Freunde-Mod; der Besitzer legt das Projekt an und trägt sie hier ein. Bis dahin ist die
/// Mod nicht verfügbar, und die Entwicklungs-JAR kommt von Hand in den `mods/`-Ordner.
pub const MOD_PROJECT_ID: &str = "";

const RELEASE: &str = "release";
const JAR_EXTENSION: &str = ".jar";

/// Zustand der Mod in der Instanz; `Connected` kennt nur, wer die Mod-Brücke sieht.
pub fn status(instance: &Instance) -> ModState {
    status_for(MOD_PROJECT_ID, instance)
}

fn status_for(project_id: &str, instance: &Instance) -> ModState {
    if project_id.is_empty() || instance.loader != ModLoader::Fabric {
        ModState::Unavailable
    } else if has_active_mod_of(instance, project_id) {
        ModState::Installed
    } else {
        ModState::NotInstalled
    }
}

fn has_active_mod_of(instance: &Instance, project_id: &str) -> bool {
    instance.mods.iter().any(|m| {
        m.enabled && m.kind == ModKind::Mod && matches!(&m.source, ModSource::Modrinth { project_id: id, .. } if id == project_id)
    })
}

/// Installiert das neueste gelistete Release für Minecraft-Version und Fabric der Instanz samt Pflicht-Abhängigkeiten
/// (Fabric API). Der Aufrufer hält die Vorgangssperre.
pub async fn install(state: &AppState, instance_id: &str, progress: ProgressFn<'_>) -> AppResult<Instance> {
    let instance = state.instances.get(instance_id)?;
    if status(&instance) == ModState::Unavailable {
        return Err(not_available(&instance));
    }
    let client = modrinth::client()?;
    let listed =
        modrinth::listed_versions(&client, MOD_PROJECT_ID, &instance.minecraft_version, ModLoader::Fabric.name()).await?;
    let release = newest_release(listed, MOD_PROJECT_ID).ok_or_else(|| not_available(&instance))?;
    content::install_mod(state, instance_id, &release.id, progress).await
}

fn not_available(instance: &Instance) -> AppError {
    AppError::invalid(coded!("errors.friends.modNotAvailable", version = instance.minecraft_version))
}

/// Das neueste Release des Projekts `project_id`, dessen Hauptdatei sich sicher ablegen und prüfen lässt.
fn newest_release(versions: Vec<Version>, project_id: &str) -> Option<Version> {
    versions
        .into_iter()
        .filter(|v| v.project_id == project_id && v.version_type == RELEASE && has_installable_jar(v))
        .max_by(|a, b| a.date_published.cmp(&b.date_published))
}

/// Die Hauptdatei ist eine JAR mit einfachem Namen und trägt den SHA-512, gegen den die Installation prüft.
fn has_installable_jar(version: &Version) -> bool {
    modrinth::primary(version, JAR_EXTENSION)
        .is_ok_and(|file| is_plain_jar_name(&file.filename) && file.hashes.contains_key("sha512"))
}

/// `[A-Za-z0-9._+-]+\.jar`
fn is_plain_jar_name(name: &str) -> bool {
    name.strip_suffix(JAR_EXTENSION)
        .is_some_and(|stem| !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-')))
}

#[cfg(test)]
mod tests {
    use super::super::test_support::error_key;
    use super::*;
    use crate::models::{Mod, NewInstance};

    const PROJECT: &str = "friendsmod";

    fn instance(loader: ModLoader, mods: Vec<Mod>) -> Instance {
        let mut instance =
            Instance::from_new(NewInstance { name: "i".into(), minecraft_version: "26.3".into(), loader, loader_version: None });
        instance.mods = mods;
        instance
    }

    fn modrinth_mod(project: &str, enabled: bool, kind: ModKind) -> Mod {
        Mod {
            id: project.into(),
            name: project.into(),
            version: "1".into(),
            source: ModSource::Modrinth { project_id: project.into(), version_id: "v".into() },
            file_name: format!("{project}.jar"),
            sha1: None,
            enabled,
            kind,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    #[test]
    fn without_a_pinned_project_the_mod_is_unavailable() {
        assert_eq!(status_for("", &instance(ModLoader::Fabric, vec![])), ModState::Unavailable);
    }

    #[test]
    fn only_fabric_instances_can_have_the_mod() {
        for loader in [ModLoader::Vanilla, ModLoader::Quilt, ModLoader::Forge, ModLoader::NeoForge] {
            assert_eq!(status_for(PROJECT, &instance(loader, vec![])), ModState::Unavailable, "{loader:?}");
        }
    }

    #[test]
    fn the_mod_counts_as_installed_only_when_the_pinned_project_is_active() {
        let state = |mods| status_for(PROJECT, &instance(ModLoader::Fabric, mods));

        assert_eq!(state(vec![]), ModState::NotInstalled);
        assert_eq!(state(vec![modrinth_mod(PROJECT, true, ModKind::Mod)]), ModState::Installed);
        assert_eq!(state(vec![modrinth_mod(PROJECT, false, ModKind::Mod)]), ModState::NotInstalled);
        assert_eq!(state(vec![modrinth_mod("impostor", true, ModKind::Mod)]), ModState::NotInstalled);
        assert_eq!(state(vec![modrinth_mod(PROJECT, true, ModKind::ResourcePack)]), ModState::NotInstalled);
    }

    fn version(project: &str, id: &str, kind: &str, published: &str, file: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "id": id, "project_id": project, "name": id, "version_number": "1", "game_versions": ["26.3"],
            "loaders": ["fabric"], "dependencies": [], "version_type": kind, "date_published": published,
            "status": "listed", "files": [file]
        })
    }

    fn jar(name: &str, hashes: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "hashes": hashes, "url": "https://cdn.modrinth.com/a.jar", "filename": name, "primary": true, "size": 1 })
    }

    fn good_jar() -> serde_json::Value {
        jar("pumpkin_friends-0.1.0.jar", serde_json::json!({ "sha1": "a", "sha512": "b" }))
    }

    /// Antwort von Modrinth wie sie ankommt: erst der Statusfilter, dann die Wahl.
    fn picked(versions: Vec<serde_json::Value>) -> Option<String> {
        let listed = modrinth::parse_listed_versions(&serde_json::to_vec(&versions).unwrap()).unwrap();
        newest_release(listed, PROJECT).map(|v| v.id)
    }

    #[test]
    fn the_newest_listed_release_wins() {
        let picked = picked(vec![
            version(PROJECT, "old", "release", "2026-01-01T00:00:00Z", good_jar()),
            version(PROJECT, "new", "release", "2026-03-01T00:00:00Z", good_jar()),
            version(PROJECT, "mid", "release", "2026-02-01T00:00:00Z", good_jar()),
        ]);

        assert_eq!(picked.as_deref(), Some("new"));
    }

    #[test]
    fn a_version_of_another_project_is_refused() {
        assert_eq!(picked(vec![version("impostor", "v", "release", "2026-01-01T00:00:00Z", good_jar())]), None);
    }

    #[test]
    fn betas_and_alphas_are_refused() {
        let beta = version(PROJECT, "beta", "beta", "2026-05-01T00:00:00Z", good_jar());
        let alpha = version(PROJECT, "alpha", "alpha", "2026-06-01T00:00:00Z", good_jar());
        let release = version(PROJECT, "release", "release", "2026-01-01T00:00:00Z", good_jar());

        assert_eq!(picked(vec![beta, alpha, release]).as_deref(), Some("release"));
    }

    #[test]
    fn versions_that_are_not_listed_are_refused() {
        let mut draft = version(PROJECT, "draft", "release", "2026-09-01T00:00:00Z", good_jar());
        draft["status"] = "draft".into();
        let mut archived = version(PROJECT, "archived", "release", "2026-08-01T00:00:00Z", good_jar());
        archived["status"] = "archived".into();
        let listed_release = version(PROJECT, "listed", "release", "2026-01-01T00:00:00Z", good_jar());

        assert_eq!(picked(vec![draft, archived, listed_release]).as_deref(), Some("listed"));
    }

    #[test]
    fn a_main_file_that_cannot_be_installed_safely_is_refused() {
        let hashes = serde_json::json!({ "sha1": "a", "sha512": "b" });
        let candidates = [
            jar("friends mod.jar", hashes.clone()),
            jar("evil/mod.jar", hashes.clone()),
            jar("a.zip", hashes.clone()),
            jar("ümlaut.jar", hashes.clone()),
            jar(".jar", hashes),
            jar("fine.jar", serde_json::json!({ "sha1": "a" })),
        ];
        for file in candidates {
            assert_eq!(picked(vec![version(PROJECT, "v", "release", "2026-01-01T00:00:00Z", file.clone())]), None, "{file}");
        }
    }

    #[test]
    fn plain_jar_names_use_the_documented_alphabet() {
        for name in ["pumpkin_friends-0.1.0+mc26.3.jar", "a.jar", "A-b_c.d.jar"] {
            assert!(is_plain_jar_name(name), "{name}");
        }
        for name in ["", ".jar", "a.JAR", "a b.jar", "a/b.jar", "a\\b.jar", "a.jar.exe"] {
            assert!(!is_plain_jar_name(name), "{name}");
        }
    }

    #[test]
    fn a_missing_release_reports_the_minecraft_version() {
        let err = not_available(&instance(ModLoader::Fabric, vec![]));

        assert_eq!(error_key(&err), "errors.friends.modNotAvailable");
        assert_eq!(serde_json::to_value(&err).unwrap()["params"]["version"], "26.3");
    }
}
