//! A production bridge is proven by an accepted connection and both registered UI modules.
//! Historical tracer lines are deliberately not accepted as evidence of a working bridge.
use std::time::Duration;

use launcher_lib::services::modbridge::ModBridge;

pub const POLL: Duration = Duration::from_millis(250);

/// Was gezeigt wurde.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Proof {
    /// Die Mod hat sich verbunden und `ready` mit diesen Bildschirmen gemeldet.
    BridgeReady { screens: Vec<String> },
}

impl Proof {
    pub fn describe(&self) -> String {
        match self {
            Self::BridgeReady { screens } => format!("bridge-ready {screens:?}"),
        }
    }
}

pub struct Probe<'a> {
    pub bridge: &'a ModBridge,
    pub instance_id: &'a str,
}

impl Probe<'_> {
    /// Der Beweis, sobald er vorliegt.
    pub fn proof(&self, _log: &[String]) -> Option<Proof> {
        self.bridge_proof()
    }

    /// Der Zustand der Brücke, als Zeile für den Laufbericht: die Verbindung besteht erst, nachdem `hello` angenommen,
    /// der Besitzer geprüft und `welcome` gesendet wurde (`admit` in `modbridge/state.rs`), `ready` kommt danach.
    pub fn milestones(&self) -> Vec<String> {
        let mut lines = Vec::new();
        if self.bridge.is_connected(self.instance_id) {
            lines.push(format!("[smoke] link up for {}: hello accepted, owner check passed, welcome sent", self.instance_id));
        }
        if let Some(screens) = self.bridge.ready_screens(self.instance_id) {
            lines.push(format!("[smoke] mod ready for {}: screens {screens:?}", self.instance_id));
        }
        lines
    }

    fn bridge_proof(&self) -> Option<Proof> {
        let screens = self.bridge.ready_screens(self.instance_id)?;
        let complete = ["home", "friends"].iter().all(|required| screens.iter().any(|screen| screen == required));
        (complete && self.bridge.is_connected(self.instance_id)).then_some(Proof::BridgeReady { screens })
    }

}

#[cfg(test)]
mod tests {
    use launcher_lib::services::gamesignal::GameSignals;

    use super::*;

    fn probe<'a>(bridge: &'a ModBridge) -> Probe<'a> {
        Probe { bridge, instance_id: "i" }
    }

    fn log(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|line| (*line).to_owned()).collect()
    }

    #[test]
    fn historical_tracer_lines_do_not_prove_a_full_bridge() {
        let bridge = ModBridge::new(GameSignals::default());
        let lines = log(&[
            "pumpkin_bridge tracer 1.21.1 neoforge",
            "pumpkin_bridge tracer 1.20.1 forge",
            "pumpkin_bridge tracer 1.21.1 fabric",
            "pumpkin_bridge tracer 1.21.1 fabric mixin",
        ]);

        assert_eq!(probe(&bridge).proof(&lines), None);
    }

    #[test]
    fn a_game_without_any_line_proves_nothing() {
        let bridge = ModBridge::new(GameSignals::default());

        assert_eq!(probe(&bridge).proof(&[]), None);
    }
}
