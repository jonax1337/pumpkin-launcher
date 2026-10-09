//! Regelbasierte Diagnose eines Absturzes: Aus dem Absturzbericht (ohne Bericht aus dem Protokoll der letzten Sitzung)
//! einer Instanz entstehen Befunde mit Beleg und konkreten Handgriffen, die die Oberfläche über bestehende Befehle
//! ausführt. Jede Regel ist eine Funktion in einer eigenen Datei; angemeldet wird sie mit einer Zeile in [`RULES`].
//! Das ist ein Hinweis aus Textmustern, kein Urteil.
mod dependency;
mod duplicates;
mod gamefiles;
mod graphics;
mod java_version;
mod memory;
mod mixin;
mod port;
mod source;
mod suspect_mods;
mod text;

use std::collections::BTreeMap;

use serde::Serialize;

use crate::models::{Instance, Mod, ModKind};
use crate::services::crashreport::normalized;
use crate::services::Dirs;

/// Mehr Mods schlägt ein Befund nicht zum Ausschalten vor.
const MAX_DISABLE_ACTIONS: usize = 3;

/// Was ein Befund für den Absturz bedeutet: Fehler (Ursache gefunden), Warnung (wahrscheinlich) oder Hinweis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Ein Handgriff, den die Oberfläche mit bestehenden Befehlen ausführt. Getaggt als `{"type": "raiseMemory", "suggestedMb": …}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FixAction {
    /// Arbeitsspeicher der Instanz auf diesen Wert setzen.
    RaiseMemory { suggested_mb: u32 },
    /// Eigenen Java-Pfad der Instanz löschen: es gilt wieder die Einstellung des Launchers bzw. die mitgelieferte Runtime.
    UseManagedJava,
    /// Den Dialog zum Hinzufügen von Inhalten mit dieser Suche öffnen.
    InstallDependency { project_query: String },
    /// Mod der Instanz ausschalten.
    DisableMod { mod_id: String },
    /// Hilfeseite im Browser öffnen.
    OpenUrl { url: String },
    /// Spieldateien der Instanz neu laden (Reparieren); Welten und Mods bleiben.
    ReinstallGameFiles,
}

/// Ein Befund. `id` bestimmt den Text der Oberfläche, `params` füllt seine Platzhalter; `evidence` sind kurze Auszüge aus
/// dem Bericht.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashDiagnosis {
    pub id: &'static str,
    pub severity: Severity,
    pub evidence: Vec<String>,
    pub params: BTreeMap<&'static str, String>,
    pub actions: Vec<FixAction>,
}

impl CrashDiagnosis {
    fn new(id: &'static str, severity: Severity, evidence: Vec<String>) -> Self {
        Self { id, severity, evidence, params: BTreeMap::new(), actions: Vec::new() }
    }

    fn with_param(mut self, key: &'static str, value: impl ToString) -> Self {
        self.params.insert(key, value.to_string());
        self
    }

    fn with_actions(mut self, actions: impl IntoIterator<Item = FixAction>) -> Self {
        self.actions.extend(actions);
        self
    }
}

/// Was der Rechner und die Einstellungen des Launchers beitragen, die nicht in der Instanz stehen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Machine {
    /// RAM, den Instanzen ohne eigenen Wert bekommen (Einstellung des Launchers, die nur das Frontend kennt).
    pub default_memory_mb: u32,
    /// Arbeitsspeicher des PCs; `None`, wenn er sich nicht ermitteln ließ.
    pub total_memory_mb: Option<u64>,
}

/// Alles, was eine Regel zum Urteilen braucht.
pub struct CrashContext<'a> {
    pub text: &'a str,
    pub instance: &'a Instance,
    pub machine: Machine,
}

