//! Die gemeinsamen Muster in `mod/fixtures/protocol` (siehe dort die README): jede Zeile wird in die Typen von Protokoll 2
//! gelesen und von dort wieder geschrieben, jeder Vorgang, jede Ablehnung, jedes Thema und jeder Fehlercode kommt vor, die
//! Zahlen von `limits.jsonl` sind die der Brücke, und die Anmeldung läuft gegen die laufende Brücke ab.
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::limits::*;
use super::ops::{windows_of, ErrorCode, Op, RateClass, OP_NAMES};
use super::protocol::{is_valid_request_id, LauncherFrame, ModFrame, RejectReason};
use super::tests::Fixture;
use super::topics::{DirectoryLine, Topic, TopicValue, MAX_BLOCKED, MAX_CODES, MAX_FRIENDS, MAX_INVITES, MAX_REQUESTS};

const FIXTURE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../mod/fixtures/protocol");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    ModToLauncher,
    LauncherToMod,
    None,
}

struct Entry {
    file: String,
    direction: Direction,
    line: Value,
}

fn entries_of(file: &str) -> Vec<Entry> {
    let path = PathBuf::from(FIXTURE_DIR).join(file);
    let text = fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let wrapper: Value = serde_json::from_str(line).unwrap_or_else(|err| panic!("{file}: {err}: {line}"));
            let direction = match wrapper["direction"].as_str() {
                Some("modToLauncher") => Direction::ModToLauncher,
                Some("launcherToMod") => Direction::LauncherToMod,
                Some("none") => Direction::None,
                other => panic!("{file}: unbekannte direction {other:?}"),
            };
            assert_eq!(wrapper.as_object().unwrap().len(), 2, "{file}: nur direction und line: {line}");
            Entry { file: file.to_owned(), direction, line: wrapper["line"].clone() }
        })
        .collect()
}

fn fixture_files() -> Vec<String> {
    let mut files: Vec<String> = fs::read_dir(FIXTURE_DIR)
        .unwrap()
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(".jsonl"))
        .collect();
    files.sort();
    files
}

fn all_entries() -> Vec<Entry> {
    fixture_files().iter().flat_map(|file| entries_of(file)).collect()
}

fn read_back<T: serde::Serialize + serde::de::DeserializeOwned>(entry: &Entry) -> T {
    let value: T = serde_json::from_value(entry.line.clone()).unwrap_or_else(|err| panic!("{}: {err}: {}", entry.file, entry.line));
    assert_eq!(serde_json::to_value(&value).unwrap(), entry.line, "{}: die Zeile liest sich nicht unverändert zurück", entry.file);
    value
}

#[test]
fn the_fixture_files_are_the_documented_ones() {
    let expected = [
        "errors-reasons", "errors", "events", "handshake-ok", "hints", "limits", "ops-join-failed", "ops", "pending", "reject-build",
        "reject-duplicate", "reject-owner", "reject-protocol", "reject-retry", "reject-token", "request-response",
        "topics-me-directory", "topics-notice", "topics",
    ];
    let files: Vec<String> = fixture_files().iter().map(|name| name.trim_end_matches(".jsonl").to_owned()).collect();
    assert_eq!(files, expected);
}

#[test]
fn every_line_reads_into_the_protocol_and_back_unchanged() {
    for entry in all_entries() {
        match entry.direction {
            Direction::ModToLauncher => drop(read_back::<ModFrame>(&entry)),
            Direction::LauncherToMod => drop(read_back::<LauncherFrame>(&entry)),
            Direction::None => assert_eq!(entry.file, "limits.jsonl"),
        }
    }
}

#[test]
fn requests_name_valid_ids_and_ops_in_their_canonical_form() {
    for entry in all_entries().iter().filter(|entry| entry.direction == Direction::ModToLauncher) {
        let ModFrame::Req { id, op, args } = read_back::<ModFrame>(entry) else { continue };
        assert!(is_valid_request_id(&id), "{}: {id}", entry.file);
        let parsed = Op::from_request(&op, args.clone()).unwrap_or_else(|err| panic!("{}: {op}: {err}", entry.file));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), json!({"op": op, "args": args}), "{}: {op} ist nicht kanonisch", entry.file);
    }
}

#[test]
fn every_result_reads_into_the_result_type_of_its_op() {
    for file in ["ops.jsonl", "ops-join-failed.jsonl", "request-response.jsonl", "pending.jsonl"] {
        let mut open: Option<(String, Op)> = None;
        for entry in entries_of(file) {
            match (entry.direction, read_back::<Value>(&entry)) {
                (Direction::ModToLauncher, line) => {
                    let args = line["args"].clone();
                    open = Some((line["id"].as_str().unwrap().to_owned(), Op::from_request(line["op"].as_str().unwrap(), args).unwrap()));
                }
                (Direction::LauncherToMod, line) if line["type"] == "res" && line["ok"] == true => {
                    let (id, op) = open.take().unwrap_or_else(|| panic!("{file}: res ohne req"));
                    assert_eq!(line["id"], id.as_str(), "{file}");
                    let result = op.read_result(line["result"].clone()).unwrap_or_else(|err| panic!("{file}: {}: {err}", op.name()));
                    assert_eq!(serde_json::to_value(result).unwrap(), line["result"], "{file}: {}", op.name());
                }
                _ => {}
            }
        }
    }
}

