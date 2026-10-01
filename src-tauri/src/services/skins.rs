//! Skins und Umhänge über die offizielle Minecraft-Services-API (nur Microsoft-Konten) und die
//! lokale Skin-Bibliothek: `skins/<sha1>.png`, Name und Modell in `skins.json`.
use std::fs;
use std::path::{Path, PathBuf};

use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{auth::{self, MC_PROFILE}, data_url, modrinth, remove_logged, write_atomic, Dirs};
use crate::error::{AppError, AppResult};
use crate::models::{now_ms, require_name, LibrarySkin, SkinVariant, MAX_SKIN_NAME_LEN};
use crate::services::download::sha1_hex;
use crate::state::AppState;

const TEXTURE_BASE: &str = "textures.minecraft.net/texture/";
/// Echte Skins haben wenige KiB; die Grenze fängt nur versehentlich gewählte große Bilder ab.
const MAX_FILE: u64 = 256 * 1024;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
/// Der Anfang jeder PNG-Datei: Signatur, Länge und Typ des ersten Chunks (`IHDR`), dann dessen Breite und Höhe.
const PNG_HEADER_LEN: usize = 24;
const IHDR_AT: usize = 12;
const WIDTH_AT: usize = 16;
const HEIGHT_AT: usize = 20;

/// Was das Konto gerade trägt: aktiver Skin (fehlt, wenn Minecraft keinen meldet) und alle Umhänge.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinProfile {
    pub skin: Option<OnlineSkin>,
    pub capes: Vec<Cape>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineSkin {
    pub url: String,
    pub variant: SkinVariant,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cape {
    pub id: String,
    pub alias: String,
    pub url: String,
    pub active: bool,
}

/// Skin- bzw. Umhang-Eintrag aus `/minecraft/profile`.
#[derive(Deserialize)]
struct Texture {
    #[serde(default)]
    id: String,
    state: String,
    url: String,
    #[serde(default)]
    variant: SkinVariant,
    #[serde(default)]
    alias: String,
}

impl Texture {
    fn active(&self) -> bool {
        self.state == "ACTIVE"
    }

    fn into_skin(self) -> AppResult<OnlineSkin> {
        Ok(OnlineSkin { url: texture_url(&self.url)?, variant: self.variant })
    }

    fn into_cape(self) -> AppResult<Cape> {
        Ok(Cape { url: texture_url(&self.url)?, active: self.active(), id: self.id, alias: self.alias })
    }
}

#[derive(Deserialize)]
struct ProfileResponse {
    #[serde(default)]
    skins: Vec<Texture>,
    #[serde(default)]
    capes: Vec<Texture>,
}

fn parse_profile(body: &[u8]) -> AppResult<SkinProfile> {
    let response: ProfileResponse = serde_json::from_slice(body)?;
    let skin = response.skins.into_iter().find(Texture::active).map(Texture::into_skin).transpose()?;
    let capes = response.capes.into_iter().map(Texture::into_cape).collect::<AppResult<_>>()?;
    Ok(SkinProfile { skin, capes })
}

/// Fehlerantwort der Minecraft-API; ihr `errorMessage` ist englisch.
#[derive(Deserialize)]
struct ApiError {
    #[serde(rename = "errorMessage")]
    message: String,
}

/// Fehlerantworten der Minecraft-API in Alltagssprache; ihr `errorMessage` kommt als Detail dazu.
fn check(status: u16, body: &[u8]) -> AppResult<()> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let text = status_text(status);
    Err(AppError::invalid(match serde_json::from_slice::<ApiError>(body) {
        Ok(ApiError { message }) if !message.is_empty() => format!("{text} – Details: {message}"),
        _ => text,
    }))
}

fn status_text(status: u16) -> String {
    match status {
        400 => "Minecraft hat die Änderung abgelehnt.".to_owned(),
        401 => auth::RELOGIN.to_owned(),
        404 => "Minecraft kennt diesen Skin oder Umhang nicht. Lade die Seite neu und versuch es erneut.".to_owned(),
        429 => "Zu viele Anfragen an Minecraft in kurzer Zeit. Versuch es in einer Minute erneut.".to_owned(),
        500..=599 => "Die Minecraft-Server haben gerade Probleme. Versuch es später erneut.".to_owned(),
        s => format!("Minecraft hat die Anfrage abgelehnt (Fehler {s})."),
    }
}

