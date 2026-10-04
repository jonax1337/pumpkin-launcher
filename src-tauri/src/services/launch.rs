//! Spielstart: Classpath und Argumente aus der Versions-JSON bauen, Java-Prozess starten,
//! stdout/stderr zeilenweise weiterreichen.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Child;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{Account, GameWindow, QuickPlay};
use crate::services::auth::McSession;
use crate::services::gamelog::XmlLog;
use crate::services::install::log_config_path;
use crate::services::mojang::{Argument, OneOrMany, VersionJson};
use crate::services::rules::{self, Env};
use crate::services::Dirs;

pub const LOG_EVENT: &str = "instance-log";
pub const EXIT_EVENT: &str = "instance-exit";
pub const DEFAULT_MEMORY_MB: u32 = 4096;

/// JVM-Args für Versionen vor 1.13 (dort stehen nur Game-Args in der JSON).
const LEGACY_JVM_ARGS: [&str; 3] = ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"];

/// Steht ohne Microsoft-Sitzung für Token und xuid (Offline-Start).
const OFFLINE_PLACEHOLDER: &str = "0";

/// Quick Play ab 1.20: Launcher-Feature in den Regeln der Spielargumente und dessen Platzhalter.
#[derive(Clone, Copy)]
struct QuickPlayFeature {
    rule: &'static str,
    placeholder: &'static str,
}

const WORLD_FEATURE: QuickPlayFeature = QuickPlayFeature { rule: "is_quick_play_singleplayer", placeholder: "quickPlaySingleplayer" };
const SERVER_FEATURE: QuickPlayFeature = QuickPlayFeature { rule: "is_quick_play_multiplayer", placeholder: "quickPlayMultiplayer" };
const DEFAULT_PORT: &str = "25565";

/// Was für einen Start gebraucht wird.
pub struct LaunchSpec<'a> {
    pub version: &'a VersionJson,
    pub dirs: &'a Dirs,
    pub instance_id: &'a str,
    pub account: &'a Account,
    pub memory_mb: u32,
    /// Startgröße des Heaps (`-Xms`); ohne entscheidet die JVM.
    pub min_memory_mb: Option<u32>,
    /// Startoptionen der eingespeisten Mod (INGAME 3.6): nach den JVM-Argumenten der Version, vor `extra_jvm_args`.
    pub injected_jvm_args: &'a [String],
    pub extra_jvm_args: &'a [String],
    pub window: GameWindow,
    /// Spielargumente der eingespeisten Mod: nach denen der Version, vor `extra_game_args`.
    pub injected_game_args: &'a [String],
    pub extra_game_args: &'a [String],
    /// Direkt in eine Welt oder auf einen Server.
    pub quick_play: Option<&'a QuickPlay>,
    /// Ohne Microsoft-Sitzung startet das Spiel offline.
    pub session: Option<Session<'a>>,
}

/// Echte Anmeldung eines Microsoft-Kontos (nur im Speicher, nie auf Platte).
#[derive(Clone, Copy)]
pub struct Session<'a> {
    pub access_token: &'a str,
    pub xuid: &'a str,
}

impl<'a> From<&'a McSession> for Session<'a> {
    fn from(session: &'a McSession) -> Self {
        Self { access_token: &session.access_token, xuid: &session.xuid }
    }
}

/// Ersetzt `${name}` durch Werte aus `vars`. Unbekannte Platzhalter bleiben stehen; eingesetzte
/// Werte werden nicht erneut ersetzt.
pub fn substitute(arg: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = String::with_capacity(arg.len());
    let mut rest = arg;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let Some(len) = rest[start..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let placeholder = &rest[start..start + len + 1];
        out.push_str(vars.get(&placeholder[2..len]).map_or(placeholder, String::as_str));
        rest = &rest[start + len + 1..];
    }
    out.push_str(rest);
    out
}

