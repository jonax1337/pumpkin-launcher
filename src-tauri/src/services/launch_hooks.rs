//! Der Befehl vor dem Start und der nach dem Ende des Spiels (siehe `launch_settings`). Beide laufen direkt, ohne
//! Shell, im Spielordner und mit den Umgebungsvariablen `PUMPKIN_INSTANCE_ID`, `PUMPKIN_INSTANCE_NAME`,
//! `PUMPKIN_GAME_DIR`, `PUMPKIN_MC_VERSION` und `PUMPKIN_LOADER`; der Befehl nach dem Ende bekommt zusätzlich
//! `PUMPKIN_EXIT_CODE`.
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::{Child, Command};

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::Instance;
use crate::services::launch_command::{CommandLine, Invocation};

/// So lange darf der Befehl vor dem Start laufen; danach wird er beendet und der Start abgebrochen.
pub const PRE_LAUNCH_TIMEOUT: Duration = Duration::from_secs(60);
/// So lange darf der Befehl nach dem Ende laufen; danach wird er beendet.
pub const POST_EXIT_TIMEOUT: Duration = Duration::from_secs(60);
/// Wert von `PUMPKIN_EXIT_CODE`, wenn das Spiel keinen Code hinterließ (etwa weil es von außen beendet wurde).
const NO_EXIT_CODE: i32 = -1;

/// Ein Hook samt dem, was er zum Laufen braucht; jeder Start legt seine eigenen an.
#[derive(Debug, Clone)]
pub struct Hook {
    command: CommandLine,
    instance_id: String,
    game_dir: PathBuf,
    env: Vec<(String, String)>,
}

#[derive(Debug)]
enum HookFailure {
    NotFound,
    Io(std::io::Error),
    /// Beendet mit diesem Code; `None`, wenn von außen beendet.
    Failed(Option<i32>),
    TimedOut,
}

impl Hook {
    pub fn new(command: CommandLine, instance: &Instance, game_dir: &Path) -> Self {
        let env = vec![
            ("PUMPKIN_INSTANCE_ID".to_owned(), instance.id.clone()),
            ("PUMPKIN_INSTANCE_NAME".to_owned(), instance.name.replace('\0', "")),
            ("PUMPKIN_GAME_DIR".to_owned(), game_dir.to_string_lossy().into_owned()),
            ("PUMPKIN_MC_VERSION".to_owned(), instance.minecraft_version.clone()),
            ("PUMPKIN_LOADER".to_owned(), instance.loader.name().to_owned()),
        ];
        Self { command, instance_id: instance.id.clone(), game_dir: game_dir.to_owned(), env }
    }

    /// Läuft der Befehl vor dem Start; gelingt er nicht (nicht gefunden, Fehlercode, Zeitüberschreitung), ist das ein
    /// Fehler und das Spiel startet nicht.
    pub async fn run_before_launch(&self) -> AppResult<()> {
        tracing::info!(instance = %self.instance_id, program = self.command.program(), "Befehl vor dem Start läuft");
        self.run(PRE_LAUNCH_TIMEOUT).await.map_err(|failure| failure.refusing_launch(self.command.program()))
    }

    /// Startet den Befehl nach dem Ende des Spiels im Hintergrund; ein Fehler wird nur geloggt.
    pub fn run_after_exit(self, exit_code: Option<i32>) {
        let hook = self.with_exit_code(exit_code);
        tokio::spawn(async move {
            if let Err(failure) = hook.run(POST_EXIT_TIMEOUT).await {
                tracing::warn!(instance = %hook.instance_id, program = hook.command.program(), ?failure, "Befehl nach dem Ende des Spiels gescheitert");
            }
        });
    }

    fn with_exit_code(mut self, exit_code: Option<i32>) -> Self {
        self.env.push(("PUMPKIN_EXIT_CODE".to_owned(), exit_code.unwrap_or(NO_EXIT_CODE).to_string()));
        self
    }

    async fn run(&self, timeout: Duration) -> Result<(), HookFailure> {
        let invocation = self.command.resolve().ok_or(HookFailure::NotFound)?;
        std::fs::create_dir_all(&self.game_dir).map_err(HookFailure::Io)?;
        let mut child = self.process(&invocation).spawn().map_err(HookFailure::Io)?;
        match tokio::time::timeout(timeout, child.wait()).await {
            Ok(Ok(status)) if status.success() => Ok(()),
            Ok(Ok(status)) => Err(HookFailure::Failed(status.code())),
            Ok(Err(err)) => Err(HookFailure::Io(err)),
            Err(_) => {
                stop(&mut child).await;
                Err(HookFailure::TimedOut)
            }
        }
    }

