//! Kommandozeile des Spikes: `id`, `listen` und `dial` (SPEC 14, R0b). Ablauf siehe README.md.

use std::{
    io::ErrorKind,
    net::SocketAddr,
    time::{Duration, Instant},
};

use anyhow::Context;
use clap::{Args, Parser, Subcommand};
use iroh::{endpoint::Connection, Endpoint, EndpointId, RelayUrl, SecretKey};
use p2p_spike::{
    net::{SpikeNet, ALPN},
    observe::{self, SelectedPath},
    protocol::{self, Upload},
    stats::LatencySummary,
};
use tokio::{net::TcpListener, time::timeout};
use tracing_subscriber::EnvFilter;

const KEY_FILE: &str = "spike-key.txt";
const SELF_COMMAND: &str = if cfg!(windows) {
    r".\p2p-spike.exe"
} else {
    "./p2p-spike"
};
const ONLINE_LIMIT: Duration = Duration::from_secs(10);
const PUBLIC_ADDRESS_LIMIT: Duration = Duration::from_secs(5);
const CONNECT_LIMIT: Duration = Duration::from_secs(8);
const DIRECT_PATH_LIMIT: Duration = Duration::from_secs(15);

#[derive(Parser)]
#[command(about = "Pumpkin Friends P2P spike: measures iroh connections between two PCs")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    #[command(about = "Print this PC's id (creates spike-key.txt on first use)")]
    Id,
    #[command(about = "Wait for the other PC to dial in")]
    Listen(ListenArgs),
    #[command(about = "Dial the other PC by its id and measure the connection")]
    Dial(DialArgs),
}

#[derive(Args)]
struct NetArgs {
    #[arg(
        long = "relay",
        value_name = "URL",
        help = "Use this relay instead of n0's public relays (repeatable)"
    )]
    relays: Vec<RelayUrl>,
    #[arg(long, help = "Never connect directly, always go through the relay")]
    relay_only: bool,
}

impl NetArgs {
    fn to_net(&self) -> SpikeNet {
        SpikeNet {
            relay_map: SpikeNet::relay_map_from_urls(self.relays.clone()),
            relay_only: self.relay_only,
        }
    }

    /// Die `--relay`-Angaben, die auch die Gegenseite braucht, um dieselben Relays zu nutzen.
    fn relay_flags(&self) -> String {
        self.relays
            .iter()
            .map(|url| format!(" --relay {url}"))
            .collect()
    }
}

#[derive(Args)]
struct ListenArgs {
    #[command(flatten)]
    net: NetArgs,
    #[arg(
        long,
        value_name = "127.0.0.1:PORT",
        help = "Pass tunnelled game connections on to this address (the open LAN world)"
    )]
    forward: Option<SocketAddr>,
}

#[derive(Args)]
struct DialArgs {
    #[arg(help = "The id that `listen` printed on the other PC")]
    id: EndpointId,
    #[command(flatten)]
    net: NetArgs,
    #[arg(
        long,
        value_name = "ROUNDS",
        help = "Measure this many 1-byte echo round trips"
    )]
    echo: Option<usize>,
    #[arg(
        long,
        value_name = "MIB",
        help = "Send this many MiB to measure throughput"
    )]
    throughput: Option<u64>,
    #[arg(
        long,
        value_name = "127.0.0.1:PORT",
        help = "Open a local game address that tunnels to the other PC's --forward"
    )]
    local: Option<SocketAddr>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    match Cli::parse().command {
        Command::Id => print_id().await,
        Command::Listen(args) => listen(args).await,
        Command::Dial(args) => dial(args).await,
    }
}

async fn print_id() -> anyhow::Result<()> {
    println!("{}", load_or_create_key().await?.public());
    Ok(())
}

/// Der Zuhörer behält seine ID über Neustarts, damit sie nur einmal übertragen werden muss.
async fn load_or_create_key() -> anyhow::Result<SecretKey> {
    match tokio::fs::read_to_string(KEY_FILE).await {
        Ok(hex) => hex
            .trim()
            .parse()
            .with_context(|| format!("{KEY_FILE} is damaged; delete it to get a new id")),
        Err(err) if err.kind() == ErrorKind::NotFound => create_key().await,
        Err(err) => Err(err).with_context(|| format!("cannot read {KEY_FILE}")),
    }
}

async fn create_key() -> anyhow::Result<SecretKey> {
    let key = SecretKey::generate();
    let hex: String = key
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    tokio::fs::write(KEY_FILE, hex)
        .await
        .with_context(|| format!("cannot write {KEY_FILE}"))?;
    Ok(key)
}