/// Argumentliste nach Regeln filtern und flach machen.
fn flatten<'a>(args: &'a [Argument], env: &Env) -> Vec<&'a str> {
    let mut out = Vec::new();
    for arg in args {
        match arg {
            Argument::Plain(s) => out.push(s.as_str()),
            Argument::Conditional { rules, value } if rules::allowed(rules, env) => match value {
                OneOrMany::One(s) => out.push(s.as_str()),
                OneOrMany::Many(v) => out.extend(v.iter().map(String::as_str)),
            },
            Argument::Conditional { .. } => {}
        }
    }
    out
}

/// Libraries (nach Regeln) plus Client-JAR.
pub fn classpath(version: &VersionJson, dirs: &Dirs, env: &Env) -> Vec<PathBuf> {
    let mut cp: Vec<PathBuf> = version
        .artifacts(env)
        .filter_map(|(_, a)| a.path.as_deref().map(|p| dirs.library(p)))
        .collect();
    cp.push(dirs.version_file(&version.id, "jar"));
    cp
}

/// Alle Argumente nach der Java-Programmdatei: JVM-Args, Main-Class, Game-Args.
pub fn build_args(spec: &LaunchSpec, env: &Env) -> AppResult<Vec<String>> {
    let version = spec.version;
    let mut vars = launch_vars(spec, env);
    let quick_play = spec.quick_play.map(|target| quick_play_args(version, target)).transpose()?;
    let mut env = env.clone();
    if let Some(QuickPlayArgs::Feature { feature, value }) = &quick_play {
        env.features.push(feature.rule);
        vars.insert(feature.placeholder, value.clone());
    }
    let (jvm, game) = version_args(version, &env)?;

    let mut args = vec![format!("-Xmx{}M", spec.memory_mb)];
    args.extend(min_memory_arg(spec.min_memory_mb, spec.memory_mb));
    args.extend(jvm.iter().map(|a| substitute(a, &vars)));
    if let Some(log) = &version.logging.client {
        let file = path_text(log_config_path(spec.dirs, log));
        args.push(substitute(&log.argument, &HashMap::from([("path", file)])));
    }
    args.extend(spec.injected_jvm_args.iter().cloned());
    // Eigene JVM-Args der Instanz zuletzt, damit sie Vorgaben der Version überschreiben.
    args.extend(spec.extra_jvm_args.iter().cloned());
    args.push(version.main_class.clone());
    args.extend(game.iter().map(|a| substitute(a, &vars)));
    args.extend(window_args(spec.window));
    if let Some(QuickPlayArgs::Legacy(legacy)) = quick_play {
        args.extend(legacy);
    }
    args.extend(spec.injected_game_args.iter().cloned());
    // Eigene Spielargumente zuletzt. Sie überschreiben nichts: doppelte Optionen lehnt Minecraft ab
    // (je nach Version Standardwert oder Startabbruch).
    args.extend(spec.extra_game_args.iter().cloned());
    Ok(args)
}

/// `-Xms` für den Heap; über dem Maximum startet die JVM nicht, deshalb wird es darauf begrenzt. 0 gilt als nicht gesetzt.
fn min_memory_arg(min_mb: Option<u32>, max_mb: u32) -> Option<String> {
    min_mb.filter(|mb| *mb > 0).map(|mb| format!("-Xms{}M", mb.min(max_mb)))
}

/// Eigene JVM-Argumente der Instanz ersetzen die des Launchers ganz: zwei Garbage-Collector-Wahlen gleichzeitig
/// lässt die JVM nicht zu.
pub fn effective_jvm_args<'a>(instance: &'a [String], launcher: &'a [String]) -> &'a [String] {
    if instance.is_empty() { launcher } else { instance }
}

/// Das Fenster der Instanz; hat sie keines festgelegt, das des Launchers.
pub fn effective_window(instance: GameWindow, launcher: Option<GameWindow>) -> GameWindow {
    match instance {
        GameWindow::Default => launcher.unwrap_or_default(),
        own => own,
    }
}

