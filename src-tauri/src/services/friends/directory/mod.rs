//! Das Freunde-Verzeichnis (docs/friends/BYNAME.md): Freunde per Minecraft-Namen, Briefkasten und Kontonachweis über Mojang.
//! Dieses Modul hält die Abhängigkeiten, die der Dienst von außen bekommt (Worker, Mojang, Konto), und die Fehlerart des Verzeichnisses.
pub mod api;
pub mod certificate;
#[cfg(test)]
pub mod fake;
#[cfg(test)]
mod http_tests;
pub mod mojang;
pub mod proof;
pub mod wire;

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use futures::future::BoxFuture;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::endpoint_url::https_base;
use crate::services::friends::contract::NAME_COOLDOWN_DAYS;

use api::{DirectoryApi, WorkerApi};
use mojang::{MojangHttp, MojangSessions};

/// Adresse des Verzeichnis-Workers, leer bis der Betreiber ihn bereitgestellt hat. Forks setzen `PUMPKIN_FRIENDS_DIRECTORY`
/// (Laufzeit oder beim Bauen) auf ihren eigenen Worker (`directory/`), siehe BYNAME OD-N5.
pub const DEFAULT_DIRECTORY: &str = "";
const DIRECTORY_ENV: &str = "PUMPKIN_FRIENDS_DIRECTORY";
/// Alle 15 Minuten nach neuen Briefen sehen (BYNAME 7.2).
pub const PRODUCTION_POLL: Duration = Duration::from_secs(900);

/// Gültige Minecraft-Sitzung des ersten Microsoft-Kontos; das Token verlässt Rust nie.
#[derive(Clone)]
pub struct McIdentity {
    /// 32 Hex-Zeichen in Kleinbuchstaben.
    pub uuid: String,
    pub name: String,
    pub access_token: String,
}

impl fmt::Debug for McIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McIdentity")
            .field("uuid", &self.uuid)
            .field("name", &self.name)
            .field("access_token", &"<verborgen>")
            .finish()
    }
}

pub trait AccountTokens: Send + Sync + 'static {
    /// Produktion: `auth::session` des ersten Microsoft-Kontos.
    fn minecraft_session(&self) -> BoxFuture<'_, AppResult<McIdentity>>;
    /// Drops the cached Minecraft session after Mojang refused its token, so the next one is refreshed.
    fn forget_minecraft_session(&self);
}

pub struct DirectoryDeps {
    pub api: Arc<dyn DirectoryApi>,
    pub mojang: Arc<dyn MojangSessions>,
    pub tokens: Arc<dyn AccountTokens>,
    pub poll_interval: Duration,
    /// Der Rechnername des Verzeichnisses für den Datenschutzhinweis (`DirectoryStatus.host`).
    pub host: String,
}

impl DirectoryDeps {
    /// `None`, solange dieser Build kein Verzeichnis kennt.
    pub fn production(http: reqwest::Client, tokens: Arc<dyn AccountTokens>) -> Option<Self> {
        let base = directory_url()?;
        let host = reqwest::Url::parse(&base).ok()?.host_str()?.to_owned();
        Some(Self {
            api: Arc::new(WorkerApi::new(http.clone(), base)),
            mojang: Arc::new(MojangHttp::new(http)),
            tokens,
            poll_interval: PRODUCTION_POLL,
            host,
        })
    }
}

/// Adresse des Verzeichnisses ohne Schrägstrich am Ende; `None` ohne Adresse oder bei einer ungültigen (nicht https).
pub fn directory_url() -> Option<String> {
    resolve_directory_url(
        std::env::var(DIRECTORY_ENV).ok(),
        option_env!("PUMPKIN_FRIENDS_DIRECTORY"),
    )
}

/// Die Laufzeit-Einstellung geht vor der beim Bauen, die vor dem Standard; ein ungültiger Wert fällt auf keine Adresse
/// zurück statt auf einen anderen Wert.
fn resolve_directory_url(runtime: Option<String>, build_time: Option<&str>) -> Option<String> {
    let chosen = runtime
        .as_deref()
        .or(build_time)
        .unwrap_or(DEFAULT_DIRECTORY);
    https_base(chosen)
}

/// Warum ein Aufruf des Verzeichnisses scheiterte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectoryError {
    Unreachable,
    Unauthorized,
    NotFindable,
    NotRegistered,
    RecipientFull,
    SendQuota,
    PairCooldown,
    RateLimited {
        retry_after: Option<u64>,
    },
    /// No pinned Mojang key verifies the certificate, or its key is unusable: Mojang may have rotated its keys.
    BadCertificate,
    /// The directory's clock says the certificate has expired.
    CertificateExpired,
    /// Der Worker hat die Anfrage als fehlerhaft abgelehnt: ein Fehler im Launcher oder im Worker.
    Invalid(&'static str),
}

