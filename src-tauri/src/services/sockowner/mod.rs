//! Findet heraus, welcher Prozess einen lokalen TCP-Port besitzt oder von welchem eine Verbindung kommt.
//!
//! Jedes Betriebssystem liefert die Sockets eines Prozesses auf eigenem Weg (Windows: IP-Helper-Tabelle, Linux: `/proc`,
//! macOS: `lsof`); `SocketTable` verbirgt das, die Fragen selbst (`listens`, `connects_from`) sind für alle gleich.
use std::io;
use std::net::SocketAddr;

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod macos;
#[cfg(windows)]
mod windows;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TcpState {
    Listen,
    Established,
    Other,
}

/// Ein TCP-Socket eines Prozesses. `remote` ist bei einem lauschenden Socket die Nulladresse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TcpSocket {
    pub local: SocketAddr,
    pub remote: SocketAddr,
    pub state: TcpState,
}

/// Die TCP-Sockets eines Prozesses.
pub trait SocketTable {
    fn sockets_of(&self, pid: u32) -> io::Result<Vec<TcpSocket>>;
}

/// Lauscht der Prozess `pid` auf `port` (auf irgendeiner Adresse)?
pub fn listens(pid: u32, port: u16) -> io::Result<bool> {
    listens_in(&PlatformTable, pid, port)
}

/// Kommt die Verbindung, die an `client` (deren lokale Adresse beim Verbinder) endet, vom Prozess `pid`?
pub fn connects_from(pid: u32, client: SocketAddr) -> io::Result<bool> {
    connects_from_in(&PlatformTable, pid, client)
}

fn listens_in(table: &impl SocketTable, pid: u32, port: u16) -> io::Result<bool> {
    let sockets = table.sockets_of(pid)?;
    Ok(sockets.iter().any(|socket| socket.state == TcpState::Listen && socket.local.port() == port))
}

fn connects_from_in(table: &impl SocketTable, pid: u32, client: SocketAddr) -> io::Result<bool> {
    let sockets = table.sockets_of(pid)?;
    Ok(sockets.iter().any(|socket| socket.state != TcpState::Listen && socket.local == client))
}

#[cfg(windows)]
use windows::WindowsTable as PlatformTable;
#[cfg(target_os = "linux")]
use linux::ProcTable as PlatformTable;
#[cfg(target_os = "macos")]
use macos::LsofTable as PlatformTable;

/// Auf anderen Systemen gibt es keinen Weg, den Besitzer zu erfahren; die Fragen scheitern dann ausdrücklich.
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
struct PlatformTable;

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
impl SocketTable for PlatformTable {
    fn sockets_of(&self, _pid: u32) -> io::Result<Vec<TcpSocket>> {
        Err(io::Error::new(io::ErrorKind::Unsupported, "Port-Besitzer auf diesem System nicht ermittelbar"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, TcpListener, TcpStream};

    /// Sockets, wie sie ein Betriebssystem liefern könnte, je Prozess.
    struct FakeTable(Vec<(u32, TcpSocket)>);

    impl SocketTable for FakeTable {
        fn sockets_of(&self, pid: u32) -> io::Result<Vec<TcpSocket>> {
            Ok(self.0.iter().filter(|(owner, _)| *owner == pid).map(|(_, socket)| *socket).collect())
        }
    }

    fn addr(text: &str) -> SocketAddr {
        text.parse().unwrap()
    }

    fn socket(local: &str, remote: &str, state: TcpState) -> TcpSocket {
        TcpSocket { local: addr(local), remote: addr(remote), state }
    }

    fn fake() -> FakeTable {
        FakeTable(vec![
            (10, socket("0.0.0.0:25565", "0.0.0.0:0", TcpState::Listen)),
            (10, socket("127.0.0.1:25565", "127.0.0.1:50000", TcpState::Established)),
            (20, socket("127.0.0.1:50000", "127.0.0.1:25565", TcpState::Established)),
            (20, socket("[::]:8080", "[::]:0", TcpState::Listen)),
        ])
    }

    #[test]
    fn a_listening_socket_belongs_to_its_process_only() {
        let table = fake();
        assert!(listens_in(&table, 10, 25565).unwrap());
        assert!(listens_in(&table, 20, 8080).unwrap(), "IPv6 zählt ebenso");
        assert!(!listens_in(&table, 20, 25565).unwrap());
        assert!(!listens_in(&table, 10, 8080).unwrap());
        assert!(!listens_in(&table, 99, 25565).unwrap());
    }

    #[test]
    fn only_a_listening_socket_counts_as_listening() {
        let table = FakeTable(vec![(10, socket("127.0.0.1:7000", "127.0.0.1:7001", TcpState::Established))]);
        assert!(!listens_in(&table, 10, 7000).unwrap());
    }

    #[test]
    fn a_connection_is_found_by_its_local_address_and_owner() {
        let table = fake();
        assert!(connects_from_in(&table, 20, addr("127.0.0.1:50000")).unwrap());
        assert!(!connects_from_in(&table, 10, addr("127.0.0.1:50000")).unwrap(), "der Server-Teil gehört dem anderen");
        assert!(!connects_from_in(&table, 20, addr("127.0.0.1:50001")).unwrap());
    }

    #[test]
    fn a_listening_socket_is_no_connection() {
        let table = FakeTable(vec![(10, socket("0.0.0.0:25565", "0.0.0.0:0", TcpState::Listen))]);
        assert!(!connects_from_in(&table, 10, addr("0.0.0.0:25565")).unwrap());
    }

    #[test]
    fn a_failing_lookup_is_an_error_not_a_no() {
        struct Broken;
        impl SocketTable for Broken {
            fn sockets_of(&self, _pid: u32) -> io::Result<Vec<TcpSocket>> {
                Err(io::Error::other("kaputt"))
            }
        }
        assert!(listens_in(&Broken, 1, 1).is_err());
        assert!(connects_from_in(&Broken, 1, addr("127.0.0.1:1")).is_err());
    }

    #[test]
    fn a_listener_of_this_process_is_owned_by_it() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let pid = std::process::id();
        assert!(listens(pid, port).unwrap());
        assert!(!listens(pid.wrapping_add(1), port).unwrap());
    }

    #[test]
    fn a_connection_of_this_process_is_found_by_its_client_address() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_accepted, _) = listener.accept().unwrap();
        let pid = std::process::id();
        assert!(connects_from(pid, client.local_addr().unwrap()).unwrap());
        assert!(!connects_from(pid.wrapping_add(1), client.local_addr().unwrap()).unwrap());
    }
}
