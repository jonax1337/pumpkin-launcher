//! Start-Umgebung einer Instanz und des Launchers: Umgebungsvariablen, Wrapper-Befehl (`gamemoderun`, `mangohud`, …)
//! und die Befehle vor dem Start und nach dem Ende des Spiels. Sie gelten je Instanz; hat die Instanz zu einem Feld
//! nichts eingestellt, gilt der Standard des Launchers (wie bei den JVM-Argumenten).
//!
//! Wrapper und Hooks führen Programme mit den Rechten des Nutzers aus. Sie kommen deshalb nur aus den eigenen
//! Einstellungen, nie aus Modpacks, Vorlagen oder den Dateien anderer Launcher: jeder Import legt die Instanz mit
//! `LaunchSettings::default()` an. Nur das Duplizieren einer eigenen Instanz übernimmt sie.
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::Instance;
use crate::services::launch_command::{CommandKind, CommandLine, Invocation};
use crate::services::launch_hooks::Hook;

/// Umgebungsvariablen je Liste.
pub const MAX_ENV_VARS: usize = 64;
/// Zeichen im Namen einer Umgebungsvariable.
const MAX_ENV_NAME_CHARS: usize = 128;
/// Zeichen im Wert einer Umgebungsvariable.
const MAX_ENV_VALUE_CHARS: usize = 4096;
/// Namen mit diesem Anfang setzt der Launcher selbst (Verbindung zur Mod im Spiel, Umgebung der Hooks), gleich wie
/// sie geschrieben sind. Sie lassen sich nicht einstellen; setzt die Einspeisung eine, gilt ohnehin ihr Wert.
const RESERVED_PREFIX: &str = "PUMPKIN_";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LaunchSettings {
    pub env: Vec<EnvVar>,
    /// Programm samt Argumenten vor dem Java-Aufruf (`wrapper args… java …`).
    pub wrapper: String,
    /// Befehl vor dem Start; scheitert er, startet das Spiel nicht.
    pub pre_launch: String,
    /// Befehl nach dem Ende des Spiels; ein Fehler wird nur geloggt.
    pub post_exit: String,
}

impl LaunchSettings {
    /// Die Einstellungen der Instanz; was sie nicht gesetzt hat, kommt aus `defaults` (die des Launchers).
    pub fn or_defaults(&self, defaults: &Self) -> Self {
        Self {
            env: if self.env.is_empty() { defaults.env.clone() } else { self.env.clone() },
            wrapper: text_or(&self.wrapper, &defaults.wrapper).to_owned(),
            pre_launch: text_or(&self.pre_launch, &defaults.pre_launch).to_owned(),
            post_exit: text_or(&self.post_exit, &defaults.post_exit).to_owned(),
        }
    }

    /// Prüft Variablen und Befehlszeilen: Namen, Grenzen, reservierte Namen, Anführungszeichen.
    pub fn require_valid(&self) -> AppResult<()> {
        require_env(&self.env)?;
        CommandLine::parse(&self.wrapper, CommandKind::Wrapper)?;
        CommandLine::parse(&self.pre_launch, CommandKind::PreLaunch)?;
        CommandLine::parse(&self.post_exit, CommandKind::PostExit).map(drop)
    }
}

fn text_or<'a>(own: &'a str, fallback: &'a str) -> &'a str {
    if own.trim().is_empty() { fallback } else { own }
}

fn require_env(env: &[EnvVar]) -> AppResult<()> {
    if env.len() > MAX_ENV_VARS {
        return Err(AppError::invalid(coded!("errors.app.launchSettings.env.tooMany", max = MAX_ENV_VARS)));
    }
    for (index, var) in env.iter().enumerate() {
        var.require_valid()?;
        if env[..index].iter().any(|earlier| same_name(&earlier.name, &var.name)) {
            return Err(AppError::invalid(coded!("errors.app.launchSettings.env.duplicate", name = var.name)));
        }
    }
    Ok(())
}

