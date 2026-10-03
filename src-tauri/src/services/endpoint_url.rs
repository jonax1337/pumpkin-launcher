//! Adressen eigener Dienste (CurseForge-Proxy, Freunde-Verzeichnis), die per Umgebungsvariable oder beim Bauen gesetzt werden.

/// Nur eine https-Adresse ohne Zugangsdaten, Pfad, Suchteil und Anker, ohne Schrägstrich am Ende; sonst würde ein falsch
/// gesetzter Wert alles dorthin leiten.
pub fn https_base(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let plain = url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
        && matches!(url.path(), "" | "/")
        && url.query().is_none()
        && url.fragment().is_none();
    plain.then(|| url.as_str().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_address_must_be_plain_https() {
        assert_eq!(https_base(" https://pumpkin-curseforge.jonas.workers.dev/ ").as_deref(), Some("https://pumpkin-curseforge.jonas.workers.dev"));
        for bad in ["", "http://x.workers.dev", "https://user:pw@x.workers.dev", "https://x.workers.dev/v1", "https://x.workers.dev/?a=1", "ftp://x", "nicht-url"] {
            assert_eq!(https_base(bad), None, "{bad}");
        }
    }

    #[test]
    fn an_anchor_or_a_password_alone_is_refused_too() {
        assert_eq!(https_base("https://x.workers.dev/#anker"), None);
        assert_eq!(https_base("https://:pw@x.workers.dev"), None);
    }

    #[test]
    fn a_port_stays_part_of_the_base() {
        assert_eq!(https_base("https://directory.example:8443/").as_deref(), Some("https://directory.example:8443"));
    }
}
