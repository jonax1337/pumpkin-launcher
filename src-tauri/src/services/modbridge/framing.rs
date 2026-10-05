//! JSON-Zeilen auf dem Draht (INGAME 5.3): Lesen mit Längengrenze, Schreiben mit Zeitgrenze, dazu die Uhr für Ping und
//! Stille.
use std::io;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::time::Instant;

/// Liest Zeilen, ohne mehr als `limit` Byte zu puffern.
pub(super) struct LineReader<R> {
    reader: BufReader<R>,
    line: Vec<u8>,
    limit: usize,
}

impl<R: AsyncRead + Unpin> LineReader<R> {
    pub fn new(read: R, limit: usize) -> Self {
        Self { reader: BufReader::new(read), line: Vec::new(), limit }
    }

    /// Ab der nächsten Zeile gilt diese Grenze (nach `welcome` wächst sie).
    pub fn set_limit(&mut self, limit: usize) {
        self.limit = limit;
    }

    /// Die nächste Zeile ohne Zeilenende; `None`, wenn die Gegenseite geschlossen hat. Eine Zeile samt Zeilenende über
    /// der Grenze ist ein Fehler. Abbrechen ist unschädlich: was gelesen ist, bleibt für den nächsten Aufruf im Puffer.
    pub async fn next_line(&mut self) -> io::Result<Option<String>> {
        loop {
            let available = self.reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(None);
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let taken = newline.map_or(available.len(), |end| end + 1);
            self.line.extend_from_slice(&available[..taken]);
            self.reader.consume(taken);
            if self.line.len() > self.limit {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "Zeile der Mod zu lang"));
            }
            if newline.is_some() {
                return Ok(Some(self.take_line()));
            }
        }
    }

    /// Ungültiges UTF-8 wird ersetzt und scheitert dann beim Auswerten wie jede andere kaputte Zeile.
    fn take_line(&mut self) -> String {
        let bytes = std::mem::take(&mut self.line);
        String::from_utf8_lossy(&bytes).trim_end_matches(['\r', '\n']).to_owned()
    }
}

/// Die Nachricht als JSON-Zeile samt Zeilenende.
pub(super) fn encode_line(message: &impl Serialize) -> Vec<u8> {
    let mut line = serde_json::to_vec(message).unwrap_or_default();
    line.push(b'\n');
    line
}

/// Schreibt die Zeile; dauert das länger als `stall`, liest die Mod nicht mehr.
pub(super) async fn write_line<W: AsyncWrite + Unpin>(writer: &mut W, line: &[u8], stall: Duration) -> io::Result<()> {
    let timed_out = |_| io::Error::new(io::ErrorKind::TimedOut, "Mod liest nicht");
    tokio::time::timeout(stall, writer.write_all(line)).await.map_err(timed_out)?
}

/// A revoked private write must end its connection: a partial JSON line cannot be resumed safely.
pub(super) async fn write_private_line<W: AsyncWrite + Unpin>(
    writer: &mut W,
    line: &[u8],
    stall: Duration,
    permission: &tokio_util::sync::CancellationToken,
) -> io::Result<()> {
    tokio::select! {
        biased;
        () = permission.cancelled() => Err(io::Error::new(io::ErrorKind::ConnectionAborted, "Friends permission revoked during write")),
        result = write_line(writer, line, stall) => result,
    }
}

/// Was die Uhr der Verbindung als Nächstes verlangt.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Beat {
    /// Zeit für ein `ping`.
    Ping,
    /// Zu lange nichts von der Mod: die Verbindung ist tot.
    Silent,
    /// Bis dahin ist nichts zu tun.
    Wait(Instant),
}

/// Ping alle `ping_interval`; kommt `silence` lang nichts von der Mod, ist die Verbindung tot.
pub(super) struct Liveness {
    last_heard: Instant,
    last_ping: Instant,
    ping_interval: Duration,
    silence: Duration,
}

impl Liveness {
    pub fn new(now: Instant, ping_interval: Duration, silence: Duration) -> Self {
        Self { last_heard: now, last_ping: now, ping_interval, silence }
    }

    /// Irgendeine Zeile der Mod zählt als Lebenszeichen.
    pub fn heard(&mut self, now: Instant) {
        self.last_heard = now;
    }

