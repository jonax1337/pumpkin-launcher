//! Das Icon einer Instanz für ihre Desktop-Verknüpfung. Gezeichnet wird es von der Oberfläche (eigenes Bild,
//! Modpack-Icon oder Pixel-Icon); hier wird das PNG geprüft und je nach System als `.ico` (Windows) oder `.png`
//! (Linux, macOS) im Datenordner des Launchers abgelegt. Dort liegt es dauerhaft, denn die Verknüpfung verweist darauf.
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;

use super::limits::ICON_LIMIT;
use super::providers::{self, Source};
use super::{modrinth, remote_icon, require_plain_name, write_atomic, Dirs, PNG_DATA_URL};
use crate::error::AppResult;
use crate::models::{Instance, ModpackOrigin};

const MIN_SIDE: u32 = 16;
/// Größte Kantenlänge, die ein Eintrag einer `.ico`-Datei nennen kann (das Byte 0 steht für 256).
const MAX_SIDE: u32 = 256;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
/// Bis hierhin reichen Signatur und der Anfang des ersten Blocks (`IHDR`) mit Breite und Höhe.
const PNG_HEADER_LEN: usize = 24;
const ICO_BITS_PER_PIXEL: u16 = 32;
/// Der Eintrag der Bilddaten folgt dem Kopf (6 Bytes) und dem einen Verzeichniseintrag (16 Bytes).
const ICO_IMAGE_OFFSET: u32 = 22;

/// Ein geprüftes, quadratisches PNG von 16 bis 256 Pixeln Kantenlänge.
pub struct IconPng {
    bytes: Vec<u8>,
    side: u32,
}

impl IconPng {
    /// `None`, wenn die `data:`-URL kein solches PNG trägt oder größer als erlaubt ist.
    pub fn from_data_url(url: &str) -> Option<Self> {
        let encoded = url.strip_prefix(PNG_DATA_URL)?;
        // base64 braucht für drei Bytes vier Zeichen.
        if encoded.len() as u64 > ICON_LIMIT / 3 * 4 + 4 {
            return None;
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
        let side = square_side(&bytes)?;
        Some(Self { bytes, side })
    }

    /// Eine `.ico`-Datei mit genau diesem PNG als einzigem Bild (ab Windows Vista erlaubt).
    fn to_ico(&self) -> Vec<u8> {
        let edge = if self.side == MAX_SIDE { 0 } else { self.side as u8 };
        let mut ico = Vec::with_capacity(ICO_IMAGE_OFFSET as usize + self.bytes.len());
        ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]); // reserviert, Art „Icon“, ein Bild
        ico.extend_from_slice(&[edge, edge, 0, 0]); // Breite, Höhe, Farben der Tabelle, reserviert
        ico.extend_from_slice(&1u16.to_le_bytes()); // Farbebenen
        ico.extend_from_slice(&ICO_BITS_PER_PIXEL.to_le_bytes());
        ico.extend_from_slice(&(self.bytes.len() as u32).to_le_bytes());
        ico.extend_from_slice(&ICO_IMAGE_OFFSET.to_le_bytes());
        ico.extend_from_slice(&self.bytes);
        ico
    }
}

