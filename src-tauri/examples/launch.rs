//! Headless-Test ohne UI: installiert eine Version (Vanilla oder mit Mod-Loader) und startet sie offline.
//!
//! `cargo run --example launch -- [version|1.21] [spielername] [sekunden] [vanilla|fabric|quilt|neoforge|forge[:loader]]`
//!
//! - Version: exakte ID oder Präfix; Präfix nimmt die neueste passende Release (Standard `1.21`).
//! - Sekunden: danach wird das Spiel beendet (Standard `0`: warten, bis es sich selbst beendet).
//! - Loader: Standard `vanilla`; `fabric` nimmt den neuesten stabilen Loader, `fabric:0.19.5` einen bestimmten
//!   (ebenso `quilt`, `neoforge`, `forge`).
//! - Datenverzeichnis: `LAUNCHER_DATA`, sonst dasselbe wie die App (Datenordner des Systems, darin `dev.laux.launcher`).
use std::path::PathBuf;
use std::time::Duration;

use launcher_lib::models::{GameWindow, ModLoader};
use launcher_lib::services::install::InstallStep;
use launcher_lib::services::launch::{self, LaunchSpec, Running};
use launcher_lib::services::loader::{self, GameChoice, InstalledGame};
use launcher_lib::services::mojang::{VersionManifest, MANIFEST_URL};
use launcher_lib::services::rules::Env;
use launcher_lib::services::{auth, download, Dirs};
use tokio::sync::oneshot;

type Error = Box<dyn std::error::Error>;
/// Exit-Code des Spiels, sobald es beendet ist.
type ExitCode = oneshot::Receiver<Option<i32>>;

/// Die Angaben der Kommandozeile.
struct Options {
    wanted: String,
    username: String,
    seconds: Option<u64>,
    loader: ModLoader,
    loader_version: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let options = parse_options()?;
    let dirs = Dirs::new(data_dir());
    let client = download::http_client()?;
    let mc = find_version(&client, &options.wanted).await?;
    println!("Version {mc}, Daten in {}", dirs.root.display());

    let instance_id = format!("headless-{}", options.loader.name());
    let choice = GameChoice { mc: &mc, loader: options.loader, loader_version: options.loader_version.as_deref() };
    let game = install(&client, &dirs, choice, &instance_id).await?;
    let (running, exit_rx) = start(&dirs, &game, &instance_id, &options.username)?;
    println!("gestartet: pid {} mit {}", running.pid, game.java.display());
    let code = wait_for_exit(running, exit_rx, options.seconds).await?;
    println!("beendet, Exit-Code {code:?}");
    Ok(())
}

fn parse_options() -> Result<Options, Error> {
    let mut args = std::env::args().skip(1);
    let wanted = args.next().unwrap_or_else(|| "1.21".into());
    let username = args.next().unwrap_or_else(|| "Headless".into());
    let seconds: Option<u64> = args.next().map(|s| s.parse()).transpose()?.filter(|&s| s > 0);
    let loader_arg = args.next().unwrap_or_else(|| "vanilla".into());
    let (name, loader_version) = match loader_arg.split_once(':') {
        Some((name, version)) => (name, Some(version.to_owned())),
        None => (loader_arg.as_str(), None),
    };
    let loader = ModLoader::from_name(name).ok_or_else(|| format!("unbekannter Loader '{loader_arg}'"))?;
    Ok(Options { wanted, username, seconds, loader, loader_version })
}

