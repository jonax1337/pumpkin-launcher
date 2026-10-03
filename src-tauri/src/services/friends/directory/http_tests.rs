//! Tests des Worker-Clients gegen einen echten HTTP-Server auf dem Loopback, der vorbereitete Antworten ausliefert
//! und jede Anfrage aufzeichnet. Kein echtes Netz, kein echter Worker; echte Sockets mit echter Zeit.
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::api::{DirectoryApi, WorkerApi};
use super::wire::{CertificateProof, OutgoingLetter, SessionRequest};
use super::DirectoryError;
use crate::services::transport::base_client_builder;

const TOKEN: &str = "v2.nutzlast.pruefwert";
const LETTER_ID: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UUID: &str = "069a79f444e94726a5befca90e38aaf5";
const PEER_ID: &str = "2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d";
const HEADER_END: &[u8] = b"\r\n\r\n";

/// Was der Server auf die nächste Verbindung antwortet.
struct Canned {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
    /// Nimmt die Anfrage an und antwortet nie.
    silent: bool,
}

impl Canned {
    fn json(status: u16, body: Value) -> Self {
        Self { status, headers: vec![("content-type", "application/json".into())], body: body.to_string().into_bytes(), silent: false }
    }

    fn empty(status: u16) -> Self {
        Self { status, headers: Vec::new(), body: Vec::new(), silent: false }
    }

    fn error(status: u16, code: &str) -> Self {
        Self::json(status, json!({ "error": code }))
    }

    fn silent() -> Self {
        Self { silent: true, ..Self::empty(200) }
    }

    fn with_header(mut self, name: &'static str, value: &str) -> Self {
        self.headers.push((name, value.to_owned()));
        self
    }
}

#[derive(Debug, Clone)]
struct Recorded {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

impl Recorded {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }

    fn json_body(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }
}

struct Loopback {
    base: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl Loopback {
    async fn serving(answers: Vec<Canned>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        tokio::spawn(accept_loop(listener, answers.into(), requests.clone()));
        Self { base, requests }
    }

    fn api(&self) -> WorkerApi {
        WorkerApi::new(reqwest::Client::new(), self.base.clone())
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    fn only_request(&self) -> Recorded {
        let mut requests = self.requests();
        assert_eq!(requests.len(), 1, "{requests:?}");
        requests.remove(0)
    }
}

async fn accept_loop(listener: TcpListener, answers: VecDeque<Canned>, requests: Arc<Mutex<Vec<Recorded>>>) {
    let answers = Arc::new(Mutex::new(answers));
    while let Ok((mut stream, _)) = listener.accept().await {
        let (answers, requests) = (answers.clone(), requests.clone());
        tokio::spawn(async move {
            let Some(request) = read_request(&mut stream).await else { return };
            requests.lock().unwrap().push(request);
            let answer = answers.lock().unwrap().pop_front().unwrap_or_else(|| Canned::empty(500));
            respond(stream, answer).await;
        });
    }
}

/// Liest, bis die Köpfe und so viele Bytes Körper da sind, wie `content-length` nennt.
async fn read_request(stream: &mut TcpStream) -> Option<Recorded> {
    let mut raw = Vec::new();
    let head_len = loop {
        read_more(stream, &mut raw).await?;
        if let Some(at) = raw.windows(HEADER_END.len()).position(|window| window == HEADER_END) {
            break at + HEADER_END.len();
        }
    };
    let head = String::from_utf8_lossy(&raw[..head_len]).into_owned();
    let mut lines = head.lines();
    let mut request_line = lines.next()?.split(' ');
    let (method, path) = (request_line.next()?.to_owned(), request_line.next()?.to_owned());
    let headers: HashMap<String, String> =
        lines.filter_map(|line| line.split_once(':')).map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned())).collect();
    let length: usize = headers.get("content-length").and_then(|value| value.parse().ok()).unwrap_or(0);
    while raw.len() < head_len + length {
        read_more(stream, &mut raw).await?;
    }
    Some(Recorded { method, path, headers, body: raw[head_len..head_len + length].to_vec() })
}