async fn listen(args: ListenArgs) -> anyhow::Result<()> {
    let net = args.net.to_net();
    let endpoint = net
        .builder()?
        .secret_key(load_or_create_key().await?)
        .bind()
        .await?;
    report_network(&endpoint).await;
    println!();
    println!("Your id: {}", endpoint.id());
    println!("On the other PC run:");
    println!(
        "  {SELF_COMMAND} dial {}{} --echo 1000 --throughput 50",
        endpoint.id(),
        args.net.relay_flags()
    );
    if let Some(target) = args.forward {
        println!("Tunnelled game connections go to {target}.");
    }
    println!("Waiting for connections. Press Ctrl+C to stop.");
    tokio::select! {
        _ = accept_connections(&endpoint, args.forward) => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    endpoint.close().await;
    Ok(())
}

async fn accept_connections(endpoint: &Endpoint, forward: Option<SocketAddr>) {
    while let Some(incoming) = endpoint.accept().await {
        tokio::spawn(async move {
            match incoming.await {
                Ok(conn) => serve_peer(conn, forward).await,
                Err(err) => eprintln!("incoming connection failed: {err:#}"),
            }
        });
    }
}

async fn serve_peer(conn: Connection, forward: Option<SocketAddr>) {
    let label = conn.remote_id().fmt_short().to_string();
    println!("[{label}] connected");
    observe::print_path_changes(conn.clone(), label.clone());
    protocol::serve(conn.clone(), forward).await;
    println!("[{label}] disconnected: {}", conn.closed().await);
}

async fn report_network(endpoint: &Endpoint) {
    let started = Instant::now();
    match timeout(ONLINE_LIMIT, endpoint.online()).await {
        Ok(()) => println!(
            "Relay connected after {} ms.",
            started.elapsed().as_millis()
        ),
        Err(_) => println!(
            "WARNING: no relay reachable within {} s.",
            ONLINE_LIMIT.as_secs()
        ),
    }
    for relay in endpoint.addr().relay_urls() {
        println!("Home relay: {relay}");
    }
    match observe::public_address(endpoint, PUBLIC_ADDRESS_LIMIT).await {
        Some(address) => println!("Public address seen by the relay: {address}"),
        None => println!("Public address seen by the relay: none reported"),
    }
}

async fn dial(args: DialArgs) -> anyhow::Result<()> {
    let net = args.net.to_net();
    let endpoint = net.builder()?.bind().await?;
    report_network(&endpoint).await;
    println!();
    let started = Instant::now();
    let conn = timeout(
        CONNECT_LIMIT,
        endpoint.connect(net.dial_addr(args.id), ALPN),
    )
    .await
    .context("no answer within 8 s: is `listen` running on the other PC, and is the id right?")??;
    let connect_time = started.elapsed();
    println!("Connected after {} ms.", connect_time.as_millis());
    observe::print_path_changes(conn.clone(), "peer".to_string());

    let measured = measure(&conn, &args, net.relay_only, connect_time).await?;
    println!("{measured}");
    if let Some(local) = args.local {
        run_tunnel(local, &conn).await?;
    }
    conn.close(0u32.into(), b"done");
    endpoint.close().await;
    Ok(())
}

async fn measure(
    conn: &Connection,
    args: &DialArgs,
    relay_only: bool,
    connect_time: Duration,
) -> anyhow::Result<Measured> {
    let direct_after = if relay_only {
        DirectPath::Skipped
    } else {
        println!(
            "Waiting up to {} s for a direct path ...",
            DIRECT_PATH_LIMIT.as_secs()
        );
        observe::wait_for_direct(conn, DIRECT_PATH_LIMIT)
            .await
            .map_or(DirectPath::Never, DirectPath::After)
    };
    // Vor der Last messen: der Durchsatztest füllt Puffer und verfälscht die RTT-Schätzung.
    let path = observe::selected_path(conn);
    let echo = match args.echo {
        Some(rounds) => {
            println!("Measuring {rounds} echo round trips ...");
            LatencySummary::from_samples(&protocol::echo_round_trips(conn, rounds).await?)
        }
        None => None,
    };
    let upload = match args.throughput {
        Some(mib) => {
            println!("Sending {mib} MiB ...");
            Some(protocol::upload(conn, mib * 1024 * 1024).await?)
        }
        None => None,
    };
    Ok(Measured {
        path,
        connect_time,
        direct_after,
        echo,
        upload,
    })
}

async fn run_tunnel(local: SocketAddr, conn: &Connection) -> anyhow::Result<()> {
    let listener = TcpListener::bind(local)
        .await
        .with_context(|| format!("cannot open {local}; pick another port"))?;
    println!();
    println!("Tunnel ready. In Minecraft: Multiplayer > Direct Connection > {local}");
    println!("Press Ctrl+C to stop.");
    tokio::select! {
        result = protocol::forward_local(listener, conn.clone()) => result?,
        reason = conn.closed() => println!("The other PC closed the connection: {reason}"),
        _ = tokio::signal::ctrl_c() => {}
    }
    Ok(())
}

enum DirectPath {
    After(Duration),
    Never,
    Skipped,
}

/// Messergebnis eines `dial`-Laufs, gedruckt in der Reihenfolge der G1-Spalten.
struct Measured {
    path: Option<SelectedPath>,
    connect_time: Duration,
    direct_after: DirectPath,
    echo: Option<LatencySummary>,
    upload: Option<Upload>,
}

impl std::fmt::Display for Measured {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f)?;
        writeln!(f, "=== RESULT (copy these lines into the G1 table) ===")?;
        match &self.path {
            Some(path) => writeln!(f, "path:           {path}")?,
            None => writeln!(f, "path:           unknown")?,
        }
        writeln!(f, "connect time:   {} ms", self.connect_time.as_millis())?;
        match self.direct_after {
            DirectPath::After(wait) => writeln!(f, "direct after:   {} ms", wait.as_millis())?,
            DirectPath::Never => writeln!(f, "direct after:   never (stayed on the relay)")?,
            DirectPath::Skipped => writeln!(f, "direct after:   skipped (--relay-only)")?,
        }
        if let Some(echo) = &self.echo {
            writeln!(
                f,
                "echo p50 / p99: {:.1} / {:.1} ms (min {:.1}, max {:.1})",
                millis(echo.p50),
                millis(echo.p99),
                millis(echo.min),
                millis(echo.max)
            )?;
        }
        if let Some(upload) = &self.upload {
            writeln!(f, "throughput:     {:.1} MiB/s", upload.mib_per_sec())?;
        }
        write!(f, "===================================================")
    }
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}
