//! Grenzen des Mod-Kanals (docs/friends/INGAME.md, 5.3 und 5.6). `mod/fixtures/protocol/limits.jsonl` hält dieselben
//! Zahlen für die Java-Seite fest; `tests_fixtures` prüft beide gegeneinander.
use std::time::Duration;

/// Längste Zeile samt Zeilenende, solange die Verbindung noch nicht mit `welcome` angenommen ist.
pub const PRE_WELCOME_LINE_BYTES: usize = 1024;
/// Längste Zeile der Mod an den Launcher nach `welcome`.
pub const MOD_LINE_BYTES: usize = 16 * 1024;
/// Längste Zeile des Launchers an die Mod nach `welcome`.
pub const LAUNCHER_LINE_BYTES: usize = 64 * 1024;
/// So viele Verbindungen dürfen gleichzeitig noch auf ihr `hello` warten.
pub const MAX_UNAUTHENTICATED: usize = 4;
/// So viele Nachrichten darf die Mod in `MESSAGE_WINDOW` schicken; mehr trennt die Verbindung.
pub const MESSAGES_PER_WINDOW: usize = 20;
pub const MESSAGE_WINDOW: Duration = Duration::from_secs(1);
/// So viele Anfragen darf die Mod gleichzeitig offen haben.
pub const MAX_IN_FLIGHT: usize = 8;
/// So viele Nachrichten warten höchstens auf eine langsame Mod; darüber wird die Verbindung getrennt.
pub const OUTGOING_QUEUE: usize = 64;
/// So viele Hinweise warten höchstens auf die Mod; ein weiterer verdrängt den ältesten.
pub const EVENT_QUEUE: usize = 32;
/// Ein Thema geht frühestens so lange nach seinem vorigen Stand hinaus; zwischendurch zählt nur der letzte.
pub const TOPIC_COALESCE: Duration = Duration::from_millis(250);
/// Der Wert eines Themas samt Rahmen bleibt unter diesem Wert, damit er in `LAUNCHER_LINE_BYTES` passt.
pub const TOPIC_BUDGET_BYTES: usize = 60 * 1024;
/// So lange darf der Launcher auf die Antwort eines Vorgangs warten, auch auf den Dialog im Launcher
/// (Rückfrage 120 s, dazu Spielraum).
pub const REQUEST_DEADLINE: Duration = Duration::from_secs(125);

/// Die Zeiten, die Tests verkürzen dürfen; die Brücke läuft mit [`Timing::PRODUCTION`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timing {
    /// So lange darf die Mod mit dem `hello` brauchen.
    pub hello: Duration,
    /// So lange darf das Schreiben an eine Mod dauern, die nicht liest.
    pub write_stall: Duration,
    /// So oft schickt der Launcher ein `ping`.
    pub ping_interval: Duration,
    /// So lange darf von der Mod nichts kommen.
    pub silence: Duration,
    pub topic_coalesce: Duration,
}

impl Timing {
    pub const PRODUCTION: Self = Self {
        hello: Duration::from_secs(2),
        write_stall: Duration::from_secs(5),
        ping_interval: Duration::from_secs(10),
        silence: Duration::from_secs(30),
        topic_coalesce: TOPIC_COALESCE,
    };
}
