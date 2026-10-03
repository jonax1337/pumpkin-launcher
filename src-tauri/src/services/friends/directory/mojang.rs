//! Mojangs Endpunkte für den Kontonachweis (BYNAME 3.2 und 9.9): `join` und `hasJoined` des Session-Servers wie bei
//! jedem Online-Server, dazu die Namenssuche. Die Antworten werden von reinen Funktionen gelesen; das Netz steckt nur in `MojangHttp`.
use std::time::Duration;

use futures::future::BoxFuture;
use futures::FutureExt;
use serde::Deserialize;
use serde_json::json;

use super::McIdentity;
use crate::services::friends::sanitize;
use crate::services::skins::{self, PLAYER_LOOKUP};
use crate::services::transport::read_capped;

const JOIN_URL: &str = "https://sessionserver.mojang.com/session/minecraft/join";
const HAS_JOINED_URL: &str = "https://sessionserver.mojang.com/session/minecraft/hasJoined";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const JOIN_BODY_LIMIT: u64 = 16 * 1024;
const HAS_JOINED_BODY_LIMIT: u64 = 64 * 1024;
const LOOKUP_BODY_LIMIT: u64 = 16 * 1024;

/// Konto und Name, wie Mojang sie bestätigt: `uuid` mit 32 Hex-Zeichen in Kleinbuchstaben, `name` in Mojangs Schreibweise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MojangProfile {
    pub uuid: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MojangError {
    Unreachable,
    /// Mojang erlaubt dem Konto keine Mehrspieler-Funktionen (Kindkonto) oder hat es gesperrt.
    NotAllowed,
    /// Das Zugangstoken ist abgelaufen; eine neue Sitzung hilft.
    InvalidSession,
    RateLimited,
}

pub trait MojangSessions: Send + Sync + 'static {
    /// Meldet das Konto mit dieser `serverId` an, wie der Spielclient beim Beitritt zu einem Online-Server.
    fn join<'a>(&'a self, session: &'a McIdentity, server_id: &'a str) -> BoxFuture<'a, Result<(), MojangError>>;
    /// Das Profil, das mit dieser `serverId` beigetreten ist; `None`, wenn `name` das nicht war.
    fn has_joined<'a>(&'a self, name: &'a str, server_id: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>>;
    /// Name → Konto; `None`, wenn es den Namen nicht gibt.
    fn lookup_name<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>>;
}

pub struct MojangHttp {
    client: reqwest::Client,
}

impl MojangHttp {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    async fn fetch(&self, request: reqwest::RequestBuilder, body_limit: u64) -> Result<(u16, Vec<u8>), MojangError> {
        let mut response = request.timeout(REQUEST_TIMEOUT).send().await.map_err(|_| MojangError::Unreachable)?;
        let status = response.status().as_u16();
        let body = read_capped(&mut response, body_limit, "Antwort zu groß").await.map_err(|_| MojangError::Unreachable)?;
        Ok((status, body))
    }
}

impl MojangSessions for MojangHttp {
    fn join<'a>(&'a self, session: &'a McIdentity, server_id: &'a str) -> BoxFuture<'a, Result<(), MojangError>> {
        async move {
            let request = self.client.post(JOIN_URL).json(&join_body(session, server_id));
            let (status, body) = self.fetch(request, JOIN_BODY_LIMIT).await?;
            parse_join(status, &body)
        }
        .boxed()
    }

    fn has_joined<'a>(&'a self, name: &'a str, server_id: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>> {
        async move {
            // Der Name stammt aus dem Hello-Rahmen der Gegenseite; was kein Minecraft-Name ist, kann nicht beigetreten sein.
            if sanitize::mc_name(Some(name)).is_none() {
                return Ok(None);
            }
            let request = self.client.get(has_joined_url(name, server_id));
            let (status, body) = self.fetch(request, HAS_JOINED_BODY_LIMIT).await?;
            parse_has_joined(status, &body)
        }
        .boxed()
    }

    fn lookup_name<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>> {
        async move {
            // Der Name wird Teil des Pfads: nur Minecraft-Namen gehen hinaus.
            if !skins::valid_player_name(name) {
                return Ok(None);
            }
            let request = self.client.get(format!("{PLAYER_LOOKUP}{name}"));
            let (status, body) = self.fetch(request, LOOKUP_BODY_LIMIT).await?;
            parse_lookup(status, &body)
        }
        .boxed()
    }
}

