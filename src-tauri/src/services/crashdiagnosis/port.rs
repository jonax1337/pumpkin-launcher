//! Regel „Port belegt“: Minecraft wollte einen Netzwerk-Port öffnen (LAN-Spiel, integrierter Server), den schon ein anderes
//! Programm benutzt, oft ein zweites Minecraft. Es gibt nichts zu klicken, nur zu erklären.
use super::text::evidence_containing;
use super::{CrashContext, CrashDiagnosis, Severity};

const MARKERS: [&str; 2] = ["Address already in use", "Failed to bind to port"];

pub(super) fn diagnose(context: &CrashContext<'_>) -> Option<CrashDiagnosis> {
    let evidence = evidence_containing(context.text, &MARKERS);
    (!evidence.is_empty()).then(|| CrashDiagnosis::new("portInUse", Severity::Warning, evidence))
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::*;

    fn run(text: &str) -> Option<CrashDiagnosis> {
        let instance = instance(Vec::new());
        diagnose(&context(text, &instance))
    }

    #[test]
    fn a_busy_port_is_explained_without_actions() {
        let log = "[12:00:03] [Server thread/WARN]: **** FAILED TO BIND TO PORT!\n\
                   [12:00:03] [Server thread/WARN]: The exception was: java.net.BindException: Address already in use: bind\n";
        let found = run(log).unwrap();
        assert_eq!((found.id, found.severity), ("portInUse", Severity::Warning));
        assert!(found.actions.is_empty());
        assert_eq!(found.evidence, ["[12:00:03] [Server thread/WARN]: The exception was: java.net.BindException: Address already in use: bind"]);
    }

    #[test]
    fn the_netty_wording_counts_as_well() {
        let log = "io.netty.channel.unix.Errors$NativeIoException: bind(..) failed: Address already in use\n\
                   Failed to bind to port 25565\n";
        assert_eq!(run(log).unwrap().evidence.len(), 2);
    }

    #[test]
    fn other_logs_have_no_busy_port() {
        assert!(run("[12:00:03] [Server thread/INFO]: Starting minecraft server version 1.21.1\n").is_none());
    }
}
