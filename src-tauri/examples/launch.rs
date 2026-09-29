//! Headless-Test ohne UI: installiert eine Vanilla-Version und startet sie offline.
//!
//! `cargo run --example launch -- [version|1.21] [spielername] [sekunden]`
//!
//! - Version: exakte ID oder Präfix; Präfix nimmt die neueste passende Release (Standard `1.21`).
//! - Sekunden: danach wird das Spiel beendet (Standard: warten, bis es sich selbst beendet).
//! - Datenverzeichnis: `LAUNCHER_DATA`, sonst dasselbe wie die App (`%APPDATA%/dev.laux.launcher`).
use std::path::PathBuf;
use std::time::Duration;

use launcher_lib::services::mojang::{VersionManifest, MANIFEST_URL};
use launcher_lib::services::rules::Env;
use launcher_lib::services::{auth, download, install, launch, Dirs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let mut args = std::env::args().skip(1);
    let wanted = args.next().unwrap_or_else(|| "1.21".into());
    let username = args.next().unwrap_or_else(|| "Headless".into());
    let seconds: Option<u64> = args.next().map(|s| s.parse()).transpose()?;

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

    let version = install::fetch_version(&client, &dirs, &id).await?;
    let instance_id = "headless";
    let on_progress = |step, done, total| {
        if done == total || done % 500 == 0 {
            println!("[install] {step:?} {done}/{total}");
        }
    };
    let java = install::install(&client, &dirs, &version, instance_id, &on_progress).await?;

    let account = auth::offline_account(&username)?;
    let spec = launch::LaunchSpec {
        version: &version,
        dirs: &dirs,
        instance_id,
        account: &account,
        memory_mb: launch::DEFAULT_MEMORY_MB,
        extra_jvm_args: &[],
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
