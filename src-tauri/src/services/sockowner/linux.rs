//! Linux: `/proc/net/tcp` und `/proc/net/tcp6` nennen die Sockets samt Inode, `/proc/<pid>/fd` die Inodes eines
//! Prozesses. Gelesen wird über `ProcFiles` unter einer wählbaren Wurzel; Auswerten und Entscheiden sind nicht an Linux
//! gebunden (und deshalb überall testbar).
use std::collections::HashSet;
use std::fs;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;

#[cfg(target_os = "linux")]
use super::SocketTable;
use super::{TcpSocket, TcpState};

#[cfg(target_os = "linux")]
const PROC_ROOT: &str = "/proc";
const IPV4_TABLE: &str = "tcp";
const IPV6_TABLE: &str = "tcp6";
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
        sockets_in(&ProcDir { root: PathBuf::from(PROC_ROOT) }, pid)
    }
}

/// Die Dateien unter `/proc`, aus denen sich die Sockets eines Prozesses ergeben.
trait ProcFiles {
    /// Der Inhalt der Socket-Tabelle `net/<name>`.
    fn net_table(&self, name: &str) -> io::Result<String>;
    /// Die Ziele der Descriptor-Links unter `<pid>/fd`.
    fn descriptor_targets(&self, pid: u32) -> io::Result<Vec<String>>;
}

/// Ein `/proc` unter `root`.
struct ProcDir {
    root: PathBuf,
}

impl ProcFiles for ProcDir {
    fn net_table(&self, name: &str) -> io::Result<String> {
        fs::read_to_string(self.root.join("net").join(name))
    }

    /// Ein Descriptor kann zwischen Auflisten und Lesen schließen, der Prozess mitten im Auflisten enden. Solche
    /// Einträge fallen weg; das kann dem Prozess nur Sockets absprechen, nie fremde zusprechen.
    fn descriptor_targets(&self, pid: u32) -> io::Result<Vec<String>> {
        let entries = fs::read_dir(self.root.join(pid.to_string()).join("fd"))?;
        let links = entries.flatten().filter_map(|entry| fs::read_link(entry.path()).ok());
        Ok(links.filter_map(|link| link.into_os_string().into_string().ok()).collect())
    }
}

/// Die Sockets des Prozesses `pid`. Fehlt die IPv4-Tabelle, fehlt `/proc` selbst: dann scheitert die Abfrage, bevor
/// nach dem Prozess gefragt wird.
fn sockets_in(files: &impl ProcFiles, pid: u32) -> io::Result<Vec<TcpSocket>> {
    let tables = [files.net_table(IPV4_TABLE)?, ipv6_table(files)?];
    let inodes = socket_inodes(files, pid)?;
    Ok(tables.iter().flat_map(|table| parse_table(table, &inodes)).collect())
}

/// Ein Kernel ohne IPv6 hat keine `tcp6`-Tabelle; dann hat auch kein Prozess IPv6-Sockets.
fn ipv6_table(files: &impl ProcFiles) -> io::Result<String> {
    match files.net_table(IPV6_TABLE) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        table => table,
    }
}

/// Die Inodes aller Sockets, die der Prozess offen hat. Ist er beendet (kein `<pid>`) oder sind seine Descriptoren
/// nicht lesbar, lässt sich ihm kein Socket zuordnen: er besitzt keinen.
fn socket_inodes(files: &impl ProcFiles, pid: u32) -> io::Result<HashSet<u64>> {
    match files.descriptor_targets(pid) {
        Ok(targets) => Ok(targets.iter().filter_map(|target| socket_inode(target)).collect()),
        Err(error) if is_out_of_reach(&error) => Ok(HashSet::new()),
        Err(error) => Err(error),
    }
}

