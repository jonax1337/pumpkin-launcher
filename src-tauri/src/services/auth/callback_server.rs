//! Loopback-Server für den Rücksprung der Browser-Anmeldung samt der Seite, die der Browser danach zeigt.
use std::collections::HashMap;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::oauth::{oauth_text, OAuthError};
use super::Pending;
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::data_url;

/// Platz für die Anfragezeile samt Kopfzeilen; längere Rücksprünge erzeugt Microsoft nicht.
const REQUEST_BUFFER: usize = 8192;
/// Browser öffnen gern leere Vorab-Verbindungen; auf die wird nur kurz gewartet.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

/// Wartet auf den Rücksprung des Browsers und liefert den einmaligen Code. Fremde oder falsche
/// Aufrufe (anderer `state`, andere Pfade, leere Verbindungen) werden abgewiesen, ohne abzubrechen.
pub(super) async fn wait_for_code(p: &Pending, listener: &TcpListener, expected_state: &str) -> AppResult<String> {
    loop {
        let mut stream = accept(p, listener).await?;
        let Some(line) = read_request_line(&mut stream).await else { continue };
        match parse_callback(&line, expected_state) {
            Callback::Code(code) => {
                respond(&mut stream, 200, &SIGNED_IN.render()).await;
                return Ok(code);
            }
            Callback::Failed(err) => {
                respond(&mut stream, 200, &FAILED.render()).await;
                return Err(AppError::invalid(oauth_text(&err)));
            }
            Callback::Ignore(status) => respond(&mut stream, status, "").await,
        }
    }
}

/// Nächste Verbindung, solange die Anmeldung weder abgelaufen noch abgebrochen ist.
async fn accept(p: &Pending, listener: &TcpListener) -> AppResult<TcpStream> {
    let left = p.expires_at.saturating_duration_since(Instant::now());
    match p.cancel.run_until_cancelled(tokio::time::timeout(left, listener.accept())).await {
        None => Err(AppError::invalid(coded!("errors.auth.cancelled"))),
        Some(Err(_)) => Err(AppError::invalid(coded!("errors.auth.expired"))),
        Some(Ok(Err(err))) => Err(err.into()),
        Some(Ok(Ok((stream, _)))) => Ok(stream),
    }
}

/// Erste Zeile der HTTP-Anfrage oder `None` bei leerer, abgebrochener oder zu langsamer Verbindung.
async fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    let mut buf = [0u8; REQUEST_BUFFER];
    let mut len = 0;
    let read = async {
        while !buf[..len].contains(&b'\n') && len < buf.len() {
            match stream.read(&mut buf[len..]).await {
                Ok(0) | Err(_) => return None,
                Ok(n) => len += n,
            }
        }
        Some(())
    };
    tokio::time::timeout(REQUEST_TIMEOUT, read).await.ok()??;
    String::from_utf8_lossy(&buf[..len]).lines().next().map(str::to_owned)
}

async fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        _ => "Bad Request",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\r\nConnection: close\r\n\r\n",
        body.len()
    );
    // Schreibfehler bedeuten, dass der Browser die Verbindung schon geschlossen hat: Für die Anmeldung zählt nur
    // die Anfrage, die Antwort ist Höflichkeit.
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

enum Callback {
    Code(String),
    Failed(OAuthError),
    /// Nicht unsere Antwort: mit diesem Status abweisen und weiter warten.
    Ignore(u16),
}

/// Wertet die Anfragezeile `GET /?code=…&state=… HTTP/1.1` aus.
fn parse_callback(line: &str, expected_state: &str) -> Callback {
    let mut parts = line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else { return Callback::Ignore(400) };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/" {
        return Callback::Ignore(404);
    }
    let params: HashMap<String, String> =
        query.split('&').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (form_decode(k), form_decode(v))).collect();
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Callback::Ignore(400);
    }
    if let Some(error) = params.get("error") {
        let error_description = params.get("error_description").cloned().unwrap_or_default();
        return Callback::Failed(OAuthError { error: error.clone(), error_description });
    }
    match params.get("code") {
        Some(code) if !code.is_empty() => Callback::Code(code.clone()),
        _ => Callback::Ignore(400),
    }
}

/// Dekodiert einen Query-Wert; `+` steht in Formularkodierung für ein Leerzeichen, `%2B` für ein echtes Plus.
fn form_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(&s.replace('+', " ")).decode_utf8_lossy().into_owned()
}

// Seite im Browser nach der Anmeldung: Vorlage und Schriften liegen in `assets/login/`; Tokens (base.css, ui/tokens.css), Buddy, Wortzeichen
// und Favicon sind die Dateien der App selbst (`src/`, `branding/`). Alles wird eingebunden, die Seite lädt nichts nach.
const PAGE: &str = include_str!("../../../assets/login/page.html");
const APP_CSS: &str = concat!(include_str!("../../../../src/styles/base.css"), "\n", include_str!("../../../../src/ui/tokens.css"));
const FONT_BIG: &[u8] = include_bytes!("../../../assets/login/big-shoulders-800.woff2");
const FONT_HANKEN: &[u8] = include_bytes!("../../../assets/login/hanken-grotesk.woff2");
const WORDMARK: &[u8] = include_bytes!("../../../../branding/pumpkin-launcher/wordmark/light.svg");
const FAVICON: &[u8] = include_bytes!("../../../../branding/pumpkin-launcher/web/favicon.svg");

/// Die Seite, die der Browser nach dem Rücksprung zeigt (nur feste Texte, nichts aus der Anfrage).
struct ResultPage {
    buddy: &'static [u8],
    class: &'static str,
    title: &'static str,
    text: &'static str,
}

