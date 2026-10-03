//! Erkennt den LAN-Port einer geteilten Welt in der Spielausgabe.
//!
//! Der Detektor liest die rohen stdout-Zeilen, nicht die aufbereiteten (`gamelog::XmlLog`): nur so sieht er, ob eine
//! Zeile wirklich der Beginn eines Ereignisses des Server-Threads ist oder nur Text innerhalb einer Nachricht. Ein
//! gefundener Port ist ein Hinweis; erst [`verify_port`] macht ihn verwendbar.
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use crate::services::{server_ping, sockowner};

/// So lange darf die Statusabfrage des Spiels dauern.
const STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const SERVER_THREAD: &str = "Server thread";
const XML_EVENT_START: &str = "<log4j:Event";
const XML_MESSAGE_START: &str = "<log4j:Message><![CDATA[";
const XML_MESSAGE_END: &str = "]]></log4j:Message>";
const CDATA_START: &str = "<![CDATA[";
const CDATA_END: &str = "]]>";

/// Zeile in der Form ohne XML-Konfiguration: Vanilla (`]: `) oder Fabric (`] (logger) `).
static PLAIN_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[\d{2}:\d{2}:\d{2}\] \[Server thread/INFO\](?:: | \([A-Za-z0-9_.\-]{1,64}\) )(.*)$").expect("Muster ist gültig")
});
static OPENED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:Started serving on|Published LAN server on port) (\d{1,5})$").expect("Muster ist gültig")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanLine {
    Opened(u16),
    Closed,
}

/// Ergebnis von [`verify_port`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortCheck {
    Ok,
    /// Kein Socket des Spielprozesses lauscht auf dem Port.
    NotOwned,
    /// Der Port gehört dem Spiel, antwortet aber nicht auf die Statusabfrage.
    NoAnswer,
}

/// Wo im XML-Gerüst die nächste Zeile steht.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum XmlPosition {
    #[default]
    Outside,
    /// Direkt nach dem Beginn eines INFO-Ereignisses des Server-Threads: hier steht die Nachricht.
    ServerThreadEvent,
    /// In einem mehrzeiligen CDATA-Abschnitt: Text, den jemand frei wählen kann.
    InsideCdata,
}

#[derive(Debug, Default)]
pub struct LanDetector {
    position: XmlPosition,
}

impl LanDetector {
    /// Nimmt die nächste rohe stdout-Zeile und liefert, was sie über das LAN-Netz des Spiels sagt.
    pub fn feed(&mut self, raw: &str) -> Option<LanLine> {
        let line = raw.trim_end_matches(['\r', '\n']);
        let message = match self.position {
            XmlPosition::InsideCdata => {
                self.position = if line.contains(CDATA_END) { XmlPosition::Outside } else { XmlPosition::InsideCdata };
                return None;
            }
            XmlPosition::ServerThreadEvent => self.xml_message(line),
            XmlPosition::Outside => self.outside_message(line),
        };
        message.as_deref().and_then(classify)
    }

    fn xml_message(&mut self, line: &str) -> Option<String> {
        self.position = XmlPosition::Outside;
        if let Some(message) = single_line_message(line.trim_start()) {
            return Some(message.to_owned());
        }
        self.enter_cdata_if_open(line);
        None
    }

    fn outside_message(&mut self, line: &str) -> Option<String> {
        let trimmed = line.trim_start();
        if trimmed.starts_with(XML_EVENT_START) {
            self.position = if is_server_thread_info(trimmed) { XmlPosition::ServerThreadEvent } else { XmlPosition::Outside };
            return None;
        }
        self.enter_cdata_if_open(line);
        PLAIN_LINE.captures(line).map(|captures| captures[1].to_owned())
    }

    fn enter_cdata_if_open(&mut self, line: &str) {
        if line.split_once(CDATA_START).is_some_and(|(_, rest)| !rest.contains(CDATA_END)) {
            self.position = XmlPosition::InsideCdata;
        }
    }
}