/// Texturen kommen nur von Mojangs Texturserver. Die API liefert `http://`-Adressen, geladen wird per HTTPS.
fn texture_url(url: &str) -> AppResult<String> {
    let hash = ["http://", "https://"]
        .iter()
        .find_map(|scheme| url.strip_prefix(scheme))
        .and_then(|rest| rest.strip_prefix(TEXTURE_BASE))
        .filter(|hash| !hash.is_empty() && hash.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| AppError::invalid("Minecraft hat eine unerwartete Texturadresse geliefert."))?;
    Ok(format!("https://{TEXTURE_BASE}{hash}"))
}

/// Anfrage mit dem Minecraft-Token des Kontos (`auth::session` erneuert ihn bei Bedarf); liefert den Body einer
/// erfolgreichen Antwort, jede andere ist ein Fehler.
async fn send_checked(state: &AppState, account_id: &str, request: reqwest::RequestBuilder) -> AppResult<Vec<u8>> {
    let (_, session) = auth::session(state, account_id).await?;
    let (status, body) = auth::send(request.bearer_auth(&session.access_token)).await?;
    check(status, &body)?;
    Ok(body)
}

pub async fn profile(state: &AppState, account_id: &str) -> AppResult<SkinProfile> {
    parse_profile(&send_checked(state, account_id, state.http.get(MC_PROFILE)).await?)
}

/// Lädt einen Skin der Bibliothek mit seinem Modell als aktiven Skin des Kontos hoch.
pub async fn upload(state: &AppState, account_id: &str, skin_id: &str) -> AppResult<()> {
    let skin = state.skins.get(skin_id)?;
    let png = fs::read(png_path(&state.dirs, &skin.id))?;
    let form = Form::new()
        .text("variant", skin.variant.as_str())
        .part("file", Part::bytes(png).file_name("skin.png").mime_str("image/png")?);
    send_checked(state, account_id, state.http.post(format!("{MC_PROFILE}/skins")).multipart(form)).await.map(drop)
}

/// Zurück zum Standardskin von Minecraft.
pub async fn reset(state: &AppState, account_id: &str) -> AppResult<()> {
    send_checked(state, account_id, state.http.delete(format!("{MC_PROFILE}/skins/active"))).await.map(drop)
}

/// Zeigt den Umhang `cape_id`; `None` blendet den aktiven aus.
pub async fn set_cape(state: &AppState, account_id: &str, cape_id: Option<&str>) -> AppResult<()> {
    let url = format!("{MC_PROFILE}/capes/active");
    let request = match cape_id {
        Some(id) => state.http.put(url).json(&json!({ "capeId": id })),
        None => state.http.delete(url),
    };
    send_checked(state, account_id, request).await.map(drop)
}

/// Prüft Signatur und IHDR-Kopf: nur PNGs mit 64×64 oder im alten Format 64×32 Pixel.
fn validate_png(bytes: &[u8]) -> AppResult<()> {
    let header = bytes
        .get(..PNG_HEADER_LEN)
        .filter(|h| h.starts_with(PNG_SIGNATURE) && &h[IHDR_AT..IHDR_AT + 4] == b"IHDR")
        .ok_or_else(|| AppError::invalid("Die Datei ist kein PNG-Bild."))?;
    let dimension = |at: usize| u32::from_be_bytes([header[at], header[at + 1], header[at + 2], header[at + 3]]);
    match (dimension(WIDTH_AT), dimension(HEIGHT_AT)) {
        (64, 64) | (64, 32) => Ok(()),
        (w, h) => Err(AppError::invalid(format!("Ein Skin muss 64×64 oder 64×32 Pixel groß sein, dieses Bild hat {w}×{h}."))),
    }
}

fn skin_name(name: &str) -> AppResult<String> {
    let message = format!("Der Name des Skins muss 1 bis {MAX_SKIN_NAME_LEN} Zeichen lang sein.");
    require_name(name, MAX_SKIN_NAME_LEN, message).map(str::to_owned)
}

