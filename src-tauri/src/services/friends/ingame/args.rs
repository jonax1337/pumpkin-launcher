//! Die Startoptionen, mit denen der Loader das JAR lädt (INGAME 3.5, 3.6): je Strategie JVM- und Spielargumente,
//! zusammengeführt mit dem, was der Nutzer selbst angegeben hat. Wohin die Optionen in der Argumentliste gehören
//! (nach den JVM-Argumenten der Version, vor denen des Nutzers), entscheidet der Aufrufer.
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::index::{Node, Strategy};
use super::materialise::{sha256_hex, write_atomically, MaterialisedJar, MAVEN_ARTIFACT, MAVEN_GROUP};
use super::property;

/// Trennzeichen von Pfadlisten (`File.pathSeparator`) der Java, die das Spiel startet; der Launcher und das Spiel
/// laufen auf demselben System.
#[cfg(windows)]
pub const PATH_LIST_SEPARATOR: char = ';';
#[cfg(not(windows))]
pub const PATH_LIST_SEPARATOR: char = ':';

const FABRIC_PROPERTY: &str = "fabric.addMods";
const FOLDERS_PROPERTY: &str = "fml.modFolders";
/// Bezeichnung des Mod-Ordners für `fml.modFolders`: `<Bezeichnung>%%<Pfad>`.
const FOLDERS_LABEL: &str = "pumpkin";
const MAVEN_ROOTS_OPTION: &str = "--fml.mavenRoots";
const MODS_OPTION: &str = "--fml.mods";
const LIST_FILE_PREFIX: &str = "addmods-";

/// Die eigenen Startargumente der Instanz, in die eingespeist wird.
#[derive(Debug, Clone, Copy)]
pub struct UserArgs<'a> {
    pub jvm: &'a [String],
    pub game: &'a [String],
    /// Arbeitsordner des Spiels; relative Pfade in den Argumenten des Nutzers gelten von hier aus.
    pub game_dir: &'a Path,
}

/// Die einzuspeisenden Optionen und die eigenen Argumente des Nutzers, soweit sie bleiben.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct InjectedArgs {
    /// Kommen nach den JVM-Argumenten der Version und vor `user_jvm`.
    pub jvm: Vec<String>,
    /// Spielargumente der Einspeisung; kommen nach denen der Version und vor `user_game`.
    pub game: Vec<String>,
    /// Die JVM-Argumente des Nutzers ohne die, die die Zusammenführung ersetzt hat.
    pub user_jvm: Vec<String>,
    /// Die Spielargumente des Nutzers ohne die, die die Zusammenführung ersetzt hat.
    pub user_game: Vec<String>,
    /// Die ersetzten Argumente des Nutzers im Wortlaut, für das Protokoll.
    pub replaced: Vec<String>,
}

/// Warum sich keine Optionen bauen lassen. Der Aufrufer startet dann ohne Einspeisung.
#[derive(Debug, thiserror::Error)]
pub enum ArgsError {
    #[error("Der Pfad {0} ist kein Text und lässt sich nicht als Startargument übergeben")]
    PathNotText(PathBuf),
    #[error("Der Pfad {0} enthält das Trennzeichen der Pfadliste")]
    PathHasListSeparator(PathBuf),
    #[error("Das JAR {0} liegt in keinem Maven-Verzeichnis, die Strategie fmlMavenRoot braucht eines")]
    NotInMavenLayout(PathBuf),
    #[error("Die Listendatei {path} aus den Startargumenten ist nicht lesbar: {source}")]
    ListFileUnreadable { path: PathBuf, source: io::Error },
    #[error("Die gemeinsame Listendatei {path} ließ sich nicht schreiben: {source}")]
    ListFileNotWritable { path: PathBuf, source: io::Error },
}

/// Baut die Optionen für den Knoten, dessen JAR bereitliegt.
pub fn build(node: &Node, jar: &MaterialisedJar, user: &UserArgs) -> Result<InjectedArgs, ArgsError> {
    build_with_separator(node.strategy, jar, user, PATH_LIST_SEPARATOR)
}

