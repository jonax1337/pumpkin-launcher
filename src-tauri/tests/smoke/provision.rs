//! Minecraft und Loader über dieselben Dienste installieren, die der Befehl `instance_install` benutzt
//! (`commands.rs`, `install_instance`): Version laden, Loader auflösen, installieren, als installiert vermerken.
use launcher_lib::models::{Instance, ModLoader, NewInstance};
use launcher_lib::services::modbridge::ingame::{Loader, Node};
use launcher_lib::services::install::{self, InstallStep};
use launcher_lib::services::loader;
use launcher_lib::services::Dirs;

/// Die Instanz, die den Knoten bedient: die Minecraft-Version, gegen die er gebaut ist, mit dem Loader des Knotens.
/// Die Id ist je Zelle fest, damit ein zweiter Lauf denselben Ordner benutzt.
pub fn instance_for(node: &Node, loader_version: Option<String>) -> Instance {
    let minecraft = node.minecraft.last().expect("ein geprüfter Index nennt mindestens eine Minecraft-Version").clone();
    let new = NewInstance { name: format!("smoke {}", node.id), minecraft_version: minecraft, loader: mod_loader(node.loader), loader_version };
    Instance { id: format!("smoke-{}", node.id), ..Instance::from_new(new) }
}

fn mod_loader(loader: Loader) -> ModLoader {
    match loader {
        Loader::Fabric => ModLoader::Fabric,
        Loader::Neoforge => ModLoader::NeoForge,
        Loader::Forge => ModLoader::Forge,
    }
}

/// Installiert die Instanz und liefert sie mit der aufgelösten Loader-Version zurück.
pub async fn install(client: &reqwest::Client, dirs: &Dirs, instance: Instance) -> Result<Instance, String> {
    let on_progress = |step: InstallStep, done: u64, total: u64| {
        if done == total {
            eprintln!("[smoke] install {step:?} done ({total})");
        }
    };
    let plan = loader::plan_install(client, dirs, (&instance).into(), &on_progress).await.map_err(|error| error.to_string())?;
    let instance = Instance { loader_version: plan.loader_version().map(str::to_owned).or(instance.loader_version), ..instance };
    plan.install(client, dirs, &instance.id, &on_progress).await.map_err(|error| error.to_string())?;
    install::mark_installed(dirs, &instance).await.map_err(|error| error.to_string())?;
    Ok(instance)
}
