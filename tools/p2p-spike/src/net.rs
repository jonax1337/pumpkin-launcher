//! Endpunkt-Konfiguration nach SPEC 3.3: kein Adress-Lookup, feste Relay-Karte, optional nur Relay.

use std::time::Duration;

use iroh::{
    endpoint::{presets, Builder, QuicTransportConfig, VarInt},
    Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, TransportAddr,
};

pub const ALPN: &[u8] = b"pumpkin/spike/1";

const KEEP_ALIVE: Duration = Duration::from_secs(15);
const IDLE_TIMEOUT: Duration = Duration::from_secs(40);
const MAX_BIDI_STREAMS: u32 = 16;

/// Netzwerkeinstellungen eines Spike-Endpunkts.
#[derive(Debug, Clone)]
pub struct SpikeNet {
    /// Leere Karte heißt: Relays aus.
    pub relay_map: RelayMap,
    /// Ohne IP-Transporte; der Endpunkt ist dann nur über ein Relay erreichbar.
    pub relay_only: bool,
}

impl SpikeNet {
    /// Karte aus den angegebenen URLs, jede mit QUIC-Adresserkennung auf Port 7842;
    /// ohne Angabe die Produktions-Relays von n0.
    pub fn relay_map_from_urls(urls: Vec<RelayUrl>) -> RelayMap {
        if urls.is_empty() {
            iroh::defaults::prod::default_relay_map()
        } else {
            RelayMap::from_iter(urls)
        }
    }

    /// Builder mit den SPEC-Einstellungen; Tests ergänzen nur Test-Schalter wie `ca_tls_config`.
    pub fn builder(&self) -> anyhow::Result<Builder> {
        let builder = Endpoint::builder(presets::Minimal)
            .relay_mode(self.relay_mode())
            .transport_config(transport_config()?)
            .alpns(vec![ALPN.to_vec()]);
        Ok(if self.relay_only {
            builder.clear_ip_transports()
        } else {
            builder
        })
    }

    /// Wählbare Adresse ohne IP: die ID und jede Relay-URL der eigenen Karte (SPEC 3.3).
    pub fn dial_addr(&self, id: EndpointId) -> EndpointAddr {
        let relays: Vec<RelayUrl> = self.relay_map.urls();
        EndpointAddr::from_parts(id, relays.into_iter().map(TransportAddr::Relay))
    }

    fn relay_mode(&self) -> RelayMode {
        if self.relay_map.is_empty() {
            RelayMode::Disabled
        } else {
            RelayMode::Custom(self.relay_map.clone())
        }
    }
}

fn transport_config() -> anyhow::Result<QuicTransportConfig> {
    Ok(QuicTransportConfig::builder()
        .keep_alive_interval(KEEP_ALIVE)
        .max_idle_timeout(Some(IDLE_TIMEOUT.try_into()?))
        .max_concurrent_bidi_streams(VarInt::from_u32(MAX_BIDI_STREAMS))
        .max_concurrent_uni_streams(VarInt::from_u32(0))
        .build())
}