    pub fn beat(&mut self, now: Instant) -> Beat {
        if now.duration_since(self.last_heard) >= self.silence {
            return Beat::Silent;
        }
        let ping_due = self.last_ping + self.ping_interval;
        if now >= ping_due {
            self.last_ping = now;
            return Beat::Ping;
        }
        Beat::Wait(ping_due.min(self.last_heard + self.silence))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    async fn lines_of(bytes: &[u8], limit: usize) -> Vec<io::Result<Option<String>>> {
        let (mut client, server) = tokio::io::duplex(64 * 1024);
        client.write_all(bytes).await.unwrap();
        drop(client);
        let mut reader = LineReader::new(server, limit);
        let mut results = Vec::new();
        loop {
            let line = reader.next_line().await;
            let done = !matches!(line, Ok(Some(_)));
            results.push(line);
            if done {
                return results;
            }
        }
    }

    fn texts(results: Vec<io::Result<Option<String>>>) -> Vec<String> {
        results.into_iter().filter_map(|line| line.ok().flatten()).collect()
    }

    #[tokio::test]
    async fn lines_are_split_at_the_newline_and_lose_their_line_ending() {
        assert_eq!(texts(lines_of(b"eins\r\nzwei\n\ndrei", 1024).await), ["eins", "zwei", ""]);
    }

    #[tokio::test]
    async fn a_line_at_the_limit_passes_and_one_byte_more_fails() {
        let at_limit = format!("{}\n", "a".repeat(15));
        assert_eq!(texts(lines_of(at_limit.as_bytes(), 16).await).len(), 1);
        let over = format!("{}\n", "a".repeat(16));
        let results = lines_of(over.as_bytes(), 16).await;
        assert_eq!(results[0].as_ref().unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn a_line_without_a_newline_is_cut_off_at_the_limit_instead_of_buffered() {
        let results = lines_of(&[b'a'; 40], 16).await;
        assert_eq!(results[0].as_ref().unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn the_limit_can_grow_after_the_welcome() {
        let (mut client, server) = tokio::io::duplex(64 * 1024);
        let mut reader = LineReader::new(server, 8);
        client.write_all(b"kurz\n").await.unwrap();
        assert_eq!(reader.next_line().await.unwrap().as_deref(), Some("kurz"));
        reader.set_limit(64);
        client.write_all(format!("{}\n", "b".repeat(40)).as_bytes()).await.unwrap();
        assert_eq!(reader.next_line().await.unwrap().map(|line| line.len()), Some(40));
    }

    #[tokio::test]
    async fn invalid_utf8_is_replaced_not_fatal() {
        let line = texts(lines_of(b"a\xFFb\n", 64).await);
        assert_eq!(line, ["a\u{FFFD}b"]);
    }

    #[test]
    fn encoded_lines_end_with_a_newline() {
        assert_eq!(encode_line(&serde_json::json!({"a": 1})), b"{\"a\":1}\n");
    }

    #[tokio::test(start_paused = true)]
    async fn a_writer_that_makes_no_progress_for_the_stall_time_fails() {
        let (mut writer, _unread) = tokio::io::duplex(8);
        let started = Instant::now();
        let error = write_line(&mut writer, &[b'x'; 1024], Duration::from_secs(5)).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert_eq!(started.elapsed(), Duration::from_secs(5));
    }

    #[tokio::test]
    async fn a_reader_that_keeps_up_never_stalls_the_writer() {
        let (mut writer, mut reader) = tokio::io::duplex(8);
        let drain = tokio::spawn(async move {
            let mut sink = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut reader, &mut sink).await.unwrap();
            sink.len()
        });
        write_line(&mut writer, &[b'x'; 1024], Duration::from_secs(5)).await.unwrap();
        drop(writer);
        assert_eq!(drain.await.unwrap(), 1024);
    }

    const PING: Duration = Duration::from_secs(10);
    const SILENCE: Duration = Duration::from_secs(30);

    fn secs(start: Instant, seconds: u64) -> Instant {
        start + Duration::from_secs(seconds)
    }

    #[test]
    fn a_ping_goes_out_every_ten_seconds_while_the_mod_answers() {
        let start = Instant::now();
        let mut liveness = Liveness::new(start, PING, SILENCE);
        assert_eq!(liveness.beat(start), Beat::Wait(secs(start, 10)));
        assert_eq!(liveness.beat(secs(start, 10)), Beat::Ping);
        liveness.heard(secs(start, 11));
        assert_eq!(liveness.beat(secs(start, 12)), Beat::Wait(secs(start, 20)));
        assert_eq!(liveness.beat(secs(start, 20)), Beat::Ping);
    }

    #[test]
    fn thirty_seconds_of_silence_end_the_connection() {
        let start = Instant::now();
        let mut liveness = Liveness::new(start, PING, SILENCE);
        assert_eq!(liveness.beat(secs(start, 10)), Beat::Ping);
        assert_eq!(liveness.beat(secs(start, 20)), Beat::Ping);
        assert_eq!(liveness.beat(secs(start, 29)), Beat::Wait(secs(start, 30)));
        assert_eq!(liveness.beat(secs(start, 30)), Beat::Silent);
    }

    #[test]
    fn any_sign_of_life_restarts_the_silence() {
        let start = Instant::now();
        let mut liveness = Liveness::new(start, PING, SILENCE);
        liveness.heard(secs(start, 25));
        assert_ne!(liveness.beat(secs(start, 40)), Beat::Silent);
        assert_eq!(liveness.beat(secs(start, 55)), Beat::Silent);
    }

    #[tokio::test]
    async fn revocation_interrupts_a_backpressured_private_line_and_the_partial_stream_ends() {
        use tokio::io::AsyncReadExt;

        let (mut writer, mut reader) = tokio::io::duplex(8);
        let permission = tokio_util::sync::CancellationToken::new();
        let line = b"{\"secret\":\"private-bearer-code\"}\n";
        let write = async {
            let result = write_private_line(&mut writer, line, Duration::from_secs(5), &permission).await;
            drop(writer);
            result
        };
        let revoke_and_read = async {
            let mut prefix = [0; 8];
            reader.read_exact(&mut prefix).await.unwrap();
            permission.cancel();
            let mut remaining = Vec::new();
            reader.read_to_end(&mut remaining).await.unwrap();
            (prefix, remaining)
        };

        let (result, (prefix, remaining)) = tokio::join!(write, revoke_and_read);
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::ConnectionAborted);
        assert_eq!(&prefix, &line[..8]);
        assert!(remaining.is_empty(), "revoked payload remainder must not reach the consumer");
    }
}
