//! Befehlszeilen der Startumgebung (Wrapper und Hooks): in Programm und Argumente zerlegen und das Programm finden.
//! Es läuft nie eine Shell dazwischen: der Launcher startet das Programm selbst, Sonderzeichen wie `;` oder `&&`
//! bleiben gewöhnlicher Text eines Arguments.
use std::path::{Path, PathBuf};

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::launch_args::{well_formed, MAX_ARGS};

/// Zeichen einer ganzen Befehlszeile.
const MAX_COMMAND_CHARS: usize = 4096;

/// Wofür eine Befehlszeile steht; sie nennt sich in der Fehlermeldung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    Wrapper,
    PreLaunch,
    PostExit,
}

impl CommandKind {
    fn malformed(self) -> AppError {
        AppError::invalid(match self {
            Self::Wrapper => coded!("errors.app.launchSettings.wrapper.malformed", args = MAX_ARGS, chars = MAX_COMMAND_CHARS),
            Self::PreLaunch => coded!("errors.app.launchSettings.preLaunch.malformed", args = MAX_ARGS, chars = MAX_COMMAND_CHARS),
            Self::PostExit => coded!("errors.app.launchSettings.postExit.malformed", args = MAX_ARGS, chars = MAX_COMMAND_CHARS),
        })
    }
}

/// Eine Befehlszeile, in Programm und Argumente zerlegt; das Programm ist noch nicht gesucht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandLine {
    program: String,
    args: Vec<String>,
}

/// Ein Programm mit absolutem Pfad und seine Argumente: startklar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl CommandLine {
    /// Zerlegt `text`; leer (oder nur Leerraum) ergibt keinen Befehl. Leerraum trennt, `"` und `'` fassen Text mit
    /// Leerraum zu einem Argument zusammen und gehören nicht dazu. Backslashes bleiben, wie sie sind, damit Windows-Pfade
    /// gehen.
    pub fn parse(text: &str, kind: CommandKind) -> AppResult<Option<Self>> {
        if text.trim().is_empty() {
            return Ok(None);
        }
        let mut words = split_words(text).filter(|words| within_limits(text, words)).ok_or_else(|| kind.malformed())?;
        let program = words.remove(0);
        Ok(Some(Self { program, args: words }))
    }

    pub fn program(&self) -> &str {
        &self.program
    }

    /// Sucht das Programm; `None`, wenn es sich nicht finden lässt.
    pub fn resolve(&self) -> Option<Invocation> {
        find_program(&self.program).map(|program| Invocation { program, args: self.args.clone() })
    }
}

/// Wörter und Länge des Textes in den Grenzen der Argumentlisten; Programm und Argumente zählen als Wörter.
fn within_limits(text: &str, words: &[String]) -> bool {
    text.chars().count() <= MAX_COMMAND_CHARS && words.len() <= MAX_ARGS + 1 && words.iter().all(|word| well_formed(word))
}

/// Die Wörter von `text` oder `None`, wenn ein Anführungszeichen nicht schließt.
fn split_words(text: &str) -> Option<Vec<String>> {
    let (mut words, mut word) = (Vec::new(), String::new());
    let (mut in_word, mut open_quote) = (false, None);
    for c in text.chars() {
        match open_quote {
            Some(quote) if c == quote => open_quote = None,
            Some(_) => word.push(c),
            None if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut word));
                    in_word = false;
                }
            }
            None if c == '"' || c == '\'' => {
                open_quote = Some(c);
                in_word = true;
            }
            None => {
                word.push(c);
                in_word = true;
            }
        }
    }
    if open_quote.is_some() {
        return None;
    }
    if in_word {
        words.push(word);
    }
    Some(words)
}

/// Ein absoluter Pfad muss eine Datei sein, ein bloßer Name wird im `PATH` gesucht, nie im Spielordner. Relative Pfade
/// mit Ordner (`./tool`) gelten als nicht gefunden: ihr Bezug wäre der Arbeitsordner des Launchers.
fn find_program(program: &str) -> Option<PathBuf> {
    let path = Path::new(program);
    if path.is_absolute() {
        return is_executable(path).then(|| path.to_owned());
    }
    if path.components().count() != 1 {
        return None;
    }
    let search = std::env::var_os("PATH")?;
    let names = executable_names(program);
    std::env::split_paths(&search)
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|candidate| is_executable(candidate))
}