const SIGNED_IN: ResultPage = ResultPage {
    buddy: include_bytes!("../../../../branding/pumpkin-launcher/motion/standard/success.svg"),
    class: "",
    title: "Angemeldet",
    text: "Du kannst dieses Fenster schließen und zu Pumpkin Launcher zurückkehren.",
};

const FAILED: ResultPage = ResultPage {
    buddy: include_bytes!("../../../../branding/pumpkin-launcher/motion/standard/oops.svg"),
    class: "bad",
    title: "Das hat nicht geklappt",
    text: "Schließe dieses Fenster und versuch die Anmeldung in Pumpkin Launcher noch einmal.",
};

impl ResultPage {
    fn render(&self) -> String {
        // Das Stylesheet zuletzt einsetzen: seine Zeichen sollen nicht von den übrigen Platzhaltern erfasst werden.
        PAGE.replace("@FAVICON@", &data_url("image/svg+xml", FAVICON))
            .replace("@F_BIG@", &data_url("font/woff2", FONT_BIG))
            .replace("@F_HANKEN@", &data_url("font/woff2", FONT_HANKEN))
            .replace("@BUDDY@", &data_url("image/svg+xml", self.buddy))
            .replace("@WORDMARK@", &data_url("image/svg+xml", WORDMARK))
            .replace("@CLASS@", self.class)
            .replace("@TITLE@", self.title)
            .replace("@TEXT@", self.text)
            .replace("@CSS_APP@", APP_CSS)
    }
}

#[cfg(test)]
mod tests {
    use super::super::Flow;
    use super::*;

    fn pending_for_test() -> Pending {
        Pending::new("c".into(), Flow::Device { device_code: String::new(), interval: 1 }, Duration::from_secs(20))
    }

    #[test]
    fn result_pages_are_branded_and_fixed() {
        let ok = SIGNED_IN.render();
        assert!(ok.contains("<h1>Angemeldet</h1>") && ok.contains("Pumpkin Launcher") && ok.contains("data:image/svg+xml;base64,"));
        let bad = FAILED.render();
        assert!(bad.contains("Das hat nicht geklappt") && bad.contains("login-card bad"));
        assert!(ok.contains(".login-card") && ok.contains("--panel-2:"), "Karte und Tokens der App sind eingebunden");
        assert!(ok.contains("font-family:\"Big Shoulders Display\"") && !ok.contains("url(http"), "Schriften eingebettet, keine externen Adressen");
        for page in [&ok, &bad] {
            for placeholder in ["@FAVICON@", "@F_BIG@", "@F_HANKEN@", "@BUDDY@", "@WORDMARK@", "@CLASS@", "@TITLE@", "@TEXT@", "@CSS_APP@"] {
                assert!(!page.contains(placeholder), "offener Platzhalter {placeholder}");
            }
        }
    }

    #[test]
    fn callback_parsing() {
        assert!(matches!(parse_callback("GET /?code=M.C5_a%2Fb&state=xyz HTTP/1.1", "xyz"), Callback::Code(c) if c == "M.C5_a/b"));
        assert!(matches!(parse_callback("GET /?code=abc&state=falsch HTTP/1.1", "xyz"), Callback::Ignore(400)), "fremder state");
        assert!(matches!(parse_callback("GET /?code=abc HTTP/1.1", "xyz"), Callback::Ignore(400)), "ohne state");
        assert!(matches!(parse_callback("GET /favicon.ico HTTP/1.1", "xyz"), Callback::Ignore(404)));
        assert!(matches!(parse_callback("POST /?code=a&state=xyz HTTP/1.1", "xyz"), Callback::Ignore(400)));
        assert!(matches!(parse_callback("GET /?state=xyz&code= HTTP/1.1", "xyz"), Callback::Ignore(400)), "leerer Code");
        let denied = parse_callback("GET /?error=access_denied&error_description=nope+bitte&state=xyz HTTP/1.1", "xyz");
        assert!(matches!(denied, Callback::Failed(e) if e.error == "access_denied" && e.error_description == "nope bitte"));
    }

    #[test]
    fn form_decoding_keeps_broken_escapes_and_plus_rules() {
        assert_eq!(form_decode("a%2"), "a%2", "abgeschnittene Kodierung bleibt stehen");
        assert_eq!(form_decode("%C3%A4%zz"), "ä%zz");
        assert_eq!(form_decode("a+b%2Bc"), "a b+c", "`+` ist ein Leerzeichen, `%2B` ein Plus");
    }

    /// Echter Listener auf Loopback: ein Stör-Aufruf, eine leere Vorab-Verbindung, dann der richtige Rücksprung.
    #[tokio::test]
    async fn browser_callback_over_real_socket() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let p = pending_for_test();
        let waiter = tokio::spawn(async move { wait_for_code(&p, &listener, "xyz").await });
        let get = |path: &'static str| async move {
            let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(format!("GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes()).await.unwrap();
            let mut reply = String::new();
            s.read_to_string(&mut reply).await.unwrap();
            reply
        };
        assert!(get("/?code=evil&state=nope").await.starts_with("HTTP/1.1 400"));
        let idle = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let reply = get("/?code=gut&state=xyz").await;
        assert!(reply.starts_with("HTTP/1.1 200") && reply.contains("Angemeldet"), "{reply}");
        assert_eq!(waiter.await.unwrap().unwrap(), "gut");
        drop(idle);
    }

    #[tokio::test]
    async fn browser_wait_can_be_cancelled() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let p = pending_for_test();
        p.cancel.cancel();
        let err = wait_for_code(&p, &listener, "xyz").await.err().unwrap();
        assert_eq!(err.to_string(), "Anmeldung abgebrochen.");
    }
}