async fn read_more(stream: &mut TcpStream, raw: &mut Vec<u8>) -> Option<()> {
    let mut chunk = [0u8; 4096];
    match stream.read(&mut chunk).await {
        Ok(0) | Err(_) => None,
        Ok(read) => {
            raw.extend_from_slice(&chunk[..read]);
            Some(())
        }
    }
}

async fn respond(mut stream: TcpStream, answer: Canned) {
    if answer.silent {
        tokio::time::sleep(Duration::from_secs(60)).await;
        return;
    }
    let mut head = format!("HTTP/1.1 {} X\r\ncontent-length: {}\r\nconnection: close\r\n", answer.status, answer.body.len());
    for (name, value) in &answer.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(&answer.body).await;
    let _ = stream.shutdown().await;
}

fn letter() -> OutgoingLetter {
    OutgoingLetter {
        to: UUID.into(),
        nonce: "000102030405060708090a0b0c0d0e0f".into(),
        hello_id: "20".repeat(32),
        relay_index: 0,
        secret: "a0a1a2a3a4a5a6a7a8".into(),
        display_name: "Alex".into(),
        created_at: 1_790_000_000,
        signature: "da".repeat(64),
    }
}

fn login_body() -> SessionRequest {
    SessionRequest {
        challenge: "a.b".into(),
        uuid: UUID.into(),
        certificate: CertificateProof { public_key: "MIIB".into(), expires_at: 1_790_172_800_123, mojang_signature: "c2ln".into() },
        cert_signature: "Y2VydA==".into(),
        signature: "ab".repeat(64),
    }
}

fn inbox_letter_json() -> Value {
    json!({
        "id": LETTER_ID, "from": { "uuid": UUID, "peerId": PEER_ID }, "to": UUID,
        "nonce": "000102030405060708090a0b0c0d0e0f", "helloId": "20".repeat(32), "relayIndex": 0, "secret": "a0a1a2a3a4a5a6a7a8",
        "displayName": "Alex", "createdAt": 1_790_000_000u64, "expiresAt": 1_791_209_600u64, "signature": "da".repeat(64),
    })
}

fn assert_call(request: &Recorded, method: &str, path: &str, authorized: bool) {
    assert_eq!((request.method.as_str(), request.path.as_str()), (method, path));
    let expected = authorized.then(|| format!("Bearer {TOKEN}"));
    assert_eq!(request.header("authorization"), expected.as_deref(), "{method} {path}");
    assert_eq!(request.header("origin"), None, "ein Origin-Header würde der Worker mit 403 abweisen");
}

#[tokio::test]
async fn challenge_posts_the_peer_id_without_a_token() {
    let server = Loopback::serving(vec![Canned::json(200, json!({ "challenge": "a.b", "serverId": "0".repeat(40), "expiresAt": 7 }))]).await;
    let challenge = server.api().challenge(PEER_ID).await.unwrap();
    assert_eq!((challenge.challenge.as_str(), challenge.expires_at), ("a.b", 7));
    let request = server.only_request();
    assert_call(&request, "POST", "/v2/auth/challenge", false);
    assert_eq!(request.header("content-type"), Some("application/json"));
    assert_eq!(request.json_body(), json!({ "peerId": PEER_ID }));
}

#[tokio::test]
async fn session_posts_the_certificate_login_body_and_reads_the_token() {
    let answer = json!({ "token": TOKEN, "expiresAt": 9, "uuid": UUID });
    let server = Loopback::serving(vec![Canned::json(200, answer)]).await;
    let session = server.api().session(&login_body()).await.unwrap();
    assert_eq!((session.token.as_str(), session.uuid.as_str(), session.expires_at), (TOKEN, UUID, 9));
    let request = server.only_request();
    assert_call(&request, "POST", "/v2/auth/session", false);
    let expected = json!({
        "challenge": "a.b",
        "uuid": UUID,
        "certificate": { "publicKey": "MIIB", "expiresAt": 1_790_172_800_123i64, "mojangSignature": "c2ln" },
        "certSignature": "Y2VydA==",
        "signature": "ab".repeat(64),
    });
    assert_eq!(request.json_body(), expected);
}

