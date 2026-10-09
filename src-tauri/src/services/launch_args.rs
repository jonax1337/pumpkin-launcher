//! Grenzen für die eigenen Start-Argumente einer Instanz (JVM und Spiel). Sie gelten für jede Quelle: die
//! Einstellungen der Instanz ebenso wie den Import aus Dateien anderer Launcher.
use crate::{
    coded,
    error::{AppError, AppResult},
};

/// Argumente je Liste.
pub(crate) const MAX_ARGS: usize = 128;
/// Zeichen je Argument.
pub(crate) const MAX_ARG_CHARS: usize = 1024;

/// Anfänge von JVM-Argumenten (in der Form von [`normalized`]), die Code oder native Bibliotheken laden, Programme
/// starten oder Klassen- bzw. Modulpfad ersetzen. Eigene Einstellungen dürfen sie enthalten; aus Dateien anderer
/// Launcher übernimmt der Import sie nicht.
const CODE_LOADING_PREFIXES: [&str; 20] = [
    "@",
    "-javaagent",
    "-agentlib",
    "-agentpath",
    "-xrun",
    "-xbootclasspath",
    "-xx:onerror",
    "-xx:onoutofmemoryerror",
    "-xx:flags",
    "-xx:vmoptionsfile",
    "-xx:sharedarchivefile",
    "--class-path",
    "--module-path",
    "--upgrade-module-path",
    "--patch-module",
    "-djava.library.path",
    "-dorg.lwjgl.librarypath",
    "-djava.ext.dirs",
    "-djava.endorsed.dirs",
    "-djava.system.class.loader",
];
const CLASS_PATH_FLAGS: [&str; 3] = ["-cp", "-classpath", "-p"];

pub(crate) fn well_formed(arg: &str) -> bool {
    !arg.is_empty() && arg.chars().count() <= MAX_ARG_CHARS && !arg.chars().any(char::is_control)
}

/// Die Liste, deren Argumente geprüft werden; sie nennt sich in der Fehlermeldung.
#[derive(Clone, Copy)]
pub(crate) enum ArgList {
    Jvm,
    Game,
}

pub(crate) fn require_args(args: &[String], list: ArgList) -> AppResult<()> {
    if args.len() > MAX_ARGS {
        return Err(AppError::invalid(match list {
            ArgList::Jvm => coded!("errors.app.launchArgs.jvm.tooMany", max = MAX_ARGS),
            ArgList::Game => coded!("errors.app.launchArgs.game.tooMany", max = MAX_ARGS),
        }));
    }
    if args.iter().any(|arg| !well_formed(arg)) {
        return Err(AppError::invalid(match list {
            ArgList::Jvm => coded!("errors.app.launchArgs.jvm.malformed", max = MAX_ARG_CHARS),
            ArgList::Game => coded!("errors.app.launchArgs.game.malformed", max = MAX_ARG_CHARS),
        }));
    }
    Ok(())
}

/// Ein JVM-Argument aus der Datei eines anderen Launchers, das Pumpkin Launcher übernimmt.
pub(crate) fn is_importable_jvm_arg(arg: &str) -> bool {
    let bare = normalized(arg);
    well_formed(arg)
        && !CLASS_PATH_FLAGS.contains(&bare.as_str())
        && !CODE_LOADING_PREFIXES.iter().any(|prefix| bare.starts_with(prefix))
}

/// Das Argument ohne alles, woran eine Prüfung nur scheitern soll: Leerraum und Anführungszeichen außen,
/// Groß- und Kleinschreibung sowie bei `-XX:` der Schalter `+`/`-`.
fn normalized(arg: &str) -> String {
    let bare = arg.trim().trim_matches(['"', '\'']).trim().to_ascii_lowercase();
    match bare.strip_prefix("-xx:") {
        Some(flag) => format!("-xx:{}", flag.trim_start_matches(['+', '-'])),
        None => bare,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|a| (*a).to_owned()).collect()
    }

    #[test]
    fn plain_arguments_pass_and_malformed_ones_do_not() {
        assert!(require_args(&args(&["-Xss2M", "--quickPlaySingleplayer", "Welt 1"]), ArgList::Jvm).is_ok());
        assert!(require_args(&args(&[""]), ArgList::Jvm).is_err());
        assert!(require_args(&args(&["-Dx=1\n-Dy=2"]), ArgList::Jvm).is_err());
        assert!(require_args(&[format!("-D{}", "x".repeat(MAX_ARG_CHARS))], ArgList::Jvm).is_err());
        assert!(require_args(&vec!["-Xss2M".to_owned(); MAX_ARGS + 1], ArgList::Jvm).is_err());
        assert!(require_args(&vec!["-Xss2M".to_owned(); MAX_ARGS], ArgList::Jvm).is_ok());
    }

    #[test]
    fn imports_refuse_arguments_that_load_code() {
        for arg in ["-javaagent:evil.jar", "-agentpath:x.dll", "-XX:OnError=calc.exe", "@args.txt", "-cp", "-Xbootclasspath/a:x.jar"] {
            assert!(!is_importable_jvm_arg(arg), "{arg}");
        }
        for arg in ["-XX:+UseG1GC", "-Dfile.encoding=UTF-8", "-Xms512M", "-XX:ErrorFile=hs_err.log"] {
            assert!(is_importable_jvm_arg(arg), "{arg}");
        }
    }

    #[test]
    fn imports_refuse_disguised_code_loading_arguments() {
        for arg in [
            "-JavaAgent:evil.jar",
            "-XX:onerror=calc.exe",
            " -javaagent:evil.jar",
            "\"-javaagent:evil.jar\"",
            "'@args.txt'",
            "-CP",
            "-XX:+Flags=.hotspotrc",
            "-XX:VMOptionsFile=x",
            "-XX:SharedArchiveFile=x.jsa",
            "--patch-module=java.base=x.jar",
            "--module-path=x",
            "-p",
            "-Djava.library.path=C:/evil",
            "-Dorg.lwjgl.librarypath=C:/evil",
            "-Djava.system.class.loader=Evil",
        ] {
            assert!(!is_importable_jvm_arg(arg), "{arg}");
        }
    }
}