fn build_with_separator(strategy: Strategy, jar: &MaterialisedJar, user: &UserArgs, separator: char) -> Result<InjectedArgs, ArgsError> {
    match strategy {
        Strategy::FabricAddMods => fabric_add_mods(jar, user, separator),
        Strategy::FmlMavenRoot => fml_maven_root(jar, user),
        Strategy::FmlModFolders => fml_mod_folders(jar, user, separator),
    }
}

/// Fabric: `-Dfabric.addMods=<Pfadliste>`. Hat der Nutzer die Eigenschaft gesetzt, bleiben seine Einträge, unserer
/// kommt genau einmal ans Ende. Enthält sein Wert eine Listendatei (`@datei`), entsteht eine gemeinsame Listendatei
/// im Datenordner, denn Fabric kennt nur die eine Eigenschaft.
fn fabric_add_mods(jar: &MaterialisedJar, user: &UserArgs, separator: char) -> Result<InjectedArgs, ArgsError> {
    let ours = path_text(jar.jar())?;
    let existing = property::find(user.jvm, FABRIC_PROPERTY, separator);
    let uses_list_file = existing.entries.iter().any(|entry| entry.starts_with('@')) || ours.contains(separator);
    let mut entries = if uses_list_file { expand_list_files(&existing.entries, user.game_dir)? } else { existing.entries };
    append_once(&mut entries, ours);
    let value = if uses_list_file {
        format!("@{}", write_shared_list_file(jar.runtime_dir(), &entries)?)
    } else {
        entries.join(&separator.to_string())
    };
    Ok(InjectedArgs {
        jvm: vec![format!("-D{FABRIC_PROPERTY}={value}")],
        user_jvm: existing.remaining,
        user_game: user.game.to_vec(),
        replaced: existing.replaced,
        ..InjectedArgs::default()
    })
}

/// NeoForge und Forge mit Maven-Verzeichnis: `--fml.mavenRoots <Wurzel> --fml.mods <Gruppe:Artefakt:Version>`.
/// Beide Optionen dürfen mehrfach vorkommen, deshalb bleiben die des Nutzers; nur ein früheres Paar von uns entfällt.
fn fml_maven_root(jar: &MaterialisedJar, user: &UserArgs) -> Result<InjectedArgs, ArgsError> {
    let root = path_text(jar.maven_root().ok_or_else(|| ArgsError::NotInMavenLayout(jar.jar().to_owned()))?)?;
    let coordinate = format!("{MAVEN_GROUP}:{MAVEN_ARTIFACT}:{}", jar.mod_version());
    let (rest, roots_replaced) = without_option(user.game, MAVEN_ROOTS_OPTION, &root);
    let (rest, mods_replaced) = without_option(&rest, MODS_OPTION, &coordinate);
    Ok(InjectedArgs {
        game: vec![MAVEN_ROOTS_OPTION.to_owned(), root, MODS_OPTION.to_owned(), coordinate],
        user_jvm: user.jvm.to_vec(),
        user_game: rest,
        replaced: [roots_replaced, mods_replaced].concat(),
        ..InjectedArgs::default()
    })
}

/// NeoForge ab FML 10: `-Dfml.modFolders=pumpkin%%<JAR>`, zusammengeführt mit einem Wert des Nutzers.
fn fml_mod_folders(jar: &MaterialisedJar, user: &UserArgs, separator: char) -> Result<InjectedArgs, ArgsError> {
    let path = path_text(jar.jar())?;
    if path.contains(separator) {
        return Err(ArgsError::PathHasListSeparator(jar.jar().to_owned()));
    }
    let existing = property::find(user.jvm, FOLDERS_PROPERTY, separator);
    let mut entries = existing.entries;
    append_once(&mut entries, format!("{FOLDERS_LABEL}%%{path}"));
    Ok(InjectedArgs {
        jvm: vec![format!("-D{FOLDERS_PROPERTY}={}", entries.join(&separator.to_string()))],
        user_jvm: existing.remaining,
        user_game: user.game.to_vec(),
        replaced: existing.replaced,
        ..InjectedArgs::default()
    })
}