fn is_out_of_reach(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied)
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

    /// `[::1]:8080` lauschend (Inode 2001), wie ein Little-Endian-Rechner es schreibt.
    fn tcp6_table() -> String {
        [
            HEADER,
            "   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 2001 1 0000000000000000 100 0 0 10 0",
        ]
        .join("\n")
    }

    /// Ein `/proc`, dessen Teile einzeln fehlen oder scheitern können.
    struct FakeProc {
        tcp: Result<String, io::ErrorKind>,
        tcp6: Result<String, io::ErrorKind>,
        descriptors: Result<Vec<String>, io::ErrorKind>,
    }

    impl FakeProc {
        /// Der Prozess hält den Listener auf 25565 (IPv4) und den auf 8080 (IPv6), dazu eine Pipe.
        fn healthy() -> Self {
            let descriptors = ["socket:[1001]", "socket:[2001]", "pipe:[77]"].map(String::from).to_vec();
            Self { tcp: Ok(tcp_table()), tcp6: Ok(tcp6_table()), descriptors: Ok(descriptors) }
        }
    }

    impl ProcFiles for FakeProc {
        fn net_table(&self, name: &str) -> io::Result<String> {
            let table = if name == IPV4_TABLE { &self.tcp } else { &self.tcp6 };
            table.clone().map_err(io::Error::from)
        }

        fn descriptor_targets(&self, _pid: u32) -> io::Result<Vec<String>> {
            self.descriptors.clone().map_err(io::Error::from)
        }
    }

    fn ports(sockets: &[TcpSocket]) -> Vec<u16> {
        sockets.iter().map(|socket| socket.local.port()).collect()
    }

    #[test]
    fn a_process_owns_the_sockets_of_both_tables() {
        assert_eq!(ports(&sockets_in(&FakeProc::healthy(), 1).unwrap()), [25565, 8080]);
    }

    #[test]
    fn without_a_tcp6_table_there_are_no_ipv6_sockets() {
        let proc = FakeProc { tcp6: Err(io::ErrorKind::NotFound), ..FakeProc::healthy() };
        assert_eq!(ports(&sockets_in(&proc, 1).unwrap()), [25565]);
    }

    #[test]
    fn an_empty_tcp6_table_has_no_sockets() {
        for empty in [String::new(), HEADER.to_owned()] {
            let proc = FakeProc { tcp6: Ok(empty), ..FakeProc::healthy() };
            assert_eq!(ports(&sockets_in(&proc, 1).unwrap()), [25565]);
        }
    }

    #[test]
    fn an_unreadable_tcp6_table_fails_the_lookup() {
        let proc = FakeProc { tcp6: Err(io::ErrorKind::PermissionDenied), ..FakeProc::healthy() };
        assert!(sockets_in(&proc, 1).is_err());
    }

    #[test]
    fn without_the_tcp_table_the_lookup_fails_even_for_an_ended_process() {
        for missing in [io::ErrorKind::NotFound, io::ErrorKind::PermissionDenied] {
            let proc = FakeProc { tcp: Err(missing), descriptors: Err(io::ErrorKind::NotFound), ..FakeProc::healthy() };
            assert!(sockets_in(&proc, 1).is_err(), "{missing:?}");
        }
    }

    #[test]
    fn a_process_that_ended_during_the_lookup_owns_no_sockets() {
        let proc = FakeProc { descriptors: Err(io::ErrorKind::NotFound), ..FakeProc::healthy() };
        assert!(sockets_in(&proc, 1).unwrap().is_empty());
    }

    #[test]
    fn a_process_with_unreadable_descriptors_owns_no_sockets() {
        let proc = FakeProc { descriptors: Err(io::ErrorKind::PermissionDenied), ..FakeProc::healthy() };
        assert!(sockets_in(&proc, 1).unwrap().is_empty());
    }

    #[test]
    fn other_descriptor_errors_fail_the_lookup() {
        let proc = FakeProc { descriptors: Err(io::ErrorKind::InvalidData), ..FakeProc::healthy() };
        assert!(sockets_in(&proc, 1).is_err());
    }

    /// Ein nachgebautes `/proc` auf der Platte; die Descriptoren sind Links wie beim Kernel.
    #[cfg(unix)]
    mod on_disk {
        use super::*;

        const PID: u32 = 4711;

        struct ProcRoot(PathBuf);

        impl ProcRoot {
            /// Nur `net/tcp` (ohne IPv6) und `PID` mit dem Socket 1001, einer Pipe und einem Eintrag, der kein Link
            /// (mehr) ist, wie ein Descriptor, der zwischen Auflisten und Lesen schließt.
            fn without_ipv6() -> Self {
                let root = std::env::temp_dir().join(format!("sockowner-proc-{}", crate::models::new_id()));
                let fd = root.join(PID.to_string()).join("fd");
                fs::create_dir_all(root.join("net")).unwrap();
                fs::create_dir_all(&fd).unwrap();
                fs::write(root.join("net").join(IPV4_TABLE), tcp_table()).unwrap();
                std::os::unix::fs::symlink("socket:[1001]", fd.join("3")).unwrap();
                std::os::unix::fs::symlink("pipe:[77]", fd.join("4")).unwrap();
                fs::write(fd.join("5"), "").unwrap();
                Self(root)
            }

            fn files(&self) -> ProcDir {
                ProcDir { root: self.0.clone() }
            }
        }

        impl Drop for ProcRoot {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        #[test]
        fn descriptors_are_read_from_the_links_and_vanished_ones_are_skipped() {
            let proc = ProcRoot::without_ipv6();
            assert_eq!(ports(&sockets_in(&proc.files(), PID).unwrap()), [25565]);
        }

        #[test]
        fn a_process_without_a_directory_owns_no_sockets() {
            let proc = ProcRoot::without_ipv6();
            assert!(sockets_in(&proc.files(), PID + 1).unwrap().is_empty());
        }

        #[test]
        fn a_root_without_tables_fails_the_lookup() {
            let proc = ProcRoot::without_ipv6();
            fs::remove_file(proc.0.join("net").join(IPV4_TABLE)).unwrap();
            assert!(sockets_in(&proc.files(), PID).is_err());
        }
    }
}
