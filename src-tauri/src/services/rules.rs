//! Auswertung der Mojang-`rules` an Libraries und Argumenten (Format der Versions-JSON).
use std::collections::HashMap;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Disallow,
}

// ponytail: `os.version` (Regex) und `os.versionRange` werden ignoriert, d. h. als passend
// gewertet. Betrifft nur OS-Versions-Sonderfälle (z. B. alte Windows-Builds); bei Bedarf
// die Windows-Build-Nummer ermitteln und hier vergleichen.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub action: Action,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: HashMap<String, bool>,
}

/// Plattform, gegen die Regeln ausgewertet werden. `os` in Mojang-Schreibweise
/// (`windows`/`osx`/`linux`), `arch` wie `std::env::consts::ARCH`.
#[derive(Debug, Clone)]
pub struct Env {
    pub os: &'static str,
    pub arch: &'static str,
    /// Aktive Launcher-Features (`is_demo_user`, `has_custom_resolution`, …).
    pub features: Vec<&'static str>,
}

impl Env {
    pub fn current() -> Self {
        let os = match std::env::consts::OS {
            "windows" => "windows",
            "macos" => "osx",
            _ => "linux",
        };
        Self { os, arch: std::env::consts::ARCH, features: Vec::new() }
    }

    /// Trenner im Java-Classpath (`${classpath_separator}`).
    pub fn classpath_separator(&self) -> &'static str {
        if self.os == "windows" { ";" } else { ":" }
    }
}

impl Rule {
    fn matches(&self, env: &Env) -> bool {
        let os_ok = self.os.as_ref().is_none_or(|os| {
            os.name.as_deref().is_none_or(|n| n == env.os) && os.arch.as_deref().is_none_or(|a| a == env.arch)
        });
        os_ok && self.features.iter().all(|(k, v)| env.features.contains(&k.as_str()) == *v)
    }
}

/// Keine Regeln = erlaubt. Sonst gilt die Aktion der letzten passenden Regel, ohne Treffer verboten.
pub fn allowed(rules: &[Rule], env: &Env) -> bool {
    rules.is_empty() || rules.iter().rfind(|r| r.matches(env)).is_some_and(|r| r.action == Action::Allow)
}

/// Ob ein Natives-Classifier (`natives-windows`, `natives-windows-arm64`, `natives-windows-x86`, …)
/// zur Architektur passt. Ohne Arch-Suffix ist x86_64 gemeint. Nötig, weil Mojang alle
/// Windows-Varianten mit derselben OS-Regel ausliefert und die DLLs beim Entpacken gleich heißen.
pub fn native_classifier_matches(classifier: &str, env: &Env) -> bool {
    let suffix = classifier.strip_prefix("natives-").and_then(|rest| rest.split_once('-')).map(|(_, s)| s);
    let arch = match suffix {
        None | Some("64") => "x86_64",
        Some("x86" | "32") => "x86",
        Some("arm64" | "aarch64") => "aarch64",
        Some("arm32") => "arm",
        Some(_) => return true, // z. B. `natives-macos-patch`
    };
    arch == env.arch
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(os: &'static str, arch: &'static str) -> Env {
        Env { os, arch, features: Vec::new() }
    }

    fn rules(json: &str) -> Vec<Rule> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn os_and_arch_rules() {
        let win = env("windows", "x86_64");
        let mac = env("osx", "aarch64");
        assert!(allowed(&[], &win));

        let only_osx = rules(r#"[{"action":"allow","os":{"name":"osx"}}]"#);
        assert!(!allowed(&only_osx, &win));
        assert!(allowed(&only_osx, &mac));

        let all_but_osx = rules(r#"[{"action":"allow"},{"action":"disallow","os":{"name":"osx"}}]"#);
        assert!(allowed(&all_but_osx, &win));
        assert!(!allowed(&all_but_osx, &mac));

        let x86 = rules(r#"[{"action":"allow","os":{"arch":"x86"}}]"#);
        assert!(!allowed(&x86, &win));
        assert!(allowed(&x86, &env("windows", "x86")));

        // Unbekannte Felder (versionRange) stören nicht und werden als passend gewertet.
        let range = rules(r#"[{"action":"allow","os":{"name":"windows","versionRange":{"min":"10.0.17134"}}}]"#);
        assert!(allowed(&range, &win));
    }

    #[test]
    fn feature_rules() {
        let demo = rules(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#);
        let mut e = env("linux", "x86_64");
        assert!(!allowed(&demo, &e));
        e.features.push("is_demo_user");
        assert!(allowed(&demo, &e));
    }

    #[test]
    fn native_classifiers() {
        let x64 = env("windows", "x86_64");
        let arm = env("windows", "aarch64");
        assert!(native_classifier_matches("natives-windows", &x64));
        assert!(!native_classifier_matches("natives-windows-x86", &x64));
        assert!(!native_classifier_matches("natives-windows-arm64", &x64));
        assert!(native_classifier_matches("natives-windows-arm64", &arm));
        assert!(!native_classifier_matches("natives-windows", &arm));
        assert!(native_classifier_matches("natives-windows-64", &x64));
        assert!(native_classifier_matches("natives-macos-patch", &arm));
    }

    #[test]
    fn native_classifiers_on_macos_and_linux() {
        let apple_silicon = env("osx", "aarch64");
        let intel_mac = env("osx", "x86_64");
        assert!(native_classifier_matches("natives-macos-arm64", &apple_silicon));
        assert!(!native_classifier_matches("natives-macos", &apple_silicon));
        assert!(native_classifier_matches("natives-macos", &intel_mac));
        assert!(!native_classifier_matches("natives-macos-arm64", &intel_mac));
        assert!(native_classifier_matches("natives-linux", &env("linux", "x86_64")));
        assert!(native_classifier_matches("natives-linux-aarch64", &env("linux", "aarch64")));
    }

    #[test]
    fn classpath_separator_per_os() {
        assert_eq!(env("windows", "x86_64").classpath_separator(), ";");
        assert_eq!(env("linux", "x86_64").classpath_separator(), ":");
        assert_eq!(env("osx", "aarch64").classpath_separator(), ":");
    }
}
