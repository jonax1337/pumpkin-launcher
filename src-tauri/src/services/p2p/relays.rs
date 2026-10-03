//! Relay-Karte (SPEC 3.2): fest einkompiliert, mit stabilen Ein-Byte-Indizes. Peers nennen einander nur Indizes,
//! nie URLs; gewählt wird ausschließlich, was in der Karte steht.
use std::borrow::Cow;

use iroh::{RelayConfig, RelayMap, RelayMode, RelayUrl};

use super::NetError;

/// Ein Relay der Karte. Indizes bleiben für immer: Einträge werden nur angehängt, ein entferntes Relay hinterlässt eine
/// Lücke. 0–99 betreiben wir, 200–209 sind die von n0.
#[derive(Debug, Clone)]
pub struct RelayEntry {
    pub index: u8,
    /// `Cow` nur, damit Tests eine Laufzeit-Karte mit dem In-Process-Relay bauen können (SPEC 3.7).
    pub url: Cow<'static, str>,
    pub operator: RelayOperator,
    /// UDP-Port der QUIC-Adresserkennung; `None` schaltet sie für dieses Relay ab.
    pub quic_port: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayOperator {
    Pumpkin,
    N0,
}

/// Welche Relays der Karte ein Endpunkt nutzt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelaySelection {
    All,
    /// Nur dieser Index, etwa für den Hello-Endpunkt eines Codes.
    Only(u8),
}

/// Release-Karte. Sie bleibt leer, bis unser eigenes Relay läuft (D1); I1 trägt es dann als Index 0 ein.
#[cfg(not(any(debug_assertions, feature = "beta-relays")))]
pub const RELAY_MAP: &[RelayEntry] = &[];

/// Entwicklung und geschlossene Beta: zusätzlich die Produktions-Relays von n0, kopiert aus
/// `iroh::defaults::prod` der gesperrten iroh-Version (`RelayMode::Default` könnte auf Staging umschalten).
#[cfg(any(debug_assertions, feature = "beta-relays"))]
pub const RELAY_MAP: &[RelayEntry] = &[
    n0(200, "https://use1-1.relay.n0.iroh.link./"),
    n0(201, "https://usw1-1.relay.n0.iroh.link./"),
    n0(202, "https://euc1-1.relay.n0.iroh.link./"),
    n0(203, "https://aps1-1.relay.n0.iroh.link./"),
];

/// Port der QUIC-Adresserkennung, den iroh für Relays annimmt (`iroh::defaults::DEFAULT_RELAY_QUIC_PORT`).
#[cfg(any(debug_assertions, feature = "beta-relays"))]
const DEFAULT_QUIC_PORT: u16 = 7842;

#[cfg(any(debug_assertions, feature = "beta-relays"))]
const fn n0(index: u8, url: &'static str) -> RelayEntry {
    RelayEntry { index, url: Cow::Borrowed(url), operator: RelayOperator::N0, quic_port: Some(DEFAULT_QUIC_PORT) }
}

/// Der Eintrag mit diesem Index; unbekannte Indizes (etwa aus dem `hello` eines Peers) ergeben `None`.
pub fn find_relay(map: &[RelayEntry], index: u8) -> Option<&RelayEntry> {
    map.iter().find(|entry| entry.index == index)
}

/// Die Relays eines Endpunkts, schon als iroh-Konfiguration.
#[derive(Debug, Clone)]
pub(super) struct SelectedRelays {
    relays: Vec<(u8, RelayConfig)>,
}

impl SelectedRelays {
    pub(super) fn select(map: &[RelayEntry], selection: RelaySelection) -> Result<Self, NetError> {
        let entries: Vec<&RelayEntry> = match selection {
            RelaySelection::All => map.iter().collect(),
            RelaySelection::Only(index) => vec![find_relay(map, index).ok_or(NetError::UnknownRelay(index))?],
        };
        let relays =
            entries.into_iter().map(|entry| Ok((entry.index, relay_config(entry)?))).collect::<Result<_, _>>()?;
        Ok(Self { relays })
    }

    /// Ohne Relays sind sie ganz aus; sonst genau diese, nie die eingebauten von iroh.
    pub(super) fn relay_mode(&self) -> RelayMode {
        if self.relays.is_empty() {
            RelayMode::Disabled
        } else {
            RelayMode::Custom(RelayMap::from_iter(self.relays.iter().map(|(_, config)| config.clone())))
        }
    }

    pub(super) fn urls(&self) -> impl Iterator<Item = &RelayUrl> {
        self.relays.iter().map(|(_, config)| &config.url)
    }

