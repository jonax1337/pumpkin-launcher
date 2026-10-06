//! Systemeigenschaften (`-Dname=Wert`) in den JVM-Argumenten des Nutzers finden. Die Einspeisung setzt
//! Eigenschaften, die eine Pfadliste tragen; setzt der Nutzer dieselbe, gewinnt in der JVM das letzte Vorkommen und
//! verdrängt entweder seinen oder unseren Wert. Deshalb wird sein Wert gelesen und mit unserem verbunden.

/// Was der Nutzer zu einer Systemeigenschaft angegeben hat.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct UserProperty {
    /// Die Einträge der Pfadliste, die in der JVM gelten würden: die des **letzten** Vorkommens, denn so wertet
    /// die JVM mehrfach gesetzte Eigenschaften aus.
    pub entries: Vec<String>,
    /// Die Argumente ohne jedes Vorkommen der Eigenschaft, in ihrer Reihenfolge.
    pub remaining: Vec<String>,
    /// Alle Argumente, die die Eigenschaft setzten (im Wortlaut, auch mit Anführungszeichen).
    pub replaced: Vec<String>,
}

/// Sucht `-D<name>` in `args`; `separator` trennt die Pfadliste des Werts.
pub(super) fn find(args: &[String], name: &str, separator: char) -> UserProperty {
    let mut property = UserProperty::default();
    for arg in args {
        match value_of(arg, name) {
            Some(value) => {
                property.entries = split_list(value, separator);
                property.replaced.push(arg.clone());
            }
            None => property.remaining.push(arg.clone()),
        }
    }
    property
}

/// Der Wert, wenn `arg` die Eigenschaft `name` setzt (`-Dname=Wert` oder `-Dname`, auch von Anführungszeichen
/// umschlossen). Eine Eigenschaft mit längerem Namen (`-Dname2=...`) ist nicht gemeint.
fn value_of<'a>(arg: &'a str, name: &str) -> Option<&'a str> {
    let rest = unquote(arg).strip_prefix("-D")?.strip_prefix(name)?;
    match rest.strip_prefix('=') {
        Some(value) => Some(value),
        None if rest.is_empty() => Some(""),
        None => None,
    }
}

fn split_list(value: &str, separator: char) -> Vec<String> {
    unquote(value)
        .split(separator)
        .map(unquote)
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Entfernt Leerraum und ein Paar gleicher Anführungszeichen außen. Enthält der Text innen dasselbe Zeichen noch
/// einmal (`"a";"b"`), gehören die äußeren nicht zusammen und bleiben stehen.
pub(super) fn unquote(text: &str) -> &str {
    let text = text.trim();
    for quote in ['"', '\''] {
        let inner = text
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote));
        if let Some(inner) = inner.filter(|inner| !inner.contains(quote)) {
            return inner.trim();
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_owned()).collect()
    }

    fn entries(list: &[&str]) -> Vec<String> {
        args(list)
    }

    #[test]
    fn without_the_property_everything_remains() {
        let found = find(&args(&["-Xmx2G", "-Dother=1"]), "fabric.addMods", ';');
        assert_eq!(
            found,
            UserProperty {
                entries: vec![],
                remaining: args(&["-Xmx2G", "-Dother=1"]),
                replaced: vec![]
            }
        );
    }

    #[test]
    fn a_plain_value_is_split_at_the_separator() {
        let found = find(
            &args(&["-Xmx2G", r"-Dfabric.addMods=C:\a.jar;C:\b.jar", "-Dx=1"]),
            "fabric.addMods",
            ';',
        );
        assert_eq!(found.entries, entries(&[r"C:\a.jar", r"C:\b.jar"]));
        assert_eq!(found.remaining, args(&["-Xmx2G", "-Dx=1"]));
        assert_eq!(
            found.replaced,
            args(&[r"-Dfabric.addMods=C:\a.jar;C:\b.jar"])
        );
    }

    #[test]
    fn the_separator_decides_how_a_unix_list_is_split() {
        let found = find(
            &args(&["-Dfabric.addMods=/a.jar:/b.jar"]),
            "fabric.addMods",
            ':',
        );
        assert_eq!(found.entries, entries(&["/a.jar", "/b.jar"]));
    }

    #[test]
    fn the_last_occurrence_wins_like_in_the_jvm_and_all_are_replaced() {
        let found = find(
            &args(&[
                "-Dfabric.addMods=a.jar",
                "-Xss1M",
                "-Dfabric.addMods=b.jar;c.jar",
                "-Dfabric.addMods=d.jar",
            ]),
            "fabric.addMods",
            ';',
        );
        assert_eq!(found.entries, entries(&["d.jar"]));
        assert_eq!(found.remaining, args(&["-Xss1M"]));
        assert_eq!(found.replaced.len(), 3);
    }

    #[test]
    fn quotes_around_the_argument_or_the_value_or_an_entry_are_dropped() {
        let cases = [
            r#""-Dfabric.addMods=C:\a b\x.jar""#,
            r#"-Dfabric.addMods="C:\a b\x.jar""#,
            r#"-Dfabric.addMods="C:\a b\x.jar";"#,
            r#"'-Dfabric.addMods=C:\a b\x.jar'"#,
            r#"-Dfabric.addMods=  "C:\a b\x.jar"  "#,
        ];
        for case in cases {
            let found = find(&args(&[case]), "fabric.addMods", ';');
            assert_eq!(found.entries, entries(&[r"C:\a b\x.jar"]), "{case}");
            assert_eq!(found.replaced.len(), 1, "{case}");
        }
    }

    #[test]
    fn a_whole_quoted_list_is_split_but_separately_quoted_entries_stay_apart() {
        let whole = find(
            &args(&[r#"-Dfabric.addMods="C:\a.jar;C:\b.jar""#]),
            "fabric.addMods",
            ';',
        );
        assert_eq!(whole.entries, entries(&[r"C:\a.jar", r"C:\b.jar"]));
        let separate = find(
            &args(&[r#"-Dfabric.addMods="C:\a.jar";"C:\b.jar""#]),
            "fabric.addMods",
            ';',
        );
        assert_eq!(separate.entries, entries(&[r"C:\a.jar", r"C:\b.jar"]));
    }

    #[test]
    fn empty_entries_and_an_empty_value_give_an_empty_list_but_still_replace() {
        for case in [
            "-Dfabric.addMods=",
            "-Dfabric.addMods",
            "-Dfabric.addMods=;;",
            r#"-Dfabric.addMods="""#,
        ] {
            let found = find(&args(&[case]), "fabric.addMods", ';');
            assert!(found.entries.is_empty(), "{case}");
            assert_eq!(found.replaced, args(&[case]));
        }
    }

    #[test]
    fn properties_with_other_names_are_left_alone() {
        let others = args(&[
            "-Dfabric.addModsExtra=x",
            "-Dfabric.addMod=x",
            "-fabric.addMods=x",
            "--fabric.addMods=x",
            "fabric.addMods=x",
            "-dfabric.addMods=x",
        ]);
        let found = find(&others, "fabric.addMods", ';');
        assert_eq!(found.remaining, others);
        assert!(found.replaced.is_empty());
    }
}
