//! Discord Rich Presence: zeigt in Discord, dass Minecraft läuft, mit Version, Loader und Startzeit. Der Launcher
//! spricht dazu nur lokal mit dem laufenden Discord (Named Pipe bzw. Unix-Socket); es geht nichts ins Netz.
//! Welt, Server und Instanzname kommen nie in die Anzeige.
use std::{
    sync::{mpsc, Mutex},
    thread,
};

use discord_rich_presence::{activity, error::Error as IpcError, DiscordIpc, DiscordIpcClient};

use crate::models::ModLoader;
use crate::services::lock;

/// Anwendungs-ID aus dem Discord Developer Portal (Application ID); der Name der Anwendung steht als „Spielt …“ in
/// Discord, das Bild `pumpkin` gehört unter „Rich Presence › Art Assets“ hochgeladen. Leer: keine Verbindung zu Discord.
const APPLICATION_ID: &str = "1555906597451071579";
const LARGE_IMAGE: &str = "pumpkin";
const LARGE_IMAGE_TEXT: &str = "Pumpkin Launcher";

/// Was Discord zeigt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activity {
    pub details: String,
    pub state: String,
    pub started_at_ms: i64,
}

impl Activity {
    pub fn minecraft(minecraft_version: &str, loader: ModLoader, started_at_ms: i64) -> Self {
        Self { details: format!("Minecraft {minecraft_version}"), state: loader.display_name().to_owned(), started_at_ms }
    }
}

/// Die Verbindung zu Discord; Tests setzen ein Gegenstück ein. Ein Fehler heißt: Discord war nicht erreichbar.
pub trait Client: Send + 'static {
    fn show(&mut self, activity: &Activity) -> Result<(), String>;
    fn clear(&mut self) -> Result<(), String>;
}

enum Command {
    Show(Activity),
    Clear,
}

struct Session {
    instance_id: String,
    activity: Activity,
}

/// Zeigt die zuletzt gestartete Instanz; endet sie, kommt die davor laufende zurück, sonst verschwindet die Anzeige.
/// Die Gespräche mit Discord laufen auf einem eigenen Thread: ein hängendes Discord hält weder Start noch Spielende auf.
pub struct Presence {
    commands: mpsc::Sender<Command>,
    sessions: Mutex<Vec<Session>>,
}

impl Presence {
    pub fn discord() -> Self {
        Self::with_client(DiscordClient::default())
    }

    pub fn with_client(client: impl Client) -> Self {
        let (commands, inbox) = mpsc::channel();
        thread::spawn(move || serve(client, inbox));
        Self { commands, sessions: Mutex::new(Vec::new()) }
    }

    pub fn started(&self, instance_id: &str, activity: Activity) {
        let mut sessions = lock(&self.sessions);
        sessions.retain(|session| session.instance_id != instance_id);
        sessions.push(Session { instance_id: instance_id.to_owned(), activity: activity.clone() });
        self.send(Command::Show(activity));
    }

    pub fn stopped(&self, instance_id: &str) {
        let mut sessions = lock(&self.sessions);
        let before = sessions.len();
        sessions.retain(|session| session.instance_id != instance_id);
        if sessions.len() == before {
            return;
        }
        self.send(sessions.last().map_or(Command::Clear, |latest| Command::Show(latest.activity.clone())));
    }

    fn send(&self, command: Command) {
        // Der Thread endet erst mit `Presence`; ein Fehler hieße, er ist abgestürzt, dann gibt es nichts mehr anzuzeigen.
        let _ = self.commands.send(command);
    }
}

fn serve(mut client: impl Client, inbox: mpsc::Receiver<Command>) {
    for command in inbox {
        let result = match command {
            Command::Show(activity) => client.show(&activity),
            Command::Clear => client.clear(),
        };
        if let Err(reason) = result {
            tracing::debug!(%reason, "Discord nicht erreichbar");
        }
    }
}

/// Verbindet sich erst bei der ersten Anzeige und nach einem Fehler neu: Discord kann nach dem Start des Launchers
/// aufgehen oder neu starten.
#[derive(Default)]
struct DiscordClient {
    connection: Option<DiscordIpcClient>,
}

impl DiscordClient {
    fn connection(&mut self) -> Result<&mut DiscordIpcClient, String> {
        if self.connection.is_none() {
            if APPLICATION_ID.is_empty() {
                return Err("keine Discord-Anwendungs-ID eingetragen".to_owned());
            }
            let mut ipc = DiscordIpcClient::new(APPLICATION_ID);
            ipc.connect().map_err(|err| err.to_string())?;
            self.connection = Some(ipc);
        }
        self.connection.as_mut().ok_or_else(|| "keine Verbindung".to_owned())
    }