    pub(super) fn index_of(&self, url: &RelayUrl) -> Option<u8> {
        self.relays.iter().find(|(_, config)| &config.url == url).map(|(index, _)| *index)
    }
}

fn relay_config(entry: &RelayEntry) -> Result<RelayConfig, NetError> {
    let url: RelayUrl = entry.url.parse().map_err(|_| NetError::InvalidRelayUrl(entry.url.to_string()))?;
    let Some(port) = entry.quic_port else {
        return Ok(RelayConfig::new(url, None));
    };
    let mut config = RelayConfig::from(url);
    if let Some(quic) = config.quic.as_mut() {
        quic.port = port;
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn entry(index: u8, url: &'static str, quic_port: Option<u16>) -> RelayEntry {
        RelayEntry { index, url: Cow::Borrowed(url), operator: RelayOperator::Pumpkin, quic_port }
    }

    fn two_relays() -> Vec<RelayEntry> {
        vec![entry(0, "https://relay-a.example.org./", Some(7842)), entry(1, "https://relay-b.example.org./", None)]
    }

    #[test]
    fn indexes_are_unique_and_in_their_operator_range() {
        let mut seen = HashSet::new();
        for entry in RELAY_MAP {
            assert!(seen.insert(entry.index), "index {} twice", entry.index);
            let range = match entry.operator {
                RelayOperator::Pumpkin => 0..=99,
                RelayOperator::N0 => 200..=209,
            };
            assert!(range.contains(&entry.index), "index {} outside its range", entry.index);
        }
    }

    #[test]
    fn every_entry_of_the_built_in_map_is_valid() {
        let selected = SelectedRelays::select(RELAY_MAP, RelaySelection::All).unwrap();

        assert_eq!(selected.urls().count(), RELAY_MAP.len());
    }

    #[cfg(any(debug_assertions, feature = "beta-relays"))]
    #[test]
    fn n0_entries_equal_the_production_relays_of_the_locked_iroh() {
        let ours: HashSet<RelayUrl> =
            SelectedRelays::select(RELAY_MAP, RelaySelection::All).unwrap().urls().cloned().collect();

        let iroh: HashSet<RelayUrl> = iroh::defaults::prod::default_relay_map().urls::<Vec<_>>().into_iter().collect();

        assert_eq!(ours, iroh);
        assert_eq!(DEFAULT_QUIC_PORT, iroh::defaults::DEFAULT_RELAY_QUIC_PORT);
    }

    #[cfg(not(any(debug_assertions, feature = "beta-relays")))]
    #[test]
    fn release_map_holds_only_our_relays() {
        assert!(RELAY_MAP.iter().all(|entry| entry.operator == RelayOperator::Pumpkin));
    }

    #[test]
    fn all_selects_every_entry_and_nothing_else() {
        let map = two_relays();

        let selected = SelectedRelays::select(&map, RelaySelection::All).unwrap();

        let urls: Vec<String> = selected.urls().map(|url| url.to_string()).collect();
        assert_eq!(urls, ["https://relay-a.example.org./", "https://relay-b.example.org./"]);
    }

    #[test]
    fn only_selects_the_one_entry() {
        let map = two_relays();

        let selected = SelectedRelays::select(&map, RelaySelection::Only(1)).unwrap();

        let urls: Vec<String> = selected.urls().map(|url| url.to_string()).collect();
        assert_eq!(urls, ["https://relay-b.example.org./"]);
        assert_eq!(selected.index_of(selected.urls().next().unwrap()), Some(1));
    }

    #[test]
    fn unknown_index_is_never_selected() {
        let map = two_relays();

        assert!(find_relay(&map, 77).is_none());
        assert!(matches!(SelectedRelays::select(&map, RelaySelection::Only(77)), Err(NetError::UnknownRelay(77))));
    }

    #[test]
    fn quic_port_is_taken_as_given() {
        let map = [entry(0, "https://relay-a.example.org./", Some(7843)), entry(1, "https://relay-b.example.org./", None)];

        let configs: Vec<_> = map.iter().map(|entry| relay_config(entry).unwrap().quic.map(|quic| quic.port)).collect();

        assert_eq!(configs, [Some(7843), None]);
    }

    #[test]
    fn invalid_url_is_refused() {
        let map = vec![entry(0, "not a url", None)];

        assert!(matches!(SelectedRelays::select(&map, RelaySelection::All), Err(NetError::InvalidRelayUrl(_))));
    }

    #[test]
    fn empty_selection_switches_relays_off() {
        let selected = SelectedRelays::select(&[], RelaySelection::All).unwrap();

        assert!(matches!(selected.relay_mode(), RelayMode::Disabled));
    }
}
