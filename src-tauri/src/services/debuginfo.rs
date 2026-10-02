//! Debug-Info für Fehlerberichte: Launcher, System und Instanzen als Klartext. Bewusst ohne Instanz- und
//! Kontonamen und ohne Pfade; auf Englisch, weil sie in GitHub-Issues landet.
use std::path::Path;

use crate::models::{Instance, ModKind};
use crate::services::{java, javadetect, loader, system, Dirs};

const UNKNOWN: &str = "unknown";
const MIB_PER_GIB: f64 = 1024.0;

/// Eine Instanz mit ihrem Zustand, den nur der AppState kennt.
pub struct InstanceState<'a> {
    pub instance: &'a Instance,
    pub installed: bool,
    pub running: bool,
    /// Wie die Instanz zu ihrer Java kommt, siehe [`java_label`]; leer, solange sie nicht installiert ist.
    pub java: Option<String>,
}

/// Der Text für die Zwischenablage; was sich nicht ermitteln lässt, steht als „unknown“ da. `default_memory_mb`
/// bekommen Instanzen ohne eigene RAM-Einstellung. Die Mods einer Instanz stehen nur für `focus` (ihre ID): alle
/// Instanzen auf einmal machten den Bericht für ein Issue zu lang.
pub fn report(launcher_version: &str, data_dir: &Path, default_memory_mb: u32, instances: &[InstanceState], focus: Option<&str>) -> String {
    let mut lines = vec![
        format!("Pumpkin Launcher {launcher_version}"),
        format!("OS: {} ({})", system::os_version(), std::env::consts::ARCH),
        format!("RAM: {}", system::total_memory_mb().map_or_else(|_| UNKNOWN.into(), gib)),
        format!("Free space (data folder): {}", system::free_space_mb(data_dir).map_or_else(|_| UNKNOWN.into(), gib)),
        format!("WebView: {}", tauri::webview_version().unwrap_or_else(|_| UNKNOWN.into())),
        format!("Instances: {}", instances.len()),
    ];
    lines.extend(instances.iter().enumerate().map(|(index, state)| instance_line(index + 1, state, default_memory_mb)));
    if let Some((index, state)) = instances.iter().enumerate().find(|(_, state)| Some(state.instance.id.as_str()) == focus) {
        lines.extend(mod_lines(index + 1, state.instance));
    }
    lines.join("\n")
}

fn gib(mb: u64) -> String {
    format!("{:.1} GiB", mb as f64 / MIB_PER_GIB)
}

/// „Java 21.0.2 (bundled)“ bzw. „(custom)“ für eine eigene Installation des Nutzers; nur die Version, nie der Pfad.
pub fn java_label(version: Option<&str>, custom: bool) -> String {
    format!("Java {} ({})", version.unwrap_or(UNKNOWN), if custom { "custom" } else { "bundled" })
}

/// Die Java, mit der die installierte Instanz startet, soweit sie sich ermitteln lässt.
pub async fn java_of(dirs: &Dirs, instance: &Instance, launcher_java: Option<&str>) -> String {
    let custom = [instance.java_path.as_deref(), launcher_java].into_iter().flatten().any(|path| !path.trim().is_empty());
    let component = loader::installed_version(dirs, instance.into()).await.map(|version| version.java_component().to_owned());
    let exe = component.ok().and_then(|component| java::resolve(dirs, &component, instance.java_path.as_deref(), launcher_java).ok());
    java_label(exe.as_deref().and_then(javadetect::version_of).as_deref(), custom)
}

