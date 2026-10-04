//! Fehler des Launchers als Fehlercode der Mod (INGAME 5.3): die Mod kennt eine kleine, feste Liste und übersetzt sie
//! selbst in Texte. Was darüber hinaus zu sagen ist, steht in den Parametern: `reason` nennt die genauere Ursache, `max`,
//! `min` und `days` die Zahlen dazu.
use serde_json::{json, Value};

use crate::error::AppError;
use crate::services::modbridge::ops::{ErrorCode, OpError};

/// Die Parameter eines Launcher-Fehlers, die zur Mod durchgereicht werden. Namen von Personen gehören nicht dazu.
const FORWARDED_PARAMS: [&str; 3] = ["max", "min", "days"];

pub(super) fn mod_error(err: AppError) -> OpError {
    let wire = serde_json::to_value(&err).unwrap_or_default();
    let key = wire["key"].as_str().unwrap_or_default();
    match key.strip_prefix("errors.friends.").and_then(translation) {
        Some(translation) => translation.into_error(&wire),
        None if matches!(err, AppError::NotFound(_)) => OpError::new(ErrorCode::NotFound),
        None => OpError::new(ErrorCode::Internal),
    }
}

/// Wie ein Schlüssel `errors.friends.<name>` bei der Mod ankommt.
struct Translation {
    code: ErrorCode,
    /// Der Name des Schlüssels geht als `reason` mit, weil der Code allein zu grob ist.
    with_reason: bool,
}

impl Translation {
    fn plain(code: ErrorCode) -> Option<Self> {
        Some(Self { code, with_reason: false })
    }

    fn reasoned(code: ErrorCode) -> Option<Self> {
        Some(Self { code, with_reason: true })
    }

    fn into_error(self, wire: &Value) -> OpError {
        let mut error = OpError::new(self.code);
        if self.with_reason {
            error = error.with_param("reason", reason_of(wire));
        }
        for name in FORWARDED_PARAMS {
            if let Some(value) = wire["params"].get(name) {
                error = error.with_param(name, number_or_text(value));
            }
        }
        error
    }
}

fn reason_of(wire: &Value) -> &str {
    let key = wire["key"].as_str().unwrap_or_default();
    key.rsplit('.').next().unwrap_or(key)
}

/// Die Parameter laufen als Text durch den Fehler; Zahlen sollen als Zahl ankommen.
fn number_or_text(value: &Value) -> Value {
    let text = value.as_str();
    text.and_then(|text| text.parse::<u64>().ok()).map_or_else(|| json!(value), |number| json!(number))
}

