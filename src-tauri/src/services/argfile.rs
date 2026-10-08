//! Argumentdatei (`@datei`) für den Start der JVM. So stehen die Argumente, darunter der Zugriffstoken des
//! Microsoft-Kontos, nicht auf der Kommandozeile, die jedes Programm des Nutzerkontos lesen kann, und die Grenze von
//! rund 32 000 Zeichen unter Windows entfällt. Die Datei liegt in einem eigenen Ordner des Starts, nur für den Nutzer
//! lesbar, und verschwindet kurz nach dem Start wieder.
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::AppResult;
use crate::models::new_id;
use crate::services::Dirs;

/// Ab Java 9 liest der `java`-Starter `@datei`; Java 8 hielte das Argument für eine Hauptklasse.
const MIN_JAVA_MAJOR: u32 = 9;
const FILE_NAME: &str = "java.args";

/// So lange bleibt die Datei nach dem Start des Prozesses, damit die JVM sie gelesen hat; das tut sie als Erstes.
pub const READ_GRACE: Duration = Duration::from_secs(5);
/// Ein Wrapper (etwa `firejail`) braucht bis zum Start der JVM länger.
pub const WRAPPED_READ_GRACE: Duration = Duration::from_secs(20);

/// Wo die Argumentdatei liegen soll, wenn die JVM sie lesen kann; sonst `None` und die Argumente gehen direkt auf die
/// Kommandozeile. Ein unbekanntes Java gilt als altes. Unter Windows liest der Starter die Datei in der ANSI-Codepage des
/// Systems, nicht in UTF-8: nur Text aus ASCII kommt unverändert an.
pub fn dir_for(dirs: &Dirs, java_major: Option<u32>, args: &[String]) -> Option<PathBuf> {
    let base = dirs.argfiles();
    let reads_argfiles = java_major.is_some_and(|major| major >= MIN_JAVA_MAJOR);
    let arrives_intact = base.to_str().is_some_and(survives_java) && args.iter().all(|arg| survives_java(arg));
    (reads_argfiles && arrives_intact).then_some(base)
}

fn survives_java(text: &str) -> bool {
    !cfg!(windows) || text.is_ascii()
}

/// Räumt die Reste früherer Sitzungen weg (Absturz des Launchers während eines Starts). Läuft vor dem ersten Start.
pub fn sweep_stale(dirs: &Dirs) {
    match fs::remove_dir_all(dirs.argfiles()) {
        Ok(()) => tracing::info!("Reste alter Argumentdateien entfernt"),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => tracing::warn!(%err, "Reste alter Argumentdateien nicht entfernt"),
    }
}

/// Die Argumentdatei eines Starts. Beim Verwerfen verschwindet ihr Ordner.
#[derive(Debug)]
pub struct ArgFile {
    dir: PathBuf,
}

/// Schreibt `args` in eine neue Datei unter `base`: Ordner `0700`, Datei `0600` (unter Windows erbt sie die Rechte des
/// Nutzerordners).
pub fn write(base: &Path, args: &[String]) -> AppResult<ArgFile> {
    let dir = base.join(new_id());
    create_private_dir(&dir)?;
    let file = ArgFile { dir };
    create_private_file(&file.path())?.write_all(render(args).as_bytes())?;
    Ok(file)
}

impl ArgFile {
    /// Das einzige Argument, das die JVM bekommt.
    pub fn argument(&self) -> String {
        format!("@{}", self.path().to_string_lossy())
    }

    fn path(&self) -> PathBuf {
        self.dir.join(FILE_NAME)
    }
}

impl Drop for ArgFile {
    fn drop(&mut self) {
        match fs::remove_dir_all(&self.dir) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            // Der nächste Start des Launchers räumt auf (`sweep_stale`).
            Err(err) => tracing::warn!(%err, "Argumentdatei nicht gelöscht"),
        }
    }
}

