//! Die Java-Hauptversion einer Programmdatei (INGAME 3.4), je Pfad einmal ermittelt: aus der Datei `release` im
//! Java-Home, sonst durch einen Aufruf von `java -version`. Gemerkt wird nur ein Fund; ein Fehlschlag wird beim nächsten
//! Mal erneut versucht.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use super::java_major::from_version_output;
use crate::services::{javadetect, lock};

#[derive(Default)]
pub struct JavaMajors {
    known: Mutex<HashMap<PathBuf, u32>>,
}

impl JavaMajors {
    /// Die Hauptversion der Java-Programmdatei `exe`; `None`, wenn sie sich nicht feststellen lässt.
    pub fn of(&self, exe: &Path) -> Option<u32> {
        self.of_probing(exe, probe)
    }

    fn of_probing(&self, exe: &Path, probe: impl FnOnce(&Path) -> Option<u32>) -> Option<u32> {
        if let Some(major) = lock(&self.known).get(exe) {
            return Some(*major);
        }
        let major = probe(exe)?;
        lock(&self.known).insert(exe.to_owned(), major);
        Some(major)
    }
}

fn probe(exe: &Path) -> Option<u32> {
    javadetect::major_of_exe(exe).or_else(|| major_from_version_output(exe))
}

/// Startet `java -version` (die Ausgabe kommt auf stderr). Unter Windows hat `javaw.exe` keine Konsole und schreibt
/// nichts, also fragt der Aufruf deren Nachbarn `java.exe`.
fn major_from_version_output(exe: &Path) -> Option<u32> {
    let output = silent(Command::new(console_program(exe)).arg("-version")).stdin(Stdio::null()).output().ok()?;
    from_version_output(&String::from_utf8_lossy(&output.stderr))
}

fn console_program(exe: &Path) -> PathBuf {
    let is_windowless = exe.file_name().is_some_and(|name| name.eq_ignore_ascii_case("javaw.exe"));
    if is_windowless {
        exe.with_file_name("java.exe")
    } else {
        exe.to_owned()
    }
}

#[cfg(windows)]
fn silent(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
fn silent(command: &mut Command) -> &mut Command {
    command
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[test]
    fn a_found_major_is_asked_for_once_per_path() {
        let majors = JavaMajors::default();
        let asked = Cell::new(0);
        let probe = |_: &Path| {
            asked.set(asked.get() + 1);
            Some(21)
        };

        assert_eq!(majors.of_probing(Path::new("a/java"), probe), Some(21));
        assert_eq!(majors.of_probing(Path::new("a/java"), probe), Some(21));
        assert_eq!(majors.of_probing(Path::new("b/java"), probe), Some(21));

        assert_eq!(asked.get(), 2);
    }

    #[test]
    fn a_failed_probe_is_tried_again_next_time() {
        let majors = JavaMajors::default();

        assert_eq!(majors.of_probing(Path::new("a/java"), |_| None), None);
        assert_eq!(majors.of_probing(Path::new("a/java"), |_| Some(17)), Some(17));
    }

    #[test]
    fn the_windowless_program_asks_its_console_neighbour() {
        assert_eq!(console_program(Path::new("jre/bin/javaw.exe")), Path::new("jre/bin/java.exe"));
        assert_eq!(console_program(Path::new("jre/bin/JAVAW.EXE")), Path::new("jre/bin/java.exe"));
        assert_eq!(console_program(Path::new("jre/bin/java")), Path::new("jre/bin/java"));
    }

    #[test]
    fn a_program_that_is_not_there_has_no_major() {
        assert_eq!(JavaMajors::default().of(Path::new("gibt-es-nicht/bin/java")), None);
    }
}
