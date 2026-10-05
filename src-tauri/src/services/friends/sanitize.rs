//! Bereinigung aller Texte, die ein anderer Launcher oder die Mod schickt (SPEC 12.3). Jeder Fremdtext läuft hier
//! durch, bevor er gespeichert, angezeigt oder weitergereicht wird. Die Mod bereinigt nach denselben Regeln.
use unicode_normalization::UnicodeNormalization;

use super::contract::ALIAS_MAX;
use super::identity::short_id;

const WORLD_NAME_MAX: usize = 64;
const FILE_NAME_MAX: usize = 128;
const MC_NAME_MAX: usize = 16;
const MC_UUID_LEN: usize = 32;
const PEER_NAME_MAX: usize = 32;

/// Anzeigename eines Peers, höchstens 32 Zeichen; ein leerer Name wird zu `#` und den ersten 8 Zeichen der Peer-ID.
pub fn display_name(raw: &str, peer_id: &str) -> String {
    let name = capped(raw, PEER_NAME_MAX);
    if name.is_empty() {
        format!("#{}", short_id(peer_id))
    } else {
        name
    }
}

/// Welt- und Instanzname, höchstens 64 Zeichen.
pub fn world_or_instance_name(raw: &str) -> String {
    capped(raw, WORLD_NAME_MAX)
}

/// Dateiname einer Mod, nur zur Anzeige, höchstens 128 Zeichen.
pub fn file_name(raw: &str) -> String {
    capped(raw, FILE_NAME_MAX)
}

/// Eigener Spitzname für einen Freund, höchstens 32 Zeichen; leer heißt: kein Spitzname.
pub fn alias(raw: &str) -> Option<String> {
    Some(capped(raw, ALIAS_MAX)).filter(|alias| !alias.is_empty())
}

/// Ein Minecraft-Name hat 1 bis 16 Zeichen aus `A-Za-z0-9_`, sonst gilt er als nicht angegeben.
pub fn mc_name(raw: Option<&str>) -> Option<String> {
    raw.filter(|name| {
        (1..=MC_NAME_MAX).contains(&name.len())
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    })
    .map(str::to_owned)
}

/// Eine Minecraft-UUID besteht aus 32 Hex-Zeichen in Kleinbuchstaben, sonst gilt sie als nicht angegeben.
pub fn mc_uuid(raw: Option<&str>) -> Option<String> {
    raw.filter(|uuid| {
        uuid.len() == MC_UUID_LEN && uuid.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
    .map(str::to_owned)
}

/// NFC, unsichtbare und steuernde Zeichen weg, Leerraum zusammengezogen und gekürzt.
fn clean(raw: &str) -> String {
    let visible: String = raw.nfc().filter(|c| !is_invisible(*c)).collect();
    visible.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn capped(raw: &str, max_chars: usize) -> String {
    let cut: String = clean(raw).chars().take(max_chars).collect();
    cut.trim_end().to_owned()
}

/// Steuerzeichen, `§` (Minecraft-Formatierung) und Zeichen, die Text umordnen, verstecken oder unsichtbar füllen.
fn is_invisible(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{00A7}'
                | '\u{00AD}'
                | '\u{061C}'
                | '\u{180E}'
                | '\u{200B}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{206F}'
                | '\u{FEFF}'
                | '\u{FFF9}'..='\u{FFFB}'
                | '\u{E0001}'
                | '\u{E0020}'..='\u{E007F}'
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PEER: &str = "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7";

    fn name(raw: &str) -> String {
        display_name(raw, PEER)
    }

    #[test]
    fn plain_names_stay_unchanged() {
        assert_eq!(name("Alex"), "Alex");
        assert_eq!(name("Jörg Müller"), "Jörg Müller");
    }

    #[test]
    fn formatting_sign_and_controls_are_removed() {
        assert_eq!(name("§cAlex§r"), "cAlexr");
        assert_eq!(name("Al\u{0}ex\u{7}"), "Alex");
    }

    #[test]
    fn bidi_and_zero_width_characters_are_removed() {
        let tricks = [
            "\u{202E}",
            "\u{202A}",
            "\u{2066}",
            "\u{2069}",
            "\u{200B}",
            "\u{200F}",
            "\u{FEFF}",
            "\u{00AD}",
            "\u{061C}",
            "\u{180E}",
            "\u{2060}",
            "\u{2028}",
            "\u{E0041}",
            "\u{FFF9}",
        ];
        for trick in tricks {
            assert_eq!(
                name(&format!("Al{trick}ex")),
                "Alex",
                "U+{:04X}",
                trick.chars().next().unwrap() as u32
            );
        }
    }

    #[test]
    fn every_listed_range_is_removed_at_both_ends() {
        let ranges = [
            ('\u{200B}', '\u{200F}'),
            ('\u{2028}', '\u{202E}'),
            ('\u{2060}', '\u{2064}'),
            ('\u{2066}', '\u{206F}'),
            ('\u{FFF9}', '\u{FFFB}'),
            ('\u{E0020}', '\u{E007F}'),
        ];
        for (first, last) in ranges {
            assert_eq!(name(&format!("a{first}{last}b")), "ab");
        }
    }

    #[test]
    fn whitespace_runs_collapse_and_trim() {
        assert_eq!(name("  Alex \u{a0}  Bob  "), "Alex Bob");
    }

    #[test]
    fn text_is_normalised_to_nfc() {
        assert_eq!(name("Jose\u{301}"), "Jos\u{e9}");
    }

    #[test]
    fn names_are_cut_by_characters_not_bytes() {
        assert_eq!(name(&"ä".repeat(40)).chars().count(), 32);
        assert_eq!(world_or_instance_name(&"w".repeat(100)).len(), 64);
        assert_eq!(file_name(&"f".repeat(200)).len(), 128);
        assert_eq!(alias(&"a".repeat(50)).unwrap().len(), 32);
    }

    #[test]
    fn a_cut_never_leaves_trailing_space() {
        assert_eq!(name(&format!("{} b", "a".repeat(31))), "a".repeat(31));
    }

    #[test]
    fn empty_display_name_falls_back_to_the_short_peer_id() {
        assert_eq!(name(""), "#3f9ac021");
        assert_eq!(name("\u{202E}\u{200B} §"), "#3f9ac021");
    }

    #[test]
    fn alias_that_is_empty_after_cleaning_is_none() {
        assert_eq!(alias("  \u{200B}"), None);
        assert_eq!(alias("Bea vom Bau").as_deref(), Some("Bea vom Bau"));
    }

    #[test]
    fn mc_name_needs_the_mojang_format() {
        assert_eq!(mc_name(Some("Alex_01")).as_deref(), Some("Alex_01"));
        assert_eq!(
            mc_name(Some(&"a".repeat(16))).as_deref(),
            Some("aaaaaaaaaaaaaaaa")
        );
        for raw in [
            None,
            Some(""),
            Some("a b"),
            Some("Älex"),
            Some("§cAlex"),
            Some(&*"a".repeat(17)),
        ] {
            assert_eq!(mc_name(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn mc_uuid_needs_32_lowercase_hex_chars() {
        let uuid = "069a79f444e94726a5befca90e38aaf5";
        assert_eq!(mc_uuid(Some(uuid)).as_deref(), Some(uuid));
        let dashed = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
        for raw in [
            None,
            Some(""),
            Some(dashed),
            Some(&*uuid.to_uppercase()),
            Some(&uuid[1..]),
            Some("g69a79f444e94726a5befca90e38aaf5"),
        ] {
            assert_eq!(mc_uuid(raw), None, "{raw:?}");
        }
    }
}