#[test]
fn every_op_of_the_table_has_a_request_fixture() {
    let named: BTreeSet<String> = all_entries()
        .iter()
        .filter(|entry| entry.direction == Direction::ModToLauncher && entry.line["type"] == "req")
        .map(|entry| entry.line["op"].as_str().unwrap().to_owned())
        .collect();
    let table: BTreeSet<String> = OP_NAMES.iter().map(|name| (*name).to_owned()).collect();
    assert_eq!(named, table);
    assert_eq!(OP_NAMES.len(), 22);
}

#[test]
fn the_fixture_of_join_failed_is_the_only_op_outside_ops_jsonl() {
    let in_ops: BTreeSet<String> = entries_of("ops.jsonl")
        .iter()
        .filter(|entry| entry.direction == Direction::ModToLauncher)
        .map(|entry| entry.line["op"].as_str().unwrap().to_owned())
        .collect();
    let table: BTreeSet<String> = OP_NAMES.iter().map(|name| (*name).to_owned()).collect();

    assert_eq!(table.difference(&in_ops).collect::<Vec<_>>(), ["join.failed"]);
    assert_eq!(entries_of("ops-join-failed.jsonl")[0].line["op"], "join.failed");
}

#[test]
fn every_reject_reason_has_its_own_fixture_file() {
    let all = [RejectReason::Token, RejectReason::Protocol, RejectReason::Owner, RejectReason::Build, RejectReason::Duplicate, RejectReason::Retry];
    for reason in all {
        let name = serde_json::to_value(reason).unwrap();
        let file = format!("reject-{}.jsonl", name.as_str().unwrap());
        let entries = entries_of(&file);
        assert_eq!(entries.len(), 2, "{file}: hello und reject");
        assert_eq!(entries[1].line, json!({"type": "reject", "reason": name}), "{file}");
    }
}

#[test]
fn every_topic_has_a_state_fixture_that_reads_into_its_value_type() {
    let mut seen = BTreeSet::new();
    let files = ["topics.jsonl", "topics-me-directory.jsonl", "topics-notice.jsonl"];
    for entry in files.into_iter().flat_map(entries_of) {
        let LauncherFrame::State { topic, value, .. } = read_back::<LauncherFrame>(&entry) else { panic!("{}", entry.line) };
        let typed = TopicValue::parse(topic, value.clone()).unwrap_or_else(|err| panic!("{topic:?}: {err}"));
        assert_eq!(typed.to_json(), value, "{topic:?}");
        seen.insert(topic);
    }
    let all = [Topic::Me, Topic::Friends, Topic::Requests, Topic::Invites, Topic::Session, Topic::Join, Topic::Game, Topic::Codes, Topic::Blocked];
    assert_eq!(seen, all.into_iter().collect::<BTreeSet<_>>());
}

#[test]
fn the_me_topic_names_the_directory_state_and_the_fixture_shows_every_state() {
    let directory_of = |entry: Entry| {
        let LauncherFrame::State { value, .. } = read_back::<LauncherFrame>(&entry) else { panic!("{}", entry.line) };
        let TopicValue::Me(me) = TopicValue::parse(Topic::Me, value).unwrap() else { panic!("{}", entry.line) };
        me.directory
    };

    let shown: Vec<DirectoryLine> = entries_of("topics-me-directory.jsonl").into_iter().map(directory_of).collect();

    let every_state = [DirectoryLine::Active, DirectoryLine::Off, DirectoryLine::Unreachable, DirectoryLine::NotAllowed, DirectoryLine::Unavailable];
    assert_eq!(shown, every_state);
    let main_push = entries_of("topics.jsonl").into_iter().find(|entry| entry.line["topic"] == "me").unwrap();
    assert_eq!(directory_of(main_push), DirectoryLine::Active);
}

