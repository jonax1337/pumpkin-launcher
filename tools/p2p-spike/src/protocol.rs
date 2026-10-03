//! Stream-Protokoll des Spikes: das erste Byte jedes Bi-Streams wählt Echo, Durchsatz oder Tunnel.

use std::{
    net::SocketAddr,
    time::{Duration, Instant},
};

use anyhow::{bail, ensure, Context};
use iroh::endpoint::{Connection, RecvStream, SendStream, VarInt};
use tokio::{
    io::AsyncReadExt,
    net::{TcpListener, TcpStream},
};

use crate::tunnel;

const ECHO: u8 = b'e';
const THROUGHPUT: u8 = b't';
const FORWARD: u8 = b'f';
const UPLOAD_CHUNK: usize = 64 * 1024;
const STREAM_REFUSED: u32 = 1;

/// Ergebnis einer Durchsatzmessung vom Wählenden zum Zuhörer.
#[derive(Debug, Clone, Copy)]
pub struct Upload {
    pub bytes: u64,
    pub elapsed: Duration,
}

impl Upload {
    pub fn mib_per_sec(&self) -> f64 {
        self.bytes as f64 / (1024.0 * 1024.0) / self.elapsed.as_secs_f64()
    }
}

/// Bedient alle Streams einer angenommenen Verbindung, bis der Gegenüber sie schließt.
pub async fn serve(conn: Connection, forward: Option<SocketAddr>) {
    while let Ok((send, recv)) = conn.accept_bi().await {
        tokio::spawn(async move {
            if let Err(err) = serve_stream(send, recv, forward).await {
                eprintln!("stream failed: {err:#}");
            }
        });
    }
}

async fn serve_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    forward: Option<SocketAddr>,
) -> anyhow::Result<()> {
    match recv.read_u8().await? {
        ECHO => serve_echo(send, recv).await,
        THROUGHPUT => serve_throughput(send, recv).await,
        FORWARD => serve_forward(send, recv, forward).await,
        other => {
            send.reset(VarInt::from_u32(STREAM_REFUSED))?;
            bail!("unknown stream mode {other}")
        }
    }
}

async fn serve_echo(mut send: SendStream, mut recv: RecvStream) -> anyhow::Result<()> {
    tokio::io::copy(&mut recv, &mut send).await?;
    send.finish()?;
    Ok(())
}

async fn serve_throughput(mut send: SendStream, mut recv: RecvStream) -> anyhow::Result<()> {
    let received = tokio::io::copy(&mut recv, &mut tokio::io::sink()).await?;
    send.write_all(&received.to_be_bytes()).await?;
    send.finish()?;
    Ok(())
}

async fn serve_forward(
    mut send: SendStream,
    recv: RecvStream,
    forward: Option<SocketAddr>,
) -> anyhow::Result<()> {
    let Some(target) = forward else {
        send.reset(VarInt::from_u32(STREAM_REFUSED))?;
        bail!("the other side asked for a tunnel, but this listener runs without --forward");
    };
    let tcp = TcpStream::connect(target)
        .await
        .with_context(|| format!("nothing answers on {target} (is the LAN world open?)"))?;
    tunnel::bridge(send, recv, tcp).await?;
    Ok(())
}

/// 1-Byte-Ping-Pong auf einem Stream; liefert die Umlaufzeit jeder Runde.
pub async fn echo_round_trips(conn: &Connection, rounds: usize) -> anyhow::Result<Vec<Duration>> {
    let (mut send, mut recv) = open(conn, ECHO).await?;
    let mut samples = Vec::with_capacity(rounds);
    for round in 0..rounds {
        let ping = round as u8;
        let started = Instant::now();
        send.write_all(&[ping]).await?;
        let pong = recv.read_u8().await?;
        samples.push(started.elapsed());
        ensure!(pong == ping, "echo returned {pong}, expected {ping}");
    }
    send.finish()?;
    Ok(samples)
}

/// Sendet `bytes` Nullbytes und wartet, bis der Zuhörer die Menge bestätigt.
pub async fn upload(conn: &Connection, bytes: u64) -> anyhow::Result<Upload> {
    let (mut send, mut recv) = open(conn, THROUGHPUT).await?;
    let chunk = vec![0u8; UPLOAD_CHUNK];
    let started = Instant::now();
    let mut remaining = bytes;
    while remaining > 0 {
        let len = remaining.min(UPLOAD_CHUNK as u64) as usize;
        send.write_all(&chunk[..len]).await?;
        remaining -= len as u64;
    }
    send.finish()?;
    let confirmed = recv.read_u64().await?;
    ensure!(
        confirmed == bytes,
        "listener confirmed {confirmed} of {bytes} bytes"
    );
    Ok(Upload {
        bytes,
        elapsed: started.elapsed(),
    })
}

/// Tunnelt jede lokale TCP-Verbindung über einen eigenen Stream zum `--forward`-Ziel des Zuhörers.
pub async fn forward_local(listener: TcpListener, conn: Connection) -> anyhow::Result<()> {
    loop {
        let (tcp, client) = listener.accept().await?;
        let conn = conn.clone();
        tokio::spawn(async move {
            match tunnel_one(&conn, tcp).await {
                Ok((up, down)) => {
                    println!("tunnel from {client} closed ({up} bytes up, {down} bytes down)")
                }
                Err(err) => eprintln!("tunnel from {client} failed: {err:#}"),
            }
        });
    }
}

async fn tunnel_one(conn: &Connection, tcp: TcpStream) -> anyhow::Result<(u64, u64)> {
    let (send, recv) = open(conn, FORWARD).await?;
    Ok(tunnel::bridge(send, recv, tcp).await?)
}

/// Öffnet einen Bi-Stream; erst das Modus-Byte macht ihn für den Gegenüber sichtbar.
async fn open(conn: &Connection, mode: u8) -> anyhow::Result<(SendStream, RecvStream)> {
    let (mut send, recv) = conn.open_bi().await?;
    send.write_all(&[mode]).await?;
    Ok((send, recv))
}
