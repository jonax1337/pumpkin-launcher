//! Gemeinsame Bausteine der Lern-Tests: Endpunkte nur auf Loopback, Test-Relay ohne Zertifikatsprüfung.

#![allow(dead_code)] // Jede Testdatei nutzt nur einen Teil der Helfer.

use std::{net::SocketAddr, time::Duration};

use iroh::{
    endpoint::{Builder, Connection},
    tls::CaTlsConfig,
    Endpoint, RelayMap,
};
use p2p_spike::{net::SpikeNet, protocol};

pub const LIMIT: Duration = Duration::from_secs(10);

pub fn without_relays() -> SpikeNet {
    SpikeNet {
        relay_map: RelayMap::empty(),
        relay_only: false,
    }
}

pub async fn bind_loopback(net: &SpikeNet) -> Endpoint {
    loopback(net.builder().unwrap()).await
}

/// Bindet nur 127.0.0.1, damit Tests keine Firewall-Abfrage auslösen.
pub async fn loopback(builder: Builder) -> Endpoint {
    builder
        .clear_ip_transports()
        .bind_addr("127.0.0.1:0")
        .unwrap()
        .bind()
        .await
        .unwrap()
}

/// Das In-Process-Relay hat ein selbst signiertes Zertifikat (SPEC 3.7, `InsecureForTests`).
pub fn trusting_test_relay(net: &SpikeNet) -> Builder {
    net.builder()
        .unwrap()
        .ca_tls_config(CaTlsConfig::insecure_skip_verify())
}

pub async fn online(endpoint: &Endpoint) {
    tokio::time::timeout(LIMIT, endpoint.online())
        .await
        .expect("relay not reached");
}

/// Nimmt genau eine Verbindung an und bedient sie wie `listen`.
pub fn serve_one(endpoint: Endpoint, forward: Option<SocketAddr>) {
    tokio::spawn(async move {
        let conn = endpoint.accept().await.unwrap().await.unwrap();
        protocol::serve(conn, forward).await;
    });
}

pub async fn echo_works(conn: &Connection) {
    let samples = protocol::echo_round_trips(conn, 20).await.unwrap();
    assert_eq!(samples.len(), 20);
}
