//! Linux: `/proc/net/tcp` und `/proc/net/tcp6` nennen die Sockets samt Inode, `/proc/<pid>/fd` die Inodes eines
//! Prozesses. Das Lesen ist an Linux gebunden, das Auswerten der Tabellen nicht (und deshalb überall testbar).
use std::collections::HashSet;
#[cfg(target_os = "linux")]
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

#[cfg(target_os = "linux")]
use super::SocketTable;
use super::{TcpSocket, TcpState};

const TCP_TABLES: [&str; 2] = ["/proc/net/tcp", "/proc/net/tcp6"];
const STATE_ESTABLISHED: &str = "01";
const STATE_LISTEN: &str = "0A";
const SOCKET_LINK_PREFIX: &str = "socket:[";
/// Eine IPv6-Adresse besteht aus vier 32-Bit-Wörtern, je acht Hexzeichen.
const WORD_BYTES: usize = 4;
const WORD_HEX_LEN: usize = 8;
/// Spalten einer Zeile: sl, local_address, rem_address, st, tx:rx, tr:tm, retrnsmt, uid, timeout, inode.
const COLUMN_LOCAL: usize = 1;
const COLUMN_REMOTE: usize = 2;
const COLUMN_STATE: usize = 3;
const COLUMN_INODE: usize = 9;

#[cfg(target_os = "linux")]
pub struct ProcTable;

#[cfg(target_os = "linux")]
impl SocketTable for ProcTable {
    fn sockets_of(&self, pid: u32) -> io::Result<Vec<TcpSocket>> {
        let inodes = socket_inodes(pid)?;
        let mut sockets = Vec::new();
        for table in TCP_TABLES {
            sockets.extend(parse_table(&std::fs::read_to_string(table)?, &inodes));
        }
        Ok(sockets)
    }
}

/// Die Inodes aller Sockets, die der Prozess offen hat.
#[cfg(target_os = "linux")]
fn socket_inodes(pid: u32) -> io::Result<HashSet<u64>> {
    let mut inodes = HashSet::new();
    for entry in std::fs::read_dir(format!("/proc/{pid}/fd"))? {
        // Ein Descriptor kann zwischen Auflisten und Lesen schließen.
        let Ok(link) = std::fs::read_link(entry?.path()) else { continue };
        inodes.extend(link.to_str().and_then(socket_inode));
    }
    Ok(inodes)
}

/// Der Inode aus dem Ziel eines Descriptor-Links (`socket:[12345]`).
fn socket_inode(link: &str) -> Option<u64> {
    link.strip_prefix(SOCKET_LINK_PREFIX)?.strip_suffix(']')?.parse().ok()
}

/// Die Sockets einer Tabelle, deren Inode in `inodes` steht. Zeilen, die sich nicht lesen lassen, fallen weg.
fn parse_table(text: &str, inodes: &HashSet<u64>) -> Vec<TcpSocket> {
    text.lines().skip(1).filter_map(|line| parse_row(line, inodes)).collect()
}

fn parse_row(line: &str, inodes: &HashSet<u64>) -> Option<TcpSocket> {
    let columns: Vec<&str> = line.split_whitespace().collect();
    let inode: u64 = columns.get(COLUMN_INODE)?.parse().ok()?;
    if !inodes.contains(&inode) {
        return None;
    }
    Some(TcpSocket {
        local: parse_endpoint(columns.get(COLUMN_LOCAL)?)?,
        remote: parse_endpoint(columns.get(COLUMN_REMOTE)?)?,
        state: parse_state(columns.get(COLUMN_STATE)?),
    })
}

fn parse_state(hex: &str) -> TcpState {
    match hex {
        STATE_LISTEN => TcpState::Listen,
        STATE_ESTABLISHED => TcpState::Established,
        _ => TcpState::Other,
    }
}