impl CrashContext<'_> {
    /// Der RAM, mit dem die Instanz startet.
    fn current_memory_mb(&self) -> u32 {
        self.instance.memory_mb.unwrap_or(self.machine.default_memory_mb)
    }

    /// Der eingeschaltete Mod der Instanz, dessen Kennung oder Name einer der `keys` entspricht („fabric-api“ = „Fabric API“);
    /// frühere Schlüssel gehen vor.
    fn installed_mod(&self, keys: &[&str]) -> Option<&Mod> {
        keys.iter().map(|key| normalized(key)).filter(|key| !key.is_empty()).find_map(|key| {
            self.instance.mods.iter().find(|m| {
                m.kind == ModKind::Mod && m.enabled && (normalized(&m.id) == key || normalized(&m.name) == key)
            })
        })
    }
}

type Rule = fn(&CrashContext<'_>) -> Option<CrashDiagnosis>;

/// Die Regeln in der Reihenfolge, in der ihre Befunde erscheinen. Eine neue Regel kommt als eine Zeile dazu.
const RULES: &[Rule] = &[
    memory::diagnose,
    java_version::diagnose,
    dependency::diagnose,
    mixin::diagnose,
    duplicates::diagnose,
    graphics::diagnose,
    port::diagnose,
    gamefiles::diagnose,
];

/// Regeln für den Fall, dass keine der [`RULES`] etwas fand: dann bleibt wenigstens der Verdacht auf einzelne Mods.
const FALLBACK_RULES: &[Rule] = &[suspect_mods::diagnose];

/// Alle Befunde zum Text; ohne Befund der Regeln die der [`FALLBACK_RULES`].
pub fn diagnose(context: &CrashContext<'_>) -> Vec<CrashDiagnosis> {
    let found = run(RULES, context);
    if found.is_empty() { run(FALLBACK_RULES, context) } else { found }
}

/// Befunde zum letzten Absturz der Instanz; ohne lesbaren Bericht oder Protokoll keine.
pub fn diagnose_instance(dirs: &Dirs, instance: &Instance, machine: Machine) -> Vec<CrashDiagnosis> {
    match source::crash_text(dirs, instance) {
        Some(text) => diagnose(&CrashContext { text: &text, instance, machine }),
        None => Vec::new(),
    }
}

fn run(rules: &[Rule], context: &CrashContext<'_>) -> Vec<CrashDiagnosis> {
    rules.iter().filter_map(|rule| rule(context)).collect()
}

/// `DisableMod` je Mod, ohne Doppelte und höchstens [`MAX_DISABLE_ACTIONS`].
fn disable_actions<'a>(mods: impl IntoIterator<Item = &'a Mod>) -> Vec<FixAction> {
    let mut ids: Vec<&str> = Vec::new();
    for m in mods {
        if !ids.contains(&m.id.as_str()) {
            ids.push(&m.id);
        }
    }
    ids.into_iter().take(MAX_DISABLE_ACTIONS).map(|id| FixAction::DisableMod { mod_id: id.to_owned() }).collect()
}

#[cfg(test)]
mod testing {
    use super::*;
    use crate::models::{ModLoader, ModSource, NewInstance};

    pub const MACHINE: Machine = Machine { default_memory_mb: 4096, total_memory_mb: Some(16384) };

