//! Skins und Umhänge über die offizielle Minecraft-Services-API (nur Microsoft-Konten) und die
//! lokale Skin-Bibliothek: `skins/<sha1>.png`, Name und Modell in `skins.json`.
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{auth::{self, MC_PROFILE}, modrinth::{self, invalid}, Dirs};
use crate::error::AppResult;
use crate::models::{now_ms, LibrarySkin, SkinVariant};
use crate::services::download::sha1_hex;
use crate::state::AppState;

const TEXTURE_BASE: &str = "textures.minecraft.net/texture/";
/// Echte Skins haben wenige KiB; die Grenze fängt nur versehentlich gewählte große Bilder ab.
const MAX_FILE: u64 = 256 * 1024;
const MAX_NAME: usize = 64;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

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

fn parse_profile(status: u16, body: &[u8]) -> AppResult<SkinProfile> {
    check(status, body)?;
    let response: ProfileResponse = serde_json::from_slice(body)?;
    let skin = response.skins.into_iter().find(Texture::active).map(Texture::into_skin).transpose()?;
    let capes = response.capes.into_iter().map(Texture::into_cape).collect::<AppResult<_>>()?;
    Ok(SkinProfile { skin, capes })
}

/// Fehlerantworten der Minecraft-API in Alltagssprache; ihr `errorMessage` (englisch) kommt als Detail dazu.
fn check(status: u16, body: &[u8]) -> AppResult<()> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let text = match status {
        400 => "Minecraft hat die Änderung abgelehnt.".to_owned(),
        401 => auth::RELOGIN.to_owned(),
        404 => "Minecraft kennt diesen Skin oder Umhang nicht. Lade die Seite neu und versuch es erneut.".to_owned(),
        429 => "Zu viele Anfragen an Minecraft in kurzer Zeit. Versuch es in einer Minute erneut.".to_owned(),
        500..=599 => "Die Minecraft-Server haben gerade Probleme. Versuch es später erneut.".to_owned(),
        s => format!("Minecraft hat die Anfrage abgelehnt (Fehler {s})."),
    };
    #[derive(Deserialize)]
    struct ApiError {
        #[serde(rename = "errorMessage")]
        message: String,
    }
    Err(invalid(match serde_json::from_slice::<ApiError>(body) {
        Ok(ApiError { message }) if !message.is_empty() => format!("{text} – Details: {message}"),
        _ => text,
    }))
}

/// Texturen kommen nur von Mojangs Texturserver. Die API liefert `http://`-Adressen, geladen wird per HTTPS.
fn texture_url(url: &str) -> AppResult<String> {
    let hash = ["http://", "https://"]
        .iter()
        .find_map(|scheme| url.strip_prefix(scheme))
        .and_then(|rest| rest.strip_prefix(TEXTURE_BASE))
        .filter(|hash| !hash.is_empty() && hash.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| invalid("Minecraft hat eine unerwartete Texturadresse geliefert."))?;
    Ok(format!("https://{TEXTURE_BASE}{hash}"))
}

/// Anfrage mit dem Minecraft-Token des Kontos; `auth::session` erneuert ihn bei Bedarf.
async fn send(state: &AppState, account_id: &str, request: reqwest::RequestBuilder) -> AppResult<(u16, Vec<u8>)> {
    let (_, session) = auth::session(state, account_id).await?;
    auth::send(request.bearer_auth(&session.access_token)).await
}

pub async fn profile(state: &AppState, account_id: &str) -> AppResult<SkinProfile> {
    let (status, body) = send(state, account_id, state.http.get(MC_PROFILE)).await?;
    parse_profile(status, &body)
}

/// Lädt einen Skin der Bibliothek mit seinem Modell als aktiven Skin des Kontos hoch.
pub async fn upload(state: &AppState, account_id: &str, skin_id: &str) -> AppResult<()> {
    let skin = state.skins.get(skin_id)?;
    let png = fs::read(file(&state.dirs, &skin.id))?;
    let form = Form::new()
        .text("variant", skin.variant.as_str())
        .part("file", Part::bytes(png).file_name("skin.png").mime_str("image/png")?);
    let (status, body) = send(state, account_id, state.http.post(format!("{MC_PROFILE}/skins")).multipart(form)).await?;
    check(status, &body)
}

/// Zurück zum Standardskin von Minecraft.
pub async fn reset(state: &AppState, account_id: &str) -> AppResult<()> {
    let (status, body) = send(state, account_id, state.http.delete(format!("{MC_PROFILE}/skins/active"))).await?;
    check(status, &body)
}

/// Zeigt den Umhang `cape_id`; `None` blendet den aktiven aus.
pub async fn set_cape(state: &AppState, account_id: &str, cape_id: Option<&str>) -> AppResult<()> {
    let url = format!("{MC_PROFILE}/capes/active");
    let request = match cape_id {
        Some(id) => state.http.put(url).json(&json!({ "capeId": id })),
        None => state.http.delete(url),
    };
    let (status, body) = send(state, account_id, request).await?;
    check(status, &body)
}

/// Prüft Signatur und IHDR-Kopf: nur PNGs mit 64×64 oder im alten Format 64×32 Pixel.
fn validate_png(bytes: &[u8]) -> AppResult<()> {
    let header = bytes
        .get(..24)
        .filter(|h| h.starts_with(PNG_SIGNATURE) && &h[12..16] == b"IHDR")
        .ok_or_else(|| invalid("Die Datei ist kein PNG-Bild."))?;
    let dimension = |at: usize| u32::from_be_bytes([header[at], header[at + 1], header[at + 2], header[at + 3]]);
    match (dimension(16), dimension(20)) {
        (64, 64) | (64, 32) => Ok(()),
        (w, h) => Err(invalid(format!("Ein Skin muss 64×64 oder 64×32 Pixel groß sein, dieses Bild hat {w}×{h}."))),
    }
}

