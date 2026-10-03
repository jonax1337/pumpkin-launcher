//! Prüfungen am Minecraft-Protokoll, bevor ein Tunnel Bytes weiterreicht (SPEC 6.1, 6.2). Der Gastgeber lässt einen
//! Stream erst an den LAN-Port, wenn sein erstes Paket ein Handshake ist und beim Anmelden das zweite ein Login Start
//! mit gültigem Spielernamen. Der Gast prüft am Handshake, ob eine lokale Verbindung wirklich an seinen Zuhörer ging.
use std::net::SocketAddr;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};

const HANDSHAKE_PACKET_MAX: usize = 1024;
const ADDRESS_MAX_CHARS: usize = 255;
/// Ein Zeichen braucht in UTF-8 höchstens vier Bytes.
const ADDRESS_MAX_BYTES: usize = ADDRESS_MAX_CHARS * 4;
const PLAYER_NAME_MAX: usize = 16;
const VARINT_MAX_BYTES: usize = 5;
/// Erstes Byte des alten Status-Pings (vor 1.7); er hat kein Handshake.
const LEGACY_PING: u8 = 0xFE;
const HANDSHAKE_ID: i32 = 0x00;
const LOGIN_START_ID: i32 = 0x00;
const NEXT_STATE_STATUS: i32 = 1;
const NEXT_STATE_LOGIN: i32 = 2;

/// Wie lange und wie viel gelesen wird, bevor eine Prüfung aufgibt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Window {
    pub(super) wait: Duration,
    pub(super) max_bytes: usize,
}

/// Gastgeber: Handshake und Login Start, bevor der LAN-Port berührt wird.
pub(super) const HOST_WINDOW: Window = Window { wait: Duration::from_secs(5), max_bytes: 2048 };
/// Gast: nur der Handshake an seinem Zuhörer.
pub(super) const GUEST_WINDOW: Window = Window { wait: Duration::from_secs(2), max_bytes: 1024 };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NextState {
    Status,
    Login,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Handshake {
    pub(super) address: String,
    pub(super) port: u16,
    pub(super) next: NextState,
}

impl Handshake {
    /// Spricht der Handshake genau diesen Zuhörer an? Forge hängt nach einem NUL eigene Kennungen an die Adresse.
    pub(super) fn is_addressed_to(&self, listener: SocketAddr) -> bool {
        let host = self.address.split('\0').next().unwrap_or_default();
        host == listener.ip().to_string() && self.port == listener.port()
    }
}

/// Was die bisher gelesenen Bytes ergeben.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Check<T> {
    NeedMore,
    Refused,
    Valid(T),
}

/// Prüft den Anfang eines Tunnel-Streams beim Gastgeber: Handshake (Status oder Login), beim Login dann Login Start.
pub(super) fn check_host_opening(bytes: &[u8], max_bytes: usize) -> Check<()> {
    let (handshake, used) = match check_handshake(bytes, max_bytes) {
        Check::Valid(found) => found,
        Check::NeedMore => return Check::NeedMore,
        Check::Refused => return Check::Refused,
    };
    match handshake.next {
        NextState::Status => Check::Valid(()),
        NextState::Login => check_login_start(&bytes[used..], max_bytes - used),
    }
}

/// Prüft das erste Paket auf einen Handshake; liefert ihn mit seiner Länge in Bytes.
pub(super) fn check_handshake(bytes: &[u8], max_bytes: usize) -> Check<(Handshake, usize)> {
    if bytes.first() == Some(&LEGACY_PING) {
        return Check::Refused;
    }
    match packet(bytes, HANDSHAKE_PACKET_MAX.min(max_bytes)) {
        Check::Valid((body, used)) => match parse_handshake(body) {
            Some(handshake) => Check::Valid((handshake, used)),
            None => Check::Refused,
        },
        Check::NeedMore => Check::NeedMore,
        Check::Refused => Check::Refused,
    }
}

