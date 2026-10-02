//! Server-List-Ping: Handshake und Statusanfrage des Spiels per TCP. Aus der Antwort liest der Launcher nur
//! Text und Zahlen; nichts daraus wird ausgeführt, nachgeladen oder als Markup angezeigt.
use std::{
    io,
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

use super::limits::SERVER_STATUS_LIMIT;
use super::servers::{parse_address, ServerAddress};
use crate::coded;
use crate::error::{AppError, AppResult};

/// Verbinden und Antwort zusammen; danach gilt der Server als nicht erreichbar.
const PING_TIMEOUT: Duration = Duration::from_secs(5);
/// Das Handshake nennt kein Protokoll; der Server antwortet mit seiner eigenen Version.
const UNKNOWN_PROTOCOL: i32 = -1;
const HANDSHAKE_PACKET: i32 = 0x00;
const STATUS_PACKET: i32 = 0x00;
const NEXT_STATE_STATUS: i32 = 1;
const VARINT_MAX_BYTES: usize = 5;
const MOTD_MAX_CHARS: usize = 200;
const VERSION_MAX_CHARS: usize = 64;
/// Tiefe verschachtelter Textbausteine der MOTD, die gelesen wird.
const COMPONENT_MAX_DEPTH: usize = 8;
/// Zeichen, das im Spiel die folgende Formatierung (`§a`, `§l` …) einleitet.
const FORMAT_MARK: char = '§';

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    /// MOTD als einzeiliger Text ohne Formatierung.
    pub motd: String,
    pub players_online: u32,
    pub players_max: u32,
    /// Versionsname, wie der Server ihn nennt (z. B. `Paper 1.21.4`); leer, wenn er keinen nennt.
    pub version: String,
    /// Antwortzeit der Statusanfrage in Millisekunden.
    pub latency_ms: u32,
}

/// Fragt den Status eines Servers ab. Die Adresse prüft der Aufrufer gegen die eigene Serverliste.
pub async fn ping(address: &str) -> AppResult<ServerStatus> {
    let ServerAddress { host, port } =
        parse_address(address).ok_or_else(|| AppError::invalid(coded!("errors.app.server.addressInvalid")))?;
    let answer = tokio::time::timeout(PING_TIMEOUT, async {
        let mut stream = TcpStream::connect((host, port)).await.map_err(|_| unreachable_server())?;
        request_status(&mut stream, host, port).await.map_err(|_| AppError::invalid(coded!("errors.app.server.notMinecraft")))
    })
    .await;
    answer.unwrap_or_else(|_| Err(unreachable_server()))
}

fn unreachable_server() -> AppError {
    AppError::invalid(coded!("errors.app.server.unreachable"))
}

async fn request_status<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S, host: &str, port: u16) -> io::Result<ServerStatus> {
    let started = Instant::now();
    let request = [handshake_packet(host, port), packet(STATUS_PACKET, |_| {})].concat();
    stream.write_all(&request).await?;
    let json = read_status_json(stream).await?;
    to_status(&json, started.elapsed())
}

/// Liest das Statuspaket und gibt den JSON-Text daraus zurück; die Größe ist durch [`SERVER_STATUS_LIMIT`] begrenzt.
async fn read_status_json<R: AsyncRead + Unpin>(stream: &mut R) -> io::Result<Vec<u8>> {
    let packet_len = u64::try_from(read_varint(stream).await?).map_err(|_| invalid_data("negative Paketlänge"))?;
    if packet_len > SERVER_STATUS_LIMIT {
        return Err(invalid_data("Antwort zu groß"));
    }
    let mut packet = (&mut *stream).take(packet_len);
    if read_varint(&mut packet).await? != STATUS_PACKET {
        return Err(invalid_data("unerwartetes Paket"));
    }
    let json_len = read_varint(&mut packet).await?;
    let mut json = Vec::new();
    packet.read_to_end(&mut json).await?;
    if usize::try_from(json_len) != Ok(json.len()) {
        return Err(invalid_data("Länge des Status stimmt nicht"));
    }
    Ok(json)
}