fn data_dir() -> PathBuf {
    std::env::var_os("LAUNCHER_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::data_dir().unwrap_or_else(|| "target".into()).join("dev.laux.launcher"))
}

/// Exakte Versions-ID oder die neueste Release mit diesem Präfix.
async fn find_version(client: &reqwest::Client, wanted: &str) -> Result<String, Error> {
    let manifest: VersionManifest = download::get_json(client, MANIFEST_URL).await?;
    select_version(manifest, wanted)
}

fn select_version(manifest: VersionManifest, wanted: &str) -> Result<String, Error> {
    let id = manifest
        .versions
        .into_iter()
        .find(|version| {
            version.id == wanted
                || (version.kind == "release" && version.id.strip_prefix(wanted).is_some_and(|suffix| suffix.starts_with('.')))
        })
        .map(|version| version.id)
        .ok_or_else(|| format!("keine Version passt zu '{wanted}'"))?;
    Ok(id)
}

async fn install(client: &reqwest::Client, dirs: &Dirs, choice: GameChoice<'_>, instance_id: &str) -> Result<InstalledGame, Error> {
    let on_progress = |step, done, total| {
        if step == InstallStep::Loader || done == total || done % 500 == 0 {
            println!("[install] {step:?} {done}/{total}");
        }
    };
    let plan = loader::plan_install(client, dirs, choice, &on_progress).await?;
    if let Some(version) = plan.loader_version() {
        println!("{} {version}", choice.loader.display_name());
    }
    Ok(plan.install(client, dirs, instance_id, &on_progress).await?)
}

/// Startet das Spiel offline; der Empfänger bekommt den Exit-Code.
fn start(dirs: &Dirs, game: &InstalledGame, instance_id: &str, username: &str) -> Result<(Running, ExitCode), Error> {
    let account = auth::offline_account(username)?;
    let spec = LaunchSpec {
        version: &game.version,
        dirs,
        instance_id,
        account: &account,
        memory_mb: launch::DEFAULT_MEMORY_MB,
        min_memory_mb: None,
        injected_jvm_args: &[],
        injected_classpath: &[],
        extra_jvm_args: &[],
        window: GameWindow::Default,
        injected_game_args: &[],
        extra_game_args: &[],
        quick_play: None,
        session: None,
    };
    let args = launch::build_args(&spec, &Env::current())?;
    let (exit_tx, exit_rx) = oneshot::channel();
    let on_exit = move |result: launch::ProcessExit| {
        // Ohne Empfänger wartet `main` nicht mehr: dann ist nichts zu melden.
        exit_tx.send(result.code).ok();
    };
    let game_dir = dirs.game_dir(instance_id);
    let running = launch::spawn(&game.java, &args, &game_dir, &[], |stream, line| println!("[{stream:?}] {line}"), |_| {}, on_exit)?;
    Ok((running, exit_rx))
}

/// Wartet auf das Spielende; nach `seconds` wird das Spiel beendet.
async fn wait_for_exit(running: Running, mut exit_rx: ExitCode, seconds: Option<u64>) -> Result<Option<i32>, Error> {
    let Some(seconds) = seconds else { return Ok(exit_rx.await?) };
    match tokio::time::timeout(Duration::from_secs(seconds), &mut exit_rx).await {
        Ok(code) => Ok(code?),
        Err(_) => {
            println!("{seconds} s vorbei, beende pid {}", running.pid);
            running.kill();
            Ok(exit_rx.await?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use launcher_lib::services::mojang::{Latest, VersionEntry};

    fn manifest(entries: &[(&str, &str)]) -> VersionManifest {
        VersionManifest {
            latest: Latest { release: String::new(), snapshot: String::new() },
            versions: entries.iter().map(|&(id, kind)| VersionEntry {
                id: id.to_owned(),
                kind: kind.to_owned(),
                url: String::new(),
                sha1: String::new(),
                release_time: String::new(),
            }).collect(),
        }
    }

    #[test]
    fn version_selection_keeps_manifest_order_even_before_an_exact_id() {
        let versions = manifest(&[("1.21.1", "release"), ("1.21", "release")]);
        assert_eq!(select_version(versions, "1.21").unwrap(), "1.21.1");
    }

    #[test]
    fn prefix_selection_skips_snapshots_but_exact_snapshots_are_allowed() {
        let entries = [("1.21.snapshot", "snapshot"), ("1.21.2", "release")];
        assert_eq!(select_version(manifest(&entries), "1.21").unwrap(), "1.21.2");
        assert_eq!(select_version(manifest(&entries), "1.21.snapshot").unwrap(), "1.21.snapshot");
    }

    #[test]
    fn prefix_selection_requires_the_dot_separator_and_keeps_the_error() {
        let error = select_version(manifest(&[("1.210.1", "release")]), "1.21").unwrap_err();
        assert_eq!(error.to_string(), "keine Version passt zu '1.21'");
    }
}