impl DirectoryError {
    /// Die Meldung für den Nutzer (BYNAME 9.6); `name` ist der Minecraft-Name, an den der Aufruf ging.
    pub fn into_app_error(self, name: &str) -> AppError {
        let text = match self {
            Self::NotFindable => coded!("errors.friends.nameNotFindable", name = name),
            Self::PairCooldown => coded!(
                "errors.friends.nameCooldown",
                name = name,
                days = NAME_COOLDOWN_DAYS
            ),
            Self::RecipientFull => coded!("errors.friends.requestsFull"),
            Self::SendQuota | Self::RateLimited { .. } => coded!("errors.friends.rateLimited"),
            Self::Invalid(code) => {
                tracing::warn!(
                    code,
                    "Das Verzeichnis lehnt eine Anfrage des Launchers als ungültig ab"
                );
                coded!("errors.friends.directoryUnavailable")
            }
            Self::Unreachable
            | Self::Unauthorized
            | Self::NotRegistered
            | Self::BadCertificate
            | Self::CertificateExpired => coded!("errors.friends.directoryUnavailable"),
        };
        AppError::invalid(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::test_support::error_key;

    #[test]
    fn the_runtime_address_beats_the_build_time_address() {
        let resolved = resolve_directory_url(
            Some("https://runtime.example".into()),
            Some("https://build.example"),
        );
        assert_eq!(resolved.as_deref(), Some("https://runtime.example"));
    }

    #[test]
    fn the_build_time_address_is_used_without_a_runtime_address() {
        assert_eq!(
            resolve_directory_url(None, Some("https://build.example/")).as_deref(),
            Some("https://build.example")
        );
    }

    #[test]
    fn without_any_address_there_is_no_directory() {
        assert_eq!(resolve_directory_url(None, None), None);
    }

    #[test]
    fn an_address_that_is_not_https_means_no_directory() {
        assert_eq!(
            resolve_directory_url(
                Some("http://directory.example".into()),
                Some("https://build.example")
            ),
            None
        );
        assert_eq!(
            resolve_directory_url(None, Some("https://user:pw@build.example")),
            None
        );
    }

    #[test]
    fn the_token_never_shows_in_the_debug_output_of_a_session() {
        let identity = McIdentity {
            uuid: "a".repeat(32),
            name: "Steve".into(),
            access_token: "eyJgeheim".into(),
        };
        let shown = format!("{identity:?}");
        assert!(!shown.contains("eyJgeheim"), "{shown}");
        assert!(shown.contains("Steve"));
    }

    fn keys(error: DirectoryError) -> String {
        error_key(&error.into_app_error("Steve"))
    }

    #[test]
    fn errors_map_to_the_keys_of_the_table() {
        let table = [
            (
                DirectoryError::NotFindable,
                "errors.friends.nameNotFindable",
            ),
            (DirectoryError::PairCooldown, "errors.friends.nameCooldown"),
            (DirectoryError::RecipientFull, "errors.friends.requestsFull"),
            (DirectoryError::SendQuota, "errors.friends.rateLimited"),
            (
                DirectoryError::RateLimited {
                    retry_after: Some(60),
                },
                "errors.friends.rateLimited",
            ),
            (
                DirectoryError::Unreachable,
                "errors.friends.directoryUnavailable",
            ),
            (
                DirectoryError::BadCertificate,
                "errors.friends.directoryUnavailable",
            ),
            (
                DirectoryError::NotRegistered,
                "errors.friends.directoryUnavailable",
            ),
            (
                DirectoryError::CertificateExpired,
                "errors.friends.directoryUnavailable",
            ),
            (
                DirectoryError::Unauthorized,
                "errors.friends.directoryUnavailable",
            ),
            (
                DirectoryError::Invalid("clock"),
                "errors.friends.directoryUnavailable",
            ),
        ];
        for (error, key) in table {
            assert_eq!(keys(error.clone()), key, "{error:?}");
        }
    }

    #[test]
    fn the_name_and_the_cooldown_days_reach_the_message() {
        let cooldown =
            serde_json::to_value(DirectoryError::PairCooldown.into_app_error("Steve")).unwrap();
        assert_eq!(cooldown["params"]["name"], "Steve");
        assert_eq!(cooldown["params"]["days"], "7");
        let unknown =
            serde_json::to_value(DirectoryError::NotFindable.into_app_error("Steve")).unwrap();
        assert_eq!(unknown["params"]["name"], "Steve");
    }
}