#[test]
fn every_error_code_has_a_response_fixture() {
    let in_files: BTreeSet<String> = entries_of("errors.jsonl")
        .iter()
        .map(|entry| entry.line["error"]["code"].as_str().unwrap().to_owned())
        .collect();
    let all = [
        ErrorCode::NotEnabled,
        ErrorCode::PeerOffline,
        ErrorCode::GuestLimit,
        ErrorCode::LanPortUnknown,
        ErrorCode::PortNotGame,
        ErrorCode::Denied,
        ErrorCode::VersionUnsupported,
        ErrorCode::MsAccountRequired,
        ErrorCode::Busy,
        ErrorCode::RateLimited,
        ErrorCode::UnsupportedOp,
        ErrorCode::BadRequest,
        ErrorCode::UnknownFriend,
        ErrorCode::NotFound,
        ErrorCode::NameUnknown,
        ErrorCode::DirectoryUnavailable,
        ErrorCode::Timeout,
        ErrorCode::Internal,
        ErrorCode::InstanceMismatch,
        ErrorCode::Forbidden,
    ];
    let model: BTreeSet<String> = all.iter().map(|code| serde_json::to_value(code).unwrap().as_str().unwrap().to_owned()).collect();
    assert_eq!(in_files, model);
}

fn windows_json(class: RateClass) -> Value {
    let windows: Vec<Value> = windows_of(class).iter().map(|(max, span)| json!({"max": max, "windowSeconds": span.as_secs()})).collect();
    Value::Array(windows)
}

#[test]
fn the_numbers_in_limits_jsonl_are_the_ones_of_the_bridge() {
    let line = entries_of("limits.jsonl").remove(0).line;
    let millis = |duration: std::time::Duration| u64::try_from(duration.as_millis()).unwrap();
    let production = Timing::PRODUCTION;
    let expected = json!({
        "preWelcomeLineBytes": PRE_WELCOME_LINE_BYTES,
        "helloTimeoutMs": millis(production.hello),
        "maxUnauthenticated": MAX_UNAUTHENTICATED,
        "modLineBytes": MOD_LINE_BYTES,
        "launcherLineBytes": LAUNCHER_LINE_BYTES,
        "messagesPerSecond": MESSAGES_PER_WINDOW,
        "maxInFlight": MAX_IN_FLIGHT,
        "outgoingQueue": OUTGOING_QUEUE,
        "eventQueue": EVENT_QUEUE,
        "writeStallMs": millis(production.write_stall),
        "pingIntervalMs": millis(production.ping_interval),
        "silenceMs": millis(production.silence),
        "topicCoalesceMs": millis(production.topic_coalesce),
        "topicBudgetBytes": TOPIC_BUDGET_BYTES,
        "requestDeadlineMs": millis(REQUEST_DEADLINE),
        "requestIdPattern": "^[a-z0-9]{1,12}$",
        "rates": {
            "addByName": windows_json(RateClass::AddByName),
            "answer": windows_json(RateClass::Answer),
            "hostInvite": windows_json(RateClass::HostInvite),
            "launcherOpen": windows_json(RateClass::LauncherOpen),
            "other": windows_json(RateClass::Other),
        },
        "prompts": {"open": 1, "perTenMinutes": super::launch::PROMPTS_PER_SPAN},
        "caps": {
            "friends": MAX_FRIENDS,
            "invites": MAX_INVITES,
            "requestsPerDirection": MAX_REQUESTS,
            "guests": crate::services::friends::contract::MAX_GUESTS,
            "codes": MAX_CODES,
            "blocked": MAX_BLOCKED,
        },
    });
    assert_eq!(line, expected);
}

#[test]
fn the_numbers_are_the_ones_of_the_design_document() {
    assert_eq!(PRE_WELCOME_LINE_BYTES, 1024);
    assert_eq!(MOD_LINE_BYTES, 16 * 1024);
    assert_eq!(LAUNCHER_LINE_BYTES, 64 * 1024);
    assert_eq!(MESSAGES_PER_WINDOW, 20);
    assert_eq!(MESSAGE_WINDOW, std::time::Duration::from_secs(1));
    assert_eq!((MAX_IN_FLIGHT, OUTGOING_QUEUE, EVENT_QUEUE, MAX_UNAUTHENTICATED), (8, 64, 32, 4));
    assert_eq!(super::launch::PROMPT_SPAN, std::time::Duration::from_secs(600));
}

#[tokio::test]
async fn the_handshake_fixture_runs_against_the_bridge() {
    let fixture = Fixture::start().await;
    let [hello, welcome] = <[Entry; 2]>::try_from(entries_of("handshake-ok.jsonl")).ok().unwrap();
    let mut client = fixture.connect().await;
    let mut line = hello.line.clone();
    line["token"] = Value::String(fixture.token.clone());
    client.send(line).await;

    let mut answer = client.read().await.unwrap();

    answer["launcher"] = welcome.line["launcher"].clone();
    assert_eq!(answer, welcome.line);
}

#[tokio::test]
async fn the_token_reject_fixture_runs_against_the_bridge() {
    let fixture = Fixture::start().await;
    let [hello, reject] = <[Entry; 2]>::try_from(entries_of("reject-token.jsonl")).ok().unwrap();
    let mut client = fixture.connect().await;
    client.send(hello.line).await;
    assert_eq!(client.read().await.unwrap(), reject.line);
}
