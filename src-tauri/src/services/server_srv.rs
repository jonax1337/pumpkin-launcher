//! SRV-Auflösung wie im Spiel: Für eine Adresse ohne Port fragt es zuerst `_minecraft._tcp.<host>` ab und verbindet
//! sich mit Ziel und Port aus dem Eintrag; ohne Eintrag gilt `host:25565`. Gefragt werden die DNS-Server, die das
//! Betriebssystem eingestellt hat. Aus der Antwort übernimmt der Launcher nur Zielname und Port.
use std::{cmp::Reverse, future::Future, io, net::IpAddr, time::Duration};

use hickory_resolver::{proto::rr::RData, TokioResolver};
use tokio::sync::OnceCell;

use super::servers::DEFAULT_PORT;

/// Danach gilt die Adresse wie eine ohne SRV-Eintrag.
const SRV_TIMEOUT: Duration = Duration::from_secs(3);
const SRV_PREFIX: &str = "_minecraft._tcp.";

#[derive(Debug, Clone, PartialEq)]
pub struct SrvRecord {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    /// Zielname, wie DNS ihn liefert, meist mit abschließendem Punkt.
    pub target: String,
}

pub trait SrvLookup {
    /// SRV-Einträge zum voll qualifizierten Namen `name`.
    fn srv_records(&self, name: &str) -> impl Future<Output = io::Result<Vec<SrvRecord>>> + Send;
}

/// Host und Port, mit denen sich das Spiel für `host` verbindet; `port` ist der Port der Adresse, falls sie einen nennt.
pub async fn resolve_target(host: &str, port: Option<u16>, lookup: &impl SrvLookup) -> (String, u16) {
    match port {
        Some(port) => (host.into(), port),
        None if host.parse::<IpAddr>().is_ok() => (host.into(), DEFAULT_PORT),
        None => srv_target(host, lookup).await.unwrap_or_else(|| (host.into(), DEFAULT_PORT)),
    }
}

/// Ziel des bevorzugten SRV-Eintrags; `None` ohne verwendbaren Eintrag, bei Fehler (auch NXDOMAIN) oder Zeitablauf.
async fn srv_target(host: &str, lookup: &impl SrvLookup) -> Option<(String, u16)> {
    let records = tokio::time::timeout(SRV_TIMEOUT, lookup.srv_records(&format!("{SRV_PREFIX}{host}."))).await;
    preferred_target(records.ok()?.ok()?)
}

/// Niedrigste Priorität, bei Gleichstand höchstes Gewicht. Das Ziel `.` heißt laut RFC 2782 „Dienst gibt es hier nicht“.
fn preferred_target(records: Vec<SrvRecord>) -> Option<(String, u16)> {
    let best = records
        .into_iter()
        .filter(|record| !without_root_dot(&record.target).is_empty())
        .min_by_key(|record| (record.priority, Reverse(record.weight)))?;
    Some((without_root_dot(&best.target).into(), best.port))
}

fn without_root_dot(name: &str) -> &str {
    name.strip_suffix('.').unwrap_or(name)
}

/// Fragt die DNS-Server des Betriebssystems. Der Resolver samt Cache entsteht beim ersten Aufruf und wird von allen
/// Pings gemeinsam genutzt; scheitert sein Aufbau, versucht der nächste Aufruf es erneut.
pub struct SystemDns;

impl SrvLookup for SystemDns {
    async fn srv_records(&self, name: &str) -> io::Result<Vec<SrvRecord>> {
        let lookup = system_resolver().await?.srv_lookup(name).await.map_err(io::Error::other)?;
        let srv_records = lookup.answers().iter().filter_map(|record| match &record.data {
            RData::SRV(srv) => Some(SrvRecord { priority: srv.priority, weight: srv.weight, port: srv.port, target: srv.target.to_ascii() }),
            _ => None,
        });
        Ok(srv_records.collect())
    }
}

