//! Versionsbedingungen aus Mod-Metadaten gegen eine Minecraft-Version: Semver-Bedingungen von Fabric und Quilt,
//! Maven-Bereiche von Forge und NeoForge. `None` heißt unbekannt (Snapshots, ungewohnte Schreibweise): dann gibt es
//! keine Warnung.
use std::cmp::Ordering;

/// Release-Version wie `1.21.1` als Zahlenreihe; Snapshots und anderes sind keine.
fn parse_release(version: &str) -> Option<Vec<u64>> {
    version.split('.').map(|part| part.parse().ok()).collect()
}

/// Vergleicht Zahlenreihen, die kürzere mit Nullen aufgefüllt (`1.21` ist `1.21.0`).
fn compare(a: &[u64], b: &[u64]) -> Ordering {
    let len = a.len().max(b.len());
    (0..len)
        .map(|i| a.get(i).unwrap_or(&0).cmp(b.get(i).unwrap_or(&0)))
        .find(|order| order.is_ne())
        .unwrap_or(Ordering::Equal)
}

/// Eines trifft zu: `Some(true)`; sonst unbekannt, wenn eines unbekannt ist, sonst `Some(false)`.
fn any_of(results: impl Iterator<Item = Option<bool>>) -> Option<bool> {
    let mut unknown = false;
    for result in results {
        match result {
            Some(true) => return Some(true),
            None => unknown = true,
            Some(false) => {}
        }
    }
    (!unknown).then_some(false)
}

/// Alle treffen zu: `Some(true)`; sonst `Some(false)`, wenn eines nicht zutrifft, sonst unbekannt.
fn all_of(results: impl Iterator<Item = Option<bool>>) -> Option<bool> {
    let mut unknown = false;
    for result in results {
        match result {
            Some(false) => return Some(false),
            None => unknown = true,
            Some(true) => {}
        }
    }
    (!unknown).then_some(true)
}

/// Bedingungen von Fabric und Quilt (`>=1.21 <1.22`, `~1.21.1`, `1.21.x`, `*`): Leerzeichen heißt „und“, `||` und
/// mehrere Einträge heißen „oder“.
pub(super) fn semver_matches(ranges: &[String], version: &str) -> Option<bool> {
    let mc = parse_release(version)?;
    any_of(ranges.iter().flat_map(|range| range.split("||")).map(|alternative| {
        all_of(alternative.split_whitespace().map(|comparator| comparator_matches(comparator, &mc)))
    }))
}

#[derive(Clone, Copy)]
enum Operator {
    Equal,
    AtLeast,
    More,
    AtMost,
    Less,
    Tilde,
    Caret,
}

const OPERATORS: [(&str, Operator); 7] = [
    (">=", Operator::AtLeast),
    ("<=", Operator::AtMost),
    (">", Operator::More),
    ("<", Operator::Less),
    ("=", Operator::Equal),
    ("~", Operator::Tilde),
    ("^", Operator::Caret),
];

fn comparator_matches(token: &str, mc: &[u64]) -> Option<bool> {
    let (operator, version) = OPERATORS
        .iter()
        .find_map(|(prefix, operator)| token.strip_prefix(prefix).map(|rest| (*operator, rest)))
        .unwrap_or((Operator::Equal, token));
    // Eine Vorabversion (`1.21-beta`) zählt wie ihre Release-Zahl.
    let parts: Vec<Option<u64>> = version
        .split('-')
        .next()?
        .split('.')
        .map(|part| match part {
            "x" | "X" | "*" => Some(None),
            number => number.parse().ok().map(Some),
        })
        .collect::<Option<_>>()?;
    let concrete: Vec<u64> = parts.iter().map(|part| part.unwrap_or(0)).collect();
    Some(match operator {
        Operator::Equal => matches_prefix(&parts, mc),
        Operator::AtLeast => compare(mc, &concrete).is_ge(),
        Operator::More => compare(mc, &concrete).is_gt(),
        Operator::AtMost => compare(mc, &concrete).is_le(),
        Operator::Less => compare(mc, &concrete).is_lt(),
        Operator::Tilde => within(mc, &concrete, parts.len().min(2) - 1),
        Operator::Caret => within(mc, &concrete, 0),
    })
}

/// Jede genannte Stelle stimmt (`x` passt immer); ohne Platzhalter muss die Version genau gleich sein.
fn matches_prefix(parts: &[Option<u64>], mc: &[u64]) -> bool {
    if parts.iter().all(Option::is_some) {
        let exact: Vec<u64> = parts.iter().flatten().copied().collect();
        return compare(mc, &exact).is_eq();
    }
    parts.iter().enumerate().all(|(i, part)| part.is_none_or(|n| mc.get(i).unwrap_or(&0) == &n))
}

/// Ab `lower` (einschließlich) bis zur nächsten Zahl an Stelle `bumped` (ausschließlich).
fn within(mc: &[u64], lower: &[u64], bumped: usize) -> bool {
    let mut upper: Vec<u64> = lower.iter().take(bumped + 1).copied().collect();
    upper.resize(bumped + 1, 0);
    upper[bumped] += 1;
    compare(mc, lower).is_ge() && compare(mc, &upper).is_lt()
}

