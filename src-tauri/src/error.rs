use serde::{Serialize, Serializer};

/// Zentraler Fehlertyp des Backends. Wird an das Frontend als lesbarer Satz serialisiert;
/// technische Details folgen nach „ – Details: “.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{}", io_text(.0))]
    Io(#[from] std::io::Error),
    #[error("Die Daten konnten nicht gelesen werden – Details: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{}", http_text(.0))]
    Http(#[from] reqwest::Error),
    #[error("Das Archiv ist beschädigt oder kein gültiges Paket – Details: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Eine Spieldatei ist beschädigt oder hat ein unbekanntes Format – Details: {0}")]
    Nbt(#[from] fastnbt::error::Error),
    #[error("Ein Download ist fehlgeschlagen – Details: {0}")]
    Download(String),
    #[error("Das Hochladen hat nicht geklappt – Details: {0}")]
    Upload(String),
    #[error("Interner Fehler der App – Details: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Der Passwortspeicher des Systems ist nicht erreichbar – Details: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Die Datei konnte nicht in den Papierkorb verschoben werden – Details: {0}")]
    Trash(#[from] trash::Error),
    #[error("Die Datenbank eines anderen Launchers ist nicht lesbar – Details: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{kind} „{id}“ wurde nicht gefunden")]
    NotFound { kind: &'static str, id: String },
    #[error("{0}")]
    Invalid(String),
    #[error("Installation abgebrochen")]
    Cancelled,
}

fn io_text(err: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    // Windows: 32 = Datei von anderem Prozess geöffnet, 33 = Bereich gesperrt, 39/112 = Datenträger voll.
    // Rohe Codes nur unter Windows deuten; unter Unix bedeuten 32/33/39 anderes (EPIPE, EDOM, ENOTEMPTY).
    let code = if cfg!(windows) { err.raw_os_error() } else { None };
    let text = match (err.kind(), code) {
        (StorageFull, _) | (_, Some(39 | 112)) => "Auf der Festplatte ist nicht genug Platz frei. Schaffe Platz und versuch es erneut.",
        (_, Some(32 | 33)) => "Eine Datei wird gerade von einem anderen Programm benutzt. Schließe es (z. B. Minecraft) und versuch es erneut.",
        (PermissionDenied, _) => "Zugriff auf eine Datei wurde verweigert. Prüfe, ob ein anderes Programm sie sperrt oder schützt.",
        (NotFound, _) => "Eine benötigte Datei oder ein Ordner fehlt.",
        (TimedOut, _) => "Der Vorgang hat zu lange gedauert. Versuch es erneut.",
        _ => "Beim Lesen oder Schreiben einer Datei ist ein Fehler aufgetreten.",
    };
    format!("{text} – Details: {err}")
}

fn http_text(err: &reqwest::Error) -> String {
    let text = match err.status().map(|s| s.as_u16()) {
        Some(404 | 410) => "Die Datei gibt es auf dem Server nicht (mehr).",
        Some(401 | 403) => "Der Server hat den Zugriff verweigert.",
        Some(429) => "Zu viele Anfragen in kurzer Zeit. Warte einen Moment und versuch es erneut.",
        Some(500..=599) => "Der Server hat gerade Probleme. Versuch es später erneut.",
        Some(_) => "Der Server hat die Anfrage abgelehnt.",
        None if err.is_timeout() => "Der Server antwortet nicht rechtzeitig. Prüfe deine Verbindung und versuch es erneut.",
        None if err.is_connect() => "Keine Verbindung zum Internet. Prüfe deine Verbindung und versuch es erneut.",
        None if err.is_decode() => "Die Antwort des Servers war unvollständig oder unlesbar.",
        None => "Die Verbindung zum Server ist abgebrochen. Versuch es erneut.",
    };
    format!("{text} – Details: {err}")
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
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
        assert_eq!(AppError::Cancelled.to_string(), "Installation abgebrochen");
        assert_eq!(AppError::Invalid("Instanz läuft noch".into()).to_string(), "Instanz läuft noch");
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

    #[tokio::test]
    async fn http_errors_read_like_sentences() {
        // Port 9 auf localhost: sofortige Ablehnung, kein echtes Netz nötig.
        let err = reqwest::Client::new().get("http://127.0.0.1:9/").send().await.unwrap_err();
        starts(err.into(), "Keine Verbindung zum Internet");
        starts(http_error(404).into(), "Die Datei gibt es auf dem Server nicht");
        starts(http_error(503).into(), "Der Server hat gerade Probleme");
    }

    /// reqwest-Fehler mit Status, wie ihn `error_for_status` liefert.
    fn http_error(status: u16) -> reqwest::Error {
        let response = tauri::http::Response::builder().status(status).body(Vec::<u8>::new()).unwrap();
        reqwest::Response::from(response).error_for_status().unwrap_err()
    }
}