fn is_server_thread_info(event_start: &str) -> bool {
    event_start.contains(r#" level="INFO""#) && event_start.contains(&format!(r#" thread="{SERVER_THREAD}""#))
}

/// Der Text einer Nachricht, die in einer Zeile steht und nichts anderes enthält.
fn single_line_message(line: &str) -> Option<&str> {
    let text = line.strip_prefix(XML_MESSAGE_START)?.strip_suffix(XML_MESSAGE_END)?;
    (!text.contains(CDATA_END)).then_some(text)
}

/// Nur die ganze Nachricht zählt: Chat (`<Name> …`) und `/say` (`[Name] …`) bilden nie die ganze Nachricht.
fn classify(message: &str) -> Option<LanLine> {
    if matches!(message, "Stopping server" | "Unpublishing integrated server") {
        return Some(LanLine::Closed);
    }
    let port = OPENED.captures(message)?[1].parse().ok()?;
    Some(LanLine::Opened(port))
}

/// Prüft einen gemeldeten Port: Er muss dem Spielprozess gehören und auf die Statusabfrage antworten.
pub async fn verify_port(pid: u32, port: u16) -> PortCheck {
    if !game_listens(pid, port).await {
        return PortCheck::NotOwned;
    }
    if answers_status(port).await {
        PortCheck::Ok
    } else {
        PortCheck::NoAnswer
    }
}

/// Eine Abfrage, die nicht klappt, zählt als „gehört nicht dem Spiel“: im Zweifel wird nichts geteilt.
async fn game_listens(pid: u32, port: u16) -> bool {
    match tokio::task::spawn_blocking(move || sockowner::listens(pid, port)).await {
        Ok(Ok(listens)) => listens,
        Ok(Err(err)) => {
            tracing::warn!(pid, port, %err, "Besitzer des Ports nicht ermittelbar");
            false
        }
        Err(err) => {
            tracing::warn!(pid, port, %err, "Abfrage des Port-Besitzers abgebrochen");
            false
        }
    }
}

async fn answers_status(port: u16) -> bool {
    let address = format!("127.0.0.1:{port}");
    matches!(tokio::time::timeout(STATUS_TIMEOUT, server_ping::ping(&address)).await, Ok(Ok(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn xml_event(thread: &str, level: &str, message_lines: &[&str]) -> Vec<String> {
        let mut lines = vec![format!(r#"<log4j:Event logger="net.minecraft.server.MinecraftServer" timestamp="1" level="{level}" thread="{thread}">"#)];
        lines.extend(message_lines.iter().map(|line| (*line).to_owned()));
        lines.push("</log4j:Event>".to_owned());
        lines
    }

    fn xml_message(text: &str) -> String {
        format!("<log4j:Message><![CDATA[{text}]]></log4j:Message>")
    }

    fn detect(lines: &[impl AsRef<str>]) -> Vec<LanLine> {
        let mut detector = LanDetector::default();
        lines.iter().filter_map(|line| detector.feed(line.as_ref())).collect()
    }

    #[test]
    fn plain_lines_of_every_supported_version_are_recognised() {
        let lines = [
            "[12:00:01] [Server thread/INFO]: Started serving on 50123",
            "[12:00:02] [Server thread/INFO]: Published LAN server on port 50124",
            "[12:00:03] [Server thread/INFO] (Minecraft) Started serving on 50125",
            "[12:00:04] [Server thread/INFO]: Stopping server",
            "[12:00:05] [Server thread/INFO]: Unpublishing integrated server",
            "[12:00:06] [Server thread/INFO] (Minecraft) Unpublishing integrated server\r",
        ];
        assert_eq!(
            detect(&lines),
            [
                LanLine::Opened(50123),
                LanLine::Opened(50124),
                LanLine::Opened(50125),
                LanLine::Closed,
                LanLine::Closed,
                LanLine::Closed
            ]
        );
    }

    #[test]
    fn xml_events_of_the_server_thread_are_recognised() {
        for (message, expected) in [
            ("Started serving on 50123", LanLine::Opened(50123)),
            ("Published LAN server on port 50124", LanLine::Opened(50124)),
            ("Stopping server", LanLine::Closed),
            ("Unpublishing integrated server", LanLine::Closed),
        ] {
            let lines = xml_event(SERVER_THREAD, "INFO", &[&xml_message(message)]);
            assert_eq!(detect(&lines), [expected], "{message}");
        }
    }

    #[test]
    fn xml_events_with_indentation_still_count() {
        let lines = ["  <log4j:Event level=\"INFO\" thread=\"Server thread\">", "  <log4j:Message><![CDATA[Stopping server]]></log4j:Message>"];
        assert_eq!(detect(&lines), [LanLine::Closed]);
    }

    #[test]
    fn chat_and_say_never_form_the_whole_message() {
        let spoofs = [
            "<Bob> Published LAN server on port 5432",
            "[Bob] Published LAN server on port 5432",
            "Bob said: Started serving on 5432",
            "Started serving on 5432 now",
            "Stopping server!",
            "Started serving on 123456",
            "Started serving on abc",
        ];
        for spoof in spoofs {
            assert_eq!(detect(&xml_event(SERVER_THREAD, "INFO", &[&xml_message(spoof)])), [], "xml: {spoof}");
            assert_eq!(detect(&[format!("[12:00:00] [Server thread/INFO]: {spoof}")]), [], "plain: {spoof}");
        }
    }

    #[test]
    fn events_of_other_threads_and_levels_do_not_count() {
        let message = xml_message("Started serving on 5432");
        assert_eq!(detect(&xml_event("Render thread", "INFO", &[&message])), []);
        assert_eq!(detect(&xml_event(SERVER_THREAD, "WARN", &[&message])), []);
        assert_eq!(detect(&xml_event("Server thread 2", "INFO", &[&message])), []);
        assert_eq!(detect(&["[12:00:00] [Render thread/INFO]: Started serving on 5432"]), []);
        assert_eq!(detect(&["[12:00:00] [Server thread/WARN]: Started serving on 5432"]), []);
        assert_eq!(detect(&["[Server thread/INFO]: Started serving on 5432"]), []);
    }

    #[test]
    fn a_message_event_does_not_carry_over_to_the_next_event() {
        let mut lines = xml_event(SERVER_THREAD, "INFO", &[&xml_message("something else")]);
        lines.extend(xml_event("Render thread", "INFO", &[&xml_message("Stopping server")]));
        lines.push(xml_message("Stopping server"));
        assert_eq!(detect(&lines), []);
    }

    #[test]
    fn a_multi_line_message_cannot_smuggle_in_lines() {
        let lines = xml_event(
            SERVER_THREAD,
            "INFO",
            &[
                "<log4j:Message><![CDATA[first line",
                "[12:00:00] [Server thread/INFO]: Published LAN server on port 5432",
                "Stopping server",
                "]]></log4j:Message>",
            ],
        );
        assert_eq!(detect(&lines), []);
        let mut detector = LanDetector::default();
        assert_eq!(detector.feed("[12:00:00] [Server thread/INFO]: Stopping server"), Some(LanLine::Closed), "danach wieder wach");
    }

    #[test]
    fn a_forged_plain_line_inside_another_threads_message_is_ignored() {
        let lines = xml_event(
            "Render thread",
            "INFO",
            &["<log4j:Message><![CDATA[[12:00:00] [Server thread/INFO]: Published LAN server on port 5432]]></log4j:Message>"],
        );
        assert_eq!(detect(&lines), []);
    }

    #[test]
    fn chat_that_continues_over_several_lines_is_skipped_until_it_ends() {
        let mut detector = LanDetector::default();
        let lines = [
            r#"<log4j:Event level="INFO" thread="Server thread">"#,
            "<log4j:Message><![CDATA[<Bob> hi",
            "Stopping server]]></log4j:Message>",
            "</log4j:Event>",
        ];
        assert_eq!(lines.iter().filter_map(|line| detector.feed(line)).count(), 0);
        assert_eq!(detector.feed("[12:00:00] [Server thread/INFO]: Stopping server"), Some(LanLine::Closed));
    }

    /// Antwortet auf jede Verbindung mit einem Minecraft-Status (oder mit `reply`) und schließt sie.
    async fn serve_status(listener: TcpListener, reply: &'static [u8]) {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else { return };
            let mut request = [0u8; 64];
            let _ = stream.read(&mut request).await;
            let _ = stream.write_all(reply).await;
        }
    }

    fn status_packet() -> Vec<u8> {
        let json = br#"{"version":{"name":"1.21","protocol":767},"players":{"max":8,"online":1},"description":"x"}"#;
        let mut body = vec![0x00, json.len() as u8];
        body.extend_from_slice(json);
        [&[body.len() as u8][..], &body].concat()
    }

    async fn status_server(reply: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve_status(listener, reply));
        port
    }

    #[tokio::test]
    async fn a_port_of_the_game_that_answers_the_status_ping_is_ok() {
        let packet: &'static [u8] = Box::leak(status_packet().into_boxed_slice());
        let port = status_server(packet).await;
        assert_eq!(verify_port(std::process::id(), port).await, PortCheck::Ok);
    }

    #[tokio::test]
    async fn a_port_of_another_process_is_not_owned() {
        let packet: &'static [u8] = Box::leak(status_packet().into_boxed_slice());
        let port = status_server(packet).await;
        let other_pid = std::process::id().wrapping_add(1);
        assert_eq!(verify_port(other_pid, port).await, PortCheck::NotOwned);
    }

    #[tokio::test]
    async fn a_port_that_is_not_listening_is_not_owned() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            listener.local_addr().unwrap().port()
        };
        assert_eq!(verify_port(std::process::id(), port).await, PortCheck::NotOwned);
    }

    #[tokio::test]
    async fn a_listener_that_is_not_a_minecraft_server_gives_no_answer() {
        let port = status_server(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        assert_eq!(verify_port(std::process::id(), port).await, PortCheck::NoAnswer);
    }
}