fn skin_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(invalid(format!("Der Name des Skins muss 1 bis {MAX_NAME} Zeichen lang sein.")));
    }
    Ok(name.into())
}

/// Nur mit IDs aus dem Store aufrufen: die ID wird Teil des Pfads.
fn file(dirs: &Dirs, id: &str) -> PathBuf {
    dirs.skins().join(format!("{id}.png"))
}

/// Nimmt eine PNG-Datei in die Bibliothek auf; Name ist der Dateiname, das Modell zunächst klassisch.
pub fn add_file(state: &AppState, path: &Path) -> AppResult<LibrarySkin> {
    if fs::metadata(path)?.len() > MAX_FILE {
        return Err(invalid("Die Datei ist zu groß für einen Skin."));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Skin");
    let name: String = stem.chars().take(MAX_NAME).collect();
    add(state, &fs::read(path)?, &name, SkinVariant::Classic)
}

/// Legt den Skin, den das Konto gerade trägt, in der Bibliothek ab.
pub async fn save_active(state: &AppState, account_id: &str, name: &str) -> AppResult<LibrarySkin> {
    let skin = profile(state, account_id)
        .await?
        .skin
        .ok_or_else(|| invalid("Minecraft meldet für dieses Konto gerade keinen Skin."))?;
    let png = modrinth::bytes(state.http.get(&skin.url), MAX_FILE).await?;
    add(state, &png, name, skin.variant)
}

fn add(state: &AppState, png: &[u8], name: &str, variant: SkinVariant) -> AppResult<LibrarySkin> {
    validate_png(png)?;
    let skin = LibrarySkin { id: sha1_hex(png), name: skin_name(name)?, variant, added_at: now_ms() };
    if let Ok(existing) = state.skins.get(&skin.id) {
        return Err(invalid(format!("Dieser Skin ist schon in der Bibliothek: „{}“.", existing.name)));
    }
    let path = file(&state.dirs, &skin.id);
    fs::create_dir_all(state.dirs.skins())?;
    let tmp = path.with_extension("png.part");
    fs::write(&tmp, png)?;
    fs::rename(&tmp, &path)?;
    state.skins.insert(skin).inspect_err(|_| remove_file(&path))
}

/// Neuer Name und neues Modell; die Datei bleibt dieselbe.
pub fn update(state: &AppState, id: &str, name: &str, variant: SkinVariant) -> AppResult<LibrarySkin> {
    let skin = state.skins.get(id)?;
    state.skins.update(LibrarySkin { name: skin_name(name)?, variant, ..skin })
}

pub fn delete(state: &AppState, id: &str) -> AppResult<()> {
    // Erst der Store-Eintrag: nur eine existierende ID wird zum Pfad.
    state.skins.remove(id)?;
    remove_file(&file(&state.dirs, id));
    Ok(())
}

fn remove_file(path: &Path) {
    match fs::remove_file(path) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
            tracing::warn!(%err, path = %path.display(), "Skin-Datei nicht gelöscht")
        }
        _ => {}
    }
}

/// Die PNG eines Bibliotheks-Skins als `data:`-URL für die Vorschau.
pub fn texture(state: &AppState, id: &str) -> AppResult<String> {
    let skin = state.skins.get(id)?;
    let png = fs::read(file(&state.dirs, &skin.id))?;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
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
        let profile = parse_profile(200, PROFILE_JSON).unwrap();
        let skin = profile.skin.unwrap();
        assert_eq!(skin.variant, SkinVariant::Slim);
        assert_eq!(skin.url, "https://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b");
        let capes: Vec<_> = profile.capes.iter().map(|c| (c.alias.as_str(), c.active)).collect();
        assert_eq!(capes, [("Migrator", false), ("Pan", true)]);
        assert!(profile.capes.iter().all(|c| c.url.starts_with("https://")));
    }

    #[test]
    fn profile_without_skins_or_capes() {
        let profile = parse_profile(200, br#"{"id":"x","name":"n","skins":[],"capes":[]}"#).unwrap();
        assert_eq!(profile, SkinProfile { skin: None, capes: Vec::new() });
        assert!(parse_profile(200, br#"{"id":"x","name":"n"}"#).unwrap().capes.is_empty(), "Felder dürfen fehlen");
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
        assert!(parse_profile(401, b"").is_err());
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
        assert_eq!(fs::read(file(&state.dirs, &skin.id)).unwrap(), png(64, 64));
        assert!(texture(&state, &skin.id).unwrap().starts_with("data:image/png;base64,iVBORw0KGgo"));
        assert!(add_file(&state, &source).unwrap_err().to_string().contains("schon in der Bibliothek"));

        let renamed = update(&state, &skin.id, "  Alex  ", SkinVariant::Slim).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.variant), ("Alex", SkinVariant::Slim));
        assert!(update(&state, &skin.id, " ", SkinVariant::Slim).is_err());

        delete(&state, &skin.id).unwrap();
        assert!(!file(&state.dirs, &skin.id).exists() && state.skins.list().is_empty());
        fs::write(&source, png(16, 16)).unwrap();
        assert!(add_file(&state, &source).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
