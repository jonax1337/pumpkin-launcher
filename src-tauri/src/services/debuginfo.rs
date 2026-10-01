//! Debug-Info für Fehlerberichte: Launcher, System und Instanzen als Klartext. Bewusst ohne Instanz- und
//! Kontonamen und ohne Pfade; auf Englisch, weil sie in GitHub-Issues landet.
use std::path::Path;

use crate::models::{Instance, ModKind};
use crate::services::system;

const UNKNOWN: &str = "unknown";

/// Eine Instanz mit ihrem Zustand, den nur der AppState kennt.
pub struct InstanceState<'a> {
    pub instance: &'a Instance,
    pub installed: bool,
    pub running: bool,
}

/// Der Text für die Zwischenablage; was sich nicht ermitteln lässt, steht als „unknown“ da.
/// `default_memory_mb` bekommen Instanzen ohne eigene RAM-Einstellung.
pub fn report(launcher_version: &str, data_dir: &Path, default_memory_mb: u32, instances: &[InstanceState]) -> String {
    let mut lines = vec![
        format!("Pumpkin Launcher {launcher_version}"),
        format!("OS: {} ({})", system::os_version(), std::env::consts::ARCH),
        format!("RAM: {}", system::total_memory_mb().map_or_else(|_| UNKNOWN.into(), gib)),
        format!("Free space (data folder): {}", system::free_space_mb(data_dir).map_or_else(|_| UNKNOWN.into(), gib)),
        format!("WebView: {}", tauri::webview_version().unwrap_or_else(|_| UNKNOWN.into())),
        format!("Instances: {}", instances.len()),
    ];
    lines.extend(instances.iter().enumerate().map(|(index, state)| instance_line(index + 1, state, default_memory_mb)));
    lines.join("\n")
}

fn gib(mb: u64) -> String {
    format!("{:.1} GiB", mb as f64 / 1024.0)
}

/// Nummeriert statt benannt: Instanznamen wählt der Nutzer frei, sie können Persönliches enthalten.
fn instance_line(number: usize, state: &InstanceState, default_memory_mb: u32) -> String {
    let instance = state.instance;
    let loader = match &instance.loader_version {
        Some(version) => format!("{:?} {version}", instance.loader),
        None => format!("{:?}", instance.loader),
    };
    let mods = instance.mods.iter().filter(|m| m.kind == ModKind::Mod && m.enabled).count();
    let memory = instance.memory_mb.map_or_else(|| format!("{default_memory_mb} MiB (default)"), |mb| format!("{mb} MiB"));
    let status = match (state.installed, state.running) {
        (_, true) => "running",
        (true, false) => "installed",
        (false, false) => "not installed",
    };
    format!("#{number}: Minecraft {}, {loader}, {mods} mods enabled, RAM {memory}, {status}", instance.minecraft_version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModLoader, NewInstance};

    #[test]
    fn lists_instances_without_names_or_paths() {
        let mut instance = Instance::from_new(NewInstance {
            name: "Max' Welt".into(),
            minecraft_version: "1.21.1".into(),
            loader: ModLoader::Fabric,
            loader_version: Some("0.16.5".into()),
        });
        let default_memory = instance.clone();
        instance.memory_mb = Some(6144);
        let data_dir = std::env::temp_dir();
        let states = [
            InstanceState { instance: &instance, installed: true, running: false },
            InstanceState { instance: &default_memory, installed: false, running: false },
        ];
        let text = report("0.1.0", &data_dir, 4096, &states);
        assert!(text.starts_with("Pumpkin Launcher 0.1.0\n"), "{text}");
        assert!(
            text.ends_with(
                "Instances: 2\n\
                 #1: Minecraft 1.21.1, Fabric 0.16.5, 0 mods enabled, RAM 6144 MiB, installed\n\
                 #2: Minecraft 1.21.1, Fabric 0.16.5, 0 mods enabled, RAM 4096 MiB (default), not installed"
            ),
            "{text}"
        );
        assert!(!text.contains("Max") && !text.contains(&*data_dir.to_string_lossy()), "{text}");
    }
}