/// Unter Windows unterscheiden Umgebungsvariablen nicht nach Groß- und Kleinschreibung.
fn same_name(first: &str, second: &str) -> bool {
    if cfg!(windows) { first.eq_ignore_ascii_case(second) } else { first == second }
}

impl EnvVar {
    fn require_valid(&self) -> AppResult<()> {
        if !is_valid_name(&self.name) {
            return Err(AppError::invalid(coded!("errors.app.launchSettings.env.invalidName", name = self.name, chars = MAX_ENV_NAME_CHARS)));
        }
        if is_reserved(&self.name) {
            return Err(AppError::invalid(coded!("errors.app.launchSettings.env.reserved", name = self.name)));
        }
        if !is_valid_value(&self.value) {
            return Err(AppError::invalid(coded!("errors.app.launchSettings.env.invalidValue", name = self.name, chars = MAX_ENV_VALUE_CHARS)));
        }
        Ok(())
    }
}

/// `[A-Za-z_][A-Za-z0-9_]*`: das, was jede Shell und jedes Betriebssystem als Namen akzeptiert.
fn is_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && name.len() <= MAX_ENV_NAME_CHARS
}

/// Nur für gültige (ASCII-)Namen.
fn is_reserved(name: &str) -> bool {
    name.as_bytes().get(..RESERVED_PREFIX.len()).is_some_and(|head| head.eq_ignore_ascii_case(RESERVED_PREFIX.as_bytes()))
}

fn is_valid_value(value: &str) -> bool {
    value.chars().count() <= MAX_ENV_VALUE_CHARS && !value.contains('\0')
}

/// Was die Einstellungen eines Starts ergeben: die Variablen, der aufgelöste Wrapper und die Hooks.
#[derive(Debug)]
pub struct LaunchEnvironment {
    env: Vec<(String, String)>,
    pub wrapper: Option<Invocation>,
    pub pre_launch: Option<Hook>,
    pub post_exit: Option<Hook>,
}

impl LaunchEnvironment {
    /// Zerlegt die (schon mit den Standards des Launchers zusammengeführten) Einstellungen und sucht das Wrapper-Programm;
    /// findet es sich nicht, scheitert der Start. Die Hooks suchen ihr Programm erst, wenn sie laufen.
    pub fn resolve(settings: &LaunchSettings, instance: &Instance, game_dir: &Path) -> AppResult<Self> {
        settings.require_valid()?;
        let hook = |text: &str, kind| Ok::<_, AppError>(CommandLine::parse(text, kind)?.map(|command| Hook::new(command, instance, game_dir)));
        Ok(Self {
            env: settings.env.iter().map(|var| (var.name.clone(), var.value.clone())).collect(),
            wrapper: resolve_wrapper(&settings.wrapper)?,
            pre_launch: hook(&settings.pre_launch, CommandKind::PreLaunch)?,
            post_exit: hook(&settings.post_exit, CommandKind::PostExit)?,
        })
    }

    /// Die Variablen des Nutzers, dahinter `injected` (die der Einspeisung der Mod): bei gleichem Namen gilt die spätere,
    /// also die des Launchers.
    pub fn variables_with(&self, injected: &[(String, String)]) -> Vec<(String, String)> {
        self.env.iter().chain(injected).cloned().collect()
    }
}