/// `ADRESSE:PORT` in Hex. Der Kernel schreibt jedes 32-Bit-Wort der Adresse in der Byte-Reihenfolge des Rechners.
fn parse_endpoint(text: &str) -> Option<SocketAddr> {
    let (address, port) = text.split_once(':')?;
    let port = u16::from_str_radix(port, 16).ok()?;
    let ip = match address.len() {
        8 => IpAddr::V4(Ipv4Addr::from(word_bytes(address)?)),
        32 => IpAddr::V6(Ipv6Addr::from(ipv6_bytes(address)?)),
        _ => return None,
    };
    Some(SocketAddr::new(ip, port))
}

fn word_bytes(hex: &str) -> Option<[u8; 4]> {
    Some(u32::from_str_radix(hex, 16).ok()?.to_ne_bytes())
}

fn ipv6_bytes(hex: &str) -> Option<[u8; 16]> {
    let mut bytes = [0u8; 16];
    for index in 0..bytes.len() / WORD_BYTES {
        let word = hex.get(index * WORD_HEX_LEN..(index + 1) * WORD_HEX_LEN)?;
        bytes[index * WORD_BYTES..(index + 1) * WORD_BYTES].copy_from_slice(&word_bytes(word)?);
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";

    /// Ein lauschender Socket auf 0.0.0.0:25565 (Inode 1001) und eine Verbindung 127.0.0.1:50000 -> 127.0.0.1:25565
    /// (Inode 1002), wie sie ein Little-Endian-Rechner schreibt.
    fn tcp_table() -> String {
        [
            HEADER,
            "   0: 00000000:63DD 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1001 1 0000000000000000 100 0 0 10 0",
            "   1: 0100007F:C350 0100007F:63DD 01 00000000:00000000 00:00000000 00000000  1000        0 1002 1 0000000000000000 20 4 30 10 -1",
            "   2: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 9999 1 0000000000000000 100 0 0 10 0",
        ]
        .join("\n")
    }

    #[test]
    fn the_inodes_of_a_process_select_its_sockets() {
        let sockets = parse_table(&tcp_table(), &HashSet::from([1001, 1002]));
        assert_eq!(sockets.len(), 2);
        assert_eq!(sockets[0].state, TcpState::Listen);
        assert_eq!(sockets[0].local.port(), 25565);
        assert_eq!(sockets[1].state, TcpState::Established);
        assert_eq!(sockets[1].remote.port(), 25565);
        assert!(parse_table(&tcp_table(), &HashSet::from([4242])).is_empty());
    }

    #[test]
    #[cfg(target_endian = "little")]
    fn ipv4_addresses_are_read_in_host_byte_order() {
        let sockets = parse_table(&tcp_table(), &HashSet::from([1002]));
        assert_eq!(sockets[0].local, "127.0.0.1:50000".parse().unwrap());
        assert_eq!(sockets[0].remote, "127.0.0.1:25565".parse().unwrap());
    }

    #[test]
    #[cfg(target_endian = "little")]
    fn ipv6_addresses_are_read_word_by_word() {
        assert_eq!(parse_endpoint("00000000000000000000000001000000:1F90"), Some("[::1]:8080".parse().unwrap()));
        assert_eq!(parse_endpoint("00000000000000000000000000000000:0050"), Some("[::]:80".parse().unwrap()));
        let mapped = parse_endpoint("0000000000000000FFFF00000100007F:0050");
        assert_eq!(mapped, Some("[::ffff:127.0.0.1]:80".parse().unwrap()));
    }

    #[test]
    fn broken_rows_are_skipped() {
        let table = [HEADER, "garbage", "   0: ZZZZZZZZ:63DD 00000000:0000 0A 0:0 0:0 0 0 0 1001", "   1: 0100007F:63 00000000:0000 0A"].join("\n");
        assert!(parse_table(&table, &HashSet::from([1001])).is_empty());
    }

    #[test]
    fn descriptor_links_name_the_socket_inode() {
        assert_eq!(socket_inode("socket:[12345]"), Some(12345));
        assert_eq!(socket_inode("pipe:[12345]"), None);
        assert_eq!(socket_inode("/dev/null"), None);
        assert_eq!(socket_inode("socket:[abc]"), None);
    }
}
