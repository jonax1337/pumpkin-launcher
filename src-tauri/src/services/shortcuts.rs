//! Verknüpfungen zu einer Instanz auf dem Desktop: Ein Doppelklick öffnet deren `pumpkin://launch/…`-Link. Die Datei
//! enthält nur diesen Link und, wo das System es kennt, das Icon der Instanz bzw. des Launchers, nie einen Programmaufruf.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{free_name, require_plain_name, write_atomic};
use crate::coded;
use crate::error::{AppError, AppResult};

/// So viele Zeichen des Instanznamens kommen in den Dateinamen.
const FILE_NAME_CHARS: usize = 80;
/// Dateiname, wenn vom Instanznamen nichts Brauchbares bleibt.
const FALLBACK_FILE_NAME: &str = "Pumpkin Launcher";

/// Wohin Verknüpfungen kommen.
pub struct Places {
    pub desktop: PathBuf,
    /// Anwendungsmenü des Nutzers; dort legt Linux zusätzlich einen Eintrag an.
    pub app_menu: Option<PathBuf>,
}

impl Places {
    pub fn of_user() -> AppResult<Self> {
        let desktop = dirs::desktop_dir().ok_or_else(|| AppError::invalid(coded!("errors.app.shortcut.noDesktop")))?;
        Ok(Self { desktop, app_menu: dirs::data_dir().map(|data| data.join("applications")) })
    }
}

/// Die Icons, die eine Verknüpfung tragen kann, so wie das jeweilige System sie nennt.
pub struct LauncherIcon {
    /// Das Icon der Instanz selbst (`services::shortcut_icon`): `.ico` unter Windows, sonst `.png`. Es geht dem des
    /// Launchers vor.
    pub own: Option<PathBuf>,
    /// Die Programmdatei, deren eingebettetes Icon Windows nutzt, wenn die Instanz kein eigenes hat.
    pub exe: PathBuf,
    /// Der Name des Icons im Icon-Thema (Linux), wenn die Instanz kein eigenes hat.
    pub theme_name: String,
}

pub struct Shortcut<'a> {
    pub instance_id: &'a str,
    pub name: &'a str,
    /// Der Link, den ein Doppelklick öffnet (`deep_link::launch_link`): nur URL-Zeichen.
    pub url: &'a str,
    pub icon: &'a LauncherIcon,
}

/// Legt die Verknüpfung auf dem Desktop an und liefert ihren Pfad. Eine Datei desselben Namens bleibt unberührt:
/// die neue heißt dann „<Name> (2)“.
pub fn create(places: &Places, shortcut: &Shortcut) -> AppResult<PathBuf> {
    let format = Format::of_this_system();
    let content = format.render(shortcut);
    let path = write_new_file(&places.desktop, shortcut.name, format, &content)?;
    if let (Format::DesktopEntry, Some(menu)) = (format, &places.app_menu) {
        add_to_app_menu(menu, shortcut.instance_id, &content)?;
    }
    #[cfg(target_os = "macos")]
    if let (Format::Webloc, Some(icon)) = (format, &shortcut.icon.own) {
        apply_file_icon(&path, icon);
    }
    Ok(path)
}

/// Setzt das Icon der Datei im Finder. Das ist Zierde: scheitert es, bleibt die Verknüpfung ohne eigenes Icon.
#[cfg(target_os = "macos")]
fn apply_file_icon(file: &Path, icon: &Path) {
    const SCRIPT: &str = "ObjC.import('AppKit'); function run(argv) { \
        const image = $.NSImage.alloc.initWithContentsOfFile(argv[0]); \
        return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[1], 0) ? 'ok' : 'refused'; }";
    let outcome = std::process::Command::new("osascript").args(["-l", "JavaScript", "-e", SCRIPT]).arg(icon).arg(file).output();
    match outcome {
        Ok(output) if output.status.success() && output.stdout.starts_with(b"ok") => {}
        Ok(output) => tracing::warn!(file = %file.display(), status = ?output.status, "Icon der Verknüpfung nicht gesetzt"),
        Err(err) => tracing::warn!(file = %file.display(), %err, "Icon der Verknüpfung nicht gesetzt"),
    }
}

