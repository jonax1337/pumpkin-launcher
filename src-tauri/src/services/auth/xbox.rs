//! Microsoft-Token → Xbox Live → XSTS → Minecraft-Token, dazu Besitz und Profil des Spielers.
use serde::Deserialize;
use serde_json::json;

use super::{is_success, send, McSession, MC_PROFILE};
use crate::error::{AppError, AppResult};

const XBOX_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";
/// Ohne `xid` im XSTS-Token und ohne `xuid`-Claim im Minecraft-Token erwartet das Spiel trotzdem einen Wert.
const UNKNOWN_XUID: &str = "0";

/// Ergebnis der Kette: das Profil des Spielers und eine frische Sitzung.
pub(super) struct MinecraftLogin {
    pub profile: Profile,
    pub session: McSession,
}

#[derive(Deserialize)]
pub(super) struct Profile {
    pub id: String,
    pub name: String,
}

pub(super) async fn login_to_minecraft(http: &reqwest::Client, ms_access_token: &str) -> AppResult<MinecraftLogin> {
    let xsts = xsts_token(http, ms_access_token).await?;
    let xui = xsts.display_claims.xui.first().ok_or_else(|| AppError::invalid("Xbox Live hat kein Profil geliefert."))?;
    let body = json!({ "identityToken": format!("XBL3.0 x={};{}", xui.uhs, xsts.token) });
    let (status, bytes) = send(http.post(MC_LOGIN).json(&body)).await?;
    let login = parse_mc_login(status, &bytes)?;
    let profile = profile(http, &login.access_token).await?;
    let xuid = xui.xid.clone().or_else(|| jwt_claim(&login.access_token, "xuid")).unwrap_or_else(|| UNKNOWN_XUID.into());
    Ok(MinecraftLogin { profile, session: McSession::new(login, xuid) })
}

async fn xsts_token(http: &reqwest::Client, ms_access_token: &str) -> AppResult<XboxToken> {
    let body = json!({
        "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access_token}") },
        "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT",
    });
    let (status, bytes) = send(http.post(XBOX_AUTH).json(&body)).await?;
    let xbox = parse_xbox(status, &bytes)?;
    let body = json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbox.token] },
        "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT",
    });
    let (status, bytes) = send(http.post(XSTS_AUTH).json(&body)).await?;
    parse_xbox(status, &bytes)
}

/// Erst der Besitz, dann das Profil: fehlt das Profil, entscheidet der Besitz über die Meldung.
async fn profile(http: &reqwest::Client, mc_access_token: &str) -> AppResult<Profile> {
    let (status, bytes) = send(http.get(MC_ENTITLEMENTS).bearer_auth(mc_access_token)).await?;
    let owns = is_success(status) && owns_game(&bytes);
    let (status, bytes) = send(http.get(MC_PROFILE).bearer_auth(mc_access_token)).await?;
    parse_profile(status, &bytes, owns)
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XboxToken {
    token: String,
    display_claims: Claims,
}

#[derive(Deserialize)]
struct Claims {
    xui: Vec<Xui>,
}

#[derive(Deserialize)]
struct Xui {
    uhs: String,
    #[serde(default)]
    xid: Option<String>,
}

/// XSTS-Fehlercodes (`XErr`) in Alltagssprache.
fn xerr_text(code: u64) -> &'static str {
    match code {
        2148916233 => "Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil. Melde dich einmal auf xbox.com an, lege dort ein Profil an und versuch es dann erneut.",
        2148916238 => "Das Konto gehört einem Kind und muss erst von einem Erwachsenen zu einer Microsoft-Familie hinzugefügt werden (account.microsoft.com/family).",
        2148916235 => "Xbox Live ist in deinem Land nicht verfügbar.",
        2148916236 | 2148916237 => "Das Konto muss auf xbox.com erst noch bestätigt werden (Altersnachweis). Danach klappt die Anmeldung.",
        2148916227 => "Dieses Konto ist bei Xbox gesperrt.",
        2148916229 => "Die Jugendschutz-Einstellungen des Kontos erlauben kein Online-Spielen. Ein Erziehungsberechtigter kann das ändern.",
        2148916234 => "Die Xbox-Nutzungsbedingungen wurden noch nicht akzeptiert. Melde dich einmal auf xbox.com an.",
        _ => "Xbox Live hat die Anmeldung abgelehnt.",
    }
}

fn parse_xbox(status: u16, body: &[u8]) -> AppResult<XboxToken> {
    if is_success(status) {
        return Ok(serde_json::from_slice(body)?);
    }
    #[derive(Deserialize)]
    struct XErr {
        #[serde(rename = "XErr")]
        code: u64,
    }
    Err(AppError::invalid(match serde_json::from_slice::<XErr>(body) {
        Ok(XErr { code }) => format!("{} (Fehler {code})", xerr_text(code)),
        Err(_) => format!("Xbox Live hat die Anmeldung abgelehnt (Fehler {status})."),
    }))
}