fn path_text(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// Werte der `${…}`-Platzhalter in den Argumenten der Versions-JSON.
fn launch_vars(spec: &LaunchSpec, env: &Env) -> HashMap<&'static str, String> {
    let LaunchSpec { version, dirs, instance_id, account, session, .. } = spec;
    let sep = env.classpath_separator();
    let cp = classpath(version, dirs, env).into_iter().map(path_text).collect::<Vec<_>>().join(sep);
    let token = session.map_or(OFFLINE_PLACEHOLDER, |s| s.access_token);
    HashMap::from([
        ("auth_player_name", account.username.clone()),
        ("auth_uuid", account.id.replace('-', "")),
        ("auth_access_token", token.into()),
        ("auth_session", token.into()),
        ("auth_xuid", session.map_or(OFFLINE_PLACEHOLDER, |s| s.xuid).into()),
        ("clientid", "0".into()),
        ("user_type", "msa".into()),
        ("user_properties", "{}".into()),
        ("version_name", version.id.clone()),
        ("version_type", version.kind.clone()),
        ("game_directory", path_text(dirs.game_dir(instance_id))),
        ("assets_root", path_text(dirs.assets())),
        ("game_assets", path_text(dirs.assets())),
        ("assets_index_name", version.asset_index.id.clone()),
        ("natives_directory", path_text(dirs.natives_dir(instance_id))),
        ("library_directory", path_text(dirs.libraries())),
        ("classpath_separator", sep.into()),
        ("classpath", cp),
        ("launcher_name", "pumpkin-launcher".into()),
        ("launcher_version", env!("CARGO_PKG_VERSION").into()),
    ])
}

/// (JVM-, Spielargumente) der Version, nach Regeln gefiltert; vor 1.13 mit den festen JVM-Args.
fn version_args<'a>(version: &'a VersionJson, env: &Env) -> AppResult<(Vec<&'a str>, Vec<&'a str>)> {
    match (&version.arguments, &version.minecraft_arguments) {
        (Some(a), _) => Ok((flatten(&a.jvm, env), flatten(&a.game, env))),
        (None, Some(legacy)) => Ok((LEGACY_JVM_ARGS.to_vec(), legacy.split_whitespace().collect())),
        (None, None) => Err(AppError::invalid(coded!("errors.game.versionWithoutArguments", version = version.id))),
    }
}

/// Fensteroptionen von Minecraft (seit 1.6 in jeder Version verstanden).
fn window_args(window: GameWindow) -> Vec<String> {
    match window {
        GameWindow::Default => Vec::new(),
        GameWindow::Size { width, height } => vec!["--width".into(), width.to_string(), "--height".into(), height.to_string()],
        GameWindow::Fullscreen => vec!["--fullscreen".into()],
    }
}

/// Kann die Version direkt in eine Welt starten? Auf Server geht es immer (vor 1.20 über `--server`).
pub fn starts_into_worlds(version: &VersionJson) -> bool {
    offers_feature(version, WORLD_FEATURE.rule)
}

/// Ob eine Regel der Spielargumente nach diesem Launcher-Feature fragt.
fn offers_feature(version: &VersionJson, feature: &str) -> bool {
    version.arguments.as_ref().is_some_and(|a| {
        a.game.iter().any(|arg| matches!(arg, Argument::Conditional { rules, .. } if rules.iter().any(|r| r.features.contains_key(feature))))
    })
}

/// Wie Minecraft das Quick-Play-Ziel bekommt.
enum QuickPlayArgs {
    /// Ab 1.20: Feature einschalten, Ziel in seinen Platzhalter; die Argumente stehen in der Versions-JSON.
    Feature { feature: QuickPlayFeature, value: String },
    /// Ältere Versionen kennen nur Server, als `--server`/`--port`.
    Legacy(Vec<String>),
}

