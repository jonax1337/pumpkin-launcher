//! Headless-Test ohne UI: installiert eine Version (Vanilla oder mit Mod-Loader) und startet sie offline.
//!
//! `cargo run --example launch -- [version|1.21] [spielername] [sekunden] [vanilla|fabric|quilt|neoforge|forge[:loader]]`
//!
//! - Version: exakte ID oder Präfix; Präfix nimmt die neueste passende Release (Standard `1.21`).
//! - Sekunden: danach wird das Spiel beendet (Standard `0`: warten, bis es sich selbst beendet).
//! - Loader: Standard `vanilla`; `fabric` nimmt den neuesten stabilen Loader, `fabric:0.19.5` einen bestimmten
//!   (ebenso `quilt`, `neoforge`, `forge`).
//! - Datenverzeichnis: `LAUNCHER_DATA`, sonst dasselbe wie die App (`%APPDATA%/dev.laux.launcher`).
use std::path::PathBuf;
use std::time::Duration;

use launcher_lib::models::GameWindow;
use launcher_lib::services::mojang::{VersionManifest, MANIFEST_URL};
use launcher_lib::services::rules::Env;
use launcher_lib::services::{auth, download, fabric, forge, install, launch, Dirs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let mut args = std::env::args().skip(1);
    let wanted = args.next().unwrap_or_else(|| "1.21".into());
    let username = args.next().unwrap_or_else(|| "Headless".into());
    let seconds: Option<u64> = args.next().map(|s| s.parse()).transpose()?.filter(|&s| s > 0);
    let loader = args.next().unwrap_or_else(|| "vanilla".into());
    let (loader_name, wanted_loader) = match loader.split_once(':') {
        Some((name, v)) => (name.to_owned(), Some(v.to_owned())),
        None => (loader.clone(), None),
    };
    enum Kind {
        Vanilla,
        Profile(fabric::Flavor),
        Installer(forge::Kind),
    }
    let kind = match loader_name.as_str() {
        "vanilla" => Kind::Vanilla,
        "fabric" => Kind::Profile(fabric::Flavor::Fabric),
        "quilt" => Kind::Profile(fabric::Flavor::Quilt),
        "neoforge" => Kind::Installer(forge::Kind::NeoForge),
        "forge" => Kind::Installer(forge::Kind::Forge),
        _ => return Err(format!("unbekannter Loader '{loader}'").into()),
    };

    let root = std::env::var_os("LAUNCHER_DATA").map(PathBuf::from).unwrap_or_else(|| {
        let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| "target".into());
        base.join("dev.laux.launcher")
    });
    let dirs = Dirs::new(root);
    let client = download::http_client()?;

    let manifest: VersionManifest = download::get_json(&client, MANIFEST_URL).await?;
    let id = manifest
        .versions
        .iter()
        .find(|v| v.id == wanted || (v.kind == "release" && v.id.starts_with(&format!("{wanted}."))))
        .map(|v| v.id.clone())
        .ok_or_else(|| format!("keine Version passt zu '{wanted}'"))?;
    println!("Version {id}, Daten in {}", dirs.root.display());

    let mut version = install::fetch_version(&client, &dirs, &id).await?;
    let instance_id = format!("headless-{loader_name}");
    let on_progress = |step, done, total| {
        if done == total || done % 500 == 0 {
            println!("[install] {step:?} {done}/{total}");
        }
    };
    let mut installer = None;
    match &kind {
        Kind::Vanilla => {}
        Kind::Profile(flavor) => {
            let loader = fabric::resolve_loader(&client, *flavor, &id, wanted_loader.as_deref()).await?;
            println!("{} {loader}", flavor.name());
            let profile = fabric::fetch_profile(&client, &dirs, *flavor, &id, &loader).await?;
            version = fabric::merge(version, &profile)?;
        }
        Kind::Installer(k) => {
            let loader = forge::resolve_loader(&client, *k, &id, wanted_loader.as_deref()).await?;
            println!("{} {loader}", k.name());
            installer = Some((*k, loader));
        }
    }
    let java = install::install(&client, &dirs, &version, &instance_id, &on_progress).await?;
    if let Some((k, loader)) = installer {
        let profile = forge::install(&client, &dirs, k, &id, &loader, &java, &|d, t| println!("[install] Loader {d}/{t}")).await?;
        version = forge::merge(version, &profile)?;
    }
    let instance_id = instance_id.as_str();

    let account = auth::offline_account(&username)?;
    let spec = launch::LaunchSpec {
        version: &version,
        dirs: &dirs,
        instance_id,
        account: &account,
        memory_mb: launch::DEFAULT_MEMORY_MB,
        extra_jvm_args: &[],
        window: GameWindow::Default,
        extra_game_args: &[],
        quick_play: None,
    };
    let args = launch::build_args(&spec, &Env::current())?;
    let (exit_tx, mut exit_rx) = tokio::sync::oneshot::channel();
    let game = launch::spawn(
        &java,
        &args,
        &dirs.game_dir(instance_id),
        |stream, line| println!("[{stream:?}] {line}"),
        move |code| {
            let _ = exit_tx.send(code);
        },
    )?;
    println!("gestartet: pid {} mit {}", game.pid, java.display());

    let code = match seconds {
        Some(s) => match tokio::time::timeout(Duration::from_secs(s), &mut exit_rx).await {
            Ok(code) => code?,
            Err(_) => {
                println!("{s} s vorbei, beende pid {}", game.pid);
                game.kill();
                exit_rx.await?
            }
        },
        None => exit_rx.await?,
    };
    println!("beendet, Exit-Code {code:?}");
    Ok(())
}
