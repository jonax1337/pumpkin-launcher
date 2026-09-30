//! Download von beliebigen öffentlichen HTTPS-Adressen (Technic-Packs liegen auf Dropbox, GitHub, eigenen
//! Servern). Ohne Prüfsumme als Gegengewicht: nur HTTPS auf Port 443, nur öffentliche Zieladressen
//! (kein localhost, kein Heimnetz), jede Weiterleitung einzeln geprüft, die geprüfte Adresse wird fest verwendet.
use crate::{error::AppResult, services::modrinth::invalid};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    path::Path,
    time::Duration,
};
use tokio::io::AsyncWriteExt;

const MAX_HOPS: usize = 5;

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_unspecified()
        || a == 0
        // Gemeinsamer Adressraum von Anbietern (100.64.0.0/10), Protokollzuweisungen, Benchmarks, Dokumentation, reserviert.
        || (a == 100 && (64..128).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 240)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(v4);
    }
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        // Eindeutige lokale Adressen (fc00::/7), Link-Local (fe80::/10), Dokumentation (2001:db8::/32).
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (first == 0x2001 && ip.segments()[1] == 0x0db8))
}

pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => public_v6(v6),
    }
}

/// Nur `https://host/…` auf Port 443, ohne Zugangsdaten; der Host ist kein IP-Literal.
fn check(url: &reqwest::Url) -> AppResult<String> {
    if url.scheme() != "https" || url.port_or_known_default() != Some(443) || !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("Nur https-Adressen auf Port 443 sind erlaubt"));
    }
    url.domain().map(str::to_string).ok_or_else(|| invalid("Adresse ohne Hostnamen nicht erlaubt"))
}

async fn resolve(host: &str) -> AppResult<Vec<SocketAddr>> {
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, 443)).await.map_err(|e| invalid(format!("{host} nicht erreichbar: {e}")))?.collect();
    if addrs.is_empty() || !addrs.iter().all(|a| is_public(a.ip())) {
        return Err(invalid(format!("{host} zeigt auf keine öffentliche Adresse")));
    }
    Ok(addrs)
}

/// Lädt `url` nach `dest`. `progress(geladen, gesamt)` in Bytes (gesamt 0 = unbekannt). Überschreitet die
/// Datei `limit`, bricht der Download ab und die Teildatei wird gelöscht.
pub async fn download_public(url: &str, dest: &Path, limit: u64, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> AppResult<()> {
    let mut url = reqwest::Url::parse(url).map_err(|e| invalid(e.to_string()))?;
    for _ in 0..MAX_HOPS {
        let host = check(&url)?;
        let addrs = resolve(&host).await?;
        let client = reqwest::Client::builder()
            .user_agent(concat!("pumpkin-launcher/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(3600))
            .resolve_to_addrs(&host, &addrs)
            .build()?;
        let response = client.get(url.clone()).send().await?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| invalid("Weiterleitung ohne Ziel"))?;
            url = url.join(location).map_err(|e| invalid(e.to_string()))?;
            continue;
        }
        let mut response = response.error_for_status()?;
        let total = response.content_length().unwrap_or(0);
        if total > limit {
            return Err(invalid("Download zu groß"));
        }
        let mut file = tokio::fs::File::create(dest).await?;
        let mut done = 0u64;
        let result: AppResult<()> = async {
            while let Some(chunk) = response.chunk().await? {
                done += chunk.len() as u64;
                if done > limit {
                    return Err(invalid("Download zu groß"));
                }
                file.write_all(&chunk).await?;
                progress(done, total);
            }
            file.flush().await?;
            Ok(())
        }
        .await;
        drop(file);
        if let Err(e) = result {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(e);
        }
        return Ok(());
    }
    Err(invalid("Zu viele Weiterleitungen"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_addresses_pass() {
        for ok in ["8.8.8.8", "162.125.1.18", "140.82.112.3", "2606:4700::1111"] {
            assert!(is_public(ok.parse().unwrap()), "{ok}");
        }
        for bad in [
            "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
            "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2001:db8::1",
        ] {
            assert!(!is_public(bad.parse().unwrap()), "{bad}");
        }
    }

    #[test]
    fn urls_must_be_plain_https_hostnames() {
        for ok in ["https://dl.dropbox.com/s/x/modpack.zip?dl=1", "https://raw.githubusercontent.com/a/b/main/p.zip"] {
            assert!(check(&reqwest::Url::parse(ok).unwrap()).is_ok(), "{ok}");
        }
        for bad in [
            "http://dl.dropbox.com/x.zip",
            "https://127.0.0.1/x.zip",
            "https://[::1]/x.zip",
            "https://example.com:8443/x.zip",
            "https://user:pw@example.com/x.zip",
            "ftp://example.com/x.zip",
        ] {
            assert!(check(&reqwest::Url::parse(bad).unwrap()).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn localhost_names_are_refused() {
        assert!(resolve("localhost").await.is_err());
    }
}