fn check_login_start(bytes: &[u8], max_bytes: usize) -> Check<()> {
    match packet(bytes, max_bytes) {
        Check::Valid((body, _)) if is_login_start(body) => Check::Valid(()),
        Check::Valid(_) | Check::Refused => Check::Refused,
        Check::NeedMore => Check::NeedMore,
    }
}

/// Liest, bis `check` entscheidet; `None` bei Ablehnung, Zeitablauf, Ende oder vollem Fenster. Die gelesenen Bytes
/// kommen mit, denn sie müssen danach weitergereicht werden.
pub(super) async fn read_checked<T>(
    reader: &mut (impl AsyncRead + Unpin),
    window: Window,
    check: impl Fn(&[u8]) -> Check<T>,
) -> Option<(T, Vec<u8>)> {
    tokio::time::timeout(window.wait, read_until_decided(reader, window.max_bytes, check)).await.ok().flatten()
}

async fn read_until_decided<T>(
    reader: &mut (impl AsyncRead + Unpin),
    max_bytes: usize,
    check: impl Fn(&[u8]) -> Check<T>,
) -> Option<(T, Vec<u8>)> {
    let mut bytes = Vec::with_capacity(max_bytes);
    let mut chunk = vec![0; max_bytes];
    loop {
        let read = reader.read(&mut chunk[..max_bytes - bytes.len()]).await.ok()?;
        if read == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..read]);
        match check(&bytes) {
            Check::Valid(found) => return Some((found, bytes)),
            Check::Refused => return None,
            Check::NeedMore if bytes.len() >= max_bytes => return None,
            Check::NeedMore => {}
        }
    }
}

/// Ein Paket mit VarInt-Länge von höchstens `max_length`: sein Inhalt und wie viele Bytes es samt Länge belegt.
fn packet(bytes: &[u8], max_length: usize) -> Check<(&[u8], usize)> {
    let (length, prefix) = match varint(bytes) {
        Check::Valid(found) => found,
        Check::NeedMore => return Check::NeedMore,
        Check::Refused => return Check::Refused,
    };
    let Ok(length) = usize::try_from(length) else { return Check::Refused };
    if length == 0 || length > max_length {
        return Check::Refused;
    }
    match bytes.get(prefix..prefix + length) {
        Some(body) => Check::Valid((body, prefix + length)),
        None => Check::NeedMore,
    }
}

fn varint(bytes: &[u8]) -> Check<(i32, usize)> {
    let mut value = 0u32;
    for (index, byte) in bytes.iter().take(VARINT_MAX_BYTES).enumerate() {
        value |= u32::from(byte & 0x7F) << (7 * index);
        if byte & 0x80 == 0 {
            return Check::Valid((value as i32, index + 1));
        }
    }
    if bytes.len() >= VARINT_MAX_BYTES {
        Check::Refused
    } else {
        Check::NeedMore
    }
}

/// Handshake: Kennung, Protokoll, Serveradresse, Port, nächster Zustand; das Paket muss genau so lang sein.
fn parse_handshake(body: &[u8]) -> Option<Handshake> {
    let mut fields = Fields(body);
    if fields.varint()? != HANDSHAKE_ID {
        return None;
    }
    fields.varint()?;
    let address = fields.string(ADDRESS_MAX_BYTES)?;
    let port = fields.u16()?;
    let next = match fields.varint()? {
        NEXT_STATE_STATUS => NextState::Status,
        NEXT_STATE_LOGIN => NextState::Login,
        _ => return None,
    };
    let fits = fields.is_empty() && address.chars().count() <= ADDRESS_MAX_CHARS;
    fits.then_some(Handshake { address, port, next })
}

/// Login Start: Kennung und als erstes Feld ein Spielername `^[A-Za-z0-9_]{1,16}$`; der Rest gehört dem Spiel.
fn is_login_start(body: &[u8]) -> bool {
    let mut fields = Fields(body);
    fields.varint() == Some(LOGIN_START_ID) && fields.string(PLAYER_NAME_MAX).is_some_and(|name| is_player_name(&name))
}

