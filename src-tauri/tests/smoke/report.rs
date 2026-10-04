//! Das Ergebnis einer Zelle: Urteil, benutzte Strategie, die Logzeilen, auf die es ankommt, und die Dauer. Es geht als
//! JSON neben das vollständige Spiel-Log und als Text auf die Ausgabe.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

/// Zeilen, die ins Ergebnis gehören: was die Mod, der Loader und der Breaker über die Mod sagen.
const EVIDENCE_MARKERS: [&str; 12] = [
    "pumpkin",
    "Pumpkin",
    "Loading Minecraft",
    "FMLLoader",
    "Incompatible mod set",
    "ModLoadingException",
    "mod loading error",
    "UnsupportedClassVersionError",
    "Mixin apply",
    "InvalidInjectionException",
    "Missing or unsupported mandatory dependencies",
    "Replace mod",
];
const MAX_EVIDENCE_LINES: usize = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Passed,
    Failed,
    Timeout,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub cell: String,
    pub scenario: String,
    pub result: Verdict,
    pub reason: String,
    pub strategy: String,
    pub minecraft: String,
    pub loader_version: String,
    pub java_major: Option<u32>,
    pub proof: Option<String>,
    pub breaker: Option<String>,
    pub injected_jvm_args: Vec<String>,
    pub injected_game_args: Vec<String>,
    pub companions: Vec<String>,
    pub seconds: f64,
    pub exit_code: Option<i32>,
    pub evidence: Vec<String>,
}

impl Outcome {
    pub fn passed(&self) -> bool {
        self.result == Verdict::Passed
    }
}

/// Die Zeilen des Spiel-Logs, auf die es ankommt, in ihrer Reihenfolge.
pub fn evidence_of(log: &[String]) -> Vec<String> {
    log.iter().filter(|line| EVIDENCE_MARKERS.iter().any(|marker| line.contains(marker))).take(MAX_EVIDENCE_LINES).cloned().collect()
}

pub fn seconds(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 10.0).round() / 10.0
}

/// Schreibt Bericht und Spiel-Log nach `out` und gibt den Bericht auf die Ausgabe.
pub fn write(out: &Path, outcome: &Outcome, game_log: &[String]) -> Result<PathBuf, String> {
    fs::create_dir_all(out).map_err(|error| error.to_string())?;
    let stem = format!("{}__{}", outcome.cell, outcome.scenario);
    let json = serde_json::to_string_pretty(outcome).map_err(|error| error.to_string())?;
    fs::write(out.join(format!("{stem}.json")), &json).map_err(|error| error.to_string())?;
    fs::write(out.join(format!("{stem}.game.log")), game_log.join("\n")).map_err(|error| error.to_string())?;
    println!("[smoke] {json}");
    Ok(out.join(stem))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_evidence_keeps_only_the_lines_about_the_mod_and_the_loader_in_order() {
        let log: Vec<String> = ["Setting user", "Loading Minecraft 1.21.1 with Fabric Loader 0.19.5", "Reloading ResourceManager", "pumpkin_friends tracer 1.21.1 fabric"]
            .iter()
            .map(|line| (*line).to_owned())
            .collect();

        assert_eq!(evidence_of(&log), vec![log[1].clone(), log[3].clone()]);
    }

    #[test]
    fn the_evidence_is_capped() {
        let log = vec!["pumpkin".to_owned(); MAX_EVIDENCE_LINES + 10];

        assert_eq!(evidence_of(&log).len(), MAX_EVIDENCE_LINES);
    }
}