#[derive(Deserialize)]
pub(super) struct McLogin {
    pub access_token: String,
    pub expires_in: u64,
}

fn parse_mc_login(status: u16, body: &[u8]) -> AppResult<McLogin> {
    match status {
        s if is_success(s) => Ok(serde_json::from_slice(body)?),
        403 => Err(AppError::invalid("Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet. Die Freigabe der App steht noch aus.")),
        429 => Err(AppError::invalid("Zu viele Anmeldeversuche in kurzer Zeit. Warte ein paar Minuten und versuch es erneut.")),
        s => Err(AppError::invalid(format!("Die Anmeldung bei Minecraft ist fehlgeschlagen (Fehler {s})."))),
    }
}

/// Besitzt das Konto Minecraft laut `entitlements/mcstore`?
fn owns_game(body: &[u8]) -> bool {
    #[derive(Deserialize)]
    struct Entitlements {
        #[serde(default)]
        items: Vec<Item>,
    }
    #[derive(Deserialize)]
    struct Item {
        name: String,
    }
    serde_json::from_slice::<Entitlements>(body)
        .is_ok_and(|e| e.items.iter().any(|i| i.name == "product_minecraft" || i.name == "game_minecraft"))
}

/// Profil mit UUID (mit Bindestrichen). Ohne Profil: kein Spiel gekauft bzw. noch kein Name gewählt.
fn parse_profile(status: u16, body: &[u8], owns: bool) -> AppResult<Profile> {
    match status {
        s if is_success(s) => {
            let p: Profile = serde_json::from_slice(body)?;
            let id = uuid::Uuid::parse_str(&p.id).map_err(|_| AppError::invalid("Minecraft hat ein ungültiges Profil geliefert."))?;
            Ok(Profile { id: id.hyphenated().to_string(), name: p.name })
        }
        404 if owns => Err(AppError::invalid("Zu diesem Konto gibt es noch kein Minecraft-Profil. Starte einmal den offiziellen Minecraft Launcher und wähle einen Spielernamen.")),
        404 => Err(AppError::invalid("Dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht.")),
        s => Err(AppError::invalid(format!("Das Minecraft-Profil konnte nicht geladen werden (Fehler {s})."))),
    }
}

/// Ein Claim aus dem (unsignierten) Payload eines JWT, z. B. `xuid` im Minecraft-Token.
fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    match serde_json::from_slice::<serde_json::Value>(&bytes).ok()?.get(claim)? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xbox_answers_and_xerr() {
        let x = parse_xbox(200, br#"{"IssueInstant":"x","NotAfter":"y","Token":"xbl","DisplayClaims":{"xui":[{"uhs":"123"}]}}"#).unwrap();
        assert_eq!((x.token.as_str(), x.display_claims.xui[0].uhs.as_str()), ("xbl", "123"));
        let err = parse_xbox(401, br#"{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"https://start.ui.xboxlive.com/CreateAccount"}"#);
        assert!(err.err().unwrap().to_string().starts_with("Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil"));
        assert!(xerr_text(2148916238).contains("Kind"));
        assert_eq!(xerr_text(1), "Xbox Live hat die Anmeldung abgelehnt.");
        assert!(parse_xbox(503, b"").err().unwrap().to_string().contains("503"));
    }

    #[test]
    fn minecraft_answers() {
        let login = parse_mc_login(200, br#"{"username":"u","roles":[],"access_token":"eyJ","token_type":"Bearer","expires_in":86400}"#).unwrap();
        assert_eq!((login.access_token.as_str(), login.expires_in), ("eyJ", 86400));
        assert!(parse_mc_login(403, b"{}").err().unwrap().to_string().contains("noch nicht für Minecraft freigeschaltet"));
        assert!(owns_game(br#"{"items":[{"name":"product_minecraft","signature":"s"},{"name":"game_minecraft","signature":"s"}],"signature":"s","keyId":"1"}"#));
        assert!(!owns_game(br#"{"items":[],"signature":"s","keyId":"1"}"#));
        let p = parse_profile(200, br#"{"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch","skins":[],"capes":[]}"#, true).unwrap();
        assert_eq!((p.id.as_str(), p.name.as_str()), ("069a79f4-44e9-4726-a5be-fca90e38aaf5", "Notch"));
        assert!(parse_profile(404, b"{}", false).err().unwrap().to_string().contains("besitzt Minecraft"));
        assert!(parse_profile(200, br#"{"id":"../x","name":"n"}"#, true).is_err());
    }

    #[test]
    fn xuid_from_minecraft_token() {
        use base64::Engine;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"xuid":"2535400000000000","sub":"x"}"#);
        assert_eq!(jwt_claim(&format!("h.{payload}.s"), "xuid").as_deref(), Some("2535400000000000"));
        assert_eq!(jwt_claim("kein-jwt", "xuid"), None);
    }
}