/// Maven-Bereiche von Forge und NeoForge (`[1.20.1,1.21)`, `[1.20,)`). Eine bloße Version ist dort nur eine
/// Empfehlung und schränkt nichts ein.
pub(super) fn maven_matches(range: &str, version: &str) -> Option<bool> {
    let mc = parse_release(version)?;
    if !range.trim_start().starts_with(['[', '(']) {
        return Some(true);
    }
    any_of(intervals(range).into_iter().map(|interval| interval_contains(interval, &mc)))
}

/// Die Intervalle eines Bereichs wie `[1.20,1.21),[1.21.2,)`, je mit ihren Klammern.
fn intervals(range: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut open = None;
    for (at, c) in range.char_indices() {
        match c {
            '[' | '(' => open = Some(at),
            ']' | ')' => found.extend(open.take().map(|start| &range[start..=at])),
            _ => {}
        }
    }
    found
}

fn interval_contains(interval: &str, mc: &[u64]) -> Option<bool> {
    let inner = &interval[1..interval.len() - 1];
    let (lower, upper) = inner.split_once(',').map_or((inner, inner), |(lower, upper)| (lower, upper));
    let above = bound(lower.trim(), interval.starts_with('['), mc, Ordering::Greater)?;
    let below = bound(upper.trim(), interval.ends_with(']'), mc, Ordering::Less)?;
    Some(above && below)
}

/// Liegt `mc` auf der Seite `side` der Grenze (bei `inclusive` auch auf ihr)? Keine Grenze lässt alles zu.
fn bound(limit: &str, inclusive: bool, mc: &[u64], side: Ordering) -> Option<bool> {
    if limit.is_empty() {
        return Some(true);
    }
    let order = compare(mc, &parse_release(limit)?);
    Some(order == side || (inclusive && order.is_eq()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn semver(range: &str, version: &str) -> Option<bool> {
        semver_matches(&[range.to_owned()], version)
    }

    #[test]
    fn fabric_ranges_follow_semver() {
        assert_eq!(semver("*", "1.21.1"), Some(true));
        assert_eq!(semver("1.21.1", "1.21.1"), Some(true));
        assert_eq!(semver("1.21", "1.21.1"), Some(false));
        assert_eq!(semver("1.21.x", "1.21.4"), Some(true));
        assert_eq!(semver("1.21.x", "1.20.4"), Some(false));
        assert_eq!(semver(">=1.20.5 <1.21.2", "1.21.1"), Some(true));
        assert_eq!(semver(">=1.20.5 <1.21.2", "1.21.2"), Some(false));
        assert_eq!(semver(">1.20", "1.20"), Some(false));
        assert_eq!(semver("<=1.20.1", "1.20.1"), Some(true));
        assert_eq!(semver(">=1.20.5-", "1.21"), Some(true));
    }

    #[test]
    fn tilde_and_caret_bound_the_upper_end() {
        assert_eq!(semver("~1.21", "1.21.4"), Some(true));
        assert_eq!(semver("~1.21", "1.22"), Some(false));
        assert_eq!(semver("~1.21.1", "1.21.0"), Some(false));
        assert_eq!(semver("~1", "1.21.1"), Some(true));
        assert_eq!(semver("~1", "2.0"), Some(false));
        assert_eq!(semver("^1.20", "1.21.1"), Some(true));
        assert_eq!(semver("^1.20", "2.0"), Some(false));
    }

    #[test]
    fn alternatives_are_or_and_unknown_stays_unknown() {
        assert_eq!(semver_matches(&["1.20.1".into(), "1.21.1".into()], "1.21.1"), Some(true));
        assert_eq!(semver("1.20.1 || 1.21.1", "1.21.1"), Some(true));
        assert_eq!(semver_matches(&["1.20.1".into(), "1.20.4".into()], "1.21.1"), Some(false));
        assert_eq!(semver("1.20.1 || banana", "1.21.1"), None);
        assert_eq!(semver("1.20.1 || banana", "1.20.1"), Some(true));
        assert_eq!(semver("banana", "1.21.1"), None);
        assert_eq!(semver("1.21.1", "24w14a"), None);
    }

    #[test]
    fn maven_ranges_have_open_and_closed_ends() {
        assert_eq!(maven_matches("[1.20.1,1.21)", "1.20.4"), Some(true));
        assert_eq!(maven_matches("[1.20.1,1.21)", "1.21"), Some(false));
        assert_eq!(maven_matches("[1.20.1,1.21]", "1.21"), Some(true));
        assert_eq!(maven_matches("(1.20.1,)", "1.20.1"), Some(false));
        assert_eq!(maven_matches("[1.20,)", "1.21.1"), Some(true));
        assert_eq!(maven_matches("(,1.21]", "1.21.1"), Some(false));
        assert_eq!(maven_matches("[1.21.1]", "1.21.1"), Some(true));
        assert_eq!(maven_matches("[1.20,1.21),[1.21.2,)", "1.21.1"), Some(false));
        assert_eq!(maven_matches("[1.20,1.21),[1.21.2,)", "1.21.3"), Some(true));
    }

    #[test]
    fn a_bare_maven_version_is_only_a_recommendation() {
        assert_eq!(maven_matches("1.20.1", "1.21.1"), Some(true));
        assert_eq!(maven_matches("[banana,)", "1.21.1"), None);
    }
}