#[tokio::test]
async fn certificate_refusals_of_the_worker_arrive_as_their_own_errors() {
    let server = Loopback::serving(vec![Canned::error(401, "badCertificate"), Canned::error(401, "certificateExpired")]).await;
    assert_eq!(server.api().session(&login_body()).await.unwrap_err(), DirectoryError::BadCertificate);
    assert_eq!(server.api().session(&login_body()).await.unwrap_err(), DirectoryError::CertificateExpired);
}

#[tokio::test]
async fn register_and_unregister_use_put_and_delete_on_me() {
    let server = Loopback::serving(vec![Canned::json(200, json!({ "findable": true, "refreshedAt": 1 })), Canned::empty(204)]).await;
    server.api().register(TOKEN).await.unwrap();
    server.api().unregister(TOKEN).await.unwrap();
    let requests = server.requests();
    assert_call(&requests[0], "PUT", "/v1/me", true);
    assert_eq!(requests[0].json_body(), json!({}));
    assert_call(&requests[1], "DELETE", "/v1/me", true);
}

#[tokio::test]
async fn send_posts_the_letter_and_reads_the_receipt() {
    let server = Loopback::serving(vec![Canned::json(202, json!({ "id": LETTER_ID, "expiresAt": 1_791_209_600u64 }))]).await;
    let sent = server.api().send(TOKEN, &letter()).await.unwrap();
    assert_eq!((sent.id.as_str(), sent.expires_at), (LETTER_ID, 1_791_209_600));
    let request = server.only_request();
    assert_call(&request, "POST", "/v1/outbox", true);
    let body = request.json_body();
    assert_eq!(body["to"], UUID);
    assert_eq!(body["helloId"], "20".repeat(32));
    assert_eq!(body["createdAt"], 1_790_000_000u64);
}

#[tokio::test]
async fn retract_delete_block_and_unblock_address_their_resources() {
    let server = Loopback::serving((0..4).map(|_| Canned::empty(204)).collect()).await;
    let api = server.api();
    api.retract(TOKEN, LETTER_ID).await.unwrap();
    api.delete(TOKEN, LETTER_ID).await.unwrap();
    api.block(TOKEN, UUID).await.unwrap();
    api.unblock(TOKEN, UUID).await.unwrap();
    let requests = server.requests();
    assert_call(&requests[0], "DELETE", &format!("/v1/outbox/{LETTER_ID}"), true);
    assert_call(&requests[1], "DELETE", &format!("/v1/inbox/{LETTER_ID}"), true);
    assert_call(&requests[2], "PUT", &format!("/v1/blocks/{UUID}"), true);
    assert_call(&requests[3], "DELETE", &format!("/v1/blocks/{UUID}"), true);
}

#[tokio::test]
async fn inbox_reads_the_letters_with_their_stamp() {
    let server = Loopback::serving(vec![Canned::json(200, json!({ "letters": [inbox_letter_json()] }))]).await;
    let letters = server.api().inbox(TOKEN).await.unwrap();
    assert_eq!(letters.len(), 1);
    assert_eq!((letters[0].id.as_str(), letters[0].from.uuid.as_str(), letters[0].from.peer_id.as_str()), (LETTER_ID, UUID, PEER_ID));
    assert_call(&server.only_request(), "GET", "/v1/inbox", true);
}

#[tokio::test]
async fn worker_errors_arrive_as_directory_errors() {
    let answers = vec![
        Canned::error(404, "notFindable"),
        Canned::error(409, "recipientFull"),
        Canned::error(429, "pairCooldown"),
        Canned::error(401, "unauthorized"),
        Canned::error(400, "clock"),
    ];
    let server = Loopback::serving(answers).await;
    let api = server.api();
    let sends = [
        DirectoryError::NotFindable,
        DirectoryError::RecipientFull,
        DirectoryError::PairCooldown,
        DirectoryError::Unauthorized,
        DirectoryError::Invalid("clock"),
    ];
    for expected in sends {
        assert_eq!(api.send(TOKEN, &letter()).await.unwrap_err(), expected);
    }
}