    pub fn installed(id: &str, name: &str) -> Mod {
        Mod {
            id: id.into(),
            name: name.into(),
            version: "1".into(),
            source: ModSource::Local,
            file_name: format!("{id}.jar"),
            sha1: None,
            enabled: true,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    pub fn instance(mods: Vec<Mod>) -> Instance {
        let new = NewInstance { name: "Test".into(), minecraft_version: "1.21.1".into(), loader: ModLoader::Fabric, loader_version: None };
        Instance { mods, ..Instance::from_new(new) }
    }

    pub fn context<'a>(text: &'a str, instance: &'a Instance) -> CrashContext<'a> {
        CrashContext { text, instance, machine: MACHINE }
    }

    pub fn disable(id: &str) -> FixAction {
        FixAction::DisableMod { mod_id: id.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    const HEAP_AND_PORT: &str = "java.lang.OutOfMemoryError: Java heap space\n\
        \tat java.base/java.util.Arrays.copyOf(Arrays.java:3481)\n\
        java.net.BindException: Address already in use: bind\n";

    #[test]
    fn every_matching_rule_reports_in_table_order() {
        let instance = instance(Vec::new());
        let ids: Vec<_> = diagnose(&context(HEAP_AND_PORT, &instance)).iter().map(|d| d.id).collect();
        assert_eq!(ids, ["outOfMemory", "portInUse"]);
    }

    #[test]
    fn suspected_mods_only_speak_up_when_no_rule_matches() {
        let report = "java.lang.NullPointerException: x\n\tat me.jellysquid.mods.sodium.client.Foo.run(Foo.java:1)\n";
        let instance = instance(vec![installed("sodium", "Sodium")]);
        let ids: Vec<_> = diagnose(&context(report, &instance)).iter().map(|d| d.id).collect();
        assert_eq!(ids, ["suspectMods"]);
        let with_rule = format!("{report}{HEAP_AND_PORT}");
        let ids: Vec<_> = diagnose(&context(&with_rule, &instance)).iter().map(|d| d.id).collect();
        assert_eq!(ids, ["outOfMemory", "portInUse"]);
    }

    #[test]
    fn text_without_a_finding_gives_nothing() {
        let instance = instance(Vec::new());
        assert!(diagnose(&context("", &instance)).is_empty());
        assert!(diagnose(&context("[12:00:00] [main/INFO]: Setting user: Steve\n", &instance)).is_empty());
    }

    #[test]
    fn arbitrary_text_never_panics() {
        let instance = instance(vec![installed("sodium", "Sodium")]);
        let noise = "\u{0}\u{fffd}Mod '( requires of \n Mod ID: ' Requested by: '\nclass file version \n\
                     Mixin apply for mod \nFound duplicate mods\n\t.jar\nat (\n"
            .repeat(50);
        let long_line = "x".repeat(100_000);
        for text in [noise.as_str(), long_line.as_str()] {
            diagnose(&context(text, &instance));
        }
    }

    #[test]
    fn installed_mods_match_by_id_or_name_and_only_when_switched_on() {
        let off = Mod { enabled: false, ..installed("lithium", "Lithium") };
        let pack = Mod { kind: ModKind::ResourcePack, ..installed("faithful", "Faithful") };
        let instance = instance(vec![installed("fabric-api-id", "Fabric API"), off, pack]);
        let context = context("", &instance);
        assert_eq!(context.installed_mod(&["fabric-api"]).map(|m| m.id.as_str()), Some("fabric-api-id"));
        assert_eq!(context.installed_mod(&["nope", "FABRIC_API_ID"]).map(|m| m.name.as_str()), Some("Fabric API"));
        assert!(context.installed_mod(&["lithium"]).is_none());
        assert!(context.installed_mod(&["faithful"]).is_none());
        assert!(context.installed_mod(&["", "--"]).is_none());
    }

    #[test]
    fn disable_actions_are_distinct_and_limited() {
        let mods: Vec<Mod> = ["a", "b", "a", "c", "d"].iter().map(|id| installed(id, id)).collect();
        assert_eq!(disable_actions(&mods), [disable("a"), disable("b"), disable("c")]);
    }

    #[test]
    fn a_diagnosis_is_serialized_with_tagged_actions() {
        let diagnosis = CrashDiagnosis::new("outOfMemory", Severity::Error, vec!["boom".into()])
            .with_param("currentMb", 4096)
            .with_actions([FixAction::RaiseMemory { suggested_mb: 8192 }, FixAction::UseManagedJava]);
        assert_eq!(
            serde_json::to_value(&diagnosis).unwrap(),
            serde_json::json!({
                "id": "outOfMemory",
                "severity": "error",
                "evidence": ["boom"],
                "params": { "currentMb": "4096" },
                "actions": [{ "type": "raiseMemory", "suggestedMb": 8192 }, { "type": "useManagedJava" }],
            })
        );
        let install = FixAction::InstallDependency { project_query: "sodium".into() };
        assert_eq!(serde_json::to_value(install).unwrap(), serde_json::json!({ "type": "installDependency", "projectQuery": "sodium" }));
    }
}
