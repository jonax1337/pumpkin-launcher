//! macOS: `lsof` listet die TCP-Sockets eines Prozesses. Der Aufruf hat feste Argumente (die Prozess-ID ist eine
//! Zahl); das Auswerten der Ausgabe ist nicht an macOS gebunden und deshalb überall testbar.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
#[cfg(target_os = "macos")]
use std::{io, process::Command};

#[cfg(target_os = "macos")]
use super::SocketTable;
use super::{TcpSocket, TcpState};

#[cfg(target_os = "macos")]
const LSOF: &str = "/usr/sbin/lsof";
/// `lsof` meldet „nichts gefunden“ mit diesem Exit-Code.
#[cfg(target_os = "macos")]
const EXIT_NOTHING_FOUND: i32 = 1;
const NAME_FIELD: &str = "n";
const STATE_FIELD: &str = "TST=";
const WILDCARD_HOST: &str = "*";
const ARROW: &str = "->";

#[cfg(target_os = "macos")]
pub struct LsofTable;

#[cfg(target_os = "macos")]
impl SocketTable for LsofTable {
    fn sockets_of(&self, pid: u32) -> io::Result<Vec<TcpSocket>> {
        let output = Command::new(LSOF).args(["-nP", "-a", "-p", &pid.to_string(), "-iTCP", "-F", "nT"]).output()?;
        if !output.status.success() && output.status.code() != Some(EXIT_NOTHING_FOUND) {
            return Err(io::Error::other(format!("lsof endete mit {}", output.status)));
        }
        Ok(parse_lsof(&String::from_utf8_lossy(&output.stdout)))
    }
}

/// Die Sockets aus der Feldausgabe (`-F nT`): je Socket eine Zeile `n<Adressen>` und eine Zeile `TST=<Zustand>`.
fn parse_lsof(output: &str) -> Vec<TcpSocket> {
    let mut sockets = Vec::new();
    let mut name = None;
    for line in output.lines() {
        if let Some(text) = line.strip_prefix(NAME_FIELD) {
            name = parse_name(text);
        } else if let Some(state) = line.strip_prefix(STATE_FIELD) {
            sockets.extend(name.take().map(|(local, remote)| TcpSocket { local, remote, state: parse_state(state) }));
        }
    }
    sockets
}

fn parse_state(text: &str) -> TcpState {
    match text {
        "LISTEN" => TcpState::Listen,
        "ESTABLISHED" => TcpState::Established,
        _ => TcpState::Other,
    }
}

/// `lokal` oder `lokal->entfernt`; ohne Gegenstelle ist sie die Nulladresse der Art des lokalen Endes.
fn parse_name(text: &str) -> Option<(SocketAddr, SocketAddr)> {
    let (local, remote) = text.split_once(ARROW).map_or((text, None), |(local, remote)| (local, Some(remote)));
    let local = parse_endpoint(local)?;
    let remote = match remote {
        Some(remote) => parse_endpoint(remote)?,
        None => SocketAddr::new(unspecified_like(local.ip()), 0),
    };
    Some((local, remote))
}

fn unspecified_like(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => Ipv4Addr::UNSPECIFIED.into(),
        IpAddr::V6(_) => Ipv6Addr::UNSPECIFIED.into(),
    }
}

/// `*:25565`, `127.0.0.1:25565` oder `[::1]:25565`.
fn parse_endpoint(text: &str) -> Option<SocketAddr> {
    let (host, port) = text.rsplit_once(':')?;
    let port = port.parse().ok()?;
    let ip = match host {
        WILDCARD_HOST => Ipv4Addr::UNSPECIFIED.into(),
        _ => host.trim_matches(['[', ']']).parse().ok()?,
    };
    Some(SocketAddr::new(ip, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(text: &str) -> SocketAddr {
        text.parse().unwrap()
    }

    const OUTPUT: &str = "p4711\nf45\nn*:25565\nTST=LISTEN\nTQR=0\nTQS=0\nf46\nn127.0.0.1:50000->127.0.0.1:25565\nTST=ESTABLISHED\nTQR=0\nTQS=0\n\
        f47\nn[::1]:50001->[::1]:8080\nTST=CLOSE_WAIT\nf48\nn[::]:9000\nTST=LISTEN\n";

    #[test]
    fn lsof_fields_become_sockets() {
        assert_eq!(
            parse_lsof(OUTPUT),
            [
                TcpSocket { local: addr("0.0.0.0:25565"), remote: addr("0.0.0.0:0"), state: TcpState::Listen },
                TcpSocket { local: addr("127.0.0.1:50000"), remote: addr("127.0.0.1:25565"), state: TcpState::Established },
                TcpSocket { local: addr("[::1]:50001"), remote: addr("[::1]:8080"), state: TcpState::Other },
                TcpSocket { local: addr("[::]:9000"), remote: addr("[::]:0"), state: TcpState::Listen },
            ]
        );
    }

    #[test]
    fn empty_and_broken_output_gives_no_sockets() {
        assert!(parse_lsof("").is_empty());
        assert!(parse_lsof("p4711\nf45\nnnonsense\nTST=LISTEN\nf46\nTST=LISTEN\n").is_empty());
    }

    #[test]
    fn a_state_does_not_attach_to_an_earlier_name() {
        let output = "n*:1000\nTST=LISTEN\nTST=ESTABLISHED\n";
        assert_eq!(parse_lsof(output).len(), 1);
    }
}
