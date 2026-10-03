//! Windows: die TCP-Tabelle mit Besitzer-Prozess aus dem IP-Helper (`GetExtendedTcpTable`), für IPv4 und IPv6.
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, MIB_TCP_STATE_ESTAB, MIB_TCP_STATE_LISTEN,
    TCP_TABLE_OWNER_PID_ALL,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

use super::{SocketTable, TcpSocket, TcpState};

const NO_ERROR: u32 = 0;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
/// Die Tabelle kann zwischen Größenabfrage und Abruf wachsen; so oft wird es erneut versucht.
const FETCH_ATTEMPTS: usize = 5;
/// Größe von `dwNumEntries` am Anfang jeder Tabelle, in Wörtern des Puffers.
const TABLE_HEADER_WORDS: usize = 1;

pub struct WindowsTable;

impl SocketTable for WindowsTable {
    fn sockets_of(&self, pid: u32) -> io::Result<Vec<TcpSocket>> {
        let v4 = fetch_table(u32::from(AF_INET))?;
        let v6 = fetch_table(u32::from(AF_INET6))?;
        // SAFETY: Beide Puffer hat `GetExtendedTcpTable` mit der passenden Zeilenart gefüllt (`TCP_TABLE_OWNER_PID_ALL`
        // für AF_INET bzw. AF_INET6).
        let (v4_rows, v6_rows) = unsafe { (rows::<MIB_TCPROW_OWNER_PID>(&v4), rows::<MIB_TCP6ROW_OWNER_PID>(&v6)) };
        let owned_v4 = v4_rows.iter().filter(|row| row.dwOwningPid == pid).map(socket_v4);
        let owned_v6 = v6_rows.iter().filter(|row| row.dwOwningPid == pid).map(socket_v6);
        Ok(owned_v4.chain(owned_v6).collect())
    }
}

/// Holt die Tabelle in einen Puffer aus `u32`, damit die Zeilen ausgerichtet darin liegen.
fn fetch_table(family: u32) -> io::Result<Vec<u32>> {
    let mut size = 0u32;
    for _ in 0..FETCH_ATTEMPTS {
        let mut buffer = vec![0u32; (size as usize).div_ceil(size_of::<u32>())];
        // SAFETY: `buffer` fasst mindestens `size` Byte; ohne Platz meldet die Funktion nur die nötige Größe.
        let status = unsafe { GetExtendedTcpTable(buffer.as_mut_ptr().cast(), &mut size, 0, family, TCP_TABLE_OWNER_PID_ALL, 0) };
        match status {
            NO_ERROR => return Ok(buffer),
            ERROR_INSUFFICIENT_BUFFER => continue,
            error => return Err(io::Error::from_raw_os_error(error as i32)),
        }
    }
    Err(io::Error::other("TCP-Tabelle wächst schneller, als sie sich lesen lässt"))
}

/// Die Zeilen einer Tabelle: erst die Anzahl, dann die Zeilen.
///
/// # Safety
/// `buffer` muss eine von `GetExtendedTcpTable` gefüllte Tabelle sein, deren Zeilen die Art `Row` haben.
unsafe fn rows<Row>(buffer: &[u32]) -> &[Row] {
    let count = buffer.first().copied().unwrap_or(0) as usize;
    // SAFETY: Laut Voraussetzung folgen `count` Zeilen der Art `Row` hinter der Anzahl; `Row` besteht aus `u32` und
    // `u8`-Feldern und ist damit im `u32`-Puffer ausgerichtet.
    unsafe { std::slice::from_raw_parts(buffer.as_ptr().add(TABLE_HEADER_WORDS).cast::<Row>(), count) }
}

fn socket_v4(row: &MIB_TCPROW_OWNER_PID) -> TcpSocket {
    let address = |raw: u32, port: u32| SocketAddr::new(IpAddr::V4(Ipv4Addr::from(raw.to_ne_bytes())), port_of(port));
    TcpSocket { local: address(row.dwLocalAddr, row.dwLocalPort), remote: address(row.dwRemoteAddr, row.dwRemotePort), state: state_of(row.dwState) }
}

fn socket_v6(row: &MIB_TCP6ROW_OWNER_PID) -> TcpSocket {
    let address = |raw: [u8; 16], port: u32| SocketAddr::new(IpAddr::V6(Ipv6Addr::from(raw)), port_of(port));
    TcpSocket { local: address(row.ucLocalAddr, row.dwLocalPort), remote: address(row.ucRemoteAddr, row.dwRemotePort), state: state_of(row.dwState) }
}

/// Der Port steht in Netzwerk-Byte-Reihenfolge in den unteren 16 Bit.
fn port_of(raw: u32) -> u16 {
    u16::from_be(raw as u16)
}

fn state_of(raw: u32) -> TcpState {
    match i32::try_from(raw) {
        Ok(MIB_TCP_STATE_LISTEN) => TcpState::Listen,
        Ok(MIB_TCP_STATE_ESTAB) => TcpState::Established,
        _ => TcpState::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn network_port(port: u16) -> u32 {
        u32::from(port.to_be())
    }

    #[test]
    fn an_ipv4_row_becomes_a_socket() {
        let row = MIB_TCPROW_OWNER_PID {
            dwState: MIB_TCP_STATE_ESTAB as u32,
            dwLocalAddr: u32::from_ne_bytes([127, 0, 0, 1]),
            dwLocalPort: network_port(50000),
            dwRemoteAddr: u32::from_ne_bytes([127, 1, 2, 3]),
            dwRemotePort: network_port(25565),
            dwOwningPid: 7,
        };
        let socket = socket_v4(&row);
        assert_eq!(socket.local, "127.0.0.1:50000".parse().unwrap());
        assert_eq!(socket.remote, "127.1.2.3:25565".parse().unwrap());
        assert_eq!(socket.state, TcpState::Established);
    }

    #[test]
    fn an_ipv6_row_becomes_a_socket() {
        let row = MIB_TCP6ROW_OWNER_PID {
            ucLocalAddr: Ipv6Addr::UNSPECIFIED.octets(),
            dwLocalScopeId: 0,
            dwLocalPort: network_port(8080),
            ucRemoteAddr: Ipv6Addr::LOCALHOST.octets(),
            dwRemoteScopeId: 0,
            dwRemotePort: network_port(1),
            dwState: MIB_TCP_STATE_LISTEN as u32,
            dwOwningPid: 7,
        };
        let socket = socket_v6(&row);
        assert_eq!(socket.local, "[::]:8080".parse().unwrap());
        assert_eq!(socket.remote, "[::1]:1".parse().unwrap());
        assert_eq!(socket.state, TcpState::Listen);
    }

    #[test]
    fn other_states_are_other() {
        assert_eq!(state_of(11), TcpState::Other);
        assert_eq!(state_of(u32::MAX), TcpState::Other);
    }
}