fn to_status(json: &[u8], latency: Duration) -> io::Result<ServerStatus> {
    let status: Value = serde_json::from_slice(json).map_err(invalid_data)?;
    let count = |value: &Value| value.as_u64().map_or(0, |n| u32::try_from(n).unwrap_or(u32::MAX));
    let mut motd = String::new();
    push_component_text(&status["description"], &mut motd, 0);
    Ok(ServerStatus {
        motd: plain_text(&motd, MOTD_MAX_CHARS),
        players_online: count(&status["players"]["online"]),
        players_max: count(&status["players"]["max"]),
        version: plain_text(status["version"]["name"].as_str().unwrap_or_default(), VERSION_MAX_CHARS),
        latency_ms: u32::try_from(latency.as_millis()).unwrap_or(u32::MAX),
    })
}

/// Hängt den Text eines Chat-Bausteins an: ein String, eine Liste von Bausteinen oder ein Objekt mit `text` und `extra`.
fn push_component_text(component: &Value, out: &mut String, depth: usize) {
    if depth > COMPONENT_MAX_DEPTH {
        return;
    }
    match component {
        Value::String(text) => out.push_str(text),
        Value::Array(parts) => parts.iter().for_each(|part| push_component_text(part, out, depth + 1)),
        Value::Object(fields) => {
            if let Some(Value::String(text)) = fields.get("text") {
                out.push_str(text);
            }
            if let Some(extra) = fields.get("extra") {
                push_component_text(extra, out, depth + 1);
            }
        }
        _ => {}
    }
}