#[tokio::test]
async fn rate_limited_carries_the_retry_after_header() {
    let server = Loopback::serving(vec![Canned::error(429, "rateLimited").with_header("retry-after", "60")]).await;
    let error = server.api().inbox(TOKEN).await.unwrap_err();
    assert_eq!(error, DirectoryError::RateLimited { retry_after: Some(60) });
}

#[tokio::test]
async fn an_error_page_without_a_code_is_judged_by_its_status() {
    let page = |status| Canned { body: b"<html>Bad gateway</html>".to_vec(), ..Canned::empty(status) };
    let server = Loopback::serving(vec![page(502), page(401)]).await;
    assert_eq!(server.api().inbox(TOKEN).await.unwrap_err(), DirectoryError::Unreachable);
    assert_eq!(server.api().inbox(TOKEN).await.unwrap_err(), DirectoryError::Unauthorized);
}

#[tokio::test]
async fn a_success_with_an_unreadable_body_is_an_invalid_response() {
    let server = Loopback::serving(vec![Canned { body: b"kein json".to_vec(), ..Canned::empty(200) }]).await;
    assert_eq!(server.api().inbox(TOKEN).await.unwrap_err(), DirectoryError::Invalid("response"));
}

#[tokio::test]
async fn a_response_beyond_64_kib_is_refused() {
    let oversize = Canned { body: vec![b' '; 64 * 1024 + 1], ..Canned::empty(200) };
    let within = Canned { body: format!("{{\"letters\":[]}}{}", " ".repeat(64 * 1024 - 14)).into_bytes(), ..Canned::empty(200) };
    let server = Loopback::serving(vec![oversize, within]).await;
    assert_eq!(server.api().inbox(TOKEN).await.unwrap_err(), DirectoryError::Invalid("responseTooLarge"));
    assert_eq!(server.api().inbox(TOKEN).await.unwrap(), Vec::new());
}

#[tokio::test]
async fn a_worker_that_never_answers_is_unreachable_after_the_timeout() {
    let server = Loopback::serving(vec![Canned::silent()]).await;
    let api = WorkerApi::with_timeout(reqwest::Client::new(), server.base.clone(), Duration::from_millis(200));
    assert_eq!(api.inbox(TOKEN).await.unwrap_err(), DirectoryError::Unreachable);
}

#[tokio::test]
async fn a_closed_port_is_unreachable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let api = WorkerApi::new(reqwest::Client::new(), base);
    assert_eq!(api.register(TOKEN).await.unwrap_err(), DirectoryError::Unreachable);
}

#[tokio::test]
async fn ids_that_could_change_the_path_never_leave_the_launcher() {
    let server = Loopback::serving(Vec::new()).await;
    let api = server.api();
    assert_eq!(api.retract(TOKEN, "../me").await.unwrap_err(), DirectoryError::Invalid("letterId"));
    assert_eq!(api.delete(TOKEN, "7c9e6679/../x").await.unwrap_err(), DirectoryError::Invalid("letterId"));
    assert_eq!(api.block(TOKEN, "../me").await.unwrap_err(), DirectoryError::Invalid("uuid"));
    assert_eq!(api.unblock(TOKEN, &UUID.to_uppercase()).await.unwrap_err(), DirectoryError::Invalid("uuid"));
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn a_redirect_is_not_followed_and_the_token_goes_nowhere_else() {
    let elsewhere = Loopback::serving(vec![Canned::empty(204)]).await;
    let redirect = Canned::empty(307).with_header("location", &format!("{}/v1/me", elsewhere.base));
    let server = Loopback::serving(vec![redirect]).await;
    let client = base_client_builder().build().unwrap();
    let api = WorkerApi::new(client, server.base.clone());
    assert_eq!(api.unregister(TOKEN).await.unwrap_err(), DirectoryError::Invalid("unexpected"));
    assert!(elsewhere.requests().is_empty());
}
