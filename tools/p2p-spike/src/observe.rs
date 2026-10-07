//! Beobachtet gewählten Pfad, RTT und die vom Relay gemeldete öffentliche Adresse.

use std::{
    fmt,
    time::{Duration, Instant},
};

use iroh::{
    endpoint::{Connection, PathEvent},
    unstable_net_report::NetReport,
    Endpoint, TransportAddr, Watcher,
};
use n0_future::StreamExt;

/// Art des Pfads, über den die Verbindung gerade sendet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    Direct,
    Relay,
    Other,
}

impl PathKind {
    pub fn of(addr: &TransportAddr) -> Self {
        match addr {
            TransportAddr::Ip(_) => Self::Direct,
            TransportAddr::Relay(_) => Self::Relay,
            _ => Self::Other,
        }
    }
}

impl fmt::Display for PathKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Direct => "direct",
            Self::Relay => "relay",
            Self::Other => "other",
        })
    }
}

/// Momentaufnahme des gewählten Pfads.
#[derive(Debug, Clone)]
pub struct SelectedPath {
    pub kind: PathKind,
    pub remote: TransportAddr,
    pub rtt: Duration,
}

impl fmt::Display for SelectedPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let remote = match &self.remote {
            TransportAddr::Ip(addr) => addr.to_string(),
            TransportAddr::Relay(url) => url.to_string(),
            other => format!("{other:?}"),
        };
        write!(
            f,
            "{} via {remote}, rtt {} ms",
            self.kind,
            self.rtt.as_millis()
        )
    }
}

pub fn selected_path(conn: &Connection) -> Option<SelectedPath> {
    conn.paths()
        .iter()
        .find(|path| path.is_selected())
        .map(|path| SelectedPath {
            kind: PathKind::of(path.remote_addr()),
            remote: path.remote_addr().clone(),
            rtt: path.rtt(),
        })
}

/// Wartet, bis ein direkter Pfad gewählt ist, und liefert die Wartezeit; `None` nach `limit`.
pub async fn wait_for_direct(conn: &Connection, limit: Duration) -> Option<Duration> {
    let started = Instant::now();
    let mut snapshots = conn.paths_stream();
    let direct_selected = async {
        while let Some(paths) = snapshots.next().await {
            if paths.iter().any(|path| path.is_selected() && path.is_ip()) {
                return Some(started.elapsed());
            }
        }
        None
    };
    tokio::time::timeout(limit, direct_selected)
        .await
        .ok()
        .flatten()
}

/// Druckt den aktuellen Pfad und danach jeden Pfadwechsel, bis die Verbindung endet.
pub fn print_path_changes(conn: Connection, label: String) {
    tokio::spawn(async move {
        if let Some(path) = selected_path(&conn) {
            println!("[{label}] path: {path}");
        }
        let mut events = conn.path_events();
        while let Some(event) = events.next().await {
            if let PathEvent::Selected { .. } = event {
                if let Some(path) = selected_path(&conn) {
                    println!("[{label}] path changed: {path}");
                }
            }
        }
    });
}

/// Öffentliche Adresse(n), die ein Relay per QUIC-Adresserkennung (QAD) gemeldet hat.
pub async fn public_address(endpoint: &Endpoint, limit: Duration) -> Option<String> {
    let mut reports = endpoint.net_report();
    let reported = async {
        loop {
            if let Some(found) = reports.get().as_ref().and_then(global_addrs) {
                return Some(found);
            }
            reports.updated().await.ok()?;
        }
    };
    tokio::time::timeout(limit, reported).await.ok().flatten()
}

fn global_addrs(report: &NetReport) -> Option<String> {
    match (report.global_v4, report.global_v6) {
        (Some(v4), Some(v6)) => Some(format!("{v4}, {v6}")),
        (Some(v4), None) => Some(v4.to_string()),
        (None, Some(v6)) => Some(v6.to_string()),
        (None, None) => None,
    }
}