    fn process(&self, invocation: &Invocation) -> Command {
        let mut command = Command::new(&invocation.program);
        command
            .args(&invocation.args)
            .envs(self.env.iter().map(|(name, value)| (name, value)))
            .current_dir(&self.game_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        hide_console_window(&mut command);
        command
    }
}

async fn stop(child: &mut Child) {
    if let Err(err) = child.kill().await {
        tracing::warn!(%err, "Befehl ließ sich nicht beenden");
    }
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

impl HookFailure {
    fn refusing_launch(self, program: &str) -> AppError {
        AppError::invalid(match self {
            Self::NotFound => coded!("errors.game.launch.hookNotFound", program = program),
            Self::Io(err) => coded!("errors.game.launch.preLaunchNotStarted", program = program).with_details(err.to_string()),
            Self::Failed(Some(code)) => coded!("errors.game.launch.preLaunchFailed", program = program, code = code),
            Self::Failed(None) => coded!("errors.game.launch.preLaunchEnded", program = program),
            Self::TimedOut => coded!("errors.game.launch.preLaunchTimeout", program = program, seconds = PRE_LAUNCH_TIMEOUT.as_secs()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{new_id, ModLoader, NewInstance};
    use crate::services::launch_command::CommandKind;

    /// Ein Befehl, der die Shell des Systems ein Skript ausführen lässt (nur für den Test: der Launcher selbst nutzt keine).
    fn script(text: &str) -> CommandLine {
        let line = if cfg!(windows) { format!("cmd /D /C \"{text}\"") } else { format!("sh -c \"{text}\"") };
        CommandLine::parse(&line, CommandKind::PreLaunch).unwrap().unwrap()
    }

    fn hook(command: CommandLine) -> (Hook, Instance, PathBuf) {
        let new = NewInstance { name: "Start".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Fabric, loader_version: None };
        let instance = Instance::from_new(new);
        let game_dir = std::env::temp_dir().join(new_id());
        (Hook::new(command, &instance, &game_dir), instance, game_dir)
    }

    /// Mit Leerzeichen vor `>`: `echo 5> datei` leitet in `cmd` sonst das Handle 5 um und schreibt nichts.
    fn printing(variables: &[&str]) -> CommandLine {
        let reads: Vec<String> = variables.iter().map(|name| if cfg!(windows) { format!("%{name}%") } else { format!("${name}") }).collect();
        script(&format!("echo {} > out.txt", reads.join(",")))
    }

    fn printed(game_dir: &Path) -> String {
        std::fs::read_to_string(game_dir.join("out.txt")).unwrap().trim().to_owned()
    }

    #[tokio::test]
    async fn the_hook_runs_in_the_game_folder_and_knows_the_instance() {
        let command = printing(&["PUMPKIN_INSTANCE_ID", "PUMPKIN_INSTANCE_NAME", "PUMPKIN_GAME_DIR", "PUMPKIN_MC_VERSION", "PUMPKIN_LOADER"]);
        let (hook, instance, game_dir) = hook(command);

        hook.run_before_launch().await.unwrap();

        assert_eq!(printed(&game_dir), format!("{},Start,{},1.21.4,fabric", instance.id, game_dir.display()));
        std::fs::remove_dir_all(game_dir).unwrap();
    }

    #[tokio::test]
    async fn the_exit_command_gets_the_exit_code() {
        for (code, shown) in [(Some(5), "5"), (None, "-1")] {
            let (hook, _, game_dir) = hook(printing(&["PUMPKIN_EXIT_CODE"]));

            hook.with_exit_code(code).run(Duration::from_secs(30)).await.unwrap();

            assert_eq!(printed(&game_dir), shown);
            std::fs::remove_dir_all(game_dir).unwrap();
        }
    }

    #[tokio::test]
    async fn a_failing_hook_reports_its_exit_code() {
        let (hook, _, game_dir) = hook(script("exit 3"));

        let failure = hook.run(Duration::from_secs(30)).await.unwrap_err();

        assert!(matches!(failure, HookFailure::Failed(Some(3))), "{failure:?}");
        std::fs::remove_dir_all(game_dir).unwrap();
    }

    #[tokio::test]
    async fn a_failing_hook_stops_the_launch_with_a_message_naming_code_and_program() {
        let (hook, _, game_dir) = hook(script("exit 3"));

        let err = hook.run_before_launch().await.unwrap_err();

        assert_eq!(err.key(), Some("errors.game.launch.preLaunchFailed"));
        assert!(err.to_string().contains('3') && err.to_string().contains(hook.command.program()), "{err}");
        std::fs::remove_dir_all(game_dir).unwrap();
    }

    #[tokio::test]
    async fn a_hook_that_runs_too_long_is_stopped() {
        let sleeping = if cfg!(windows) { "ping -n 20 127.0.0.1 > nul" } else { "sleep 20" };
        let (hook, _, game_dir) = hook(script(sleeping));

        let failure = hook.run(Duration::from_millis(200)).await.unwrap_err();

        assert!(matches!(failure, HookFailure::TimedOut), "{failure:?}");
        std::fs::remove_dir_all(game_dir).ok();
    }

    #[tokio::test]
    async fn a_missing_program_stops_the_launch_before_anything_runs() {
        let command = CommandLine::parse("pumpkin-no-such-program-4711 --flag", CommandKind::PreLaunch).unwrap().unwrap();
        let (hook, _, game_dir) = hook(command);

        let err = hook.run_before_launch().await.unwrap_err();

        assert_eq!(err.key(), Some("errors.game.launch.hookNotFound"));
        assert!(!game_dir.exists());
    }
}
