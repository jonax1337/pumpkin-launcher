//! Der Lauscher der Brücke (docs/friends/INGAME.md, 5.2): nur Loopback, ein freier Port, und unter Windows
//! ausschließlich für diesen Prozess.
use std::io;
use std::net::{Ipv4Addr, SocketAddr};

use tokio::net::{TcpListener, TcpSocket};

const BACKLOG: u32 = 128;

/// Lauscht auf `127.0.0.1` an einem freien Port. Unter Windows lässt `SO_EXCLUSIVEADDRUSE` keinen anderen Socket an
/// denselben Port, auch keinen mit `SO_REUSEADDR`: sonst könnte ein Prozess desselben Nutzers den Port mitbenutzen und
/// Verbindungen der Mod abfangen. Auf anderen Systemen gibt `SO_REUSEADDR` einem zweiten Socket keinen lauschenden Port.
pub(super) fn bind_loopback() -> io::Result<TcpListener> {
    let socket = TcpSocket::new_v4()?;
    exclusive_address_use(&socket)?;
    socket.bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
    socket.listen(BACKLOG)
}

#[cfg(windows)]
fn exclusive_address_use(socket: &TcpSocket) -> io::Result<()> {
    use std::os::windows::io::AsRawSocket;
    use windows_sys::Win32::Networking::WinSock::{setsockopt, SOCKET_ERROR, SOL_SOCKET, SO_EXCLUSIVEADDRUSE};

    let enabled = 1u32;
    let option_len = i32::try_from(size_of::<u32>()).map_err(io::Error::other)?;
    // SAFETY: `socket` ist ein offener Socket; `enabled` lebt über den Aufruf hinaus und hat die Größe `option_len`.
    let status = unsafe {
        setsockopt(socket.as_raw_socket() as usize, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (&raw const enabled).cast(), option_len)
    };
    if status == SOCKET_ERROR {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn exclusive_address_use(_socket: &TcpSocket) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_listener_is_bound_to_loopback_on_a_free_port() {
        let listener = bind_loopback().unwrap();
        let address = listener.local_addr().unwrap();
        assert!(address.ip().is_loopback() && address.ip().is_ipv4());
        assert_ne!(address.port(), 0);
    }

    #[tokio::test]
    async fn two_listeners_get_two_ports() {
        let (first, second) = (bind_loopback().unwrap(), bind_loopback().unwrap());
        assert_ne!(first.local_addr().unwrap().port(), second.local_addr().unwrap().port());
    }

    /// Ohne `SO_EXCLUSIVEADDRUSE` darf unter Windows ein zweiter Socket mit `SO_REUSEADDR` den Port mitbenutzen, wenn er
    /// die Wildcard-Adresse bindet (gemessen mit einem gewöhnlichen `std`-Lauscher: das gelingt). Dieselbe Adresse
    /// scheitert auch ohne das Flag; der Wildcard-Fall ist deshalb der, der das Flag beweist.
    #[cfg(windows)]
    #[tokio::test]
    async fn on_windows_a_second_bind_with_reuseaddr_to_the_same_port_fails() {
        let listener = bind_loopback().unwrap();
        let taken = listener.local_addr().unwrap();
        let wildcard = SocketAddr::from((Ipv4Addr::UNSPECIFIED, taken.port()));

        for target in [taken, wildcard] {
            let other = TcpSocket::new_v4().unwrap();
            other.set_reuseaddr(true).unwrap();
            let error = other.bind(target).and_then(|()| other.listen(1).map(drop)).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::PermissionDenied, "{target}: {error}");
        }
    }
}