fn join_body(session: &McIdentity, server_id: &str) -> serde_json::Value {
    json!({ "accessToken": session.access_token, "selectedProfile": session.uuid, "serverId": server_id })
}

fn has_joined_url(name: &str, server_id: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse(HAS_JOINED_URL).expect("feste Adresse");
    url.query_pairs_mut().append_pair("username", name).append_pair("serverId", server_id);
    url
}

#[derive(Deserialize)]
struct MojangFault {
    error: String,
}

/// 204 heißt angemeldet. 403 sagt im Feld `error`, warum nicht.
fn parse_join(status: u16, body: &[u8]) -> Result<(), MojangError> {
    match status {
        204 => Ok(()),
        401 => Err(MojangError::InvalidSession),
        403 => Err(refusal(body)),
        429 => Err(MojangError::RateLimited),
        _ => Err(MojangError::Unreachable),
    }
}

fn refusal(body: &[u8]) -> MojangError {
    match serde_json::from_slice::<MojangFault>(body).as_ref().map(|fault| fault.error.as_str()) {
        Ok("InsufficientPrivilegesException" | "UserBannedException") => MojangError::NotAllowed,
        Ok("InvalidCredentialsException") => MojangError::InvalidSession,
        _ => MojangError::Unreachable,
    }
}

fn parse_has_joined(status: u16, body: &[u8]) -> Result<Option<MojangProfile>, MojangError> {
    match status {
        200 => profile_of(body).map(Some),
        204 => Ok(None),
        _ => Err(MojangError::Unreachable),
    }
}

fn parse_lookup(status: u16, body: &[u8]) -> Result<Option<MojangProfile>, MojangError> {
    match status {
        200 => profile_of(body).map(Some),
        404 => Ok(None),
        429 => Err(MojangError::RateLimited),
        _ => Err(MojangError::Unreachable),
    }
}