/// Die Dateiart, die der Desktop des Systems für „öffne diesen Link“ kennt.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Format {
    /// Windows: `.url`.
    InternetShortcut,
    /// Linux: `.desktop` nach der Desktop-Entry-Spezifikation.
    DesktopEntry,
    /// macOS: `.webloc`.
    Webloc,
}

impl Format {
    fn of_this_system() -> Self {
        if cfg!(windows) {
            Self::InternetShortcut
        } else if cfg!(target_os = "macos") {
            Self::Webloc
        } else {
            Self::DesktopEntry
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::InternetShortcut => ".url",
            Self::DesktopEntry => ".desktop",
            Self::Webloc => ".webloc",
        }
    }

    fn render(self, shortcut: &Shortcut) -> String {
        match self {
            Self::InternetShortcut => internet_shortcut(shortcut),
            Self::DesktopEntry => desktop_entry(shortcut),
            Self::Webloc => webloc(shortcut),
        }
    }

    /// Ein Desktop-Eintrag startet erst, wenn er ausführbar ist.
    #[cfg(unix)]
    fn unix_mode(self) -> u32 {
        if self == Self::DesktopEntry { 0o755 } else { 0o644 }
    }
}

fn internet_shortcut(shortcut: &Shortcut) -> String {
    let mut lines = vec!["[InternetShortcut]".to_owned(), format!("URL={}", shortcut.url)];
    // `.url`-Dateien liest Windows in der ANSI-Codepage: ein Pfad mit anderen Zeichen würde falsch gelesen.
    let icon_file = [shortcut.icon.own.as_deref(), Some(shortcut.icon.exe.as_path())]
        .into_iter()
        .flatten()
        .filter_map(Path::to_str)
        .find(|path| path.is_ascii());
    if let Some(file) = icon_file {
        lines.push(format!("IconFile={file}"));
        lines.push("IconIndex=0".to_owned());
    }
    lines.join("\r\n") + "\r\n"
}

fn desktop_entry(shortcut: &Shortcut) -> String {
    let mut entry = format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName={}\nExec=xdg-open {}\nTerminal=false\nCategories=Game;\n",
        escape_entry_text(shortcut.name),
        quote_exec_argument(shortcut.url),
    );
    let icon = shortcut.icon.own.as_deref().and_then(Path::to_str).unwrap_or(&shortcut.icon.theme_name);
    if !icon.is_empty() {
        entry.push_str(&format!("Icon={}\n", escape_entry_text(icon)));
    }
    entry
}

/// Ein Wert vom Typ `string` der Desktop-Entry-Spezifikation: eine Zeile, `\` verdoppelt.
fn escape_entry_text(text: &str) -> String {
    let one_line: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    one_line.trim().replace('\\', "\\\\")
}

