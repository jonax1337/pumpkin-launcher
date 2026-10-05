//! Skins der Freunde (SPEC 12.2): Rust holt sie bei Mojangs Session-Server, nur von `textures.minecraft.net`, höchstens
//! 64 KiB und mit PNG-Kennung, und legt sie einen Tag lang im Ordner der Freunde ab. Die Oberfläche lädt nichts selbst.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures::future::BoxFuture;

use super::config::friends_dir;
use super::sanitize;
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::skins::{parse_player_skin, SESSION_PROFILE};
use crate::services::{data_url, modrinth, write_atomic, Dirs};

const SKIN_MAX_BYTES: u64 = 64 * 1024;
const PROFILE_MAX_BYTES: u64 = 64 * 1024;
const CACHE_MAX_AGE: Duration = Duration::from_secs(24 * 3600);
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Die zwei Abrufe bei Mojang; Tests setzen einen Fake ein.
pub trait MojangSource: Send + Sync {
    /// Antwort des Session-Servers für das Profil mit der UUID `mc_uuid`.
    fn session_profile<'a>(&'a self, mc_uuid: &'a str) -> BoxFuture<'a, AppResult<Vec<u8>>>;
    /// Bytes unter `url`, die schon als Adresse des Texturservers geprüft ist.
    fn texture<'a>(&'a self, url: &'a str) -> BoxFuture<'a, AppResult<Vec<u8>>>;
}

struct MojangHttp<'a>(&'a reqwest::Client);

impl MojangSource for MojangHttp<'_> {
    fn session_profile<'a>(&'a self, mc_uuid: &'a str) -> BoxFuture<'a, AppResult<Vec<u8>>> {
        Box::pin(modrinth::bytes(
            self.0.get(format!("{SESSION_PROFILE}{mc_uuid}")),
            PROFILE_MAX_BYTES,
        ))
    }

    fn texture<'a>(&'a self, url: &'a str) -> BoxFuture<'a, AppResult<Vec<u8>>> {
        Box::pin(modrinth::bytes(self.0.get(url), SKIN_MAX_BYTES))
    }
}

/// Der Skin des Spielers als `data:`-URL; `None` bei einer ungültigen UUID und bei Spielern mit Standardskin.
pub async fn skin(http: &reqwest::Client, dirs: &Dirs, mc_uuid: &str) -> AppResult<Option<String>> {
    skin_from(&MojangHttp(http), dirs, mc_uuid).await
}

async fn skin_from(
    source: &dyn MojangSource,
    dirs: &Dirs,
    mc_uuid: &str,
) -> AppResult<Option<String>> {
    let Some(uuid) = sanitize::mc_uuid(Some(mc_uuid)) else {
        return Ok(None);
    };
    let path = cache_path(dirs, &uuid);
    if let Some(png) = fresh_cached(&path) {
        return Ok(Some(data_url("image/png", &png)));
    }
    let Some(png) = download(source, &uuid).await? else {
        return Ok(None);
    };
    fs::create_dir_all(path.parent().unwrap_or(&path))?;
    write_atomic(&path, &png)?;
    Ok(Some(data_url("image/png", &png)))
}

/// `friends/skins/<uuid>.png`; die UUID ist schon als 32 Hex-Zeichen geprüft.
fn cache_path(dirs: &Dirs, uuid: &str) -> PathBuf {
    friends_dir(dirs).join("skins").join(format!("{uuid}.png"))
}

fn fresh_cached(path: &Path) -> Option<Vec<u8>> {
    let age = fs::metadata(path).ok()?.modified().ok()?.elapsed().ok()?;
    if age >= CACHE_MAX_AGE {
        return None;
    }
    fs::read(path).ok()
}

async fn download(source: &dyn MojangSource, uuid: &str) -> AppResult<Option<Vec<u8>>> {
    let profile = source.session_profile(uuid).await?;
    let Some(skin) = parse_player_skin(&profile)? else {
        return Ok(None);
    };
    let png = source.texture(&skin.url).await?;
    ensure_png(&png)?;
    Ok(Some(png))
}