async fn system_resolver() -> io::Result<&'static TokioResolver> {
    static RESOLVER: OnceCell<TokioResolver> = OnceCell::const_new();
    RESOLVER.get_or_try_init(|| async { TokioResolver::builder_tokio()?.build() }).await.map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Antwortet mit festen Einträgen und merkt sich die gefragten Namen.
    struct FakeDns {
        answer: fn() -> io::Result<Vec<SrvRecord>>,
        asked: Mutex<Vec<String>>,
    }

    impl FakeDns {
        fn new(answer: fn() -> io::Result<Vec<SrvRecord>>) -> Self {
            Self { answer, asked: Mutex::new(Vec::new()) }
        }

        fn asked(&self) -> Vec<String> {
            self.asked.lock().unwrap().clone()
        }
    }

    impl SrvLookup for FakeDns {
        async fn srv_records(&self, name: &str) -> io::Result<Vec<SrvRecord>> {
            self.asked.lock().unwrap().push(name.into());
            (self.answer)()
        }
    }

    /// Antwortet nie.
    struct SilentDns;

    impl SrvLookup for SilentDns {
        async fn srv_records(&self, _name: &str) -> io::Result<Vec<SrvRecord>> {
            std::future::pending().await
        }
    }

    fn srv(priority: u16, weight: u16, port: u16, target: &str) -> SrvRecord {
        SrvRecord { priority, weight, port, target: target.into() }
    }

    fn target(host: &str, port: u16) -> (String, u16) {
        (host.into(), port)
    }

    #[tokio::test]
    async fn uses_the_srv_record_for_addresses_without_port() {
        let dns = FakeDns::new(|| Ok(vec![srv(0, 5, 25570, "node7.host.example.")]));
        assert_eq!(resolve_target("play.example.net", None, &dns).await, target("node7.host.example", 25570));
        assert_eq!(dns.asked(), ["_minecraft._tcp.play.example.net."]);
    }

    #[tokio::test]
    async fn prefers_lowest_priority_then_highest_weight() {
        let dns = FakeDns::new(|| {
            Ok(vec![srv(10, 100, 1, "backup."), srv(5, 10, 2, "light."), srv(5, 60, 3, "heavy."), srv(5, 60, 4, "twin.")])
        });
        assert_eq!(resolve_target("play.example.net", None, &dns).await, target("heavy", 3));
    }

    #[tokio::test]
    async fn accepts_targets_without_root_dot_and_skips_unavailable_service() {
        let relative = FakeDns::new(|| Ok(vec![srv(0, 0, 25566, "mc.example.org")]));
        assert_eq!(resolve_target("play.example.net", None, &relative).await, target("mc.example.org", 25566));

        let unavailable = FakeDns::new(|| Ok(vec![srv(0, 0, 25566, ".")]));
        assert_eq!(resolve_target("play.example.net", None, &unavailable).await, target("play.example.net", DEFAULT_PORT));
    }

    #[tokio::test]
    async fn falls_back_to_the_default_port_without_usable_answer() {
        let empty = FakeDns::new(|| Ok(vec![]));
        let failed = FakeDns::new(|| Err(io::Error::other("NXDOMAIN")));
        for dns in [empty, failed] {
            assert_eq!(resolve_target("play.example.net", None, &dns).await, target("play.example.net", DEFAULT_PORT));
        }
    }

    #[tokio::test(start_paused = true)]
    async fn gives_up_on_slow_dns() {
        assert_eq!(resolve_target("play.example.net", None, &SilentDns).await, target("play.example.net", DEFAULT_PORT));
    }

    #[tokio::test]
    async fn explicit_ports_and_ip_literals_skip_the_lookup() {
        let dns = FakeDns::new(|| Ok(vec![srv(0, 0, 1, "elsewhere.")]));
        assert_eq!(resolve_target("play.example.net", Some(25565), &dns).await, target("play.example.net", 25565));
        assert_eq!(resolve_target("play.example.net", Some(25570), &dns).await, target("play.example.net", 25570));
        assert_eq!(resolve_target("192.168.0.5", None, &dns).await, target("192.168.0.5", DEFAULT_PORT));
        assert_eq!(resolve_target("2001:db8::1", None, &dns).await, target("2001:db8::1", DEFAULT_PORT));
        assert!(dns.asked().is_empty());
    }
}