/// Löscht die Datei nach `grace`; von da an hat die JVM sie längst gelesen.
pub async fn remove_after(file: ArgFile, grace: Duration) {
    tokio::time::sleep(grace).await;
    drop(file);
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

fn create_private_file(path: &Path) -> io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

/// Je Argument eine Zeile.
fn render(args: &[String]) -> String {
    args.iter().fold(String::new(), |mut text, arg| {
        text.push_str(&quote(arg));
        text.push('\n');
        text
    })
}

/// Das Argument in der Schreibweise der Argumentdateien des JDK: Leerraum, `#` (Kommentar) und Anführungszeichen
/// verlangen Anführungszeichen drumherum, und in ihnen leitet der Backslash eine Escape-Folge ein, deshalb wird er
/// verdoppelt, auch in Pfaden.
fn quote(arg: &str) -> String {
    if !needs_quotes(arg) {
        return arg.to_owned();
    }
    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    for c in arg.chars() {
        match c {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            '\x0c' => quoted.push_str("\\f"),
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

fn needs_quotes(arg: &str) -> bool {
    arg.is_empty() || arg.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | '\\' | '#'))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wie der `java`-Starter Argumentdateien liest (Dokumentation von `java`, „Java Command-Line Argument Files“):
    /// Leerraum trennt, `"` und `'` fassen zusammen, darin gilt der Backslash als Escape.
    fn parse_like_java(text: &str) -> Vec<String> {
        let (mut args, mut current) = (Vec::new(), String::new());
        let (mut in_token, mut quote, mut escaped) = (false, None, false);
        for c in text.chars() {
            match quote {
                Some(_) if escaped => {
                    current.push(match c {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        'f' => '\x0c',
                        other => other,
                    });
                    escaped = false;
                }
                Some(_) if c == '\\' => escaped = true,
                Some(open) if c == open => quote = None,
                Some(_) => current.push(c),
                None if c.is_whitespace() => {
                    if in_token {
                        args.push(std::mem::take(&mut current));
                        in_token = false;
                    }
                }
                None if c == '"' || c == '\'' => {
                    quote = Some(c);
                    in_token = true;
                }
                None => {
                    assert_ne!(c, '#', "ein unquotiertes # finge einen Kommentar an");
                    current.push(c);
                    in_token = true;
                }
            }
        }
        if in_token {
            args.push(current);
        }
        args
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn plain_arguments_stay_as_they_are() {
        assert_eq!(render(&args(&["-Xmx2G", "-Dfile.encoding=UTF-8", "net.minecraft.client.main.Main"])), "-Xmx2G\n-Dfile.encoding=UTF-8\nnet.minecraft.client.main.Main\n");
    }

    #[test]
    fn paths_with_spaces_are_quoted_and_their_backslashes_doubled() {
        assert_eq!(quote(r"C:\Program Files\Java\bin"), r#""C:\\Program Files\\Java\\bin""#);
    }

    #[test]
    fn paths_without_spaces_still_double_their_backslashes() {
        assert_eq!(quote(r"C:\libs\a.jar"), r#""C:\\libs\\a.jar""#);
    }

    #[test]
    fn quotes_hashes_and_empty_arguments_are_quoted() {
        assert_eq!(quote(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote("ey.J#abc"), "\"ey.J#abc\"");
        assert_eq!(quote(""), "\"\"");
    }

    #[test]
    fn control_characters_become_escape_sequences() {
        assert_eq!(quote("a\nb\tc"), r#""a\nb\tc""#);
    }

    #[test]
    fn what_the_launcher_writes_is_what_java_reads() {
        let original = args(&[
            "-Xmx2048M",
            r"C:\Program Files\Eclipse Adoptium\bin\javaw.exe",
            r"-Djava.library.path=C:\Users\Max Mustermann\AppData\Roaming\natives",
            r"C:\Users\Max\libs\a.jar;C:\Users\Max\libs\b.jar",
            "/home/max/My Games/libs/a.jar:/home/max/libs/b.jar",
            "--accessToken",
            "eyJ#abc.def",
            r#"say "hi""#,
            "it's",
            "",
            "zwei\nZeilen",
            "tab\there",
            r"endet\",
            "Max's Welt",
        ]);
        assert_eq!(parse_like_java(&render(&original)), original);
    }

    #[test]
    fn the_file_is_written_readable_and_removed_with_its_folder() {
        let base = std::env::temp_dir().join(new_id());
        let list = args(&["-cp", r"C:\Mein Ordner\a.jar", "Main"]);

        let file = write(&base, &list).unwrap();

        let text = fs::read_to_string(file.path()).unwrap();
        assert_eq!(parse_like_java(&text), list);
        assert_eq!(file.argument(), format!("@{}", file.path().to_string_lossy()));
        let dir = file.dir.clone();
        drop(file);
        assert!(!dir.exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn only_the_owner_can_read_the_file_and_its_folder() {
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(new_id());

        let file = write(&base, &args(&["--accessToken", "geheim"])).unwrap();

        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&file.path()), 0o600);
        assert_eq!(mode(&file.dir), 0o700);
        drop(file);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn two_starts_never_share_a_file() {
        let base = std::env::temp_dir().join(new_id());
        let (first, second) = (write(&base, &[]).unwrap(), write(&base, &[]).unwrap());
        assert_ne!(first.path(), second.path());
        drop((first, second));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn java_8_and_unknown_java_get_plain_arguments() {
        let dirs = Dirs::new("/data");
        let list = args(&["-cp", "a.jar"]);
        assert_eq!(dir_for(&dirs, Some(8), &list), None);
        assert_eq!(dir_for(&dirs, None, &list), None);
        assert_eq!(dir_for(&dirs, Some(9), &list), Some(dirs.argfiles()));
        assert_eq!(dir_for(&dirs, Some(21), &list), Some(dirs.argfiles()));
    }

    #[test]
    fn non_ascii_arguments_only_use_a_file_where_java_reads_it_as_utf8() {
        let dirs = Dirs::new("/data");
        let umlaut = args(&["-Dname=Jürgen"]);
        assert_eq!(dir_for(&dirs, Some(21), &umlaut).is_some(), !cfg!(windows));
    }

    #[test]
    fn a_non_ascii_folder_only_uses_a_file_where_java_reads_it_as_utf8() {
        let dirs = Dirs::new("/daten/Jürgen");
        assert_eq!(dir_for(&dirs, Some(21), &args(&["-cp", "a.jar"])).is_some(), !cfg!(windows));
    }

    #[test]
    fn sweeping_removes_leftovers_and_tolerates_none() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        sweep_stale(&dirs);
        let file = write(&dirs.argfiles(), &args(&["x"])).unwrap();
        let path = file.path();
        std::mem::forget(file);

        sweep_stale(&dirs);

        assert!(!path.exists());
        fs::remove_dir_all(&dirs.root).ok();
    }

    #[tokio::test(start_paused = true)]
    async fn the_file_stays_for_the_grace_period_and_then_goes() {
        let base = std::env::temp_dir().join(new_id());
        let file = write(&base, &args(&["x"])).unwrap();
        let path = file.path();

        let removal = tokio::spawn(remove_after(file, READ_GRACE));
        tokio::time::sleep(READ_GRACE - Duration::from_millis(1)).await;
        assert!(path.exists());
        removal.await.unwrap();

        assert!(!path.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