/// Hängt `entry` ans Ende und nimmt vorher jedes frühere Vorkommen heraus: ein zweiter Durchlauf über das Ergebnis
/// des ersten ändert nichts.
fn append_once(entries: &mut Vec<String>, entry: String) {
    entries.retain(|existing| *existing != entry);
    entries.push(entry);
}

/// Die Einträge, mit jeder Listendatei (`@datei`) durch ihre Zeilen ersetzt.
fn expand_list_files(entries: &[String], game_dir: &Path) -> Result<Vec<String>, ArgsError> {
    let mut expanded = Vec::new();
    for entry in entries {
        match entry.strip_prefix('@') {
            Some(list_file) => expanded.extend(read_list_file(&game_dir.join(list_file))?),
            None => expanded.push(entry.clone()),
        }
    }
    Ok(expanded)
}

fn read_list_file(path: &Path) -> Result<Vec<String>, ArgsError> {
    let text = fs::read_to_string(path).map_err(|source| ArgsError::ListFileUnreadable { path: path.to_owned(), source })?;
    Ok(text.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_owned).collect())
}

/// Schreibt die Einträge als Listendatei, deren Name aus dem Inhalt folgt: gleiche Einträge ergeben dieselbe Datei
/// (ein zweiter Lauf ändert nichts), verschiedene Instanzen stören sich nicht.
fn write_shared_list_file(directory: &Path, entries: &[String]) -> Result<String, ArgsError> {
    let content = entries.iter().map(|entry| format!("{entry}\n")).collect::<String>();
    let path = directory.join(format!("{LIST_FILE_PREFIX}{}.list", &sha256_hex(content.as_bytes())[..16]));
    let write = || fs::create_dir_all(directory).and_then(|()| write_atomically(&path, content.as_bytes()));
    if fs::read_to_string(&path).ok().as_deref() != Some(content.as_str()) {
        write().map_err(|source| ArgsError::ListFileNotWritable { path: path.clone(), source })?;
    }
    path_text(&path)
}

/// Die Option `name wert` (zwei Argumente) oder `name=wert` (eines) aus `args` nehmen; zurück kommen die übrigen und
/// die entfernten Argumente.
fn without_option(args: &[String], name: &str, value: &str) -> (Vec<String>, Vec<String>) {
    let joined = format!("{name}={value}");
    let (mut kept, mut removed) = (Vec::new(), Vec::new());
    let mut position = 0;
    while position < args.len() {
        let is_pair = args[position] == name && args.get(position + 1).is_some_and(|next| next == value);
        if is_pair {
            removed.push(format!("{name} {value}"));
            position += 2;
        } else if args[position] == joined {
            removed.push(joined.clone());
            position += 1;
        } else {
            kept.push(args[position].clone());
            position += 1;
        }
    }
    (kept, removed)
}

