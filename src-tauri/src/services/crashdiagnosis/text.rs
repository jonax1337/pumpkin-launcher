//! Hilfen der Regeln: Zeilen eines Berichts finden, als Beleg kürzen und Werte hinter einem Marker lesen. Alles arbeitet
//! auf `char`-Grenzen und nie mit Byte-Positionen von außen, damit beliebiger Text keinen Panic auslöst.

/// So viele Zeilen zeigt ein Beleg höchstens.
const MAX_EVIDENCE_LINES: usize = 3;
/// Längere Zeilen (Stacktraces mit Pfaden) werden für die Anzeige gekürzt.
const MAX_EVIDENCE_CHARS: usize = 240;

pub(super) fn contains_any(haystack: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| haystack.contains(marker))
}

/// Die ersten Zeilen, für die `matches` gilt, gekürzt und ohne Doppelte.
pub(super) fn evidence_where(text: &str, matches: impl Fn(&str) -> bool) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| matches(line)) {
        let shown = excerpt(line);
        if !found.contains(&shown) {
            found.push(shown);
        }
        if found.len() == MAX_EVIDENCE_LINES {
            break;
        }
    }
    found
}

/// Die ersten Zeilen, die einen der `markers` enthalten.
pub(super) fn evidence_containing(text: &str, markers: &[&str]) -> Vec<String> {
    evidence_where(text, |line| contains_any(line, markers))
}

/// Die erste Zeile mit einer Ausnahme oder einem Fehler, die keine Stacktrace-Zeile ist.
pub(super) fn first_exception_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.starts_with("at ") && (line.contains("Exception") || line.contains("Error")))
        .map(excerpt)
}

fn excerpt(line: &str) -> String {
    let mut chars = line.trim().chars();
    let head: String = chars.by_ref().take(MAX_EVIDENCE_CHARS).collect();
    if chars.next().is_some() { head + "…" } else { head }
}

/// Die Zeilen ab der ersten mit einem der `markers` bis `after` Zeilen danach (dort stehen die Einzelheiten).
pub(super) fn block_after<'a>(text: &'a str, markers: &[&str], after: usize) -> Vec<&'a str> {
    let mut lines = text.lines();
    let Some(first) = lines.by_ref().find(|line| contains_any(line, markers)) else { return Vec::new() };
    std::iter::once(first).chain(lines.take(after)).collect()
}

/// Das erste Wort hinter `marker`, ohne Satzzeichen an den Rändern: „for mod lithium failed“ → „lithium“.
pub(super) fn word_after<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    let word = line.split_once(marker)?.1.split_whitespace().next()?.trim_matches(|c: char| !c.is_alphanumeric());
    (!word.is_empty()).then_some(word)
}

/// Der Text in einfachen Anführungszeichen direkt hinter `marker`, der selbst das öffnende Zeichen enthält:
/// `Mod ID: 'flywheel'` mit dem Marker `Mod ID: '` → „flywheel“.
pub(super) fn quoted_after<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    line.split_once(marker)?.1.split('\'').next().filter(|value| !value.is_empty())
}

/// Zeichen, aus denen die Kennung eines Mods besteht.
pub(super) fn is_mod_id_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_is_trimmed_distinct_and_limited() {
        let text = "  a boom \na boom\nb boom\nc boom\nd boom\nno";
        assert_eq!(evidence_containing(text, &["boom"]), ["a boom", "b boom", "c boom"]);
    }

    #[test]
    fn long_lines_are_cut_on_a_character_boundary() {
        let line = "ä".repeat(MAX_EVIDENCE_CHARS + 10);
        let shown = excerpt(&line);
        assert_eq!(shown.chars().count(), MAX_EVIDENCE_CHARS + 1);
        assert!(shown.ends_with('…'));
        assert_eq!(excerpt("  kurz  "), "kurz");
    }

    #[test]
    fn the_first_exception_skips_stacktrace_frames() {
        let text = "Time: now\n\tat java.lang.Foo.bar(Foo.java:1) throws IOException\njava.lang.IllegalStateException: no\n";
        assert_eq!(first_exception_line(text).as_deref(), Some("java.lang.IllegalStateException: no"));
        assert_eq!(first_exception_line("alles gut"), None);
    }

    #[test]
    fn a_block_runs_from_the_marker_for_a_number_of_lines() {
        let text = "x\nFound duplicate mods:\n  a.jar\n  b.jar\n  c.jar\n";
        assert_eq!(block_after(text, &["duplicate mods"], 2), ["Found duplicate mods:", "  a.jar", "  b.jar"]);
        assert!(block_after(text, &["fehlt"], 2).is_empty());
    }

    #[test]
    fn words_and_quotes_are_read_after_their_marker() {
        assert_eq!(word_after("Mixin apply for mod lithium failed x", "for mod "), Some("lithium"));
        assert_eq!(word_after("from mod 'sodium',", "from mod "), Some("sodium"));
        assert_eq!(word_after("for mod ", "for mod "), None);
        assert_eq!(quoted_after("Mod ID: 'flywheel', Requested by: 'create'", "Requested by: '"), Some("create"));
        assert_eq!(quoted_after("Mod ID: ''", "Mod ID: '"), None);
    }

    #[test]
    fn arbitrary_text_never_panics() {
        let noise = "\u{0}\u{fffd}ä€𝄞 Mod ID: ' (\n\r\n for mod ";
        assert!(evidence_containing(noise, &["Mod"]).len() <= MAX_EVIDENCE_LINES);
        assert_eq!(word_after(noise, "for mod "), None);
        assert_eq!(quoted_after(noise, "Mod ID: '"), Some(" (\n\r\n for mod "));
    }
}