/// Unsichtbare Formatzeichen (Zero-Width, Bidi-Steuerung), mit denen ein Server die Zeile optisch verdrehen könnte.
fn is_invisible_format(c: char) -> bool {
    matches!(c, '\u{061C}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// Einzeiliger Klartext: ohne `§`-Formatierung, Steuerzeichen und unsichtbare Formatzeichen, Leerraum zusammengezogen,
/// mit `…` auf `max_chars` gekürzt.
fn plain_text(raw: &str, max_chars: usize) -> String {
    let mut chars = raw.chars();
    let mut text = String::new();
    while let Some(c) = chars.next() {
        match c {
            FORMAT_MARK => drop(chars.next()),
            c if c.is_control() => text.push(' '),
            c if is_invisible_format(c) => {}
            c => text.push(c),
        }
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max_chars {
        return text;
    }
    format!("{}…", text.chars().take(max_chars - 1).collect::<String>().trim_end())
}

fn handshake_packet(host: &str, port: u16) -> Vec<u8> {
    packet(HANDSHAKE_PACKET, |fields| {
        write_varint(fields, UNKNOWN_PROTOCOL);
        write_varint(fields, host.len() as i32);
        fields.extend_from_slice(host.as_bytes());
        fields.extend_from_slice(&port.to_be_bytes());
        write_varint(fields, NEXT_STATE_STATUS);
    })
}

/// Paket mit Länge, Kennung und den Feldern, die `write_fields` anhängt.
fn packet(id: i32, write_fields: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let mut body = Vec::new();
    write_varint(&mut body, id);
    write_fields(&mut body);
    let mut framed = Vec::with_capacity(body.len() + VARINT_MAX_BYTES);
    write_varint(&mut framed, body.len() as i32);
    framed.extend_from_slice(&body);
    framed
}

fn write_varint(out: &mut Vec<u8>, value: i32) {
    let mut rest = value as u32;
    loop {
        let low_bits = (rest & 0x7F) as u8;
        rest >>= 7;
        if rest == 0 {
            out.push(low_bits);
            return;
        }
        out.push(low_bits | 0x80);
    }
}

async fn read_varint<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<i32> {
    let mut value = 0u32;
    for shift in (0..).step_by(7).take(VARINT_MAX_BYTES) {
        let byte = reader.read_u8().await?;
        value |= u32::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err(invalid_data("VarInt zu lang"))
}

fn invalid_data(reason: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;
    use tokio::net::TcpListener;

    fn varint(value: i32) -> Vec<u8> {
        let mut out = Vec::new();
        write_varint(&mut out, value);
        out
    }

    /// Statuspaket, wie ein Server es sendet.
    fn status_packet(json: &str) -> Vec<u8> {
        packet(STATUS_PACKET, |fields| {
            write_varint(fields, json.len() as i32);
            fields.extend_from_slice(json.as_bytes());
        })
    }

    async fn read_json(bytes: Vec<u8>) -> io::Result<Vec<u8>> {
        read_status_json(&mut bytes.as_slice()).await
    }

    fn status_of(json: &str) -> ServerStatus {
        to_status(json.as_bytes(), Duration::from_millis(42)).unwrap()
    }

    #[test]
    fn encodes_varints_like_the_protocol() {
        assert_eq!(varint(0), [0x00]);
        assert_eq!(varint(127), [0x7F]);
        assert_eq!(varint(128), [0x80, 0x01]);
        assert_eq!(varint(25565), [0xDD, 0xC7, 0x01]);
        assert_eq!(varint(-1), [0xFF, 0xFF, 0xFF, 0xFF, 0x0F]);
    }

    #[tokio::test]
    async fn varints_survive_a_round_trip_and_reject_overlong_ones() {
        for value in [0, 1, 127, 128, 25565, i32::MAX, -1, i32::MIN] {
            assert_eq!(read_varint(&mut varint(value).as_slice()).await.unwrap(), value);
        }
        assert!(read_varint(&mut [0x80u8; 6].as_slice()).await.is_err());
        assert!(read_varint(&mut [0x80u8].as_slice()).await.is_err(), "Ende mitten im VarInt");
    }

    #[test]
    fn builds_handshake_and_request() {
        let handshake = handshake_packet("mc.example.net", 25565);
        let expected_body = [vec![0x00], varint(UNKNOWN_PROTOCOL), vec![14], b"mc.example.net".to_vec(), vec![0x63, 0xDD], vec![1]].concat();
        assert_eq!(handshake, [varint(expected_body.len() as i32), expected_body].concat());
        assert_eq!(packet(STATUS_PACKET, |_| {}), [0x01, 0x00]);
    }

    #[test]
    fn reads_players_version_and_latency() {
        let status = status_of(r#"{"version":{"name":"Paper 1.21.4","protocol":769},"players":{"max":100,"online":12},"description":"Hallo"}"#);
        assert_eq!(
            status,
            ServerStatus { motd: "Hallo".into(), players_online: 12, players_max: 100, version: "Paper 1.21.4".into(), latency_ms: 42 }
        );
    }

    #[test]
    fn flattens_chat_components_to_plain_text() {
        let component = r#"{"description":{"text":"§6Pump","extra":[{"text":"kin","bold":true},"\n",{"text":" §lSMP","extra":[" x"]}]}}"#;
        assert_eq!(status_of(component).motd, "Pumpkin SMP x");
        assert_eq!(status_of(r#"{"description":["A",{"text":"B"}]}"#).motd, "AB");
        assert_eq!(status_of(r#"{"description":"  §a§lGrün\u0007\n\tzwei  "}"#).motd, "Grün zwei");
    }

    #[test]
    fn drops_bidi_overrides_and_zero_width_characters() {
        assert_eq!(status_of(r#"{"description":"Lo\u202Ebby\u200B \u2066x\u2069\uFEFF!"}"#).motd, "Lobby x!");
        assert_eq!(status_of(r#"{"description":"a\u200Fb"}"#).motd, "ab");
    }

    #[test]
    fn tolerates_missing_and_odd_fields() {
        let status = status_of(r#"{"players":{"online":-3,"max":99999999999},"description":{"translate":"x"},"version":{"name":7}}"#);
        assert_eq!(status, ServerStatus { motd: String::new(), players_online: 0, players_max: u32::MAX, version: String::new(), latency_ms: 42 });
        assert_eq!(status_of("{}").players_online, 0);
        assert!(to_status(b"[1,", Duration::ZERO).is_err());
    }

    #[test]
    fn caps_text_length_and_nesting() {
        let long = "ä".repeat(MOTD_MAX_CHARS + 50);
        let motd = status_of(&format!(r#"{{"description":"{long}"}}"#)).motd;
        assert_eq!(motd.chars().count(), MOTD_MAX_CHARS);
        assert!(motd.ends_with('…'));

        let deep = format!("{}{}{}", r#"{"extra":["#.repeat(20), r#"{"text":"tief"}"#, "]}".repeat(20));
        assert_eq!(status_of(&format!(r#"{{"description":{deep}}}"#)).motd, "");
    }

    #[tokio::test]
    async fn reads_a_status_packet_and_rejects_bad_ones() {
        let json = r#"{"description":"ok"}"#;
        assert_eq!(read_json(status_packet(json)).await.unwrap(), json.as_bytes());

        let wrong_id = packet(0x01, |fields| fields.extend_from_slice(&[1, b'x']));
        let wrong_json_len = packet(STATUS_PACKET, |fields| fields.extend_from_slice(&[9, b'x']));
        let oversized = varint(SERVER_STATUS_LIMIT as i32 + 1);
        let truncated = status_packet(json)[..10].to_vec();
        for (name, bytes) in [("falsche Kennung", wrong_id), ("falsche Länge", wrong_json_len), ("zu groß", oversized), ("abgeschnitten", truncated), ("leer", vec![]), ("negativ", varint(-5))] {
            assert!(read_json(bytes).await.is_err(), "{name}");
        }
    }

    #[tokio::test]
    async fn oversized_answers_are_refused_without_reading_them() {
        let (mut client, mut server) = duplex(64);
        let sender = tokio::spawn(async move {
            // Kündigt mehr an, als erlaubt ist, und liefert dann nichts mehr: der Client darf nicht darauf warten.
            server.write_all(&varint(SERVER_STATUS_LIMIT as i32 + 1)).await.unwrap();
            tokio::time::sleep(Duration::from_secs(30)).await;
        });
        let result = tokio::time::timeout(Duration::from_secs(2), read_status_json(&mut client)).await;
        assert!(result.expect("kein Warten auf die angekündigten Bytes").is_err());
        sender.abort();
    }

    #[tokio::test]
    async fn asks_the_server_and_reads_the_answer() {
        let (mut client, mut server) = duplex(4096);
        let fake_server = tokio::spawn(async move {
            let expected = [handshake_packet("mc.example.net", 25570), packet(STATUS_PACKET, |_| {})].concat();
            let mut received = vec![0; expected.len()];
            server.read_exact(&mut received).await.unwrap();
            assert_eq!(received, expected);
            server.write_all(&status_packet(r#"{"players":{"online":3,"max":20},"description":"§aHi"}"#)).await.unwrap();
        });
        let status = request_status(&mut client, "mc.example.net", 25570).await.unwrap();
        fake_server.await.unwrap();
        assert_eq!((status.motd.as_str(), status.players_online, status.players_max), ("Hi", 3, 20));
    }

    #[tokio::test]
    async fn pings_a_listening_server_and_reports_dead_ones() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let fake_server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let expected = [handshake_packet("127.0.0.1", port), packet(STATUS_PACKET, |_| {})].concat();
            stream.read_exact(&mut vec![0; expected.len()]).await.unwrap();
            stream.write_all(&status_packet(r#"{"version":{"name":"1.21"},"description":"da"}"#)).await.unwrap();
        });
        let status = ping(&format!("127.0.0.1:{port}")).await.unwrap();
        fake_server.await.unwrap();
        assert_eq!((status.motd.as_str(), status.version.as_str()), ("da", "1.21"));

        assert!(ping(&format!("127.0.0.1:{port}")).await.is_err(), "niemand hört mehr zu");
        assert!(ping("not a valid address!!").await.is_err());
    }
}
