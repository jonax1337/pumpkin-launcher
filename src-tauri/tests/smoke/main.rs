//! Rauchtest der Mod im Spiel (tools/mod-smoke/README.md): startet Minecraft, Loader und eingespeiste Mod
//! über den Startweg des Launchers ohne Tauri-Fenster und prüft den Bridge-Handshake.
//! Läuft nur mit dem Cargo-Feature `smoke` und einer Zelle in `PUMPKIN_SMOKE_CELL`.
mod config;
mod friends;
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
use launcher_lib::services::gamesignal::{GameSignal, GameSignals};
use launcher_lib::services::modbridge::ModBridge;
use launcher_lib::services::Dirs;

use config::{Config, Scenario};
use launch::{Game, Inputs, Prepared};
use friends::SmokeFriends;
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

    let signals = GameSignals::default();
    let bridge = ModBridge::new(signals.clone());
    let social = SmokeFriends::new(&dirs, &instance, client, signals.clone(), bridge.clone());
    let result = async {
        let social = social.as_ref().map_err(Clone::clone)?;
        bridge.start().await.map_err(|error| error.to_string())?;
        social.start().await?;
        let prepared = launch::prepare(&Inputs { dirs: &dirs, bridge: &bridge, source: &source, instance: &instance }).await?;
        let facts = Facts::of(&node, &instance, &prepared, &config.scenario);
        match &prepared.injection {
            Injection::Injected(_) => run_game(config, &node, &instance.id, prepared, &bridge, &signals, facts).await,
            Injection::Skipped(reason) => Ok(skipped_outcome(facts, &config.scenario, reason)),
            Injection::Failed(error) => Ok(facts.not_started(Verdict::Failed, format!("the injection failed: {error}"))),
        }
    }.await;
    signals.send(GameSignal::Exited { instance_id: instance.id.clone() });
    let social_cleanup = match social {
        Ok(social) => social.shutdown().await,
        Err(_) => Ok(()),
    };
    bridge.forget(&instance.id);
    bridge.stop().await;
    let copy_cleanup = copy.map_or(Ok(()), |copy| {
        std::fs::remove_file(&copy).map_err(|error| format!("{}: {error}", copy.display()))
    });
    finish_cleanup(finish_cleanup(result, social_cleanup), copy_cleanup)
}

fn finish_cleanup<T>(result: Result<T, String>, cleanup: Result<(), String>) -> Result<T, String> {
    match (result, cleanup) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(reason), Ok(())) | (Ok(_), Err(reason)) => Err(reason),
        (Err(reason), Err(cleanup)) => Err(format!("{reason}; {cleanup}")),
    }
}

