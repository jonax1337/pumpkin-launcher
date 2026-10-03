//! Lern-Tests mit iroh's In-Process-Relay (SPEC 3.7): Nur-Relay-Endpunkt, Mehrfach-Relay-Adresse,
//! QUIC-Adresserkennung und die Relay-Karte aus URLs.

mod common;

use common::{
    bind_loopback, echo_works, online, serve_one, trusting_test_relay, without_relays, LIMIT,
};
use iroh::{
    defaults::DEFAULT_RELAY_QUIC_PORT,
    endpoint::{ConnectError, ConnectWithOptsError},
    test_utils::run_relay_server,
    EndpointAddr, RelayConfig, RelayMap, RelayUrl, Watcher,
};
use p2p_spike::{
    net::{SpikeNet, ALPN},
    observe::{self, PathKind},
};

#[tokio::test]
async fn relay_only_endpoint_is_reachable_only_through_the_relay() {
    let (relay_map, relay_url, _relay) = run_relay_server().await.unwrap();
    let net = SpikeNet {
        relay_map,
        relay_only: true,
    };
    let listener = trusting_test_relay(&net).bind().await.unwrap();
    online(&listener).await;

    let advertised = listener.addr();
    assert_eq!(advertised.ip_addrs().count(), 0, "no direct (IP) address");
    assert!(listener.bound_sockets().is_empty(), "no UDP socket at all");
    assert_eq!(
        advertised.relay_urls().collect::<Vec<_>>(),
        vec![&relay_url]
    );
    let home = listener.home_relay_status().get();
    assert_eq!(
        (home.len(), home[0].url(), home[0].is_connected()),
        (1, &relay_url, true)
    );

    let loopback_peer = bind_loopback(&without_relays()).await;
    let without_relay = tokio::time::timeout(
        LIMIT,
        loopback_peer.connect(EndpointAddr::new(listener.id()), ALPN),
    )
    .await;
    assert!(
        matches!(
            without_relay.expect("fails at once, no time-out"),
            Err(ConnectError::Connect {
                source: ConnectWithOptsError::NoAddress { .. },
                ..
            })
        ),
        "without address lookup an id alone is not dialable"
    );

    serve_one(listener.clone(), None);
    let dialer = trusting_test_relay(&SpikeNet {
        relay_only: false,
        ..net.clone()
    })
    .bind()
    .await
    .unwrap();
    let conn = dialer
        .connect(net.dial_addr(listener.id()), ALPN)
        .await
        .unwrap();
    echo_works(&conn).await;
    assert_eq!(observe::selected_path(&conn).unwrap().kind, PathKind::Relay);
}

#[tokio::test]
async fn address_with_several_relays_reaches_the_peer_on_any_of_them() {
    let (home_map, _home_url, _home) = run_relay_server().await.unwrap();
    let (other_map, _other_url, _other) = run_relay_server().await.unwrap();
    let listener_net = SpikeNet {
        relay_map: home_map.clone(),
        relay_only: true,
    };
    let listener = trusting_test_relay(&listener_net).bind().await.unwrap();
    online(&listener).await;
    serve_one(listener.clone(), None);
    let both = RelayMap::empty();
    both.extend(&other_map);
    both.extend(&home_map);
    let dialer_net = SpikeNet {
        relay_map: both,
        relay_only: true,
    };
    let dialer = trusting_test_relay(&dialer_net).bind().await.unwrap();

    let dial_addr = dialer_net.dial_addr(listener.id());
    assert_eq!(dial_addr.relay_urls().count(), 2);
    let conn = tokio::time::timeout(LIMIT, dialer.connect(dial_addr, ALPN))
        .await
        .expect("connects within the limit")
        .unwrap();

    echo_works(&conn).await;
}

