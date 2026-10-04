//! Der Startweg des Launchers ohne Tauri-Fenster: dieselben Schritte wie `prepare_launch` und `spawn_game` in
//! `commands.rs` (Version lesen, Java wählen, Einspeisung entscheiden und vorbereiten, Argumente bauen, Prozess starten
//! und an den Datensatz der Brücke binden), zusammengesetzt aus denselben Funktionen der Bibliothek.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use launcher_lib::models::{Account, GameWindow, Instance};
use launcher_lib::services::content::ModIdScanner;
use launcher_lib::services::friends::ingame::{inject, FailureKind, Injection, InjectionRequest, InjectionState, JavaMajors, LaunchFacts, ModSource, StartupWatch, UserArgs};
use launcher_lib::services::launch::{self, LaunchSpec, Running};
use launcher_lib::services::modbridge::ModBridge;
use launcher_lib::services::rules::Env;
use launcher_lib::services::{auth, java, loader, Dirs};

const SMOKE_PLAYER: &str = "PumpkinSmoke";
const STOP_POLL: Duration = Duration::from_millis(100);
const STOP_POLLS: u32 = 150;
const WINDOW: GameWindow = GameWindow::Size { width: 854, height: 480 };

/// Alles, was zum Start feststeht, bevor das Spiel läuft (`PreparedLaunch` in `commands.rs`).
pub struct Prepared {
    pub injection: Injection,
    /// Das Java, das das Tor gesehen hat.
    pub gate_java: PathBuf,
    pub gate_java_major: Option<u32>,
    pub args: Vec<String>,
    pub game_dir: PathBuf,
}

pub struct Inputs<'a> {
    pub dirs: &'a Dirs,
    pub bridge: &'a ModBridge,
    pub source: &'a dyn ModSource,
    pub instance: &'a Instance,
}

pub async fn prepare(inputs: &Inputs<'_>) -> Result<Prepared, String> {
    let Inputs { dirs, bridge, source, instance } = *inputs;
    let account = auth::offline_account(SMOKE_PLAYER).map_err(|error| error.to_string())?;
    let version = loader::installed_version(dirs, instance.into()).await.map_err(|error| error.to_string())?;
    let gate_java = java::resolve(dirs, version.java_component(), instance.java_path.as_deref(), None).map_err(|error| error.to_string())?;
    let gate_java_major = JavaMajors::default().of(&gate_java);
    let game_dir = dirs.game_dir(&instance.id);
    let mod_ids = ModIdScanner::default().ids_in(&dirs.mods_dir(&instance.id));
    let facts = LaunchFacts {
        friends_enabled: true,
        bridge_running: true,
        online_account: false,
        minecraft: &instance.minecraft_version,
        loader: instance.loader,
        loader_version: instance.loader_version.as_deref().unwrap_or_default(),
        java_major: gate_java_major,
        global_switch: true,
        instance_state: &InjectionState::Active,
        launcher_version: env!("CARGO_PKG_VERSION"),
        mod_ids_in_instance: &mod_ids,
    }
    .with_online_account_forced();
    let user_jvm = launch::effective_jvm_args(&instance.jvm_args, &[]);
    let request = InjectionRequest {
        facts,
        instance_id: &instance.id,
        user: UserArgs { jvm: user_jvm, game: &instance.game_args, game_dir: &game_dir },
        pre_granted: false,
    };
    let injection = inject(source, &dirs.root, bridge, &request);
    let args = game_arguments(dirs, instance, &account, &version, &injection, user_jvm)?;
    Ok(Prepared { injection, gate_java, gate_java_major, args, game_dir })
}

fn game_arguments(
    dirs: &Dirs,
    instance: &Instance,
    account: &Account,
    version: &launcher_lib::services::mojang::VersionJson,
    injection: &Injection,
    user_jvm: &[String],
) -> Result<Vec<String>, String> {
    let start_args = injection.start_args(user_jvm, &instance.game_args);
    let spec = start_args.apply(LaunchSpec {
        version,
        dirs,
        instance_id: &instance.id,
        account,
        memory_mb: launch::DEFAULT_MEMORY_MB,
        min_memory_mb: None,
        injected_jvm_args: &[],
        extra_jvm_args: user_jvm,
        window: WINDOW,
        injected_game_args: &[],
        extra_game_args: &instance.game_args,
        quick_play: None,
        session: None,
    });
    launch::build_args(&spec, &Env::current()).map_err(|error| error.to_string())
}

/// Das laufende Spiel: Ausgabezeilen, Ende und das Urteil der Wache des Breakers.
pub struct Game {
    pub pid: u32,
    started: Instant,
    process: Running,
    lines: Arc<Mutex<Vec<String>>>,
    exit: Arc<Mutex<Option<Option<i32>>>>,
    breaker: Arc<Mutex<Option<FailureKind>>>,
}

impl Game {
    pub fn start(prepared: &Prepared, java: &Path, bridge: &ModBridge, instance_id: &str) -> Result<Self, String> {
        let started = Instant::now();
        let lines = Arc::new(Mutex::new(Vec::new()));
        let exit = Arc::new(Mutex::new(None));
        let breaker = Arc::new(Mutex::new(None));
        let watch = Arc::new(Mutex::new(StartupWatch::default()));
        let on_line = {
            let (lines, breaker, watch) = (lines.clone(), breaker.clone(), watch.clone());
            move |_stream, line: String| {
                eprintln!("[game] {line}");
                record_breaker(&breaker, unpoisoned(&watch).on_line(started.elapsed(), &line));
                unpoisoned(&lines).push(line);
            }
        };
        let on_exit = {
            let (exit, breaker, watch) = (exit.clone(), breaker.clone(), watch);
            move |code| {
                record_breaker(&breaker, unpoisoned(&watch).on_exit(code, started.elapsed()));
                *unpoisoned(&exit) = Some(code);
            }
        };
        let process = launch::spawn(java, &prepared.args, &prepared.game_dir, prepared.injection.env(), on_line, |_| {}, on_exit).map_err(|error| error.to_string())?;
        prepared.injection.bind_pid(bridge, instance_id, process.pid);
        Ok(Self { pid: process.pid, started, process, lines, exit, breaker })
    }

    pub fn lines(&self) -> Vec<String> {
        unpoisoned(&self.lines).clone()
    }

    /// `Some(code)` nach dem Ende des Spiels (`code` ist `None`, wenn es von außen beendet wurde).
    pub fn exit(&self) -> Option<Option<i32>> {
        *unpoisoned(&self.exit)
    }

    pub fn breaker(&self) -> Option<FailureKind> {
        *unpoisoned(&self.breaker)
    }

    pub fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }

    /// Beendet nur den Prozess, den dieser Lauf gestartet hat, wartet auf sein Ende und liefert Exit-Code und Log.
    pub async fn stop(self) -> (Option<i32>, Vec<String>) {
        let exit = self.exit.clone();
        let lines = self.lines.clone();
        self.process.kill();
        let mut code = None;
        for _ in 0..STOP_POLLS {
            if let Some(ended) = *unpoisoned(&exit) {
                code = ended;
                break;
            }
            tokio::time::sleep(STOP_POLL).await;
        }
        let log = unpoisoned(&lines).clone();
        (code, log)
    }
}

fn record_breaker(slot: &Mutex<Option<FailureKind>>, failure: Option<FailureKind>) {
    if failure.is_some() {
        *unpoisoned(slot) = failure;
    }
}

fn unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