fn ensure_png(bytes: &[u8]) -> AppResult<()> {
    if bytes.len() as u64 > SKIN_MAX_BYTES {
        return Err(AppError::invalid(coded!("errors.app.skin.tooLarge")));
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err(AppError::invalid(coded!("errors.app.skin.notPng")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use base64::Engine;

    use super::super::test_support::{error_key, TempDir};
    use super::*;

    const UUID: &str = "986dec87b7ec47ff89ff033fdb95c4b5";
    const TEXTURE_URL: &str =
        "http://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dc";
    const TEXTURE_URL_HTTPS: &str =
        "https://textures.minecraft.net/texture/1a4af718455d4aab528e7a61f86fa25e6a369d1768dc";

    fn png(extra: usize) -> Vec<u8> {
        [PNG_SIGNATURE, &vec![0u8; extra]].concat()
    }

    fn session_profile(texture_url: &str) -> Vec<u8> {
        let textures =
            serde_json::json!({ "textures": { "SKIN": { "url": texture_url } } }).to_string();
        let value = base64::engine::general_purpose::STANDARD.encode(textures);
        serde_json::to_vec(&serde_json::json!({ "id": UUID, "properties": [{ "name": "textures", "value": value }] })).unwrap()
    }

    struct FakeMojang {
        profile: Vec<u8>,
        texture: Vec<u8>,
        profile_calls: AtomicUsize,
        textures_asked: Mutex<Vec<String>>,
    }

    impl FakeMojang {
        fn serving(profile: Vec<u8>, texture: Vec<u8>) -> Self {
            Self {
                profile,
                texture,
                profile_calls: AtomicUsize::new(0),
                textures_asked: Mutex::default(),
            }
        }

        fn with_skin() -> Self {
            Self::serving(session_profile(TEXTURE_URL), png(100))
        }

        fn profile_calls(&self) -> usize {
            self.profile_calls.load(Ordering::SeqCst)
        }
    }

    impl MojangSource for FakeMojang {
        fn session_profile<'a>(&'a self, _: &'a str) -> BoxFuture<'a, AppResult<Vec<u8>>> {
            self.profile_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(self.profile.clone()) })
        }

        fn texture<'a>(&'a self, url: &'a str) -> BoxFuture<'a, AppResult<Vec<u8>>> {
            self.textures_asked.lock().unwrap().push(url.to_owned());
            Box::pin(async { Ok(self.texture.clone()) })
        }
    }

    fn cached_file(dirs: &Dirs) -> PathBuf {
        cache_path(dirs, UUID)
    }

    #[tokio::test]
    async fn the_skin_comes_back_as_a_data_url_and_is_cached() {
        let dir = TempDir::new();
        let dirs = Dirs::new(dir.path());
        let mojang = FakeMojang::with_skin();

        let first = skin_from(&mojang, &dirs, UUID).await.unwrap().unwrap();
        let second = skin_from(&mojang, &dirs, UUID).await.unwrap().unwrap();

        assert!(first.starts_with("data:image/png;base64,"));
        assert_eq!(first, second);
        assert_eq!(fs::read(cached_file(&dirs)).unwrap(), png(100));
        assert_eq!(
            mojang.profile_calls(),
            1,
            "der zweite Aufruf kommt aus dem Ordner"
        );
        assert_eq!(*mojang.textures_asked.lock().unwrap(), [TEXTURE_URL_HTTPS]);
    }

    #[tokio::test]
    async fn a_cache_older_than_a_day_is_fetched_again() {
        let dir = TempDir::new();
        let dirs = Dirs::new(dir.path());
        let mojang = FakeMojang::with_skin();
        skin_from(&mojang, &dirs, UUID).await.unwrap();
        let old = std::time::SystemTime::now() - CACHE_MAX_AGE - Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(cached_file(&dirs))
            .unwrap()
            .set_modified(old)
            .unwrap();

        skin_from(&mojang, &dirs, UUID).await.unwrap();

        assert_eq!(mojang.profile_calls(), 2);
    }

    #[tokio::test]
    async fn an_invalid_uuid_asks_nobody() {
        let dir = TempDir::new();
        let mojang = FakeMojang::with_skin();

        for bad in [
            "",
            "../etc/passwd",
            &UUID.to_uppercase(),
            "986dec87-b7ec-47ff-89ff-033fdb95c4b5",
        ] {
            assert_eq!(
                skin_from(&mojang, &Dirs::new(dir.path()), bad)
                    .await
                    .unwrap(),
                None,
                "{bad}"
            );
        }

        assert_eq!(mojang.profile_calls(), 0);
    }

    #[tokio::test]
    async fn a_player_with_the_default_skin_has_none_and_nothing_is_cached() {
        let dir = TempDir::new();
        let dirs = Dirs::new(dir.path());
        let profile =
            serde_json::to_vec(&serde_json::json!({ "id": UUID, "properties": [] })).unwrap();
        let mojang = FakeMojang::serving(profile, png(0));

        assert_eq!(skin_from(&mojang, &dirs, UUID).await.unwrap(), None);

        assert!(!cached_file(&dirs).exists());
        assert!(mojang.textures_asked.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn textures_come_only_from_the_mojang_texture_server() {
        let dir = TempDir::new();
        let dirs = Dirs::new(dir.path());
        for url in [
            "http://evil.example/texture/abcd",
            "https://textures.minecraft.net.evil.example/texture/abcd",
            "https://textures.minecraft.net/other/abcd",
            "https://textures.minecraft.net/texture/not-hex",
        ] {
            let mojang = FakeMojang::serving(session_profile(url), png(10));

            assert!(skin_from(&mojang, &dirs, UUID).await.is_err(), "{url}");
            assert!(mojang.textures_asked.lock().unwrap().is_empty(), "{url}");
        }
        assert!(!cached_file(&dirs).exists());
    }

    #[tokio::test]
    async fn images_over_64_kib_or_without_png_signature_are_refused_and_not_cached() {
        let dir = TempDir::new();
        let dirs = Dirs::new(dir.path());
        let too_big =
            FakeMojang::serving(session_profile(TEXTURE_URL), png(SKIN_MAX_BYTES as usize));
        let not_png =
            FakeMojang::serving(session_profile(TEXTURE_URL), b"GIF89a-not-a-png".to_vec());

        let big_error = skin_from(&too_big, &dirs, UUID).await.unwrap_err();
        let png_error = skin_from(&not_png, &dirs, UUID).await.unwrap_err();

        assert_eq!(error_key(&big_error), "errors.app.skin.tooLarge");
        assert_eq!(error_key(&png_error), "errors.app.skin.notPng");
        assert!(!cached_file(&dirs).exists());
    }

    #[tokio::test]
    async fn an_image_of_exactly_64_kib_is_accepted() {
        let dir = TempDir::new();
        let exact = png(SKIN_MAX_BYTES as usize - PNG_SIGNATURE.len());
        let mojang = FakeMojang::serving(session_profile(TEXTURE_URL), exact);

        assert!(skin_from(&mojang, &Dirs::new(dir.path()), UUID)
            .await
            .unwrap()
            .is_some());
    }
}