fn quick_play_args(version: &VersionJson, target: &QuickPlay) -> AppResult<QuickPlayArgs> {
    let (feature, value) = match target {
        QuickPlay::World { id } => (WORLD_FEATURE, id),
        QuickPlay::Server { address } => (SERVER_FEATURE, address),
    };
    if offers_feature(version, feature.rule) {
        return Ok(QuickPlayArgs::Feature { feature, value: value.clone() });
    }
    match target {
        QuickPlay::World { .. } => {
            Err(AppError::invalid(coded!("errors.game.quickPlayWorldUnsupported", version = version.id)))
        }
        QuickPlay::Server { address } => {
            let (host, port) = split_address(address);
            Ok(QuickPlayArgs::Legacy(vec!["--server".into(), host.into(), "--port".into(), port.into()]))
        }
    }
}

/// `host[:port]` → (Host, Port), ohne Port der Standardport. IPv6 mit Port steht in eckigen Klammern.
fn split_address(address: &str) -> (&str, &str) {
    match address.rsplit_once(':') {
        Some((host, port)) if port.parse::<u16>().is_ok() && (!host.contains(':') || host.starts_with('[')) => {
            (host.trim_matches(['[', ']']), port)
        }
        _ => (address.trim_matches(['[', ']']), DEFAULT_PORT),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

/// Rückruf für jede Ausgabezeile des Spiels.
type LineFn = Arc<dyn Fn(LogStream, String) + Send + Sync>;
/// Rückruf für jede stdout-Zeile, wie das Spiel sie schrieb (vor dem Auflösen der XML-Ereignisse).
type RawFn = Arc<dyn Fn(&str) + Send + Sync>;

async fn pump(stream: impl AsyncRead + Unpin, kind: LogStream, on_line: LineFn, on_raw: Option<RawFn>) {
    let mut reader = BufReader::new(stream);
    let mut xml = XmlLog::default();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        // Zeilen byteweise lesen: das Spiel schreibt nicht garantiert gültiges UTF-8.
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) => return,
            Ok(_) => {}
            Err(err) => {
                tracing::warn!(?kind, %err, "Ausgabe des Spiels nicht mehr lesbar");
                return;
            }
        }
        let raw = String::from_utf8_lossy(&buf);
        let raw = raw.trim_end_matches(['\r', '\n']);
        if let Some(on_raw) = &on_raw {
            on_raw(raw);
        }
        let line = if kind == LogStream::Stdout { xml.line(raw) } else { Some(raw.to_owned()) };
        if let Some(line) = line {
            on_line(kind, line);
        }
    }
}

/// Handle eines laufenden Spiels. `kill` beendet den Prozess; wird das Handle nur verworfen,
/// läuft das Spiel weiter.
pub struct Running {
    pub pid: u32,
    kill: oneshot::Sender<()>,
}

impl Running {
    pub fn kill(self) {
        if self.kill.send(()).is_err() {
            tracing::debug!(pid = self.pid, "Spiel war schon beendet");
        }
    }
}