fn path_text(path: &Path) -> Result<String, ArgsError> {
    path.to_str().map(str::to_owned).ok_or_else(|| ArgsError::PathNotText(path.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::ingame::index::Loader;
    use crate::services::friends::ingame::materialise::materialise;
    use crate::services::friends::ingame::test_support::{jar_node, FakeSource, TempDir};

    const JAR_BYTES: &[u8] = b"jar";

    /// Ein Buchstabe, der in jedem Testpfad vorkommt (alle Ordner heißen `pumpkin-ingame-...`).
    const SEPARATOR_IN_EVERY_TEST_PATH: char = 'p';

    struct Case {
        strategy: Strategy,
        data: TempDir,
        game_dir: TempDir,
        jar: MaterialisedJar,
    }

    impl Case {
        fn new(loader: Loader, strategy: Strategy) -> Self {
            let node = Node { strategy, ..jar_node("1.21.1-test", loader, JAR_BYTES) };
            let data = TempDir::new();
            let jar = materialise(&FakeSource::with_jar(&node, JAR_BYTES), data.path(), &node).unwrap();
            Self { strategy, data, game_dir: TempDir::new(), jar }
        }

        fn run(&self, jvm: &[&str], game: &[&str], separator: char) -> Result<InjectedArgs, ArgsError> {
            let (jvm, game) = (strings(jvm), strings(game));
            build_with_separator(self.strategy, &self.jar, &UserArgs { jvm: &jvm, game: &game, game_dir: self.game_dir.path() }, separator)
        }

        fn ours(&self) -> String {
            self.jar.jar().to_str().unwrap().to_owned()
        }
    }

    fn strings(list: &[&str]) -> Vec<String> {
        list.iter().map(|text| (*text).to_owned()).collect()
    }

    fn fabric_case() -> Case {
        Case::new(Loader::Fabric, Strategy::FabricAddMods)
    }

    fn single_jvm_value(args: &InjectedArgs, property: &str) -> String {
        assert_eq!(args.jvm.len(), 1, "{args:?}");
        args.jvm[0].strip_prefix(&format!("-D{property}=")).unwrap_or_else(|| panic!("{:?}", args.jvm)).to_owned()
    }

    // --- fabricAddMods ---------------------------------------------------------------------------------------

    #[test]
    fn fabric_without_user_property_passes_just_the_jar() {
        let case = fabric_case();
        let args = case.run(&["-Xmx2G"], &["--demo"], ';').unwrap();
        assert_eq!(args.jvm, vec![format!("-Dfabric.addMods={}", case.ours())]);
        assert!(args.game.is_empty());
        assert_eq!((args.user_jvm, args.user_game, args.replaced), (strings(&["-Xmx2G"]), strings(&["--demo"]), vec![]));
    }

    #[test]
    fn fabric_appends_the_jar_to_the_users_list_exactly_once() {
        let case = fabric_case();
        let args = case.run(&["-Xmx2G", r"-Dfabric.addMods=C:\a.jar;C:\b.jar"], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&args, "fabric.addMods"), format!(r"C:\a.jar;C:\b.jar;{}", case.ours()));
        assert_eq!(args.user_jvm, strings(&["-Xmx2G"]), "die Eigenschaft des Nutzers ist ersetzt, nicht doppelt");
        assert_eq!(args.replaced, strings(&[r"-Dfabric.addMods=C:\a.jar;C:\b.jar"]));
    }

    #[test]
    fn fabric_merge_is_idempotent() {
        let case = fabric_case();
        let first = case.run(&[r"-Dfabric.addMods=C:\a.jar;C:\b.jar"], &[], ';').unwrap();
        let second = case.run(&first.jvm.iter().map(String::as_str).collect::<Vec<_>>(), &[], ';').unwrap();
        assert_eq!(second.jvm, first.jvm);
        let value = single_jvm_value(&second, "fabric.addMods");
        assert_eq!(value.matches(&case.ours()).count(), 1);
    }

    #[test]
    fn fabric_moves_a_leftover_entry_of_ours_to_the_end_instead_of_duplicating_it() {
        let case = fabric_case();
        let existing = format!("-Dfabric.addMods={};C:\\b.jar", case.ours());
        let args = case.run(&[&existing], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&args, "fabric.addMods"), format!("C:\\b.jar;{}", case.ours()));
    }

    #[test]
    fn fabric_splits_and_joins_with_the_separator_it_is_given() {
        let case = fabric_case();
        let args = case.run(&["-Dfabric.addMods=/a.jar|/b.jar"], &[], '|').unwrap();
        assert_eq!(single_jvm_value(&args, "fabric.addMods"), format!("/a.jar|/b.jar|{}", case.ours()));
    }

    #[test]
    fn fabric_collapses_duplicate_properties_to_the_one_the_jvm_would_use() {
        let case = fabric_case();
        let args = case.run(&["-Dfabric.addMods=a.jar", "-Xss1M", "-Dfabric.addMods=b.jar", "-Dfabric.addMods=c.jar"], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&args, "fabric.addMods"), format!("c.jar;{}", case.ours()));
        assert_eq!(args.user_jvm, strings(&["-Xss1M"]));
        assert_eq!(args.replaced.len(), 3);
    }

    #[test]
    fn fabric_understands_quoted_user_values() {
        let case = fabric_case();
        let args = case.run(&[r#"-Dfabric.addMods="C:\my mods\a.jar";"C:\b.jar""#], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&args, "fabric.addMods"), format!(r"C:\my mods\a.jar;C:\b.jar;{}", case.ours()));
    }

    #[test]
    fn fabric_ignores_an_empty_user_value() {
        let case = fabric_case();
        let args = case.run(&["-Dfabric.addMods="], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&args, "fabric.addMods"), case.ours());
        assert_eq!(args.replaced, strings(&["-Dfabric.addMods="]));
    }

    #[test]
    fn fabric_merges_a_user_list_file_into_one_shared_list_file() {
        let case = fabric_case();
        fs::write(case.game_dir.path().join("mine.txt"), "C:\\x.jar\r\n\r\n  C:\\y.jar  \n").unwrap();
        let args = case.run(&["-Dfabric.addMods=@mine.txt"], &[], ';').unwrap();
        let value = single_jvm_value(&args, "fabric.addMods");
        let list_file = value.strip_prefix('@').expect("Listendatei-Form");
        assert!(Path::new(list_file).starts_with(case.jar.runtime_dir()));
        assert_eq!(fs::read_to_string(list_file).unwrap(), format!("C:\\x.jar\nC:\\y.jar\n{}\n", case.ours()));
        assert_eq!(args.replaced, strings(&["-Dfabric.addMods=@mine.txt"]));
    }

    #[test]
    fn fabric_list_file_merge_mixes_plain_entries_and_list_files_and_is_idempotent() {
        let case = fabric_case();
        fs::write(case.game_dir.path().join("mine.txt"), "listed.jar\n").unwrap();
        let first = case.run(&["-Dfabric.addMods=plain.jar;@mine.txt"], &[], ';').unwrap();
        let content = fs::read_to_string(single_jvm_value(&first, "fabric.addMods").strip_prefix('@').unwrap()).unwrap();
        assert_eq!(content, format!("plain.jar\nlisted.jar\n{}\n", case.ours()));
        let second = case.run(&[first.jvm[0].as_str()], &[], ';').unwrap();
        assert_eq!(second.jvm, first.jvm);
        assert_eq!(fs::read_to_string(single_jvm_value(&second, "fabric.addMods").strip_prefix('@').unwrap()).unwrap(), content);
    }

    #[test]
    fn fabric_reports_an_unreadable_user_list_file() {
        let case = fabric_case();
        let error = case.run(&["-Dfabric.addMods=@missing.txt"], &[], ';').unwrap_err();
        assert!(matches!(error, ArgsError::ListFileUnreadable { .. }), "{error}");
    }

    #[test]
    fn fabric_falls_back_to_a_list_file_when_our_path_contains_the_separator() {
        let case = fabric_case();
        let args = case.run(&[], &[], SEPARATOR_IN_EVERY_TEST_PATH).unwrap();
        let value = single_jvm_value(&args, "fabric.addMods");
        assert!(value.starts_with('@'), "{value}");
    }

    // --- fmlMavenRoot ----------------------------------------------------------------------------------------

    fn maven_case() -> Case {
        Case::new(Loader::Neoforge, Strategy::FmlMavenRoot)
    }

    fn maven_game_args(case: &Case) -> Vec<String> {
        let root = case.jar.maven_root().unwrap().to_str().unwrap().to_owned();
        vec!["--fml.mavenRoots".to_owned(), root, "--fml.mods".to_owned(), "dev.laux.pumpkin:pumpkin_friends:2.1.0".to_owned()]
    }

    #[test]
    fn maven_root_passes_root_and_coordinate_as_game_arguments() {
        let case = maven_case();
        let args = case.run(&["-Xmx2G"], &["--demo"], ';').unwrap();
        assert_eq!(args.game, maven_game_args(&case));
        assert!(args.jvm.is_empty());
        assert_eq!((args.user_jvm, args.user_game, args.replaced), (strings(&["-Xmx2G"]), strings(&["--demo"]), vec![]));
    }

    #[test]
    fn maven_root_keeps_user_options_of_the_same_name_with_other_values() {
        let case = maven_case();
        let user = ["--fml.mavenRoots", "/their/repo", "--fml.mods", "their:mod:1.0"];
        let args = case.run(&[], &user, ';').unwrap();
        assert_eq!(args.user_game, strings(&user));
        assert!(args.replaced.is_empty());
    }

    #[test]
    fn maven_root_drops_a_leftover_pair_of_ours_so_that_running_twice_does_not_duplicate() {
        let case = maven_case();
        let ours = maven_game_args(&case);
        let mut user: Vec<&str> = ours.iter().map(String::as_str).collect();
        user.extend(["--demo"]);
        let args = case.run(&[], &user, ';').unwrap();
        assert_eq!(args.game, ours);
        assert_eq!(args.user_game, strings(&["--demo"]));
        assert_eq!(args.replaced.len(), 2);
    }

    #[test]
    fn maven_root_also_drops_the_equals_form_of_our_options() {
        let case = maven_case();
        let ours = maven_game_args(&case);
        let user = [format!("--fml.mavenRoots={}", ours[1]), format!("--fml.mods={}", ours[3]), "--x".to_owned()];
        let user: Vec<&str> = user.iter().map(String::as_str).collect();
        let args = case.run(&[], &user, ';').unwrap();
        assert_eq!(args.user_game, strings(&["--x"]));
        assert_eq!(args.replaced.len(), 2);
    }

    // --- fmlModFolders ---------------------------------------------------------------------------------------

    fn folders_case() -> Case {
        Case::new(Loader::Neoforge, Strategy::FmlModFolders)
    }

    #[test]
    fn mod_folders_without_user_property_labels_the_jar() {
        let case = folders_case();
        let args = case.run(&["-Xmx2G"], &[], ';').unwrap();
        assert_eq!(args.jvm, vec![format!("-Dfml.modFolders=pumpkin%%{}", case.ours())]);
        assert!(args.game.is_empty());
        assert_eq!(args.user_jvm, strings(&["-Xmx2G"]));
    }

    #[test]
    fn mod_folders_appends_to_the_users_value_exactly_once_and_is_idempotent() {
        let case = folders_case();
        let first = case.run(&["-Dfml.modFolders=dev%%C:\\dev\\classes;dev%%C:\\dev\\res"], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&first, "fml.modFolders"), format!("dev%%C:\\dev\\classes;dev%%C:\\dev\\res;pumpkin%%{}", case.ours()));
        assert_eq!(first.replaced.len(), 1);
        let second = case.run(&[first.jvm[0].as_str()], &[], ';').unwrap();
        assert_eq!(second.jvm, first.jvm);
    }

    #[test]
    fn mod_folders_collapses_duplicate_properties_like_the_jvm() {
        let case = folders_case();
        let args = case.run(&["-Dfml.modFolders=a%%1", "-Dfml.modFolders=b%%2"], &[], ';').unwrap();
        assert_eq!(single_jvm_value(&args, "fml.modFolders"), format!("b%%2;pumpkin%%{}", case.ours()));
        assert!(args.user_jvm.is_empty());
    }

    #[test]
    fn mod_folders_refuses_a_path_that_would_break_the_list() {
        let case = folders_case();
        let error = case.run(&[], &[], SEPARATOR_IN_EVERY_TEST_PATH).unwrap_err();
        assert!(matches!(error, ArgsError::PathHasListSeparator(_)), "{error}");
    }

    // --- Hilfen ----------------------------------------------------------------------------------------------

    #[test]
    fn option_removal_handles_pairs_joined_forms_and_dangling_names() {
        let args = strings(&["--a", "v", "--a", "w", "--a=v", "--a"]);
        let (kept, removed) = without_option(&args, "--a", "v");
        assert_eq!(kept, strings(&["--a", "w", "--a"]));
        assert_eq!(removed, strings(&["--a v", "--a=v"]));
    }

    #[test]
    fn the_shared_list_file_name_follows_its_content() {
        let case = fabric_case();
        let one = write_shared_list_file(case.data.path(), &strings(&["a.jar"])).unwrap();
        let again = write_shared_list_file(case.data.path(), &strings(&["a.jar"])).unwrap();
        let other = write_shared_list_file(case.data.path(), &strings(&["b.jar"])).unwrap();
        assert_eq!(one, again);
        assert_ne!(one, other);
    }
}
