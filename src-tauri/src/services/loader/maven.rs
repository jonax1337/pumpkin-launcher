//! Maven-Repositories der Loader: Koordinaten als Pfade, Artefakt-URLs und ihre `.sha1`-Dateien.
use super::segment;
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::download::{self, is_sha1};

/// Eine `.sha1`-Datei hat 40 Hex-Zeichen, höchstens ein Dateiname dahinter.
const SHA1_FILE_LIMIT: u64 = 4096;

/// `group:artifact:version[:classifier][@ext]` → Pfad im Maven-Repository.
pub fn maven_path(name: &str) -> AppResult<String> {
    let malformed = || AppError::invalid(coded!("errors.game.invalidMavenCoordinate", name = name));
    let (coords, ext) = name.split_once('@').unwrap_or((name, "jar"));
    let parts: Vec<&str> = coords.split(':').collect();
    let [group, artifact, version, rest @ ..] = parts.as_slice() else { return Err(malformed()) };
    if rest.len() > 1 || [*group, *artifact, *version, ext].iter().chain(rest).any(|p| segment(p).is_err()) {
        return Err(malformed());
    }
    let classifier = rest.first().map(|c| format!("-{c}")).unwrap_or_default();
    Ok(format!("{}/{artifact}/{version}/{artifact}-{version}{classifier}.{ext}", group.replace('.', "/")))
}

/// Adresse des Artefakts `name` im Repository `repo` (mit oder ohne abschließendes `/`).
pub fn artifact_url(repo: &str, name: &str) -> AppResult<String> {
    Ok(format!("{}/{}", repo.trim_end_matches('/'), maven_path(name)?))
}

/// Schlüssel für Duplikate: Koordinate ohne Version (`group:artifact[:classifier]`).
pub fn library_key(name: &str) -> String {
    let mut parts: Vec<&str> = name.split('@').next().unwrap_or(name).split(':').collect();
    if parts.len() >= 3 {
        parts.remove(2);
    }
    parts.join(":")
}

/// SHA-1 einer Maven-Datei aus der danebenliegenden `<url>.sha1`.
pub async fn maven_sha1(client: &reqwest::Client, url: &str) -> AppResult<String> {
    let url = format!("{url}.sha1");
    let bytes = download::get_capped(client, &url, SHA1_FILE_LIMIT).await?;
    let text = String::from_utf8_lossy(&bytes);
    let sha1 = text.split_whitespace().next().unwrap_or_default();
    if !is_sha1(sha1) {
        return Err(AppError::Download(coded!("errors.game.noSha1", url = url).into()));
    }
    Ok(sha1.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maven_paths() {
        assert_eq!(maven_path("net.fabricmc:fabric-loader:0.19.5").unwrap(), "net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar");
        assert_eq!(maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows").unwrap(), "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar");
        assert_eq!(maven_path("a.b:c:1@zip").unwrap(), "a/b/c/1/c-1.zip");
        for bad in ["a:b", "a:..:1", "a:b:1:c:d", "a/b:c:1", ":b:1"] {
            assert!(maven_path(bad).is_err(), "{bad}");
        }
        assert_eq!(library_key("org.ow2.asm:asm:9.10.1"), "org.ow2.asm:asm");
        assert_eq!(library_key("org.lwjgl:lwjgl:3.3.3:natives-windows"), "org.lwjgl:lwjgl:natives-windows");
        assert_eq!(artifact_url("https://maven.fabricmc.net/", "a.b:c:1").unwrap(), "https://maven.fabricmc.net/a/b/c/1/c-1.jar");
    }
}