/// Die Antwort ist nur brauchbar, wenn Konto und Name die Form haben, die der Rest des Verzeichnisses voraussetzt.
fn profile_of(body: &[u8]) -> Result<MojangProfile, MojangError> {
    let player = skins::parse_player(body).map_err(|_| MojangError::Unreachable)?;
    let uuid = sanitize::mc_uuid(Some(&player.id.to_ascii_lowercase()));
    let name = sanitize::mc_name(Some(&player.name));
    uuid.zip(name).map(|(uuid, name)| MojangProfile { uuid, name }).ok_or(MojangError::Unreachable)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "069a79f444e94726a5befca90e38aaf5";

    fn profile_json(id: &str, name: &str) -> Vec<u8> {
        json!({ "id": id, "name": name, "properties": [{ "name": "textures", "value": "AAAA" }] }).to_string().into_bytes()
    }

    fn fault(error: &str) -> Vec<u8> {
        json!({ "error": error, "errorMessage": "egal" }).to_string().into_bytes()
    }

    fn steve() -> MojangProfile {
        MojangProfile { uuid: UUID.into(), name: "Steve".into() }
    }

    #[test]
    fn join_204_is_ok() {
        assert_eq!(parse_join(204, b""), Ok(()));
    }

    #[test]
    fn join_403_names_the_reason() {
        let table = [
            ("InsufficientPrivilegesException", MojangError::NotAllowed),
            ("UserBannedException", MojangError::NotAllowed),
            ("InvalidCredentialsException", MojangError::InvalidSession),
            ("ForbiddenOperationException", MojangError::Unreachable),
        ];
        for (error, expected) in table {
            assert_eq!(parse_join(403, &fault(error)), Err(expected), "{error}");
        }
    }

    #[test]
    fn join_403_without_a_readable_reason_is_unreachable() {
        assert_eq!(parse_join(403, b"<html>"), Err(MojangError::Unreachable));
        assert_eq!(parse_join(403, b""), Err(MojangError::Unreachable));
    }

    #[test]
    fn join_401_is_an_invalid_session_and_429_is_rate_limited() {
        assert_eq!(parse_join(401, b""), Err(MojangError::InvalidSession));
        assert_eq!(parse_join(429, b""), Err(MojangError::RateLimited));
    }

    #[test]
    fn join_with_any_other_status_is_unreachable() {
        for status in [200, 400, 404, 500, 503] {
            assert_eq!(parse_join(status, b""), Err(MojangError::Unreachable), "{status}");
        }
    }

    #[test]
    fn join_sends_the_token_the_uuid_without_hyphens_and_the_server_id() {
        let session = McIdentity { uuid: UUID.into(), name: "Steve".into(), access_token: "token-1".into() };
        let server_id = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(join_body(&session, server_id), json!({ "accessToken": "token-1", "selectedProfile": UUID, "serverId": server_id }));
    }

    #[test]
    fn has_joined_200_reads_the_profile() {
        assert_eq!(parse_has_joined(200, &profile_json(UUID, "Steve")), Ok(Some(steve())));
    }

    #[test]
    fn has_joined_normalizes_an_uppercase_uuid() {
        assert_eq!(parse_has_joined(200, &profile_json(&UUID.to_uppercase(), "Steve")), Ok(Some(steve())));
    }

    #[test]
    fn has_joined_204_means_not_joined() {
        assert_eq!(parse_has_joined(204, b""), Ok(None));
    }

    #[test]
    fn has_joined_with_any_other_status_is_unreachable() {
        for status in [400, 403, 404, 429, 500] {
            assert_eq!(parse_has_joined(status, b""), Err(MojangError::Unreachable), "{status}");
        }
    }

    #[test]
    fn a_profile_with_a_malformed_id_or_name_is_unreachable() {
        let bad = [
            profile_json("zz9a79f444e94726a5befca90e38aaf5", "Steve"),
            profile_json("069a79f4", "Steve"),
            profile_json(UUID, "Ste ve"),
            profile_json(UUID, ""),
            profile_json(UUID, "ZwölfZeichenLangerNameXX"),
            b"{}".to_vec(),
            b"kein json".to_vec(),
        ];
        for body in bad {
            assert_eq!(parse_has_joined(200, &body), Err(MojangError::Unreachable), "{}", String::from_utf8_lossy(&body));
        }
    }

    #[test]
    fn lookup_200_reads_the_canonical_spelling() {
        assert_eq!(parse_lookup(200, &profile_json(UUID, "Steve")), Ok(Some(steve())));
    }

    #[test]
    fn lookup_404_means_there_is_no_such_player() {
        assert_eq!(parse_lookup(404, b""), Ok(None));
    }

    #[test]
    fn lookup_429_is_rate_limited_and_anything_else_unreachable() {
        assert_eq!(parse_lookup(429, b""), Err(MojangError::RateLimited));
        for status in [204, 400, 403, 500] {
            assert_eq!(parse_lookup(status, b""), Err(MojangError::Unreachable), "{status}");
        }
    }

    #[test]
    fn the_has_joined_url_carries_username_and_server_id_but_no_ip() {
        let url = has_joined_url("Steve", "0123456789abcdef0123456789abcdef01234567");
        assert_eq!(url.origin().ascii_serialization() + url.path(), "https://sessionserver.mojang.com/session/minecraft/hasJoined");
        let query: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        assert_eq!(
            query,
            [("username".to_owned(), "Steve".to_owned()), ("serverId".to_owned(), "0123456789abcdef0123456789abcdef01234567".to_owned())]
        );
    }

    #[test]
    fn a_name_that_is_not_a_minecraft_name_cannot_smuggle_query_parts() {
        let url = has_joined_url("Steve&ip=1.2.3.4", "x");
        assert_eq!(url.query_pairs().count(), 2);
        assert_eq!(url.query_pairs().next().unwrap().1, "Steve&ip=1.2.3.4");
    }

    #[tokio::test]
    async fn names_that_are_no_minecraft_names_never_reach_the_network() {
        let http = MojangHttp::new(reqwest::Client::new());
        for name in ["", "Ste ve", "../x", "Steve&ip=1", "ZwölfZeichenLangerNameXX"] {
            assert_eq!(http.has_joined(name, "x").await, Ok(None), "{name}");
            assert_eq!(http.lookup_name(name).await, Ok(None), "{name}");
        }
    }
}