fn is_player_name(name: &str) -> bool {
    (1..=PLAYER_NAME_MAX).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Liest Felder aus einem vollständigen Paketinhalt; was fehlt, ist ein Fehler.
struct Fields<'a>(&'a [u8]);

impl Fields<'_> {
    fn varint(&mut self) -> Option<i32> {
        let Check::Valid((value, used)) = varint(self.0) else { return None };
        self.0 = &self.0[used..];
        Some(value)
    }

    fn string(&mut self, max_bytes: usize) -> Option<String> {
        let length = usize::try_from(self.varint()?).ok().filter(|length| *length <= max_bytes)?;
        let text = std::str::from_utf8(self.0.get(..length)?).ok()?.to_owned();
        self.0 = &self.0[length..];
        Some(text)
    }

    fn u16(&mut self) -> Option<u16> {
        let bytes: [u8; 2] = self.0.get(..2)?.try_into().ok()?;
        self.0 = &self.0[2..];
        Some(u16::from_be_bytes(bytes))
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Pakete, wie ein Spiel sie sendet; auch für die Sitzungstests.
#[cfg(test)]
pub(super) mod wire {
    pub(crate) fn varint(value: i32) -> Vec<u8> {
        let mut rest = value as u32;
        let mut out = Vec::new();
        loop {
            let low = (rest & 0x7F) as u8;
            rest >>= 7;
            if rest == 0 {
                out.push(low);
                return out;
            }
            out.push(low | 0x80);
        }
    }

    pub(crate) fn string(text: &str) -> Vec<u8> {
        [varint(text.len() as i32), text.as_bytes().to_vec()].concat()
    }

    pub(crate) fn packet(body: &[u8]) -> Vec<u8> {
        [varint(body.len() as i32), body.to_vec()].concat()
    }

    pub(crate) fn handshake(address: &str, port: u16, next: i32) -> Vec<u8> {
        let body = [varint(0), varint(774), string(address), port.to_be_bytes().to_vec(), varint(next)].concat();
        packet(&body)
    }

    pub(crate) fn login_start(name: &str) -> Vec<u8> {
        packet(&[varint(0), string(name), [7u8; 16].to_vec()].concat())
    }
}

#[cfg(test)]
mod tests {
    use super::wire::{handshake, login_start, packet, string, varint};
    use super::*;

    const MAX: usize = HOST_WINDOW.max_bytes;

    fn login(name: &str) -> Vec<u8> {
        [handshake("localhost", 25565, 2), login_start(name)].concat()
    }

    #[test]
    fn status_handshake_alone_is_a_valid_opening() {
        assert_eq!(check_host_opening(&handshake("localhost", 25565, 1), MAX), Check::Valid(()));
    }

    #[test]
    fn login_needs_a_login_start_with_a_player_name() {
        assert_eq!(check_host_opening(&login("Steve_01"), MAX), Check::Valid(()));
        assert_eq!(check_host_opening(&handshake("localhost", 25565, 2), MAX), Check::NeedMore);
    }

    #[test]
    fn bad_player_names_are_refused() {
        for name in ["", "Steve Smith", "Stéve", "a_name_far_too_long", "x§c"] {
            assert_eq!(check_host_opening(&login(name), MAX), Check::Refused, "{name:?}");
        }
    }

    #[test]
    fn transfer_and_unknown_next_states_are_refused() {
        for next in [0, 3, 4] {
            assert_eq!(check_host_opening(&handshake("localhost", 25565, next), MAX), Check::Refused, "{next}");
        }
    }

    #[test]
    fn legacy_ping_is_refused_at_its_first_byte() {
        assert_eq!(check_host_opening(&[0xFE], MAX), Check::Refused);
        assert_eq!(check_host_opening(&[0xFE, 0x01, 0xFA], MAX), Check::Refused);
    }

    #[test]
    fn a_handshake_packet_over_1024_bytes_is_refused_before_it_arrives() {
        assert_eq!(check_host_opening(&varint(1025), MAX), Check::Refused);
        assert_eq!(check_host_opening(&varint(1024), MAX), Check::NeedMore);
    }

    #[test]
    fn a_login_start_beyond_the_window_is_refused() {
        let opening = [handshake("localhost", 25565, 2), varint(MAX as i32)].concat();

        assert_eq!(check_host_opening(&opening, MAX), Check::Refused);
    }

    #[test]
    fn an_address_over_255_characters_is_refused() {
        let long = "a".repeat(256);

        assert_eq!(check_host_opening(&handshake(&long, 25565, 1), MAX), Check::Refused);
        assert!(matches!(check_handshake(&handshake(&"a".repeat(255), 1, 1), MAX), Check::Valid(_)));
    }

    #[test]
    fn other_first_packets_and_trailing_fields_are_refused() {
        let not_handshake = packet(&[varint(1), varint(774)].concat());
        let trailing = packet(&[varint(0), varint(774), string("x"), vec![0, 1], varint(1), vec![9]].concat());

        assert_eq!(check_host_opening(&not_handshake, MAX), Check::Refused);
        assert_eq!(check_host_opening(&trailing, MAX), Check::Refused);
        assert_eq!(check_host_opening(&[0xFF; 5], MAX), Check::Refused, "VarInt too long");
    }

    #[test]
    fn a_split_handshake_needs_more_bytes() {
        let full = handshake("localhost", 25565, 1);

        assert_eq!(check_host_opening(&full[..full.len() - 1], MAX), Check::NeedMore);
    }

    #[test]
    fn the_guest_handshake_must_name_the_listener_ip_and_port() {
        let listener: SocketAddr = "127.4.5.6:41000".parse().unwrap();
        let parsed = |bytes: Vec<u8>| match check_handshake(&bytes, GUEST_WINDOW.max_bytes) {
            Check::Valid((handshake, _)) => handshake,
            other => panic!("{other:?}"),
        };

        assert!(parsed(handshake("127.4.5.6", 41000, 2)).is_addressed_to(listener));
        assert!(parsed(handshake("127.4.5.6\0FML3\0", 41000, 2)).is_addressed_to(listener));
        assert!(!parsed(handshake("127.0.0.1", 41000, 2)).is_addressed_to(listener));
        assert!(!parsed(handshake("127.4.5.6", 41001, 2)).is_addressed_to(listener));
    }

    /// macOS lauscht auf `127.0.0.1` (SPEC 6.2); auch dort zählt nur genau diese Adresse.
    #[test]
    fn a_guest_listener_on_127_0_0_1_accepts_only_that_address() {
        let listener: SocketAddr = "127.0.0.1:41000".parse().unwrap();
        let addressed = |host: &str| match check_handshake(&handshake(host, 41000, 2), GUEST_WINDOW.max_bytes) {
            Check::Valid((handshake, _)) => handshake.is_addressed_to(listener),
            other => panic!("{other:?}"),
        };

        assert!(addressed("127.0.0.1"));
        assert!(!addressed("127.0.0.2"));
        assert!(!addressed("localhost"));
    }

    #[tokio::test]
    async fn reading_returns_the_checked_bytes_or_nothing() {
        let opening = login("Alex");
        let (mut client, mut server) = tokio::io::duplex(4096);
        tokio::io::AsyncWriteExt::write_all(&mut client, &opening).await.unwrap();

        let read = read_checked(&mut server, HOST_WINDOW, |bytes| check_host_opening(bytes, MAX)).await;

        assert_eq!(read, Some(((), opening)));
    }

    #[tokio::test]
    async fn a_silent_reader_times_out() {
        let (_client, mut server) = tokio::io::duplex(64);
        let window = Window { wait: Duration::from_millis(50), max_bytes: 64 };

        assert_eq!(read_checked(&mut server, window, |bytes| check_host_opening(bytes, 64)).await, None);
    }
}