#[cfg(windows)]
fn executable_names(program: &str) -> Vec<String> {
    if Path::new(program).extension().is_some() {
        return vec![program.to_owned()];
    }
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
    extensions.split(';').filter(|extension| !extension.is_empty()).map(|extension| format!("{program}{extension}")).collect()
}

#[cfg(not(windows))]
fn executable_names(program: &str) -> Vec<String> {
    vec![program.to_owned()]
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> CommandLine {
        CommandLine::parse(text, CommandKind::Wrapper).unwrap().unwrap()
    }

    fn words(text: &str) -> Vec<String> {
        let line = parsed(text);
        std::iter::once(line.program).chain(line.args).collect()
    }

    #[test]
    fn a_blank_text_is_no_command() {
        for text in ["", "   ", "\t\n"] {
            assert_eq!(CommandLine::parse(text, CommandKind::PreLaunch).unwrap(), None, "{text:?}");
        }
    }

    #[test]
    fn words_are_split_at_whitespace() {
        assert_eq!(words("  mangohud  --dlsym \t gamemoderun "), ["mangohud", "--dlsym", "gamemoderun"]);
    }

    #[test]
    fn quotes_join_words_and_are_not_part_of_them() {
        let text = r#""C:\Program Files\Tool\tool.exe" --name 'Max Welt' x"#;
        assert_eq!(words(text), [r"C:\Program Files\Tool\tool.exe", "--name", "Max Welt", "x"]);
    }

    #[test]
    fn a_quote_inside_a_word_continues_it() {
        assert_eq!(words(r#"tool --path="a b"/c"#), ["tool", "--path=a b/c"]);
    }

    #[test]
    fn the_other_kind_of_quote_is_plain_text_inside_quotes() {
        assert_eq!(words(r#"tool "it's" 'say "hi"'"#), ["tool", "it's", r#"say "hi""#]);
    }

    #[test]
    fn backslashes_stay_as_they_are() {
        assert_eq!(words(r"C:\tools\run.bat C:\a\b"), [r"C:\tools\run.bat", r"C:\a\b"]);
    }

    #[test]
    fn shell_operators_are_ordinary_arguments() {
        assert_eq!(words("tool ; rm -rf ~ && echo $HOME | cat"), ["tool", ";", "rm", "-rf", "~", "&&", "echo", "$HOME", "|", "cat"]);
    }

    #[test]
    fn an_unclosed_quote_is_refused_with_the_kind_of_command() {
        let err = CommandLine::parse(r#"tool "unfinished"#, CommandKind::PostExit).unwrap_err();
        assert_eq!(err.key(), Some("errors.app.launchSettings.postExit.malformed"));
    }

    #[test]
    fn empty_arguments_control_characters_and_oversized_commands_are_refused() {
        let too_many = format!("tool {}", "x ".repeat(MAX_ARGS + 1));
        let too_long = format!("tool {}", "x".repeat(MAX_COMMAND_CHARS));
        for text in ["tool \"\"", "tool a\u{7}b", too_many.as_str(), too_long.as_str()] {
            assert!(CommandLine::parse(text, CommandKind::Wrapper).is_err(), "{text:.20}");
        }
        let at_the_limit = format!("tool {}", "x ".repeat(MAX_ARGS));
        assert!(CommandLine::parse(&at_the_limit, CommandKind::Wrapper).is_ok());
    }

    #[test]
    fn an_absolute_path_must_be_an_existing_file() {
        let own_program = std::env::current_exe().unwrap();
        assert_eq!(find_program(own_program.to_str().unwrap()), Some(own_program.clone()));
        assert_eq!(find_program(own_program.parent().unwrap().to_str().unwrap()), None);
        assert_eq!(find_program(own_program.with_extension("missing").to_str().unwrap()), None);
    }

    #[test]
    fn a_bare_name_is_searched_on_the_path() {
        let common = if cfg!(windows) { "cmd" } else { "sh" };
        let found = find_program(common).unwrap();
        assert!(found.is_absolute(), "{found:?}");
        assert_eq!(find_program("pumpkin-no-such-program-4711"), None);
    }

    #[test]
    fn a_relative_path_with_folders_is_never_found() {
        assert_eq!(find_program("./tool"), None);
        assert_eq!(find_program("tools/tool"), None);
    }

    #[test]
    fn resolving_keeps_the_arguments() {
        let own_program = std::env::current_exe().unwrap();
        let line = parsed(&format!("\"{}\" --one two", own_program.display()));
        let invocation = line.resolve().unwrap();
        assert_eq!(invocation, Invocation { program: own_program, args: vec!["--one".into(), "two".into()] });
    }
}
