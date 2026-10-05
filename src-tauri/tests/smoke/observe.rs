//! Woran der Rauchtest erkennt, dass die Mod im Spiel angekommen ist (Anhang B von INGAME.md): bei der echten Mod am
//! Zustand der Brücke (`hello` angenommen, Besitzer geprüft, `welcome` gesendet, `ready` gemeldet), bei den Tracern an
//! ihrer Logzeile `pumpkin_bridge tracer <Minecraft> <Loader>` (der Fabric-Tracer dazu an der Zeile aus seinem Mixin).
use std::time::Duration;

use launcher_lib::services::modbridge::ingame::Loader;
use launcher_lib::services::modbridge::ModBridge;

const TRACER_PREFIX: &str = "pumpkin_bridge tracer";
const MIXIN_SUFFIX: &str = "mixin";
pub const POLL: Duration = Duration::from_millis(250);

/// Was gezeigt wurde.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Proof {
    /// Die Mod hat sich verbunden und `ready` mit diesen Bildschirmen gemeldet.
    BridgeReady { screens: Vec<String> },
    /// Die Logzeile des Tracers (beim Fabric-Tracer samt der des Mixins) steht im Spiel-Log.
    TracerLog { mixin_seen: bool },
}

impl Proof {
    pub fn describe(&self) -> String {
        match self {
            Self::BridgeReady { screens } => format!("bridge-ready {screens:?}"),
            Self::TracerLog { mixin_seen: true } => "tracer-log+mixin".to_owned(),
            Self::TracerLog { mixin_seen: false } => "tracer-log".to_owned(),
        }
    }
}

pub struct Probe<'a> {
    pub bridge: &'a ModBridge,
    pub instance_id: &'a str,
    pub minecraft: &'a str,
    pub loader: Loader,
}

impl Probe<'_> {
    /// Der Beweis, sobald er vorliegt.
    pub fn proof(&self, log: &[String]) -> Option<Proof> {
        self.bridge_proof().or_else(|| self.tracer_proof(log))
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
        self.bridge.is_connected(self.instance_id).then_some(Proof::BridgeReady { screens })
    }

    fn tracer_proof(&self, log: &[String]) -> Option<Proof> {
        let base = format!("{TRACER_PREFIX} {} {}", self.minecraft, loader_name(self.loader));
        let mixin = format!("{base} {MIXIN_SUFFIX}");
        let seen_base = log.iter().any(|line| line.contains(&base) && !line.contains(&mixin));
        let mixin_seen = log.iter().any(|line| line.contains(&mixin));
        // Beim Fabric-Tracer beweist erst die Mixin-Zeile, dass das umgeschriebene JAR im Spiel arbeitet (Anhang A, A4).
        let complete = seen_base && (self.loader != Loader::Fabric || mixin_seen);
        complete.then_some(Proof::TracerLog { mixin_seen })
    }
}

fn loader_name(loader: Loader) -> &'static str {
    match loader {
        Loader::Fabric => "fabric",
        Loader::Neoforge => "neoforge",
        Loader::Forge => "forge",
    }
}

#[cfg(test)]
mod tests {
    use launcher_lib::services::gamesignal::GameSignals;

    use super::*;

    fn probe<'a>(bridge: &'a ModBridge, loader: Loader, minecraft: &'static str) -> Probe<'a> {
        Probe { bridge, instance_id: "i", minecraft, loader }
    }

    fn log(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|line| (*line).to_owned()).collect()
    }

    #[test]
    fn a_neoforge_tracer_is_proven_by_its_one_line() {
        let bridge = ModBridge::new(GameSignals::default());
        let lines = log(&["[modloading-worker-0/INFO] [pumpkin_bridge/]: pumpkin_bridge tracer 1.21.1 neoforge"]);

        assert_eq!(probe(&bridge, Loader::Neoforge, "1.21.1").proof(&lines), Some(Proof::TracerLog { mixin_seen: false }));
        assert_eq!(probe(&bridge, Loader::Neoforge, "26.2").proof(&lines), None, "another Minecraft version is another cell");
        assert_eq!(probe(&bridge, Loader::Forge, "1.21.1").proof(&lines), None, "another loader is another cell");
    }

    #[test]
    fn the_fabric_tracer_needs_the_line_of_its_mixin_too() {
        let bridge = ModBridge::new(GameSignals::default());
        let entry = "(pumpkin_bridge) pumpkin_bridge tracer 1.21.1 fabric";
        let mixin = "(pumpkin_bridge) pumpkin_bridge tracer 1.21.1 fabric mixin";

        assert_eq!(probe(&bridge, Loader::Fabric, "1.21.1").proof(&log(&[entry])), None);
        assert_eq!(probe(&bridge, Loader::Fabric, "1.21.1").proof(&log(&[mixin])), None);
        assert_eq!(probe(&bridge, Loader::Fabric, "1.21.1").proof(&log(&[entry, mixin])), Some(Proof::TracerLog { mixin_seen: true }));
    }

    #[test]
    fn a_game_without_any_line_proves_nothing() {
        let bridge = ModBridge::new(GameSignals::default());

        assert_eq!(probe(&bridge, Loader::Fabric, "26.3").proof(&[]), None);
    }
}
