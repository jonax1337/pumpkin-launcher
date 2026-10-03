//! Anwählen eines Peers mit festem Zeitlimit (SPEC 3.3). Die Naht [`Dialer`] lässt Zeitlimit- und Backoff-Tests mit
//! pausierter Zeit ohne Sockets laufen.
use std::{future::Future, time::Duration};

use futures::future::BoxFuture;

use super::{NetError, PeerConn, PeerId};

/// Ohne Grenze kostete ein offline Peer bis zur Leerlaufzeit von QUIC.
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(8);

/// Wählt einen Peer über die Relays der eigenen Karte an; nach [`DIAL_TIMEOUT`] ist Schluss.
pub trait Dialer: Send + Sync + 'static {
    fn dial<'a>(&'a self, peer: &'a PeerId, alpn: &'static [u8]) -> BoxFuture<'a, Result<PeerConn, NetError>>;
}

/// Bricht einen Verbindungsversuch nach [`DIAL_TIMEOUT`] mit [`NetError::Timeout`] ab.
pub(super) async fn within_dial_timeout<T>(attempt: impl Future<Output = Result<T, NetError>>) -> Result<T, NetError> {
    tokio::time::timeout(DIAL_TIMEOUT, attempt).await.unwrap_or(Err(NetError::Timeout))
}

#[cfg(test)]
mod tests {
    use std::future;

    use tokio::time::Instant;

    use super::*;

    #[tokio::test(start_paused = true)]
    async fn attempt_without_answer_ends_after_eight_seconds() {
        let started = Instant::now();

        let outcome = within_dial_timeout(future::pending::<Result<(), NetError>>()).await;

        assert!(matches!(outcome, Err(NetError::Timeout)));
        assert_eq!(started.elapsed(), DIAL_TIMEOUT);
    }

    #[tokio::test(start_paused = true)]
    async fn answer_just_before_the_limit_passes_through() {
        let answer = async {
            tokio::time::sleep(DIAL_TIMEOUT - Duration::from_millis(1)).await;
            Ok(7)
        };

        assert!(matches!(within_dial_timeout(answer).await, Ok(7)));
    }

    #[tokio::test(start_paused = true)]
    async fn failure_inside_the_limit_is_kept() {
        let outcome = within_dial_timeout(future::ready(Err::<(), _>(NetError::Unreachable))).await;

        assert!(matches!(outcome, Err(NetError::Unreachable)));
    }
}