    fn talk(&mut self, send: impl FnOnce(&mut DiscordIpcClient) -> Result<(), IpcError>) -> Result<(), String> {
        let result = send(self.connection()?);
        if result.is_err() {
            self.connection = None;
        }
        result.map_err(|err| err.to_string())
    }
}

impl Client for DiscordClient {
    fn show(&mut self, activity: &Activity) -> Result<(), String> {
        self.talk(|ipc| {
            ipc.set_activity(
                activity::Activity::new()
                    .details(&activity.details)
                    .state(&activity.state)
                    .timestamps(activity::Timestamps::new().start(activity.started_at_ms))
                    .assets(activity::Assets::new().large_image(LARGE_IMAGE).large_text(LARGE_IMAGE_TEXT)),
            )
        })
    }

    fn clear(&mut self) -> Result<(), String> {
        self.talk(|ipc| ipc.clear_activity())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    #[derive(Debug, PartialEq)]
    enum Shown {
        Activity(String),
        Cleared,
    }

    /// Merkt sich, was Discord bekäme; `fail` lässt es wie ein nicht laufendes Discord antworten.
    struct Recorder {
        shown: Arc<Mutex<Vec<Shown>>>,
        fail: bool,
    }

    impl Recorder {
        fn record(&self, what: Shown) -> Result<(), String> {
            self.shown.lock().unwrap().push(what);
            if self.fail { Err("offline".into()) } else { Ok(()) }
        }
    }

    impl Client for Recorder {
        fn show(&mut self, activity: &Activity) -> Result<(), String> {
            self.record(Shown::Activity(activity.details.clone()))
        }

        fn clear(&mut self) -> Result<(), String> {
            self.record(Shown::Cleared)
        }
    }

    fn presence(fail: bool) -> (Presence, Arc<Mutex<Vec<Shown>>>) {
        let shown = Arc::new(Mutex::new(Vec::new()));
        (Presence::with_client(Recorder { shown: shown.clone(), fail }), shown)
    }

    fn activity(version: &str) -> Activity {
        Activity::minecraft(version, ModLoader::Fabric, 1_000)
    }

    /// Lässt den Thread alle Befehle abarbeiten: ohne `Presence` endet seine Schleife und gibt den Rekorder frei.
    fn shown_after(presence: Presence, shown: &Arc<Mutex<Vec<Shown>>>) -> Vec<Shown> {
        let Presence { commands, .. } = presence;
        drop(commands);
        for _ in 0..200 {
            if Arc::strong_count(shown) == 1 {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        std::mem::take(&mut *shown.lock().unwrap())
    }

    #[test]
    fn the_activity_names_version_and_loader_only() {
        let a = Activity::minecraft("1.21.1", ModLoader::NeoForge, 5);
        assert_eq!((a.details.as_str(), a.state.as_str(), a.started_at_ms), ("Minecraft 1.21.1", "NeoForge", 5));
        assert_eq!(Activity::minecraft("26.3", ModLoader::Vanilla, 0).state, "Vanilla");
    }

    #[test]
    fn a_started_game_is_shown_and_clears_when_it_ends() {
        let (presence, shown) = presence(false);
        presence.started("a", activity("1.21.1"));
        presence.stopped("a");
        assert_eq!(shown_after(presence, &shown), [Shown::Activity("Minecraft 1.21.1".into()), Shown::Cleared]);
    }

    #[test]
    fn with_several_games_the_latest_is_shown_and_the_earlier_returns() {
        let (presence, shown) = presence(false);
        presence.started("a", activity("1.20.1"));
        presence.started("b", activity("1.21.1"));
        presence.stopped("b");
        presence.stopped("a");
        assert_eq!(
            shown_after(presence, &shown),
            [
                Shown::Activity("Minecraft 1.20.1".into()),
                Shown::Activity("Minecraft 1.21.1".into()),
                Shown::Activity("Minecraft 1.20.1".into()),
                Shown::Cleared,
            ]
        );
    }

    #[test]
    fn a_game_that_was_never_shown_sends_nothing_when_it_ends() {
        let (presence, shown) = presence(false);
        presence.stopped("unknown");
        assert_eq!(shown_after(presence, &shown), []);
    }

    #[test]
    fn an_unreachable_discord_changes_nothing_for_the_caller() {
        let (presence, shown) = presence(true);
        presence.started("a", activity("1.21.1"));
        presence.stopped("a");
        assert_eq!(shown_after(presence, &shown).len(), 2);
    }
}