/// Nummeriert statt benannt: Instanznamen wählt der Nutzer frei, sie können Persönliches enthalten.
fn instance_line(number: usize, state: &InstanceState, default_memory_mb: u32) -> String {
    let instance = state.instance;
    let loader = match &instance.loader_version {
        Some(version) => format!("{} {version}", instance.loader.display_name()),
        None => instance.loader.display_name().to_owned(),
    };
    let mods = instance.mods.iter().filter(|m| m.kind == ModKind::Mod && m.enabled).count();
    let memory = instance.memory_mb.map_or_else(|| format!("{default_memory_mb} MiB (default)"), |mb| format!("{mb} MiB"));
    let status = match (state.installed, state.running) {
        (_, true) => "running",
        (true, false) => "installed",
        (false, false) => "not installed",
    };
    let java = state.java.as_ref().map(|java| format!("{java}, ")).unwrap_or_default();
    format!("#{number}: Minecraft {}, {loader}, {java}{mods} mods enabled, RAM {memory}, {status}", instance.minecraft_version)
}

/// Die Mod-Dateien der Instanz, eine je Zeile; deaktivierte sind markiert. Dateinamen statt Titel: sie nennen die Version.
fn mod_lines(number: usize, instance: &Instance) -> Vec<String> {
    let mods = instance.mods.iter().filter(|m| m.kind == ModKind::Mod).collect::<Vec<_>>();
    let heading = format!("Mods of #{number}:");
    let files = mods.iter().map(|m| format!("  {}{}", m.file_name, if m.enabled { "" } else { " (disabled)" }));
    if mods.is_empty() { vec![format!("{heading} none")] } else { std::iter::once(heading).chain(files).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Mod, ModLoader, ModSource, NewInstance};

    fn installed_mod(file: &str, enabled: bool) -> Mod {
        Mod {
            id: file.into(),
            name: "Titel".into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: file.into(),
            sha1: None,
            enabled,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    fn fabric_instance() -> Instance {
        Instance::from_new(NewInstance {
            name: "Max' Welt".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.5".into()),
        })
    }

    #[test]
    fn lists_instances_without_names_or_paths() {
        let mut instance = fabric_instance();
        let default_memory = instance.clone();
        instance.memory_mb = Some(6144);
        let data_dir = std::env::temp_dir();
        let states = [
            InstanceState { instance: &instance, installed: true, running: false, java: Some(java_label(Some("21.0.2"), false)) },
            InstanceState { instance: &default_memory, installed: false, running: false, java: None },
        ];
        let text = report("0.1.0", &data_dir, 4096, &states, None);
        assert!(text.starts_with("Pumpkin Launcher 0.1.0\n"), "{text}");
        assert!(
            text.ends_with(
                "Instances: 2\n\
                 #1: Minecraft 1.21.1, Fabric 0.16.5, Java 21.0.2 (bundled), 0 mods enabled, RAM 6144 MiB, installed\n\
                 #2: Minecraft 1.21.1, Fabric 0.16.5, 0 mods enabled, RAM 4096 MiB (default), not installed"
            ),
            "{text}"
        );
        assert!(!text.contains("Max") && !text.contains(&*data_dir.to_string_lossy()), "{text}");
    }

    #[test]
    fn the_focused_instance_lists_its_mod_files() {
        let mut instance = fabric_instance();
        instance.mods = vec![installed_mod("sodium-fabric-0.6.0.jar", true), installed_mod("lithium.jar", false)];
        let other = fabric_instance();
        let states = [
            InstanceState { instance: &other, installed: true, running: false, java: None },
            InstanceState { instance: &instance, installed: true, running: false, java: None },
        ];
        let report_for = |focus| report("0.1.0", &std::env::temp_dir(), 4096, &states, focus);
        assert!(report_for(Some(&instance.id)).ends_with("Mods of #2:\n  sodium-fabric-0.6.0.jar\n  lithium.jar (disabled)"));
        assert!(report_for(Some(&other.id)).ends_with("Mods of #1: none"));
        assert!(!report_for(None).contains("Mods of"));
        assert!(!report_for(Some("unbekannt")).contains("Mods of"));
    }

    #[test]
    fn java_is_named_by_version_and_origin_never_by_path() {
        assert_eq!(java_label(Some("17.0.9"), true), "Java 17.0.9 (custom)");
        assert_eq!(java_label(None, false), "Java unknown (bundled)");
    }
}