/// Startet `java args…` im Spielverzeichnis, mit den Umgebungsvariablen `env` zusätzlich zu denen des Launchers.
/// `on_line` bekommt jede aufbereitete Ausgabezeile, `on_stdout_raw` jede stdout-Zeile unverändert,
/// `on_exit` den Exit-Code (None bei Signal/Kill), nachdem alle Ausgaben gelesen sind.
pub fn spawn(
    java: &Path,
    args: &[String],
    game_dir: &Path,
    env: &[(String, String)],
    on_line: impl Fn(LogStream, String) + Send + Sync + 'static,
    on_stdout_raw: impl Fn(&str) + Send + Sync + 'static,
    on_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> AppResult<Running> {
    std::fs::create_dir_all(game_dir)?;
    let mut child = tokio::process::Command::new(java)
        .args(args)
        .envs(env.iter().map(|(name, value)| (name, value)))
        .current_dir(game_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(spawn_error)?;
    let pid = child.id().unwrap_or_default();
    let on_line: LineFn = Arc::new(on_line);
    let pumps = [
        child.stdout.take().map(|s| tokio::spawn(pump(s, LogStream::Stdout, on_line.clone(), Some(Arc::new(on_stdout_raw))))),
        child.stderr.take().map(|s| tokio::spawn(pump(s, LogStream::Stderr, on_line, None))),
    ];
    let (kill, kill_rx) = oneshot::channel::<()>();
    tokio::spawn(supervise(child, kill_rx, pumps.into_iter().flatten().collect(), on_exit));
    Ok(Running { pid, kill })
}

/// Wartet auf das Ende des Spiels oder beendet es auf Wunsch, liest die restlichen Ausgaben und meldet dann
/// den Exit-Code.
async fn supervise(
    mut child: Child,
    mut kill_rx: oneshot::Receiver<()>,
    pumps: Vec<JoinHandle<()>>,
    on_exit: impl FnOnce(Option<i32>),
) {
    let pid = child.id().unwrap_or_default();
    let status = tokio::select! {
        status = child.wait() => status,
        // Ein verworfener Sender (Err) ist kein Kill-Wunsch: dann greift nur `wait`.
        Ok(()) = &mut kill_rx => {
            if let Err(err) = child.start_kill() {
                tracing::warn!(pid, %err, "Prozess ließ sich nicht beenden");
            }
            child.wait().await
        }
    };
    for pump in pumps {
        if let Err(err) = pump.await {
            tracing::warn!(pid, %err, "Weiterreichen der Spielausgabe abgebrochen");
        }
    }
    let code = match status {
        Ok(s) => s.code(),
        Err(err) => {
            tracing::error!(pid, %err, "Warten auf den Spielprozess fehlgeschlagen");
            None
        }
    };
    on_exit(code);
}

/// Auf Apple Silicon startet eine x64-Runtime (Minecraft bis 1.18.2, siehe `java`) nur mit Rosetta 2,
/// das frische Macs nicht mitbringen; sonst meldet macOS nur „Bad CPU type in executable“.
fn spawn_error(err: std::io::Error) -> AppError {
    #[cfg(target_os = "macos")]
    if err.raw_os_error() == Some(libc::EBADARCH) {
        return AppError::invalid(coded!("errors.game.rosettaRequired"));
    }
    err.into()
}

/// Vorlagen für Tests, die Startargumente bauen.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// Offline-Start ohne eigene Fenster- und Spieloptionen.
    pub fn plain_spec<'a>(version: &'a VersionJson, dirs: &'a Dirs, account: &'a Account) -> LaunchSpec<'a> {
        LaunchSpec {
            version,
            dirs,
            instance_id: "i1",
            account,
            memory_mb: 2048,
            min_memory_mb: None,
            injected_jvm_args: &[],
            extra_jvm_args: &[],
            window: GameWindow::Default,
            injected_game_args: &[],
            extra_game_args: &[],
            quick_play: None,
            session: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::test_support::plain_spec;
    use super::*;
    use crate::models::AccountKind;

    #[test]
    fn substitution() {
        let vars = HashMap::from([("a", "1".to_owned()), ("b", "${a}".to_owned())]);
        assert_eq!(substitute("-Dx=${a}/${b}", &vars), "-Dx=1/${a}");
        assert_eq!(substitute("${unknown} ${a", &vars), "${unknown} ${a");
        assert_eq!(substitute("plain", &vars), "plain");
    }

    fn test_version() -> VersionJson {
        serde_json::from_value(serde_json::json!({
            "id": "1.21.11", "type": "release", "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "29", "sha1": "x", "url": "u"},
            "downloads": {"client": {"sha1": "x", "url": "u"}},
            "libraries": [
                {"name": "a:b:1", "downloads": {"artifact": {"path": "a/b/1/b-1.jar", "sha1": "x", "url": "u"}}},
                {"name": "mac:only:1", "rules": [{"action": "allow", "os": {"name": "osx"}}],
                 "downloads": {"artifact": {"path": "mac.jar", "sha1": "x", "url": "u"}}}
            ],
            "arguments": {
                "jvm": [{"rules": [{"action": "allow", "os": {"name": "osx"}}], "value": ["-XstartOnFirstThread"]},
                        "-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
                "game": ["--username", "${auth_player_name}", "--uuid", "${auth_uuid}",
                         "--accessToken", "${auth_access_token}", "--userType", "${user_type}",
                         {"rules": [{"action": "allow", "features": {"is_demo_user": true}}], "value": "--demo"}]
            },
            "logging": {"client": {"argument": "-Dlog4j.configurationFile=${path}",
                                   "file": {"id": "client-1.21.2.xml", "sha1": "x", "url": "u"}}}
        }))
        .unwrap()
    }

    fn notch() -> Account {
        Account { id: "b50ad385-829d-3141-a216-7e7d7539ba7f".into(), username: "Notch".into(), kind: AccountKind::Offline, active: true }
    }

    const LINUX: Env = Env { os: "linux", arch: "x86_64", features: Vec::new() };

    #[test]
    fn args_from_version_json() {
        let (version, dirs, account) = (test_version(), Dirs::new("/data"), notch());
        let jvm_args = ["-Dfoo=1".to_owned()];
        let spec = LaunchSpec { extra_jvm_args: &jvm_args, ..plain_spec(&version, &dirs, &account) };
        let args = build_args(&spec, &LINUX).unwrap();
        let natives = dirs.natives_dir("i1").to_string_lossy().into_owned();
        let cp = [dirs.library("a/b/1/b-1.jar"), dirs.version_file("1.21.11", "jar")]
            .map(|p| p.to_string_lossy().into_owned())
            .join(":");
        let log = dirs.assets().join("log_configs").join("client-1.21.2.xml").to_string_lossy().into_owned();
        assert_eq!(
            args,
            [
                "-Xmx2048M".to_owned(),
                format!("-Djava.library.path={natives}"),
                "-cp".into(),
                cp,
                format!("-Dlog4j.configurationFile={log}"),
                "-Dfoo=1".into(),
                "net.minecraft.client.main.Main".into(),
                "--username".into(),
                "Notch".into(),
                "--uuid".into(),
                "b50ad385829d3141a2167e7d7539ba7f".into(),
                "--accessToken".into(),
                "0".into(),
                "--userType".into(),
                "msa".into(),
            ]
        );
        let online = LaunchSpec { session: Some(Session { access_token: "eyJ.token", xuid: "2535" }), ..spec };
        let args = build_args(&online, &LINUX).unwrap();
        let token = args.iter().position(|a| a == "--accessToken").unwrap();
        assert_eq!(args[token + 1], "eyJ.token");
    }

    #[test]
    fn injected_options_sit_after_the_version_options_and_before_the_users() {
        let (version, dirs, account) = (test_version(), Dirs::new("/data"), notch());
        let (injected_jvm, injected_game) = (["-Dfabric.addMods=m.jar".to_owned()], ["--fml.mods".to_owned(), "g:a:1".to_owned()]);
        let (user_jvm, user_game) = (["-Dfoo=1".to_owned()], ["--demo".to_owned()]);
        let spec = LaunchSpec {
            injected_jvm_args: &injected_jvm,
            injected_game_args: &injected_game,
            extra_jvm_args: &user_jvm,
            extra_game_args: &user_game,
            ..plain_spec(&version, &dirs, &account)
        };

        let args = build_args(&spec, &LINUX).unwrap();

        let at = |wanted: &str| args.iter().position(|arg| arg == wanted).unwrap_or_else(|| panic!("{wanted} fehlt in {args:?}"));
        let log_config = args.iter().position(|arg| arg.starts_with("-Dlog4j.configurationFile=")).unwrap();
        assert_eq!(at("-Dfabric.addMods=m.jar"), log_config + 1, "direkt nach den JVM-Argumenten der Version");
        assert_eq!(at("-Dfoo=1"), log_config + 2, "danach die des Nutzers");
        assert!(at("-Dfoo=1") < at("net.minecraft.client.main.Main"));
        assert_eq!(at("--fml.mods"), args.len() - 3, "die Spielargumente der Einspeisung stehen vor denen des Nutzers");
        assert_eq!(args[args.len() - 2..], ["g:a:1", "--demo"]);
    }

    #[test]
    fn min_memory_follows_the_max_and_never_exceeds_it() {
        assert_eq!(min_memory_arg(Some(1024), 2048).as_deref(), Some("-Xms1024M"));
        assert_eq!(min_memory_arg(Some(4096), 2048).as_deref(), Some("-Xms2048M"));
        assert_eq!(min_memory_arg(Some(0), 2048), None);
        assert_eq!(min_memory_arg(None, 2048), None);

        let (version, dirs, account) = (test_version(), Dirs::new("/data"), notch());
        let spec = LaunchSpec { min_memory_mb: Some(512), ..plain_spec(&version, &dirs, &account) };
        assert_eq!(build_args(&spec, &LINUX).unwrap()[..2], ["-Xmx2048M", "-Xms512M"]);
    }

    #[test]
    fn instance_settings_beat_launcher_defaults() {
        let own = vec!["-XX:+UseZGC".to_owned()];
        let default = vec!["-XX:+UseG1GC".to_owned()];
        assert_eq!(effective_jvm_args(&own, &default), own);
        assert_eq!(effective_jvm_args(&[], &default), default);

        let size = GameWindow::Size { width: 800, height: 600 };
        assert_eq!(effective_window(GameWindow::Default, Some(size)), size);
        assert_eq!(effective_window(GameWindow::Fullscreen, Some(size)), GameWindow::Fullscreen);
        assert_eq!(effective_window(GameWindow::Default, None), GameWindow::Default);
    }

    #[test]
    fn macos_gets_the_lwjgl_main_thread_flag_from_the_version() {
        let (version, dirs, account) = (test_version(), Dirs::new("/data"), notch());
        let mac = Env { os: "osx", arch: "aarch64", features: Vec::new() };
        let args = build_args(&plain_spec(&version, &dirs, &account), &mac).unwrap();
        assert_eq!(args[1], "-XstartOnFirstThread");
        assert!(!build_args(&plain_spec(&version, &dirs, &account), &LINUX).unwrap().contains(&args[1]));
    }

    #[test]
    fn window_and_own_game_args_come_last() {
        let (version, dirs, account) = (test_version(), Dirs::new("/data"), notch());
        let game_args = ["--quickPlaySingleplayer".to_owned(), "Welt 1".to_owned()];
        let sized = LaunchSpec {
            window: GameWindow::Size { width: 1280, height: 720 },
            extra_game_args: &game_args,
            ..plain_spec(&version, &dirs, &account)
        };
        let args = build_args(&sized, &LINUX).unwrap();
        assert_eq!(args[args.len() - 6..], ["--width", "1280", "--height", "720", "--quickPlaySingleplayer", "Welt 1"]);

        let fullscreen = LaunchSpec { window: GameWindow::Fullscreen, ..plain_spec(&version, &dirs, &account) };
        assert_eq!(build_args(&fullscreen, &LINUX).unwrap().last().map(String::as_str), Some("--fullscreen"));
    }

    /// Wie `test_version`, mit den Quick-Play-Argumenten der Versions-JSON ab 1.20.
    fn quick_play_version() -> VersionJson {
        let mut version = test_version();
        let quick_play: Vec<Argument> = serde_json::from_value(serde_json::json!([
            {"rules": [{"action": "allow", "features": {"is_quick_play_singleplayer": true}}], "value": ["--quickPlaySingleplayer", "${quickPlaySingleplayer}"]},
            {"rules": [{"action": "allow", "features": {"is_quick_play_multiplayer": true}}], "value": ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"]}
        ]))
        .unwrap();
        version.arguments.as_mut().unwrap().game.extend(quick_play);
        version
    }

    /// Die letzten `n` Argumente eines Vollbild-Starts mit Quick Play.
    fn quick_play_tail(version: &VersionJson, target: QuickPlay, n: usize) -> AppResult<Vec<String>> {
        let (dirs, account) = (Dirs::new("/data"), notch());
        let spec = LaunchSpec { quick_play: Some(&target), window: GameWindow::Fullscreen, ..plain_spec(version, &dirs, &account) };
        let args = build_args(&spec, &LINUX)?;
        Ok(args[args.len() - n..].to_vec())
    }

    #[test]
    fn quick_play_uses_version_features() {
        let version = quick_play_version();
        assert!(starts_into_worlds(&version));
        let world = QuickPlay::World { id: "Neue Welt".into() };
        assert_eq!(quick_play_tail(&version, world, 3).unwrap(), ["--quickPlaySingleplayer", "Neue Welt", "--fullscreen"]);
        let server = QuickPlay::Server { address: "mc.example.net:25570".into() };
        assert_eq!(quick_play_tail(&version, server, 3).unwrap(), ["--quickPlayMultiplayer", "mc.example.net:25570", "--fullscreen"]);

        // Ohne Ziel bleiben die Quick-Play-Argumente draußen.
        let (dirs, account) = (Dirs::new("/data"), notch());
        let args = build_args(&plain_spec(&version, &dirs, &account), &LINUX).unwrap();
        assert!(!args.iter().any(|a| a.starts_with("--quickPlay")));
    }

    #[test]
    fn quick_play_before_1_20_only_joins_servers() {
        let version = test_version();
        assert!(!starts_into_worlds(&version));
        let server = QuickPlay::Server { address: "mc.example.net:25570".into() };
        assert_eq!(quick_play_tail(&version, server, 5).unwrap(), ["--fullscreen", "--server", "mc.example.net", "--port", "25570"]);
        assert!(quick_play_tail(&version, QuickPlay::World { id: "Neue Welt".into() }, 1).is_err());
    }

    #[test]
    fn server_addresses() {
        assert_eq!(split_address("mc.example.net"), ("mc.example.net", "25565"));
        assert_eq!(split_address("mc.example.net:25570"), ("mc.example.net", "25570"));
        assert_eq!(split_address("[::1]:25566"), ("::1", "25566"));
        assert_eq!(split_address("::1"), ("::1", "25565"));
    }

    /// Ein Programm, das den Wert von `PUMPKIN_TEST_VAR` ausgibt.
    fn echo_env_command() -> (&'static str, [String; 2]) {
        if cfg!(windows) {
            ("cmd.exe", ["/C".into(), "echo %PUMPKIN_TEST_VAR%".into()])
        } else {
            ("sh", ["-c".into(), "echo $PUMPKIN_TEST_VAR".into()])
        }
    }

    #[tokio::test]
    async fn the_child_gets_the_given_environment_and_both_line_callbacks_see_its_output() {
        let game_dir = std::env::temp_dir().join(crate::models::new_id());
        let (program, args) = echo_env_command();
        let (lines, raw_lines) = (Arc::new(Mutex::new(Vec::new())), Arc::new(Mutex::new(Vec::new())));
        let (on_line, on_raw) = (lines.clone(), raw_lines.clone());
        let (exit_tx, exit_rx) = oneshot::channel();
        spawn(
            Path::new(program),
            &args,
            &game_dir,
            &[("PUMPKIN_TEST_VAR".to_owned(), "wert-42".to_owned())],
            move |_, line| on_line.lock().unwrap().push(line),
            move |raw| on_raw.lock().unwrap().push(raw.to_owned()),
            move |code| {
                exit_tx.send(code).ok();
            },
        )
        .unwrap();
        assert_eq!(exit_rx.await.unwrap(), Some(0));
        assert_eq!(*lines.lock().unwrap(), ["wert-42"]);
        assert_eq!(*raw_lines.lock().unwrap(), ["wert-42"]);
        std::fs::remove_dir_all(game_dir).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn intel_java_without_rosetta_names_the_fix() {
        let text = spawn_error(std::io::Error::from_raw_os_error(libc::EBADARCH)).to_string();
        assert!(text.contains("softwareupdate --install-rosetta"), "{text}");
    }
}
