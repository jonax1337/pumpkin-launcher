//! Rauchtest der Mod im Spiel (docs/friends/INGAME.md 3.5, 10 Schicht 4, Anhang B; Anleitung in
//! `docs/friends/INGAME-SMOKE.md`): startet eine echte Zelle (Minecraft, Loader, eingespeiste Mod) über den Startweg des
//! Launchers, ohne Tauri-Fenster, und prüft, dass die Mod im Spiel angekommen ist. Läuft nur mit dem Cargo-Feature
//! `smoke` und wenn `PUMPKIN_SMOKE_CELL` eine Zelle nennt, sonst gibt es nichts zu starten.
mod config;
mod launch;
mod observe;
mod provision;
mod report;
mod source;

use std::fs::File;
use std::sync::Mutex;
use std::time::Duration;

use launcher_lib::services::download::http_client;
use launcher_lib::services::modbridge::ingame::{FailureKind, Injection, ModSource, Node, SkipReason};
use launcher_lib::services::gamesignal::GameSignals;
use launcher_lib::services::modbridge::ModBridge;
use launcher_lib::services::Dirs;

use config::{Config, Scenario};
use launch::{Game, Inputs, Prepared};
use observe::{Probe, Proof, POLL};
use report::{evidence_of, seconds, Outcome, Verdict};
use source::DistSource;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn smoke_cell() {
    let config = match Config::from_env() {
        Ok(Some(config)) => config,
        Ok(None) => return eprintln!("[smoke] PUMPKIN_SMOKE_CELL is not set: no cell to run"),
        Err(reason) => panic!("{reason}"),
    };
    capture_launcher_log(&config);
    let (outcome, game_log) = run_cell(&config).await.unwrap_or_else(|reason| panic!("setup of {} failed: {reason}", config.cell));
    report::write(&config.out, &outcome, &game_log).expect("report written");
    assert!(outcome.passed(), "{} [{}]: {}", outcome.cell, outcome.scenario, outcome.reason);
}

/// Die Tracing-Ausgabe des Launchers (Brücke, Wache) geht neben das Spiel-Log.
fn capture_launcher_log(config: &Config) {
    std::fs::create_dir_all(&config.out).expect("report folder");
    let file = File::create(config.out.join(format!("{}__{}.launcher.log", config.cell, config.scenario.label()))).expect("launcher log");
    let filter = tracing_subscriber::EnvFilter::new("launcher_lib=debug,warn");
    let _ = tracing_subscriber::fmt().with_env_filter(filter).with_ansi(false).with_writer(Mutex::new(file)).try_init();
}

async fn run_cell(config: &Config) -> Result<(Outcome, Vec<String>), String> {
    let mut source = DistSource::open(&config.dist)?;
    if let Scenario::WrongJar { jar_of_node } = &config.scenario {
        source.serve_jar_of(&config.cell, jar_of_node)?;
    }
    let node = source.index().node(&config.cell).ok_or_else(|| format!("node {} is not in the index", config.cell))?.clone();
    let dirs = Dirs::new(&config.data);
    let client = http_client().map_err(|error| error.to_string())?;
    let instance = provision::install(&client, &dirs, provision::instance_for(&node, config.loader_version.clone())).await?;
    let copy = (config.scenario == Scenario::DuplicateId).then(|| source.place_copy_of(&config.cell, &dirs.mods_dir(&instance.id))).transpose()?;

    let bridge = ModBridge::new(GameSignals::default());
    bridge.start().await.map_err(|error| error.to_string())?;
    let prepared = launch::prepare(&Inputs { dirs: &dirs, bridge: &bridge, source: &source, instance: &instance }).await?;
    let facts = Facts::of(&node, &instance, &prepared, &config.scenario);
    let result = match &prepared.injection {
        Injection::Injected(_) => run_game(config, &node, &instance.id, prepared, &bridge, &facts).await,
        Injection::Skipped(reason) => Ok(skipped_outcome(&facts, &config.scenario, reason)),
        Injection::Failed(error) => Ok(facts.not_started(Verdict::Failed, format!("the injection failed: {error}"))),
    };
    if let Some(copy) = copy {
        std::fs::remove_file(&copy).map_err(|error| format!("{}: {error}", copy.display()))?;
    }
    bridge.forget(&instance.id);
    bridge.stop().await;
    result
}

/// Eine ausgelassene Einspeisung ist nur beim Szenario „doppelte Id“ das Bestehen (Anhang B, Punkt 2): das Tor weigert
/// sich, neben der Kopie im Mods-Ordner einzuspeisen; jedes andere Auslassen heißt, die Zelle kam nicht bis zum Spiel.
fn skipped_outcome(facts: &Facts, scenario: &Scenario, reason: &SkipReason) -> (Outcome, Vec<String>) {
    let refused_beside_copy = scenario == &Scenario::DuplicateId && reason.code() == "idCollision";
    let verdict = if refused_beside_copy { Verdict::Passed } else { Verdict::Failed };
    let text = if refused_beside_copy {
        "the gate refused to inject beside the copy in mods".to_owned()
    } else {
        format!("the gate skipped the injection: {}", reason.code())
    };
    facts.not_started(verdict, text)
}

/// Was der Bericht über eine Zelle aus dem Aufbau kennt, bevor das Spiel läuft.
struct Facts {
    cell: String,
    scenario: String,
    strategy: String,
    minecraft: String,
    loader_version: String,
    java_major: Option<u32>,
    injected_jvm_args: Vec<String>,
    injected_game_args: Vec<String>,
}