fn translation(name: &str) -> Option<Translation> {
    match name {
        "disabled" | "unavailable" | "identityLost" => Translation::plain(ErrorCode::NotEnabled),
        "peerOffline" => Translation::plain(ErrorCode::PeerOffline),
        "guestLimit" => Translation::plain(ErrorCode::GuestLimit),
        "lanPortUnknown" | "lanUnreachable" => Translation::plain(ErrorCode::LanPortUnknown),
        "portNotGame" => Translation::plain(ErrorCode::PortNotGame),
        "versionUnsupported" => Translation::plain(ErrorCode::VersionUnsupported),
        "msAccountRequired" => Translation::plain(ErrorCode::MsAccountRequired),
        "notFound.friend" => Translation::plain(ErrorCode::UnknownFriend),
        "notFound.request" | "notFound.invite" | "inviteExpired" | "sessionNotFound" => Translation::plain(ErrorCode::NotFound),
        "nameUnknown" => Translation::plain(ErrorCode::NameUnknown),
        "nameNotFindable" => Translation::reasoned(ErrorCode::NameUnknown),
        "directoryUnavailable" => Translation::plain(ErrorCode::DirectoryUnavailable),
        "directoryNotAllowed" => Translation::reasoned(ErrorCode::DirectoryUnavailable),
        "rateLimited" => Translation::plain(ErrorCode::RateLimited),
        "nameCooldown" => Translation::reasoned(ErrorCode::RateLimited),
        // Das Spiel läuft (die Mod ist darin), der Launcher hat seinen Start nur noch nicht verarbeitet.
        "sessionActive" | "gameNotRunning" => Translation::plain(ErrorCode::Busy),
        "tooManyNameRequests" | "tooManyCodes" | "requestsFull" | "friendLimit" => Translation::reasoned(ErrorCode::Busy),
        "nameInvalid" | "nameOwn" | "alreadyFriends" | "alreadyRequested" | "alreadyRequestedName" | "codeInvalid" | "codeOwn"
        | "instanceMismatch" | "manifestInvalid" | "portInvalid" => Translation::reasoned(ErrorCode::BadRequest),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coded;
    use crate::services::friends::test_support::error_key;

    fn invalid(key_and_params: crate::error::Coded) -> AppError {
        AppError::invalid(key_and_params)
    }

    #[test]
    fn launcher_errors_become_mod_error_codes() {
        let cases = [
            (invalid(coded!("errors.friends.disabled")), ErrorCode::NotEnabled),
            (invalid(coded!("errors.friends.unavailable")), ErrorCode::NotEnabled),
            (invalid(coded!("errors.friends.identityLost")), ErrorCode::NotEnabled),
            (invalid(coded!("errors.friends.peerOffline", name = "Bert")), ErrorCode::PeerOffline),
            (invalid(coded!("errors.friends.guestLimit", max = 7)), ErrorCode::GuestLimit),
            (invalid(coded!("errors.friends.lanPortUnknown")), ErrorCode::LanPortUnknown),
            (invalid(coded!("errors.friends.lanUnreachable")), ErrorCode::LanPortUnknown),
            (invalid(coded!("errors.friends.portNotGame", port = 1)), ErrorCode::PortNotGame),
            (invalid(coded!("errors.friends.versionUnsupported", min = "1.20")), ErrorCode::VersionUnsupported),
            (invalid(coded!("errors.friends.msAccountRequired")), ErrorCode::MsAccountRequired),
            (invalid(coded!("errors.friends.sessionActive")), ErrorCode::Busy),
            (invalid(coded!("errors.friends.gameNotRunning")), ErrorCode::Busy),
            (AppError::NotFound(coded!("errors.friends.notFound.friend", id = "x").into()), ErrorCode::UnknownFriend),
            (AppError::NotFound(coded!("errors.friends.notFound.request", id = "x").into()), ErrorCode::NotFound),
            (AppError::NotFound(coded!("errors.friends.notFound.invite", id = "x").into()), ErrorCode::NotFound),
            (invalid(coded!("errors.friends.inviteExpired")), ErrorCode::NotFound),
            (invalid(coded!("errors.friends.nameUnknown", name = "x")), ErrorCode::NameUnknown),
            (invalid(coded!("errors.friends.nameNotFindable", name = "x")), ErrorCode::NameUnknown),
            (invalid(coded!("errors.friends.directoryUnavailable")), ErrorCode::DirectoryUnavailable),
            (invalid(coded!("errors.friends.directoryNotAllowed")), ErrorCode::DirectoryUnavailable),
            (invalid(coded!("errors.friends.rateLimited")), ErrorCode::RateLimited),
            (invalid(coded!("errors.friends.nameCooldown", name = "x", days = 7)), ErrorCode::RateLimited),
            (invalid(coded!("errors.friends.tooManyNameRequests", max = 5)), ErrorCode::Busy),
            (invalid(coded!("errors.friends.tooManyCodes", max = 3)), ErrorCode::Busy),
            (invalid(coded!("errors.friends.requestsFull")), ErrorCode::Busy),
            (invalid(coded!("errors.friends.nameInvalid")), ErrorCode::BadRequest),
            (invalid(coded!("errors.friends.alreadyFriends")), ErrorCode::BadRequest),
            (invalid(coded!("errors.friends.codeInvalid")), ErrorCode::BadRequest),
            (AppError::NotFound("Anfrage „x“ wurde nicht gefunden".into()), ErrorCode::NotFound),
            (AppError::Cancelled, ErrorCode::Internal),
        ];

        for (err, code) in cases {
            let key = error_key(&err);
            assert_eq!(mod_error(err).code, code, "{key}");
        }
    }

    #[test]
    fn errors_with_a_number_or_a_version_carry_it_as_a_param() {
        let limit = mod_error(invalid(coded!("errors.friends.guestLimit", max = 7)));
        let version = mod_error(invalid(coded!("errors.friends.versionUnsupported", min = "1.20")));
        let requests = mod_error(invalid(coded!("errors.friends.tooManyNameRequests", max = 5)));
        let cooldown = mod_error(invalid(coded!("errors.friends.nameCooldown", name = "Notch", days = 7)));

        assert_eq!(limit.params["max"], 7);
        assert_eq!(version.params["min"], "1.20");
        assert_eq!(requests.params["max"], 5);
        assert_eq!(cooldown.params["days"], 7);
    }

    /// Die Fehler aus `errors-reasons.jsonl`, die diese Übersetzung erzeugt, sind genau die der gemeinsamen Muster.
    #[test]
    fn the_golden_reason_fixtures_are_what_the_launcher_produces() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../mod/fixtures/protocol/errors-reasons.jsonl");
        let lines: Vec<Value> = std::fs::read_to_string(path).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        let error_of = |id: &str| lines.iter().find(|line| line["line"]["id"] == id).unwrap()["line"]["error"].clone();
        let produced = [
            ("r01", invalid(coded!("errors.friends.nameInvalid"))),
            ("r04", invalid(coded!("errors.friends.tooManyCodes", max = 3))),
            ("r05", invalid(coded!("errors.friends.directoryNotAllowed"))),
            ("r06", invalid(coded!("errors.friends.nameCooldown", name = "Notch", days = 7))),
            ("r08", invalid(coded!("errors.friends.nameNotFindable", name = "Notch"))),
        ];

        for (id, err) in produced {
            assert_eq!(serde_json::to_value(mod_error(err)).unwrap(), error_of(id), "{id}");
        }
    }

    #[test]
    fn coarse_codes_name_their_cause_in_reason_and_never_leak_a_name() {
        let own = mod_error(invalid(coded!("errors.friends.nameOwn")));
        let not_allowed = mod_error(invalid(coded!("errors.friends.directoryNotAllowed")));
        let cooldown = mod_error(invalid(coded!("errors.friends.nameCooldown", name = "Notch", days = 7)));
        let offline = mod_error(invalid(coded!("errors.friends.peerOffline", name = "Bert")));

        assert_eq!(own.params["reason"], "nameOwn");
        assert_eq!(not_allowed.params["reason"], "directoryNotAllowed");
        assert_eq!(cooldown.params["reason"], "nameCooldown");
        assert!(!cooldown.params.contains_key("name") && !offline.params.contains_key("name"));
    }
}