/// Kantenlänge des PNG, wenn es quadratisch ist und im erlaubten Bereich liegt.
fn square_side(png: &[u8]) -> Option<u32> {
    let header = png.get(..PNG_HEADER_LEN)?;
    if !header.starts_with(PNG_SIGNATURE) || &header[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(header[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(header[20..24].try_into().ok()?);
    (width == height && (MIN_SIDE..=MAX_SIDE).contains(&width)).then_some(width)
}

/// Legt das Icon der Instanz in `dir` ab, ersetzt ein früheres und liefert den Pfad. Der Name folgt aus der Kennung der
/// Instanz, die erneute Verknüpfung nimmt also das aktuelle Icon.
pub fn store(dir: &Path, instance_id: &str, icon: &IconPng) -> AppResult<PathBuf> {
    require_plain_name(instance_id)?;
    fs::create_dir_all(dir)?;
    let ico;
    let (extension, content): (&str, &[u8]) = if cfg!(windows) {
        ico = icon.to_ico();
        ("ico", &ico)
    } else {
        ("png", &icon.bytes)
    };
    let path = dir.join(format!("{instance_id}.{extension}"));
    write_atomic(&path, content)?;
    Ok(path)
}

/// Das Icon des Modpacks, aus dem die Instanz stammt, als `data:`-URL für die Oberfläche; `None` ohne Pack und ohne Icon.
/// Die Oberfläche kann Fremdbilder nicht selbst lesen (die Inhaltsrichtlinie erlaubt nur Anzeige), also lädt das Backend es.
/// Das Bild wird danach als Datei der Verknüpfung abgelegt, auch das von CurseForge.
pub async fn pack_icon(client: &reqwest::Client, dirs: &Dirs, instance: &Instance) -> AppResult<Option<String>> {
    match pack_icon_url(client, instance).await? {
        Some(url) => remote_icon::fetch(dirs, &url).await,
        None => Ok(None),
    }
}

async fn pack_icon_url(client: &reqwest::Client, instance: &Instance) -> AppResult<Option<String>> {
    let project = match &instance.modpack {
        Some(ModpackOrigin::Modrinth { project_id, .. }) => modrinth::project(client, project_id).await?,
        Some(ModpackOrigin::CurseForge { project_id, .. }) => providers::project(client, Source::CurseForge, &project_id.to_string()).await?,
        Some(ModpackOrigin::Provider { source, project_id, .. }) => match Source::parse(source) {
            Ok(source) => providers::project(client, source, project_id).await?,
            Err(_) => return Ok(None),
        },
        Some(ModpackOrigin::File { .. }) | None => return Ok(None),
    };
    Ok(project.icon_url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::new_id;
    use crate::services::data_url;

    /// Signatur und Anfang des `IHDR`-Blocks eines PNG; mehr liest die Prüfung nicht.
    fn png_of(width: u32, height: u32) -> Vec<u8> {
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        png
    }

    fn url_of(bytes: &[u8]) -> String {
        data_url("image/png", bytes)
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(new_id())
    }

    #[test]
    fn only_square_pngs_within_the_icon_sizes_pass() {
        for side in [16, 48, 128, 256] {
            assert!(IconPng::from_data_url(&url_of(&png_of(side, side))).is_some(), "{side}");
        }
        for (width, height) in [(15, 15), (257, 257), (512, 512), (256, 128), (0, 0)] {
            assert!(IconPng::from_data_url(&url_of(&png_of(width, height))).is_none(), "{width}x{height}");
        }
    }

    #[test]
    fn anything_but_a_png_data_url_is_refused() {
        let png = png_of(64, 64);
        let gif = data_url("image/gif", &png);
        let truncated = url_of(&png[..PNG_HEADER_LEN - 1]);
        let not_a_png = url_of(&[b'x'; 40]);
        let broken_base64 = format!("{PNG_DATA_URL}!!!");
        let too_large = format!("{PNG_DATA_URL}{}", "A".repeat(ICON_LIMIT as usize * 2));
        for bad in [gif, truncated, not_a_png, broken_base64, too_large, "https://example.net/a.png".to_owned()] {
            assert!(IconPng::from_data_url(&bad).is_none(), "{}", &bad[..bad.len().min(40)]);
        }
    }

    #[test]
    fn an_ico_carries_the_png_unchanged_as_its_only_image() {
        let png = png_of(64, 64);
        let ico = IconPng::from_data_url(&url_of(&png)).unwrap().to_ico();

        assert_eq!(&ico[..6], [0, 0, 1, 0, 1, 0]);
        assert_eq!(&ico[6..10], [64, 64, 0, 0]);
        assert_eq!(u16::from_le_bytes([ico[10], ico[11]]), 1);
        assert_eq!(u16::from_le_bytes([ico[12], ico[13]]), 32);
        assert_eq!(u32::from_le_bytes(ico[14..18].try_into().unwrap()) as usize, png.len());
        assert_eq!(u32::from_le_bytes(ico[18..22].try_into().unwrap()), 22);
        assert_eq!(&ico[22..], png);
    }

    #[test]
    fn the_largest_icon_size_is_written_as_zero() {
        let ico = IconPng::from_data_url(&url_of(&png_of(256, 256))).unwrap().to_ico();

        assert_eq!(&ico[6..8], [0, 0]);
    }

    #[test]
    fn storing_replaces_the_earlier_icon_of_the_instance_and_names_it_after_the_instance() {
        let dir = temp_dir();
        let first = IconPng::from_data_url(&url_of(&png_of(32, 32))).unwrap();
        let second = IconPng::from_data_url(&url_of(&png_of(64, 64))).unwrap();

        let path = store(&dir, "abc-1", &first).unwrap();
        let again = store(&dir, "abc-1", &second).unwrap();

        assert_eq!(path, again);
        assert_eq!(path.file_name().unwrap(), if cfg!(windows) { "abc-1.ico" } else { "abc-1.png" });
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "kein Rest der temporären Datei");
        assert_eq!(fs::read(&path).unwrap().len(), if cfg!(windows) { 22 + png_of(64, 64).len() } else { png_of(64, 64).len() });
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_instance_id_cannot_leave_the_icon_folder() {
        let dir = temp_dir();
        let icon = IconPng::from_data_url(&url_of(&png_of(32, 32))).unwrap();

        assert!(store(&dir, "../x", &icon).is_err());
        assert!(store(&dir, "a/b", &icon).is_err());
    }
}
