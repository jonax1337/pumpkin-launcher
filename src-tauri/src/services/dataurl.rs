//! `data:`-URLs, damit die Oberfläche Bilder ohne eigene Datei-Freigabe anzeigen kann.
use base64::Engine;

/// Präfix einer `data:`-URL mit base64-codiertem PNG.
pub(crate) const PNG_DATA_URL: &str = "data:image/png;base64,";

/// Bytes als `data:`-URL.
pub(crate) fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Der Medientyp, wenn die Bytes mit der Signatur eines Bildformats beginnen, das die Oberfläche anzeigen kann (PNG, JPEG,
/// GIF, WebP). Erst diese Kennung macht aus beliebigen Bytes aus fremden Quellen ein Bild.
pub(crate) fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_image_formats_the_interface_shows_are_recognised_by_their_signature() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0, 0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a.."), Some("image/gif"));
        assert_eq!(image_mime(b"RIFF\x10\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_mime(b"RIFF\x10\0\0\0WAVEfmt "), None);
        assert_eq!(image_mime(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), None);
        assert_eq!(image_mime(b""), None);
    }
}
