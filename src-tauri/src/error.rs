mod text;

use std::fmt;

use serde::{Serialize, Serializer};

pub use text::{is_translated, Coded, ErrorText};

use crate::coded;

/// Zentraler Fehlertyp des Backends. Wird an das Frontend als `{ code, message }` serialisiert: `code` ist die
/// stabile Fehlerart, an der das Frontend Fälle erkennt, `message` der deutsche Satz (Details nach „ – Details: “).
/// Ist der Text schon ein Fehlercode (`coded!`), kommen `key`, `params` und `details` dazu; das Frontend übersetzt
/// sie in die Sprache der Oberfläche und zeigt sonst `message`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    Io(#[from] std::io::Error),
    Json(#[from] serde_json::Error),
    Http(#[from] reqwest::Error),
    Zip(#[from] zip::result::ZipError),
    Nbt(#[from] fastnbt::error::Error),
    Download(ErrorText),
    Upload(ErrorText),
    Tauri(#[from] tauri::Error),
    Keyring(#[from] keyring::Error),
    Trash(#[from] trash::Error),
    Sqlite(#[from] rusqlite::Error),
    NotFound(ErrorText),
    Invalid(ErrorText),
    /// Der Server lehnt endgültig ab, die Meldung sagt, was zu tun ist; ein neuer Versuch ändert nichts.
    Refused(ErrorText),
    Cancelled,
}

impl AppError {
    /// Fehler mit einer Meldung, die der Nutzer so lesen soll.
    pub fn invalid(message: impl Into<ErrorText>) -> Self {
        Self::Invalid(message.into())
    }

    /// `kind` (etwa „Welt“) mit der ID `id` gibt es nicht.
    pub fn not_found(kind: &str, id: impl fmt::Display) -> Self {
        Self::NotFound(format!("{kind} „{id}“ wurde nicht gefunden").into())
    }

    /// Stabiler Schlüssel der Fehlerart für das Frontend; ändert sich nie, auch wenn der Text umformuliert wird.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "io",
            Self::Json(_) => "json",
            Self::Http(_) => "http",
            Self::Zip(_) => "zip",
            Self::Nbt(_) => "nbt",
            Self::Download(_) => "download",
            Self::Upload(_) => "upload",
            Self::Tauri(_) => "tauri",
            Self::Keyring(_) => "keyring",
            Self::Trash(_) => "trash",
            Self::Sqlite(_) => "sqlite",
            Self::NotFound(_) => "not_found",
            Self::Invalid(_) => "invalid",
            Self::Refused(_) => "refused",
            Self::Cancelled => "cancelled",
        }
    }

    /// Fehlte die Datei oder der Ordner?
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::Io(e) if e.kind() == std::io::ErrorKind::NotFound)
    }

    /// Fehlte die Datei, ist `what` nicht installiert; jeder andere Fehler bleibt, wie er ist.
    pub fn or_not_installed(self, what: impl fmt::Display) -> Self {
        if self.is_not_found() { Self::invalid(coded!("errors.notInstalled", what = what)) } else { self }
    }

    /// Ob ein neuer Versuch helfen kann. Nicht, wenn der Server die Anfrage selbst ablehnt (4xx außer 408 Zeitüberschreitung
    /// und 429 zu viele Anfragen): dieselbe Anfrage bekäme dieselbe Antwort.
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Refused(_) => false,
            Self::Http(err) => !err.status().is_some_and(|s| s.is_client_error() && !matches!(s.as_u16(), 408 | 429)),
            _ => true,
        }
    }

    /// Die Meldung für den Nutzer, als Fehlercode, sobald die Stelle umgestellt ist.
    fn text(&self) -> ErrorText {
        match self {
            Self::Io(err) => io_text(err).into(),
            Self::Json(err) => coded!("errors.json").with_details(err.to_string()).into(),
            Self::Http(err) => http_text(err).into(),
            Self::Zip(err) => coded!("errors.zip").with_details(err.to_string()).into(),
            Self::Nbt(err) => coded!("errors.nbt").with_details(err.to_string()).into(),
            Self::Download(details) => coded!("errors.download").with_details(details.clone()).into(),
            Self::Upload(details) => coded!("errors.upload").with_details(details.clone()).into(),
            Self::Tauri(err) => coded!("errors.tauri").with_details(err.to_string()).into(),
            Self::Keyring(err) => keyring_text(err).into(),
            Self::Trash(err) => coded!("errors.trash").with_details(err.to_string()).into(),
            Self::Sqlite(err) => coded!("errors.sqlite").with_details(err.to_string()).into(),
            Self::NotFound(text) | Self::Invalid(text) | Self::Refused(text) => text.clone(),
            Self::Cancelled => coded!("errors.cancelled").into(),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.text().fmt(f)
    }
}

fn io_text(err: &std::io::Error) -> Coded {
    use std::io::ErrorKind::*;
    // Windows: 32 = Datei von anderem Prozess geöffnet, 33 = Bereich gesperrt, 39/112 = Datenträger voll.
    // Rohe Codes nur unter Windows deuten; unter Unix bedeuten 32/33/39 anderes (EPIPE, EDOM, ENOTEMPTY).
    let code = if cfg!(windows) { err.raw_os_error() } else { None };
    let text = match (err.kind(), code) {
        (StorageFull, _) | (_, Some(39 | 112)) => coded!("errors.io.storageFull"),
        (_, Some(32 | 33)) => coded!("errors.io.fileInUse"),
        (PermissionDenied, _) => coded!("errors.io.permissionDenied"),
        (NotFound, _) => coded!("errors.io.notFound"),
        (TimedOut, _) => coded!("errors.io.timedOut"),
        _ => coded!("errors.io.other"),
    };
    text.with_details(err.to_string())
}

fn http_text(err: &reqwest::Error) -> Coded {
    let text = match err.status().map(|s| s.as_u16()) {
        Some(404 | 410) => coded!("errors.http.gone"),
        Some(401 | 403) => coded!("errors.http.forbidden"),
        Some(429) => coded!("errors.http.tooManyRequests"),
        Some(500..=599) => coded!("errors.http.serverError"),
        Some(_) => coded!("errors.http.rejected"),
        None if err.is_timeout() => coded!("errors.http.timeout"),
        None if err.is_connect() => coded!("errors.http.offline"),
        None if err.is_decode() => coded!("errors.http.unreadable"),
        None => coded!("errors.http.interrupted"),
    };
    text.with_details(err.to_string())
}

fn keyring_text(err: &keyring::Error) -> Coded {
    // Unter Linux fehlt oft der Secret-Service-Dienst; dort sagt die Meldung, welcher gebraucht wird.
    let text = if cfg!(target_os = "linux") { coded!("errors.keyring.linux") } else { coded!("errors.keyring") };
    text.with_details(err.to_string())
}

/// Was das Frontend von einem Fehler bekommt; `coded` liefert `key`, `params` und `details` mit.
#[derive(Serialize)]
struct Wire<'a> {
    code: &'static str,
    message: String,
    #[serde(flatten)]
    coded: Option<&'a Coded>,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let text = self.text();
        Wire { code: self.code(), message: text.to_string(), coded: text.as_coded() }.serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    fn starts(err: AppError, prefix: &str) {
        let text = err.to_string();
        assert!(text.starts_with(prefix), "{text}");
    }

    #[test]
    fn io_errors_read_like_sentences() {
        starts(Error::from(ErrorKind::StorageFull).into(), "Auf der Festplatte ist nicht genug Platz");
        starts(Error::from(ErrorKind::PermissionDenied).into(), "Zugriff auf eine Datei wurde verweigert");
        starts(Error::other("x").into(), "Beim Lesen oder Schreiben");
        assert!(AppError::from(Error::other("kaputt")).to_string().ends_with(" – Details: kaputt"));
        assert_eq!(AppError::Cancelled.to_string(), "Vorgang abgebrochen");
        assert_eq!(AppError::invalid("Instanz läuft noch").to_string(), "Instanz läuft noch");
    }

    #[test]
    fn an_unreachable_keyring_names_the_linux_service() {
        let text = AppError::from(keyring::Error::NoStorageAccess("dienst fehlt".into())).to_string();
        assert!(text.starts_with("Der Passwortspeicher des Systems ist nicht erreichbar."), "{text}");
        assert_eq!(text.contains("GNOME Keyring oder KWallet"), cfg!(target_os = "linux"), "{text}");
        assert!(text.contains(" – Details: ") && text.ends_with("dienst fehlt"), "{text}");
    }

    #[test]
    fn only_missing_files_read_as_not_installed() {
        let missing = AppError::from(Error::from(ErrorKind::NotFound));
        assert!(missing.is_not_found());
        assert_eq!(missing.or_not_installed("Version 1.21").to_string(), "Version 1.21 ist nicht installiert");
        let locked = AppError::from(Error::from(ErrorKind::PermissionDenied));
        assert!(!locked.is_not_found());
        assert!(locked.or_not_installed("Version 1.21").to_string().starts_with("Zugriff auf eine Datei"));
        assert!(!AppError::not_found("Welt", "x").is_not_found());
    }

    #[test]
    #[cfg(windows)]
    fn windows_codes_read_like_sentences() {
        starts(Error::from_raw_os_error(112).into(), "Auf der Festplatte ist nicht genug Platz");
        starts(Error::from_raw_os_error(32).into(), "Eine Datei wird gerade von einem anderen Programm benutzt");
    }

    #[test]
    #[cfg(unix)]
    fn unix_codes_read_by_kind() {
        starts(Error::from_raw_os_error(libc::ENOSPC).into(), "Auf der Festplatte ist nicht genug Platz");
        starts(Error::from_raw_os_error(libc::EPIPE).into(), "Beim Lesen oder Schreiben");
    }

    fn json(err: AppError) -> serde_json::Value {
        serde_json::to_value(err).unwrap()
    }

    #[test]
    fn raw_errors_reach_the_frontend_as_code_and_message() {
        assert_eq!(
            json(AppError::not_found("Welt", "x")),
            serde_json::json!({ "code": "not_found", "message": "Welt „x“ wurde nicht gefunden" })
        );
        assert_eq!(json(AppError::invalid("Instanz läuft noch")), serde_json::json!({ "code": "invalid", "message": "Instanz läuft noch" }));
    }

    #[test]
    fn coded_errors_reach_the_frontend_with_key_params_and_details() {
        assert_eq!(
            json(AppError::Cancelled),
            serde_json::json!({ "code": "cancelled", "message": "Vorgang abgebrochen", "key": "errors.cancelled" })
        );
        assert_eq!(
            json(AppError::from(Error::from(ErrorKind::NotFound)).or_not_installed("Fabric")),
            serde_json::json!({
                "code": "invalid",
                "message": "Fabric ist nicht installiert",
                "key": "errors.notInstalled",
                "params": { "what": "Fabric" },
            })
        );
        let io = json(Error::other("kaputt").into());
        assert_eq!((&io["code"], &io["key"], &io["details"]), (&"io".into(), &"errors.io.other".into(), &"kaputt".into()));
    }

    #[test]
    fn download_details_keep_their_own_code() {
        let wire = json(AppError::Download(coded!("errors.instance.stillRunning").into()));
        assert_eq!(wire["message"], "Ein Download ist fehlgeschlagen – Details: Instanz läuft noch");
        assert_eq!(wire["details"], serde_json::json!({ "key": "errors.instance.stillRunning" }));
    }

    #[tokio::test]
    async fn http_errors_read_like_sentences() {
        // Port 9 auf localhost: sofortige Ablehnung, kein echtes Netz nötig.
        let err = reqwest::Client::new().get("http://127.0.0.1:9/").send().await.unwrap_err();
        starts(err.into(), "Keine Verbindung zum Internet");
        starts(http_error(404).into(), "Die Datei gibt es auf dem Server nicht");
        starts(http_error(503).into(), "Der Server hat gerade Probleme");
    }

    #[test]
    fn only_refusals_of_the_request_are_final() {
        for status in [401, 403, 404] {
            assert!(!AppError::from(http_error(status)).is_retryable(), "{status}");
        }
        for status in [408, 429, 500, 503] {
            assert!(AppError::from(http_error(status)).is_retryable(), "{status}");
        }
        assert!(!AppError::Refused("Schlüssel fehlt".into()).is_retryable());
        assert!(AppError::Download("SHA-1 stimmt nicht".into()).is_retryable());
    }

    /// reqwest-Fehler mit Status, wie ihn `error_for_status` liefert.
    fn http_error(status: u16) -> reqwest::Error {
        let response = tauri::http::Response::builder().status(status).body(Vec::<u8>::new()).unwrap();
        reqwest::Response::from(response).error_for_status().unwrap_err()
    }
}