/// Nur mit IDs aus dem Store aufrufen: die ID wird Teil des Pfads.
fn png_path(dirs: &Dirs, id: &str) -> PathBuf {
    dirs.skins().join(format!("{id}.png"))
}

/// Nimmt eine PNG-Datei in die Bibliothek auf; Name ist der Dateiname, das Modell zunächst klassisch.
pub fn add_file(state: &AppState, path: &Path) -> AppResult<LibrarySkin> {
    if fs::metadata(path)?.len() > MAX_FILE {
        return Err(AppError::invalid("Die Datei ist zu groß für einen Skin."));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Skin");
    let name: String = stem.chars().take(MAX_SKIN_NAME_LEN).collect();
    add(state, &fs::read(path)?, &name, SkinVariant::Classic)
}

/// Legt den Skin, den das Konto gerade trägt, in der Bibliothek ab.
pub async fn save_active(state: &AppState, account_id: &str, name: &str) -> AppResult<LibrarySkin> {
    let skin = profile(state, account_id)
        .await?
        .skin
        .ok_or_else(|| AppError::invalid("Minecraft meldet für dieses Konto gerade keinen Skin."))?;
    let png = modrinth::bytes(state.http.get(&skin.url), MAX_FILE).await?;
    add(state, &png, name, skin.variant)
}

fn add(state: &AppState, png: &[u8], name: &str, variant: SkinVariant) -> AppResult<LibrarySkin> {
    validate_png(png)?;
    let skin = LibrarySkin { id: sha1_hex(png), name: skin_name(name)?, variant, added_at: now_ms() };
    if let Ok(existing) = state.skins.get(&skin.id) {
        return Err(AppError::invalid(format!("Dieser Skin ist schon in der Bibliothek: „{}“.", existing.name)));
    }
    let path = png_path(&state.dirs, &skin.id);
    fs::create_dir_all(state.dirs.skins())?;
    write_atomic(&path, png)?;
    state.skins.insert(skin).inspect_err(|_| remove_logged(&path))
}

/// Neuer Name und neues Modell; die Datei bleibt dieselbe.
pub fn update(state: &AppState, id: &str, name: &str, variant: SkinVariant) -> AppResult<LibrarySkin> {
    let skin = state.skins.get(id)?;
    state.skins.update(LibrarySkin { name: skin_name(name)?, variant, ..skin })
}

pub fn delete(state: &AppState, id: &str) -> AppResult<()> {
    // Erst der Store-Eintrag: nur eine existierende ID wird zum Pfad.
    state.skins.remove(id)?;
    remove_logged(&png_path(&state.dirs, id));
    Ok(())
}

/// Die PNG eines Bibliotheks-Skins als `data:`-URL für die Vorschau.
pub fn texture(state: &AppState, id: &str) -> AppResult<String> {
    let skin = state.skins.get(id)?;
    let png = fs::read(png_path(&state.dirs, &skin.id))?;
    Ok(data_url("image/png", &png))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;

    /// Kleinste Datei, die die Prüfung erreicht: Signatur und IHDR-Kopf mit Breite und Höhe.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 13]);
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn png_validation_accepts_only_skin_sizes() {
        assert!(validate_png(&png(64, 64)).is_ok());
        assert!(validate_png(&png(64, 32)).is_ok(), "altes Format");
        let err = validate_png(&png(128, 128)).unwrap_err().to_string();
        assert!(err.contains("128×128"), "{err}");
        assert!(validate_png(&png(32, 64)).is_err());
        assert_eq!(validate_png(b"GIF89a....................").unwrap_err().to_string(), "Die Datei ist kein PNG-Bild.");
        assert!(validate_png(&png(64, 64)[..20]).is_err(), "abgeschnittener Kopf");
        let mut no_ihdr = png(64, 64);
        no_ihdr[12..16].copy_from_slice(b"IDAT");
        assert!(validate_png(&no_ihdr).is_err());
    }

    /// Aufgezeichnete Antwort von `GET /minecraft/profile` (Beispielkonto).
    const PROFILE_JSON: &[u8] = br#"{
        "id": "986dec87b7ec47ff89ff033fdb95c4b5",
        "name": "HowDoesAuthWork",
        "skins": [
            { "id": "6a6e65e5-76dd-4c3c-a625-162924514568", "state": "INACTIVE",
              "url": "http://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb",
              "textureKey": "31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb", "variant": "CLASSIC", "alias": "STEVE" },
            { "id": "0c6a2f50-04a4-4e33-8e4a-0e2f4f0b1f6e", "state": "ACTIVE",
              "url": "http://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b",
              "textureKey": "1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b", "variant": "SLIM" }
        ],
        "capes": [
            { "id": "1981aad373fa9754", "state": "INACTIVE", "alias": "Migrator",
              "url": "http://textures.minecraft.net/texture/2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933" },
            { "id": "5ec930cdd2629b0b", "state": "ACTIVE", "alias": "Pan",
              "url": "http://textures.minecraft.net/texture/28de4a81688ad18b49e735a273e086c18f1e3966956123ccb574034c06f5d336" }
        ],
        "profileActions": {}
    }"#;

    #[test]
    fn profile_answer_maps_active_skin_and_capes() {
        let profile = parse_profile(PROFILE_JSON).unwrap();
        let skin = profile.skin.unwrap();
        assert_eq!(skin.variant, SkinVariant::Slim);
        assert_eq!(skin.url, "https://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b");
        let capes: Vec<_> = profile.capes.iter().map(|c| (c.alias.as_str(), c.active)).collect();
        assert_eq!(capes, [("Migrator", false), ("Pan", true)]);
        assert!(profile.capes.iter().all(|c| c.url.starts_with("https://")));
    }

    #[test]
    fn profile_without_skins_or_capes() {
        let profile = parse_profile(br#"{"id":"x","name":"n","skins":[],"capes":[]}"#).unwrap();
        assert_eq!(profile, SkinProfile { skin: None, capes: Vec::new() });
        assert!(parse_profile(br#"{"id":"x","name":"n"}"#).unwrap().capes.is_empty(), "Felder dürfen fehlen");
    }

    #[test]
    fn api_errors_read_like_sentences() {
        let error = |status, body: &[u8]| check(status, body).unwrap_err().to_string();
        assert_eq!(error(401, b""), auth::RELOGIN);
        assert!(error(429, b"").contains("in einer Minute"));
        let rejected = error(400, br#"{"path":"/minecraft/profile/skins","errorType":"BAD_REQUEST","errorMessage":"Could not validate image data"}"#);
        assert_eq!(rejected, "Minecraft hat die Änderung abgelehnt. – Details: Could not validate image data");
        assert!(error(503, b"<html>").starts_with("Die Minecraft-Server haben gerade Probleme"));
        assert!(error(418, b"").contains("Fehler 418"));
        assert!(parse_profile(b"").is_err(), "ohne JSON kein Profil");
        assert!(check(204, b"").is_ok());
    }

    #[test]
    fn textures_only_from_mojang() {
        assert_eq!(texture_url("http://textures.minecraft.net/texture/ab12").unwrap(), "https://textures.minecraft.net/texture/ab12");
        for bad in ["https://evil.example/texture/ab12", "http://textures.minecraft.net/texture/../x", "http://textures.minecraft.net/texture/", "file:///C:/x.png"] {
            assert!(texture_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn library_roundtrip() {
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let source = root.join("Mein Skin.png");
        fs::write(&source, png(64, 64)).unwrap();

        let skin = add_file(&state, &source).unwrap();
        assert_eq!((skin.name.as_str(), skin.variant, skin.id.len()), ("Mein Skin", SkinVariant::Classic, 40));
        assert_eq!(fs::read(png_path(&state.dirs, &skin.id)).unwrap(), png(64, 64));
        assert!(texture(&state, &skin.id).unwrap().starts_with("data:image/png;base64,iVBORw0KGgo"));
        assert!(add_file(&state, &source).unwrap_err().to_string().contains("schon in der Bibliothek"));

        let renamed = update(&state, &skin.id, "  Alex  ", SkinVariant::Slim).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.variant), ("Alex", SkinVariant::Slim));
        assert!(update(&state, &skin.id, " ", SkinVariant::Slim).is_err());

        delete(&state, &skin.id).unwrap();
        assert!(!png_path(&state.dirs, &skin.id).exists() && state.skins.list().is_empty());
        fs::write(&source, png(16, 16)).unwrap();
        assert!(add_file(&state, &source).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
