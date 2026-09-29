//! Spielstart: Classpath und Argumente aus der Versions-JSON bauen, Java-Prozess starten,
//! stdout/stderr zeilenweise weiterreichen.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};
use crate::models::Account;
use crate::services::gamelog::XmlLog;
use crate::services::install;
use crate::services::mojang::{Argument, OneOrMany, VersionJson};
use crate::services::rules::{self, Env};
use crate::services::Dirs;

pub const LOG_EVENT: &str = "instance-log";
pub const EXIT_EVENT: &str = "instance-exit";
pub const DEFAULT_MEMORY_MB: u32 = 4096;

/// JVM-Args für Versionen vor 1.13 (dort stehen nur Game-Args in der JSON).
const LEGACY_JVM_ARGS: [&str; 3] = ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"];

/// Was für einen Start gebraucht wird.
pub struct LaunchSpec<'a> {
    pub version: &'a VersionJson,
    pub dirs: &'a Dirs,
    pub instance_id: &'a str,
    pub account: &'a Account,
    pub memory_mb: u32,
    pub extra_jvm_args: &'a [String],
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
    let mut cp: Vec<PathBuf> = install::artifacts(version, env)
        .filter_map(|(_, a)| a.path.as_deref().map(|p| dirs.library(p)))
        .collect();
    cp.push(dirs.version_file(&version.id, "jar"));
    cp
}

/// Alle Argumente nach der Java-Programmdatei: JVM-Args, Main-Class, Game-Args.
pub fn build_args(spec: &LaunchSpec, env: &Env) -> AppResult<Vec<String>> {
    let LaunchSpec { version, dirs, instance_id, account, .. } = spec;
    let sep = if env.os == "windows" { ";" } else { ":" };
    let path = |p: PathBuf| p.to_string_lossy().into_owned();
    let cp = classpath(version, dirs, env).into_iter().map(path).collect::<Vec<_>>().join(sep);

    let vars: HashMap<&str, String> = HashMap::from([
        ("auth_player_name", account.username.clone()),
        ("auth_uuid", account.id.replace('-', "")),
        ("auth_access_token", "0".into()),
        ("auth_session", "0".into()),
        ("auth_xuid", "0".into()),
        ("clientid", "0".into()),
        ("user_type", "msa".into()),
        ("user_properties", "{}".into()),
        ("version_name", version.id.clone()),
        ("version_type", version.kind.clone()),
        ("game_directory", path(dirs.game_dir(instance_id))),
        ("assets_root", path(dirs.assets())),
        ("game_assets", path(dirs.assets())),
        ("assets_index_name", version.asset_index.id.clone()),
        ("natives_directory", path(dirs.natives_dir(instance_id))),
        ("library_directory", path(dirs.libraries())),
        ("classpath_separator", sep.into()),
        ("classpath", cp),
        ("launcher_name", "voxlet".into()),
        ("launcher_version", env!("CARGO_PKG_VERSION").into()),
    ]);

    let (jvm, game) = match (&version.arguments, &version.minecraft_arguments) {
        (Some(a), _) => (flatten(&a.jvm, env), flatten(&a.game, env)),
        (None, Some(legacy)) => (LEGACY_JVM_ARGS.to_vec(), legacy.split_whitespace().collect()),
        (None, None) => return Err(AppError::Invalid(format!("Version {} ohne Startargumente", version.id))),
    };

    let mut args = vec![format!("-Xmx{}M", spec.memory_mb)];
    args.extend(jvm.iter().map(|a| substitute(a, &vars)));
    if let Some(log) = &version.logging.client {
        let file = path(dirs.assets().join("log_configs").join(&log.file.id));
        args.push(substitute(&log.argument, &HashMap::from([("path", file)])));
    }
    // Eigene JVM-Args der Instanz zuletzt, damit sie Vorgaben der Version überschreiben.
    args.extend(spec.extra_jvm_args.iter().cloned());
    args.push(version.main_class.clone());
    args.extend(game.iter().map(|a| substitute(a, &vars)));
    Ok(args)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

async fn pump(
    stream: impl AsyncRead + Unpin,
    kind: LogStream,
    on_line: Arc<dyn Fn(LogStream, String) + Send + Sync>,
) {
    let mut reader = BufReader::new(stream);
    let mut xml = XmlLog::default();
    let mut buf = Vec::new();
    // Zeilen byteweise lesen: das Spiel schreibt nicht garantiert gültiges UTF-8.
    while reader.read_until(b'\n', &mut buf).await.is_ok_and(|n| n > 0) {
        let raw = String::from_utf8_lossy(&buf);
        let raw = raw.trim_end_matches(['\r', '\n']);
        let line = if kind == LogStream::Stdout { xml.line(raw) } else { Some(raw.to_owned()) };
        if let Some(line) = line {
            on_line(kind, line);
        }
        buf.clear();
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
        let _ = self.kill.send(());
    }
}

/// Startet `java args…` im Spielverzeichnis. `on_line` bekommt jede Ausgabezeile,
/// `on_exit` den Exit-Code (None bei Signal/Kill), nachdem alle Ausgaben gelesen sind.
pub fn spawn(
    java: &Path,
    args: &[String],
    game_dir: &Path,
    on_line: impl Fn(LogStream, String) + Send + Sync + 'static,
    on_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> AppResult<Running> {
    std::fs::create_dir_all(game_dir)?;
    let mut child = tokio::process::Command::new(java)
        .args(args)
        .current_dir(game_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let pid = child.id().unwrap_or_default();
    let on_line: Arc<dyn Fn(LogStream, String) + Send + Sync> = Arc::new(on_line);
    let out = child.stdout.take().map(|s| tokio::spawn(pump(s, LogStream::Stdout, on_line.clone())));
    let err = child.stderr.take().map(|s| tokio::spawn(pump(s, LogStream::Stderr, on_line)));
    let (kill, mut kill_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
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
        for task in [out, err].into_iter().flatten() {
            let _ = task.await;
        }
        let code = match status {
            Ok(s) => s.code(),
            Err(err) => {
                tracing::error!(pid, %err, "Warten auf den Spielprozess fehlgeschlagen");
                None
            }
        };
        on_exit(code);
    });
    Ok(Running { pid, kill })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AccountKind;

    #[test]
    fn substitution() {
        let vars = HashMap::from([("a", "1".to_owned()), ("b", "${a}".to_owned())]);
        assert_eq!(substitute("-Dx=${a}/${b}", &vars), "-Dx=1/${a}");
        assert_eq!(substitute("${unknown} ${a", &vars), "${unknown} ${a");
        assert_eq!(substitute("plain", &vars), "plain");
    }

    #[test]
    fn args_from_version_json() {
        let version: VersionJson = serde_json::from_value(serde_json::json!({
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
        .unwrap();
        let dirs = Dirs::new("/data");
        let account = Account {
            id: "b50ad385-829d-3141-a216-7e7d7539ba7f".into(),
            username: "Notch".into(),
            kind: AccountKind::Offline,
            active: true,
        };
        let spec = LaunchSpec {
            version: &version,
            dirs: &dirs,
            instance_id: "i1",
            account: &account,
            memory_mb: 2048,
            extra_jvm_args: &["-Dfoo=1".to_owned()],
        };
        let env = Env { os: "linux", arch: "x86_64", features: Vec::new() };
        let args = build_args(&spec, &env).unwrap();
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
    }
}