impl Facts {
    fn of(node: &Node, instance: &launcher_lib::models::Instance, prepared: &Prepared, scenario: &Scenario) -> Self {
        let start_args = prepared.injection.start_args(&[], &instance.game_args);
        Self {
            cell: node.id.clone(),
            scenario: scenario.label(),
            strategy: serde_json::to_value(node.strategy).ok().and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default(),
            minecraft: instance.minecraft_version.clone(),
            loader_version: instance.loader_version.clone().unwrap_or_default(),
            java_major: prepared.gate_java_major,
            injected_jvm_args: start_args.injected_jvm,
            injected_game_args: start_args.injected_game,
        }
    }

    fn outcome(&self, result: Verdict, reason: String, ended: Ended) -> (Outcome, Vec<String>) {
        let outcome = Outcome {
            cell: self.cell.clone(),
            scenario: self.scenario.clone(),
            result,
            reason,
            strategy: self.strategy.clone(),
            minecraft: self.minecraft.clone(),
            loader_version: self.loader_version.clone(),
            java_major: self.java_major,
            proof: ended.proof.as_ref().map(Proof::describe),
            breaker: ended.breaker.map(|kind| format!("{kind:?}")),
            injected_jvm_args: self.injected_jvm_args.clone(),
            injected_game_args: self.injected_game_args.clone(),
            seconds: seconds(ended.duration),
            exit_code: ended.exit_code,
            evidence: evidence_of(&ended.log),
        };
        (outcome, ended.log)
    }

    fn not_started(&self, verdict: Verdict, reason: String) -> (Outcome, Vec<String>) {
        self.outcome(verdict, reason, Ended::default())
    }
}

/// Wie ein Lauf endete.
#[derive(Default)]
struct Ended {
    proof: Option<Proof>,
    breaker: Option<FailureKind>,
    exit_code: Option<i32>,
    timed_out: bool,
    duration: Duration,
    log: Vec<String>,
}

async fn run_game(
    config: &Config,
    node: &Node,
    instance_id: &str,
    prepared: Prepared,
    bridge: &ModBridge,
    facts: &Facts,
) -> Result<(Outcome, Vec<String>), String> {
    let java = match &config.scenario {
        Scenario::SpawnWithJava { java } => java.clone(),
        _ => prepared.gate_java.clone(),
    };
    let game = Game::start(&prepared, &java, bridge, instance_id)?;
    eprintln!("[smoke] {} started as pid {} ({})", node.id, game.pid, config.scenario.label());
    let Prepared { injection, .. } = prepared;
    // Der Launcher lässt die Haltevorrichtung fallen, sobald das Spiel läuft; der Normalfall des Rauchtests hält sie bis zum Ende.
    let _guard = (config.scenario != Scenario::ReleaseGuardAtSpawn).then_some(injection);
    let probe = Probe { bridge, instance_id, minecraft: &facts.minecraft, loader: node.loader };
    let waited = wait_for_end(&game, &probe, config).await;
    let duration = game.elapsed();
    let (exit_code, log) = game.stop().await;
    let ended = Ended { exit_code, duration, log, ..waited };
    let (result, reason) = judge(&config.scenario, &ended);
    Ok(facts.outcome(result, reason, ended))
}

async fn wait_for_end(game: &Game, probe: &Probe<'_>, config: &Config) -> Ended {
    let mut seen = Vec::new();
    loop {
        let (exit, breaker, log) = (game.exit(), game.breaker(), game.lines());
        let proof = probe.proof(&log);
        let timed_out = game.elapsed() > config.timeout;
        for line in probe.milestones() {
            if !seen.contains(&line) {
                seen.push(line.clone());
                eprintln!("{line}");
            }
        }
        if proof.is_some() || breaker.is_some() || exit.is_some() || timed_out {
            return Ended { proof, breaker, timed_out, ..Ended::default() };
        }
        tokio::time::sleep(POLL).await;
    }
}

/// Das Urteil: der Normalfall besteht mit einem Beweis, ein absichtlicher Fehlstart damit, dass der Breaker ihn im Log erkennt.
fn judge(scenario: &Scenario, ended: &Ended) -> (Verdict, String) {
    if scenario.expects_failed_start() {
        return judge_failed_start(ended);
    }
    match (&ended.proof, ended.breaker, ended.timed_out) {
        (Some(proof), _, _) => (Verdict::Passed, format!("proof: {}", proof.describe())),
        (None, Some(kind), _) => (Verdict::Failed, format!("the startup watch blames the mod: {kind:?}")),
        (None, None, true) => (Verdict::Timeout, "no proof of the mod within the time limit".to_owned()),
        (None, None, false) => (Verdict::Failed, format!("the game ended with {:?} without proof of the mod", ended.exit_code)),
    }
}

fn judge_failed_start(ended: &Ended) -> (Verdict, String) {
    match (&ended.proof, ended.breaker) {
        (_, Some(kind)) => (Verdict::Passed, format!("the startup watch recognised the failure: {kind:?}")),
        (Some(proof), None) => (Verdict::Failed, format!("the mod loaded although the start should fail: {}", proof.describe())),
        (None, None) if ended.timed_out => (Verdict::Timeout, "neither a failure nor the mod within the time limit".to_owned()),
        (None, None) => (Verdict::Failed, format!("the game ended with {:?} and its log does not name the mod", ended.exit_code)),
    }
}