fn resolve_wrapper(text: &str) -> AppResult<Option<Invocation>> {
    let Some(command) = CommandLine::parse(text, CommandKind::Wrapper)? else { return Ok(None) };
    command
        .resolve()
        .map(Some)
        .ok_or_else(|| AppError::invalid(coded!("errors.game.launch.wrapperNotFound", program = command.program())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModLoader, NewInstance};

    fn var(name: &str, value: &str) -> EnvVar {
        EnvVar { name: name.into(), value: value.into() }
    }

    fn with_env(env: Vec<EnvVar>) -> LaunchSettings {
        LaunchSettings { env, ..LaunchSettings::default() }
    }

    fn instance() -> Instance {
        Instance::from_new(NewInstance { name: "Start".into(), minecraft_version: "1.21.4".into(), loader: ModLoader::Vanilla, loader_version: None })
    }

    fn refusal(settings: &LaunchSettings) -> Option<&'static str> {
        settings.require_valid().unwrap_err().key()
    }

    #[test]
    fn plain_settings_are_valid() {
        let settings = LaunchSettings {
            env: vec![var("FOO", "bar"), var("_x1", ""), var("__GLX_VENDOR_LIBRARY_NAME", "nvidia"), var("DRI_PRIME", "a b=c")],
            wrapper: "gamemoderun".into(),
            pre_launch: r#""C:\Program Files\Tool\sync.exe" --quiet"#.into(),
            post_exit: "backup.sh now".into(),
        };
        assert!(settings.require_valid().is_ok());
        assert!(LaunchSettings::default().require_valid().is_ok());
    }

    #[test]
    fn names_must_be_identifiers() {
        for name in ["", "1A", "A-B", "A B", "A=B", "Ä", "A\0", "a.b"] {
            assert_eq!(refusal(&with_env(vec![var(name, "x")])), Some("errors.app.launchSettings.env.invalidName"), "{name:?}");
        }
    }

    #[test]
    fn values_must_not_contain_nul_or_exceed_the_limit() {
        for value in ["a\0b".to_owned(), "x".repeat(MAX_ENV_VALUE_CHARS + 1)] {
            assert_eq!(refusal(&with_env(vec![var("FOO", &value)])), Some("errors.app.launchSettings.env.invalidValue"));
        }
        assert!(with_env(vec![var("FOO", &"x".repeat(MAX_ENV_VALUE_CHARS))]).require_valid().is_ok());
    }

    #[test]
    fn names_that_the_launcher_sets_itself_are_reserved_in_any_case() {
        for name in ["PUMPKIN_IPC_TOKEN", "PUMPKIN_IPC_PORT", "pumpkin_ipc_port", "Pumpkin_Instance_Id", "PUMPKIN_EXIT_CODE", "PUMPKIN_"] {
            assert_eq!(refusal(&with_env(vec![var(name, "x")])), Some("errors.app.launchSettings.env.reserved"), "{name}");
        }
        assert!(with_env(vec![var("PUMPKINS", "x"), var("PUMPKIN", "x")]).require_valid().is_ok());
    }

    #[test]
    fn the_count_of_variables_is_limited() {
        let many = |count: usize| with_env((0..count).map(|index| var(&format!("VAR_{index}"), "x")).collect());
        assert!(many(MAX_ENV_VARS).require_valid().is_ok());
        assert_eq!(refusal(&many(MAX_ENV_VARS + 1)), Some("errors.app.launchSettings.env.tooMany"));
    }

    #[test]
    fn a_name_twice_is_refused() {
        assert_eq!(refusal(&with_env(vec![var("FOO", "1"), var("BAR", "2"), var("FOO", "3")])), Some("errors.app.launchSettings.env.duplicate"));
    }

    #[test]
    fn a_broken_command_line_names_its_kind() {
        let broken = |wrapper: &str, pre_launch: &str, post_exit: &str| LaunchSettings {
            wrapper: wrapper.into(),
            pre_launch: pre_launch.into(),
            post_exit: post_exit.into(),
            ..LaunchSettings::default()
        };
        assert_eq!(refusal(&broken("a \"b", "", "")), Some("errors.app.launchSettings.wrapper.malformed"));
        assert_eq!(refusal(&broken("", "a \"b", "")), Some("errors.app.launchSettings.preLaunch.malformed"));
        assert_eq!(refusal(&broken("", "", "a \"b")), Some("errors.app.launchSettings.postExit.malformed"));
    }

    #[test]
    fn the_settings_of_the_instance_win_field_by_field() {
        let own = LaunchSettings { env: vec![var("A", "1")], wrapper: "mangohud".into(), ..LaunchSettings::default() };
        let defaults = LaunchSettings {
            env: vec![var("B", "2")],
            wrapper: "gamemoderun".into(),
            pre_launch: "sync".into(),
            post_exit: "  ".into(),
        };

        let effective = own.or_defaults(&defaults);

        assert_eq!(effective.env, [var("A", "1")]);
        assert_eq!(effective.wrapper, "mangohud");
        assert_eq!(effective.pre_launch, "sync");
        assert_eq!(effective.post_exit, "  ");
        assert_eq!(LaunchSettings::default().or_defaults(&defaults), defaults);
    }

    #[test]
    fn settings_without_fields_load_as_empty_and_survive_a_round_trip() {
        let loaded: LaunchSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(loaded, LaunchSettings::default());
        let own = LaunchSettings { env: vec![var("FOO", "bar")], wrapper: "gamemoderun".into(), pre_launch: "a".into(), post_exit: "b".into() };
        let json = serde_json::to_value(&own).unwrap();
        assert_eq!(json["preLaunch"], "a");
        assert_eq!(json["postExit"], "b");
        assert_eq!(serde_json::from_value::<LaunchSettings>(json).unwrap(), own);
    }

    #[test]
    fn an_old_instance_record_without_launch_settings_loads_with_empty_ones() {
        let loaded: Instance = serde_json::from_value(serde_json::json!({
            "id": "i", "name": "Alt", "minecraftVersion": "1.21.1", "loader": "vanilla", "loaderVersion": null,
            "memoryMb": null, "jvmArgs": [], "mods": [], "createdAt": 1, "lastPlayedAt": null
        }))
        .unwrap();
        assert_eq!(loaded.launch, LaunchSettings::default());
    }

    #[test]
    fn a_new_instance_never_carries_commands_or_variables() {
        assert_eq!(instance().launch, LaunchSettings::default());
    }

    #[test]
    fn the_variables_of_the_injection_come_last_so_they_win() {
        let environment = LaunchEnvironment { env: vec![("FOO".into(), "bar".into()), ("SHARED".into(), "user".into())], wrapper: None, pre_launch: None, post_exit: None };

        let merged = environment.variables_with(&[("SHARED".into(), "injected".into())]);

        let expected = [("FOO", "bar"), ("SHARED", "user"), ("SHARED", "injected")].map(|(name, value)| (name.to_owned(), value.to_owned()));
        assert_eq!(merged, expected);
    }

    #[test]
    fn resolving_builds_hooks_and_finds_the_wrapper() {
        let common = if cfg!(windows) { "cmd" } else { "sh" };
        let settings = LaunchSettings {
            env: vec![var("FOO", "bar")],
            wrapper: format!("{common} --flag"),
            pre_launch: "anything".into(),
            post_exit: String::new(),
        };

        let environment = LaunchEnvironment::resolve(&settings, &instance(), Path::new("game")).unwrap();

        let wrapper = environment.wrapper.as_ref().unwrap();
        assert!(wrapper.program.is_absolute());
        assert_eq!(wrapper.args, ["--flag"]);
        assert!(environment.pre_launch.is_some());
        assert!(environment.post_exit.is_none());
        assert_eq!(environment.variables_with(&[]), [("FOO".to_owned(), "bar".to_owned())]);
    }

    #[test]
    fn a_wrapper_that_does_not_exist_stops_the_launch() {
        let settings = LaunchSettings { wrapper: "pumpkin-no-such-wrapper-4711 --x".into(), ..LaunchSettings::default() };
        let err = LaunchEnvironment::resolve(&settings, &instance(), Path::new("game")).unwrap_err();
        assert_eq!(err.key(), Some("errors.game.launch.wrapperNotFound"));
        assert!(err.to_string().contains("pumpkin-no-such-wrapper-4711"), "{err}");
    }

    #[test]
    fn a_hook_program_that_does_not_exist_only_fails_when_it_runs() {
        let settings = LaunchSettings { pre_launch: "pumpkin-no-such-hook-4711".into(), post_exit: "pumpkin-no-such-hook-4711".into(), ..LaunchSettings::default() };
        assert!(LaunchEnvironment::resolve(&settings, &instance(), Path::new("game")).is_ok());
    }
}