#[tokio::test]
async fn address_with_only_a_foreign_relay_does_not_reach_the_peer() {
    let (home_map, _home_url, _home) = run_relay_server().await.unwrap();
    let (other_map, _other_url, _other) = run_relay_server().await.unwrap();
    let listener = trusting_test_relay(&SpikeNet {
        relay_map: home_map,
        relay_only: true,
    })
    .bind()
    .await
    .unwrap();
    online(&listener).await;
    serve_one(listener.clone(), None);
    let dialer_net = SpikeNet {
        relay_map: other_map,
        relay_only: true,
    };
    let dialer = trusting_test_relay(&dialer_net).bind().await.unwrap();

    let attempt = tokio::time::timeout(
        LIMIT / 3,
        dialer.connect(dialer_net.dial_addr(listener.id()), ALPN),
    )
    .await;

    assert!(
        !matches!(attempt, Ok(Ok(_))),
        "a relay only carries packets of its own clients"
    );
}

#[tokio::test]
async fn unreachable_relay_never_becomes_a_home_relay() {
    let dead: RelayUrl = "https://127.0.0.1:9/".parse().unwrap();
    let net = SpikeNet {
        relay_map: RelayMap::from_iter([dead]),
        relay_only: true,
    };
    let endpoint = trusting_test_relay(&net).bind().await.unwrap();

    let online = tokio::time::timeout(LIMIT / 2, endpoint.online()).await;

    assert!(online.is_err(), "online() never completes");
    assert!(
        endpoint.home_relay_status().get().is_empty(),
        "so there is no status with an error"
    );
}

#[tokio::test]
async fn relay_reports_the_public_address_through_quic_address_discovery() {
    let (relay_map, relay_url, _relay) = run_relay_server().await.unwrap();
    let quic_port = relay_map
        .get(&relay_url)
        .unwrap()
        .quic
        .as_ref()
        .map(|quic| quic.port);
    assert!(
        quic_port.is_some_and(|port| port != DEFAULT_RELAY_QUIC_PORT),
        "the test relay runs QAD on a random port"
    );
    let net = SpikeNet {
        relay_map,
        relay_only: false,
    };
    let endpoint = common::loopback(trusting_test_relay(&net)).await;
    online(&endpoint).await;

    let public = observe::public_address(&endpoint, LIMIT).await;

    let bound = endpoint.bound_sockets()[0];
    assert_eq!(
        public,
        Some(bound.to_string()),
        "on loopback the relay sees our own socket"
    );
}

#[test]
fn relay_map_from_urls_uses_the_default_quic_port() {
    let url: RelayUrl = "https://relay.example.org./".parse().unwrap();

    let map = SpikeNet::relay_map_from_urls(vec![url.clone()]);

    let quic = map.get(&url).unwrap().quic.clone().unwrap();
    assert_eq!((quic.port, DEFAULT_RELAY_QUIC_PORT), (7842, 7842));
}

#[test]
fn relay_config_takes_another_quic_port_without_the_iroh_relay_crate() {
    let url: RelayUrl = "https://relay.example.org./".parse().unwrap();

    let mut config = RelayConfig::from(url);
    if let Some(quic) = config.quic.as_mut() {
        quic.port = 7843;
    }

    assert_eq!(config.quic.map(|quic| quic.port), Some(7843));
}

#[test]
fn relay_config_without_quic_skips_address_discovery() {
    let url: RelayUrl = "https://relay.example.org./".parse().unwrap();

    let config = RelayConfig::new(url, None);

    assert_eq!(config.quic, None);
}

#[test]
fn empty_url_list_means_the_n0_production_relays() {
    let map = SpikeNet::relay_map_from_urls(Vec::new());

    let hosts: Vec<String> = map
        .urls::<Vec<RelayUrl>>()
        .iter()
        .map(|url| url.host_str().unwrap_or_default().to_string())
        .collect();
    assert!(
        hosts
            .iter()
            .all(|host| host.ends_with(".relay.n0.iroh.link.")),
        "{hosts:?}"
    );
}