/// Eine ausgelassene Einspeisung ist nur beim Szenario „doppelte Id“ das Bestehen (Anhang B, Punkt 2): das Tor weigert
/// sich, neben der Kopie im Mods-Ordner einzuspeisen; jedes andere Auslassen heißt, die Zelle kam nicht bis zum Spiel.
fn skipped_outcome(facts: Facts, scenario: &Scenario, reason: &SkipReason) -> (Outcome, Vec<String>) {
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

    fn outcome(self, result: Verdict, reason: String, ended: Ended) -> (Outcome, Vec<String>) {
        let outcome = Outcome {
            cell: self.cell,
            scenario: self.scenario,
            result,
            reason,
            strategy: self.strategy,
            minecraft: self.minecraft,
            loader_version: self.loader_version,
            java_major: self.java_major,
            proof: ended.proof.as_ref().map(Proof::describe),
            breaker: ended.breaker.map(|kind| format!("{kind:?}")),
            injected_jvm_args: self.injected_jvm_args,
            injected_game_args: self.injected_game_args,
            seconds: seconds(ended.duration),
            exit_code: ended.exit_code,
            evidence: evidence_of(&ended.log),
        };
        (outcome, ended.log)
    }

    fn not_started(self, verdict: Verdict, reason: String) -> (Outcome, Vec<String>) {
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
    natural_exit: bool,
    ready_lost: bool,
    duration: Duration,
    log: Vec<String>,
}

async fn run_game(
    config: &Config,
    node: &Node,
    instance_id: &str,
    prepared: Prepared,
    bridge: &ModBridge,
    signals: &GameSignals,
    facts: Facts,
) -> Result<(Outcome, Vec<String>), String> {
    let java = match &config.scenario {
        Scenario::SpawnWithJava { java } => java.clone(),
        _ => prepared.gate_java.clone(),
    };
    let game = Game::start(&prepared, &java, bridge, instance_id)?;
    signals.send(GameSignal::Spawned {
        instance_id: instance_id.to_owned(),
        pid: game.pid,
        online_account: false,
        friend_join: None,
    });
    eprintln!("[smoke] {} started as pid {} ({})", node.id, game.pid, config.scenario.label());
    let Prepared { injection, .. } = prepared;
    // Der Launcher lässt die Haltevorrichtung fallen, sobald das Spiel läuft; der Normalfall des Rauchtests hält sie bis zum Ende.
    let _guard = (config.scenario != Scenario::ReleaseGuardAtSpawn).then_some(injection);
    let probe = Probe { bridge, instance_id };
    let waited = wait_for_end(&game, &probe, config).await;
    let duration = game.elapsed();
    let stopped = game.stop().await?;
    let ended = Ended {
        exit_code: stopped.exit_code,
        duration,
        log: stopped.log,
        breaker: stopped.breaker.or(waited.breaker),
        natural_exit: waited.natural_exit || stopped.natural_exit,
        ..waited
    };
    let (result, reason) = judge(&config.scenario, &ended);
    Ok(facts.outcome(result, reason, ended))
}

async fn wait_for_end(game: &Game, probe: &Probe<'_>, config: &Config) -> Ended {
    let mut seen = Vec::new();
    let mut ready_at = None;
    loop {
        let (exit, breaker, log) = (game.exit(), game.breaker(), game.lines());
        let proof = probe.proof(&log);
        let timed_out = ready_at.is_none() && game.elapsed() > config.timeout;
        for line in probe.milestones() {
            if !seen.contains(&line) {
                seen.push(line.clone());
                eprintln!("{line}");
            }
        }
        let ready_lost = ready_at.is_some() && proof.is_none();
        let hold_finished = if proof.is_some() {
            let ready = ready_at.get_or_insert_with(std::time::Instant::now);
            ready.elapsed() >= config.ui_hold
        } else {
            false
        };
        if hold_finished || breaker.is_some() || exit.is_some() || timed_out || ready_lost {
            return Ended { proof, breaker, timed_out, natural_exit: exit.is_some(), ready_lost, ..Ended::default() };
        }
        tokio::time::sleep(POLL).await;
    }
}

/// Das Urteil: der Normalfall besteht mit einem Beweis, ein absichtlicher Fehlstart damit, dass der Breaker ihn im Log erkennt.
fn judge(scenario: &Scenario, ended: &Ended) -> (Verdict, String) {
    if scenario.expects_failed_start() {
        return judge_failed_start(ended);
    }
    if ended.log.iter().any(|line| line.contains("Pumpkin Bridge: disabling the in-game UI for this session")) {
        return (Verdict::Failed, "the Bridge disabled its UI during the smoke".to_owned());
    }
    if let Some(kind) = ended.breaker {
        return (Verdict::Failed, format!("the startup watch blames the mod: {kind:?}"));
    }
    if ended.natural_exit {
        return (Verdict::Failed, format!("the game exited with {:?} before the smoke completed", ended.exit_code));
    }
    if ended.ready_lost {
        return (Verdict::Failed, "the bridge disconnected before the UI hold completed".to_owned());
    }
    if ended.timed_out {
        return (Verdict::Timeout, "the smoke deadline expired before completion".to_owned());
    }
    match &ended.proof {
        Some(proof) => (Verdict::Passed, format!("proof: {}", proof.describe())),
        None => (Verdict::Failed, format!("the game ended with {:?} without proof of the mod", ended.exit_code)),
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

#[cfg(test)]
mod verdict_regressions {
    use super::*;

    fn ready() -> Ended {
        Ended {
            proof: Some(Proof::BridgeReady { screens: vec!["home".to_owned(), "friends".to_owned()] }),
            ..Ended::default()
        }
    }

    #[test]
    fn an_observed_startup_failure_overrides_an_earlier_ready() {
        let ended = Ended { breaker: Some(FailureKind::FabricIncompatibleModSet), ..ready() };
        assert_eq!(judge(&Scenario::HoldGuard, &ended).0, Verdict::Failed);
    }

    #[test]
    fn a_natural_game_exit_during_ui_hold_is_not_a_success() {
        let ended = Ended { natural_exit: true, exit_code: Some(0), ..ready() };
        assert_eq!(judge(&Scenario::HoldGuard, &ended).0, Verdict::Failed);
    }

    #[test]
    fn an_incomplete_hold_cannot_pass_because_ready_was_seen() {
        let ended = Ended { timed_out: true, ..ready() };
        assert_eq!(judge(&Scenario::HoldGuard, &ended).0, Verdict::Timeout);
    }

    #[test]
    fn a_disabled_ui_overrides_an_accepted_ready_handshake() {
        let ended = Ended {
            log: vec!["[Render thread/WARN] Pumpkin Bridge: disabling the in-game UI for this session".to_owned()],
            ..ready()
        };
        assert_eq!(judge(&Scenario::HoldGuard, &ended).0, Verdict::Failed);
    }

    #[test]
    fn the_harness_kill_exit_code_does_not_invalidate_a_completed_smoke() {
        let ended = Ended { exit_code: Some(-1), ..ready() };
        assert_eq!(judge(&Scenario::HoldGuard, &ended).0, Verdict::Passed);
    }
}