/// Ein Argument in `Exec`: in Anführungszeichen, `"`, `` ` ``, `$` und `\` mit `\` davor, danach (Escape-Regel für
/// Zeichenketten) jedes `\` verdoppelt, und `%` als `%%`, damit es kein Platzhalter (`%u`, `%f` …) wird.
fn quote_exec_argument(argument: &str) -> String {
    let mut quoted = String::from('"');
    for c in argument.chars() {
        match c {
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(c);
            }
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

fn webloc(shortcut: &Shortcut) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\">\n<dict>\n\t<key>URL</key>\n\t<string>{}</string>\n</dict>\n</plist>\n",
        escape_xml(shortcut.url),
    )
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Schreibt die Datei neu in `dir`; ist der Name belegt, mit „ (2)“, „ (3)“ …, und überschreibt nie.
fn write_new_file(dir: &Path, instance_name: &str, format: Format, content: &str) -> AppResult<PathBuf> {
    let file_name = free_name(&file_stem(instance_name), format.extension(), |name| dir.join(name).exists());
    let path = dir.join(file_name);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, format.unix_mode());
    let mut file = options.open(&path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(path)
}

/// Der Name der Datei: der Instanzname ohne Zeichen, die ein Dateiname unter Windows nicht trägt.
fn file_stem(instance_name: &str) -> String {
    let clean: String = instance_name
        .chars()
        .take(FILE_NAME_CHARS)
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let stem = clean.trim_matches([' ', '.']);
    require_plain_name(stem).map_or_else(|_| FALLBACK_FILE_NAME.to_owned(), str::to_owned)
}

/// Der Eintrag im Anwendungsmenü gehört dem Launcher und heißt nach der Instanz: Ein neuer ersetzt den alten.
fn add_to_app_menu(menu: &Path, instance_id: &str, content: &str) -> AppResult<()> {
    fs::create_dir_all(menu)?;
    let file_name = format!("pumpkin-instance-{}.desktop", require_plain_name(instance_id)?);
    write_atomic(&menu.join(file_name), content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;

    const URL: &str = "pumpkin://launch/abc-1?s=0f";

    fn icon() -> LauncherIcon {
        LauncherIcon { own: None, exe: PathBuf::from("C:\\Programme\\pumpkin-launcher.exe"), theme_name: "pumpkin-launcher".into() }
    }

    fn render(format: Format, name: &str) -> String {
        format.render(&Shortcut { instance_id: "abc-1", name, url: URL, icon: &icon() })
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_internet_shortcut_holds_the_link_and_the_launcher_icon() {
        assert_eq!(
            render(Format::InternetShortcut, "Pack"),
            "[InternetShortcut]\r\nURL=pumpkin://launch/abc-1?s=0f\r\nIconFile=C:\\Programme\\pumpkin-launcher.exe\r\nIconIndex=0\r\n"
        );
    }

    #[test]
    fn an_internet_shortcut_leaves_out_an_icon_path_the_system_would_misread() {
        let icon = LauncherIcon { own: None, exe: PathBuf::from("C:\\Benutzer\\Jörg\\pumpkin-launcher.exe"), theme_name: String::new() };

        let text = Format::InternetShortcut.render(&Shortcut { instance_id: "i", name: "Pack", url: URL, icon: &icon });

        assert_eq!(text, "[InternetShortcut]\r\nURL=pumpkin://launch/abc-1?s=0f\r\n");
    }

    #[test]
    fn an_internet_shortcut_prefers_the_icon_of_the_instance_and_falls_back_to_the_launcher() {
        let own = LauncherIcon { own: Some(PathBuf::from("C:\\Daten\\icons\\abc-1.ico")), ..icon() };
        let non_ascii = LauncherIcon { own: Some(PathBuf::from("C:\\Benutzer\\Jörg\\abc-1.ico")), ..icon() };

        let render = |icon: &LauncherIcon| Format::InternetShortcut.render(&Shortcut { instance_id: "abc-1", name: "Pack", url: URL, icon });

        assert!(render(&own).contains("IconFile=C:\\Daten\\icons\\abc-1.ico\r\nIconIndex=0\r\n"));
        assert!(render(&non_ascii).contains("IconFile=C:\\Programme\\pumpkin-launcher.exe\r\n"));
    }

    #[test]
    fn a_desktop_entry_names_the_icon_file_of_the_instance_instead_of_the_theme_icon() {
        let own = LauncherIcon { own: Some(PathBuf::from("/home/me/.local/share/icons/abc-1.png")), ..icon() };

        let text = Format::DesktopEntry.render(&Shortcut { instance_id: "abc-1", name: "Pack", url: URL, icon: &own });

        assert!(text.ends_with("Icon=/home/me/.local/share/icons/abc-1.png\n"), "{text}");
        assert!(!text.contains("pumpkin-launcher"));
    }

    #[test]
    fn a_desktop_entry_opens_the_quoted_link_with_xdg_open() {
        assert_eq!(
            render(Format::DesktopEntry, "Pack"),
            "[Desktop Entry]\nType=Application\nVersion=1.0\nName=Pack\nExec=xdg-open \"pumpkin://launch/abc-1?s=0f\"\n\
             Terminal=false\nCategories=Game;\nIcon=pumpkin-launcher\n"
        );
    }

    #[test]
    fn a_desktop_entry_keeps_quotes_percent_signs_and_unicode_of_the_name_but_never_a_second_line() {
        let text = render(Format::DesktopEntry, "Mein \"Pack\" 100% ✨ Ünï\\Cødé\nExec=evil");

        assert!(text.contains("\nName=Mein \"Pack\" 100% ✨ Ünï\\\\Cødé Exec=evil\n"), "{text}");
        assert_eq!(text.lines().filter(|line| line.starts_with("Exec=")).count(), 1);
    }

    #[test]
    fn exec_arguments_are_quoted_for_the_desktop_entry_specification() {
        assert_eq!(quote_exec_argument("a b"), "\"a b\"");
        assert_eq!(quote_exec_argument("100%u"), "\"100%%u\"");
        assert_eq!(quote_exec_argument("a\"b`c$d"), "\"a\\\\\"b\\\\`c\\\\$d\"");
        assert_eq!(quote_exec_argument("a\\b"), "\"a\\\\\\\\b\"");
        assert_eq!(quote_exec_argument("ü ß"), "\"ü ß\"");
    }

    #[test]
    fn a_desktop_entry_without_theme_icon_has_no_icon_line() {
        let icon = LauncherIcon { own: None, exe: PathBuf::new(), theme_name: String::new() };

        let text = Format::DesktopEntry.render(&Shortcut { instance_id: "i", name: "Pack", url: URL, icon: &icon });

        assert!(!text.contains("Icon="));
    }

    #[test]
    fn a_webloc_holds_the_escaped_link() {
        let icon = icon();
        let text = Format::Webloc.render(&Shortcut { instance_id: "i", name: "Pack", url: "pumpkin://launch/a?s=1&t=<2>", icon: &icon });

        assert!(text.contains("<key>URL</key>\n\t<string>pumpkin://launch/a?s=1&amp;t=&lt;2&gt;</string>"), "{text}");
        assert!(text.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist"));
    }

    #[test]
    fn file_names_drop_what_windows_refuses_and_fall_back_to_the_product_name() {
        assert_eq!(file_stem("Mein Pack"), "Mein Pack");
        assert_eq!(file_stem("A/B:C*D?\"E\""), "A_B_C_D__E_");
        assert_eq!(file_stem("  Pack. . "), "Pack");
        assert_eq!(file_stem("Ünï ✨"), "Ünï ✨");
        for hopeless in ["", "   ", "...", "CON", "nul"] {
            assert_eq!(file_stem(hopeless), FALLBACK_FILE_NAME, "{hopeless:?}");
        }
        assert_eq!(file_stem(&"x".repeat(500)).chars().count(), FILE_NAME_CHARS);
    }

    #[test]
    fn an_existing_file_is_never_overwritten() {
        let dir = temp_dir();

        let first = write_new_file(&dir, "Pack", Format::Webloc, "eins").unwrap();
        let second = write_new_file(&dir, "Pack", Format::Webloc, "zwei").unwrap();

        assert_eq!(first.file_name().unwrap(), "Pack.webloc");
        assert_eq!(second.file_name().unwrap(), "Pack (2).webloc");
        assert_eq!(fs::read_to_string(first).unwrap(), "eins");
        assert_eq!(fs::read_to_string(second).unwrap(), "zwei");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_desktop_entry_is_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();

        let path = write_new_file(&dir, "Pack", Format::DesktopEntry, "x").unwrap();

        assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o100, 0o100);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_app_menu_entry_is_named_after_the_instance_and_replaced_on_the_next_shortcut() {
        let dir = temp_dir();

        add_to_app_menu(&dir.join("applications"), "abc-1", "alt").unwrap();
        add_to_app_menu(&dir.join("applications"), "abc-1", "neu").unwrap();

        assert_eq!(fs::read_to_string(dir.join("applications/pumpkin-instance-abc-1.desktop")).unwrap(), "neu");
        assert!(add_to_app_menu(&dir, "../x", "x").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
