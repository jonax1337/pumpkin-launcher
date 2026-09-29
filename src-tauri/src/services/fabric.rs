//! Fabric und Quilt über ihre Meta-Server (meta.fabricmc.net/v2, meta.quiltmc.org/v3): Loader-Versionen
//! je Minecraft-Version und das Launcher-Profil, eine Versions-JSON mit `inheritsFrom` auf die
//! Vanilla-Version, die hier mit ihr zusammengeführt wird. Beide Meta-Server liefern dasselbe Format.
use std::cmp::Ordering;
use std::collections::HashSet;
use std::io;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::download;
use crate::services::mojang::{Argument, Download, Library, LibraryDownloads, VersionJson};
use crate::services::Dirs;

/// Fabric oder sein Fork Quilt: gleiches Profilformat, anderer Meta-Server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    Fabric,
    Quilt,
}

impl Flavor {
    fn meta_url(self) -> &'static str {
        match self {
            Self::Fabric => "https://meta.fabricmc.net/v2",
            Self::Quilt => "https://meta.quiltmc.org/v3",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Fabric => "Fabric",
            Self::Quilt => "Quilt",
        }
    }

    fn id_prefix(self) -> &'static str {
        match self {
            Self::Fabric => "fabric-loader",
            Self::Quilt => "quilt-loader",
        }
    }
}

/// Loader-Version für das Frontend (`loader_versions`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersion {
    pub version: String,
    /// Quilt-Meta kennt kein `stable`; dort gilt eine Version ohne Zusatz (`-beta.3`) als stabil.
    #[serde(default)]
    pub stable: bool,
}

#[derive(Deserialize)]
struct LoaderEntry {
    loader: LoaderVersion,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileArguments {
    #[serde(default)]
    pub game: Vec<String>,
    #[serde(default)]
    pub jvm: Vec<String>,
}

/// Library als Maven-Koordinate plus Repository; `sha1` fehlt bei Fabric für Loader und Intermediary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MavenLibrary {
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha1: Option<String>,
}

/// Der Teil des Profils, den wir brauchen. Wird mit ergänzten SHA-1 lokal gecacht.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub inherits_from: String,
    pub main_class: String,
    #[serde(default)]
    pub arguments: ProfileArguments,
    pub libraries: Vec<MavenLibrary>,
}

/// Versions-IDs landen in URLs und Pfaden: nur einzelne, harmlose Segmente zulassen.
pub fn segment(s: &str) -> AppResult<&str> {
    if s.is_empty() || s.contains("..") || s.contains(['/', '\\', '?', '#', '%', ':']) {
        return Err(AppError::Invalid(format!("ungültige Version '{s}'")));
    }
    Ok(s)
}

pub fn is_sha1(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Versionsvergleich für Loader-Versionen (`0.29.2` > `0.29.2-beta.4` > `0.28.10`): Zahlen
/// numerisch, eine Vorabversion (`-…`) liegt vor derselben Version ohne Zusatz.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let split = |v: &str| {
        let (main, pre) = v.split_once('-').map_or((v, None), |(m, p)| (m, Some(p.to_owned())));
        let nums: Vec<u64> = main.split(['.', '+']).map(|p| p.parse().unwrap_or(0)).collect();
        (nums, pre)
    };
    let ((na, pa), (nb, pb)) = (split(a), split(b));
    na.cmp(&nb).then_with(|| match (pa, pb) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            let num = |s: &str| s.rsplit('.').next().and_then(|t| t.parse::<u64>().ok()).unwrap_or(0);
            x.split('.').next().cmp(&y.split('.').next()).then(num(&x).cmp(&num(&y)))
        }
    })
}

/// `group:artifact:version[:classifier][@ext]` → Pfad im Maven-Repository.
pub fn maven_path(name: &str) -> AppResult<String> {
    let invalid = || AppError::Invalid(format!("ungültige Maven-Koordinate '{name}'"));
    let (coords, ext) = name.split_once('@').unwrap_or((name, "jar"));
    let parts: Vec<&str> = coords.split(':').collect();
    let [group, artifact, version, rest @ ..] = parts.as_slice() else { return Err(invalid()) };
    if rest.len() > 1 || [*group, *artifact, *version, ext].iter().chain(rest).any(|p| segment(p).is_err()) {
        return Err(invalid());
    }
    let classifier = rest.first().map(|c| format!("-{c}")).unwrap_or_default();
    Ok(format!("{}/{artifact}/{version}/{artifact}-{version}{classifier}.{ext}", group.replace('.', "/")))
}

/// Schlüssel für Duplikate: Koordinate ohne Version (`group:artifact[:classifier]`).
pub fn library_key(name: &str) -> String {
    let mut parts: Vec<&str> = name.split('@').next().unwrap_or(name).split(':').collect();
    if parts.len() >= 3 {
        parts.remove(2);
    }
    parts.join(":")
}

fn artifact_url(lib: &MavenLibrary) -> AppResult<String> {
    Ok(format!("{}/{}", lib.url.trim_end_matches('/'), maven_path(&lib.name)?))
}

/// SHA-1 einer Maven-Datei aus der danebenliegenden `<url>.sha1`.
pub async fn maven_sha1(client: &reqwest::Client, url: &str) -> AppResult<String> {
    let url = format!("{url}.sha1");
    let text = client.get(&url).send().await?.error_for_status()?.text().await?;
    let sha1 = text.split_whitespace().next().unwrap_or_default();
    if !is_sha1(sha1) {
        return Err(AppError::Download(format!("{url}: keine SHA-1")));
    }
    Ok(sha1.to_ascii_lowercase())
}

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst. Unbekannte Version → leere Liste.
pub async fn loader_versions(client: &reqwest::Client, flavor: Flavor, mc_version: &str) -> AppResult<Vec<LoaderVersion>> {
    let url = format!("{}/versions/loader/{}", flavor.meta_url(), segment(mc_version)?);
    let entries: Vec<LoaderEntry> = download::get_json(client, &url).await?;
    let mut versions: Vec<LoaderVersion> = entries.into_iter().map(|e| e.loader).collect();
    if flavor == Flavor::Quilt {
        // Quilt-Meta liefert ungeordnet und ohne `stable`.
        for v in &mut versions {
            v.stable = !v.version.contains('-');
        }
        versions.sort_by(|a, b| compare_versions(&b.version, &a.version));
    }
    Ok(versions)
}

/// Die gewünschte Loader-Version oder, ohne Wunsch, die neueste stabile.
pub async fn resolve_loader(client: &reqwest::Client, flavor: Flavor, mc_version: &str, wanted: Option<&str>) -> AppResult<String> {
    if let Some(v) = wanted.filter(|v| !v.trim().is_empty()) {
        return Ok(segment(v.trim())?.to_owned());
    }
    loader_versions(client, flavor, mc_version)
        .await?
        .into_iter()
        .find(|v| v.stable)
        .map(|v| v.version)
        .ok_or_else(|| AppError::NotFound { kind: "Loader für Minecraft", id: format!("{} {mc_version}", flavor.name()) })
}

/// `fabric-loader-<loader>-<mc>` bzw. `quilt-loader-…`, wie die ID im Profil selbst.
pub fn profile_id(flavor: Flavor, mc_version: &str, loader: &str) -> String {
    format!("{}-{loader}-{mc_version}", flavor.id_prefix())
}

/// Lädt das Profil, ergänzt fehlende SHA-1 aus den `.sha1`-Dateien des Maven-Repos und cacht es
/// unter `versions/<profil-id>/<profil-id>.json` (für den Start ohne Netz).
pub async fn fetch_profile(client: &reqwest::Client, dirs: &Dirs, flavor: Flavor, mc_version: &str, loader: &str) -> AppResult<Profile> {
    let url = format!("{}/versions/loader/{}/{}/profile/json", flavor.meta_url(), segment(mc_version)?, segment(loader)?);
    let mut profile: Profile = download::get_json(client, &url).await.map_err(|err| match err {
        AppError::Http(e) if e.status().is_some_and(|s| s.is_client_error()) => {
            AppError::NotFound { kind: "Loader", id: format!("{} {loader} für Minecraft {mc_version}", flavor.name()) }
        }
        other => other,
    })?;
    if profile.inherits_from != mc_version {
        return Err(AppError::Invalid(format!("{}-Profil erbt von {} statt {mc_version}", flavor.name(), profile.inherits_from)));
    }
    for lib in profile.libraries.iter_mut().filter(|l| l.sha1.is_none()) {
        lib.sha1 = Some(maven_sha1(client, &artifact_url(lib)?).await?);
    }
    let path = dirs.version_file(&profile_id(flavor, mc_version, loader), "json");
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, serde_json::to_vec_pretty(&profile)?).await?;
    Ok(profile)
}

/// Liest ein bereits installiertes Profil.
pub async fn installed_profile(dirs: &Dirs, flavor: Flavor, mc_version: &str, loader: &str) -> AppResult<Profile> {
    let path = dirs.version_file(&profile_id(flavor, segment(mc_version)?, segment(loader)?), "json");
    download::read_json(&path).await.map_err(|err| match err {
        AppError::Io(e) if e.kind() == io::ErrorKind::NotFound => {
            AppError::Invalid(format!("{} {loader} für {mc_version} ist nicht installiert", flavor.name()))
        }
        other => other,
    })
}

/// Vanilla-Versions-JSON plus Profil: Loader-Main-Class, Loader-Libraries vor den Vanilla-
/// Libraries (bei gleicher Koordinate ersetzt der Loader die Vanilla-Library), Argumente angehängt.
/// Die ID bleibt die Vanilla-ID, weil Client-JAR und Assets daran hängen.
pub fn merge(version: VersionJson, profile: &Profile) -> AppResult<VersionJson> {
    if profile.inherits_from != version.id {
        return Err(AppError::Invalid(format!("Loader-Profil erbt von {} statt {}", profile.inherits_from, version.id)));
    }
    let mut libraries = Vec::with_capacity(profile.libraries.len());
    for lib in &profile.libraries {
        let sha1 = lib.sha1.clone().filter(|s| is_sha1(s));
        let sha1 = sha1.ok_or_else(|| AppError::Invalid(format!("Loader-Library {} ohne SHA-1", lib.name)))?;
        libraries.push(Library {
            name: lib.name.clone(),
            downloads: LibraryDownloads {
                artifact: Some(Download { path: Some(maven_path(&lib.name)?), sha1, url: artifact_url(lib)? }),
                classifiers: Default::default(),
            },
            rules: Vec::new(),
            natives: Default::default(),
            extract: Default::default(),
        });
    }
    let plain = |v: &[String]| v.iter().cloned().map(Argument::Plain).collect::<Vec<_>>();
    Ok(merge_parts(version, libraries, &profile.main_class, plain(&profile.arguments.jvm), plain(&profile.arguments.game)))
}

/// Gemeinsamer Teil für alle Loader: Loader-Libraries vorne (ersetzen gleiche Koordinaten der
/// Vanilla-Libraries), Main-Class tauschen, Argumente anhängen.
pub fn merge_parts(mut version: VersionJson, libraries: Vec<Library>, main_class: &str, jvm: Vec<Argument>, game: Vec<Argument>) -> VersionJson {
    let loader: HashSet<String> = libraries.iter().map(|l| library_key(&l.name)).collect();
    let vanilla = std::mem::take(&mut version.libraries);
    version.libraries = libraries;
    version.libraries.extend(vanilla.into_iter().filter(|l| !loader.contains(&library_key(&l.name))));
    version.main_class = main_class.to_owned();
    // Loader-Profile gibt es nur für Versionen mit `arguments`; das Legacy-Format
    // (`minecraftArguments`) bekommt daher keine Profil-Argumente.
    if let Some(args) = version.arguments.as_mut() {
        args.jvm.extend(jvm);
        args.game.extend(game);
    }
    version
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::install;
    use crate::services::rules::Env;

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
    }

    #[test]
    fn version_order() {
        let mut v = ["0.28.10", "0.29.2-beta.4", "0.29.2", "0.29.2-beta.10", "0.20.0-beta.9", "0.9.1"];
        v.sort_by(|a, b| compare_versions(b, a));
        assert_eq!(v, ["0.29.2", "0.29.2-beta.10", "0.29.2-beta.4", "0.28.10", "0.20.0-beta.9", "0.9.1"]);
        assert_eq!(profile_id(Flavor::Quilt, "1.21.1", "0.29.2"), "quilt-loader-0.29.2-1.21.1");
    }

    #[test]
    fn merge_with_vanilla() {
        let vanilla: VersionJson = serde_json::from_value(serde_json::json!({
            "id": "1.21.11", "type": "release", "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "29", "sha1": "x", "url": "u"},
            "downloads": {"client": {"sha1": "x", "url": "u"}},
            "libraries": [
                {"name": "org.ow2.asm:asm:9.6", "downloads": {"artifact": {"path": "org/ow2/asm/asm/9.6/asm-9.6.jar", "sha1": "x", "url": "u"}}},
                {"name": "com.mojang:brigadier:1.3.10", "downloads": {"artifact": {"path": "com/mojang/brigadier/1.3.10/brigadier-1.3.10.jar", "sha1": "x", "url": "u"}}}
            ],
            "arguments": {"jvm": ["-cp", "${classpath}"], "game": ["--version", "${version_name}"]}
        }))
        .unwrap();
        // Auszug aus dem echten Profil von meta.fabricmc.net (1.21.11, Loader 0.19.5).
        let profile: Profile = serde_json::from_value(serde_json::json!({
            "id": "fabric-loader-0.19.5-1.21.11", "inheritsFrom": "1.21.11", "type": "release",
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "arguments": {"game": [], "jvm": ["-DFabricMcEmu= net.minecraft.client.main.Main "]},
            "libraries": [
                {"name": "org.ow2.asm:asm:9.10.1", "url": "https://maven.fabricmc.net/", "sha1": "ada2141c0cc52ee8f5c48cd5fa4ce0e794f22236"},
                {"name": "net.fabricmc:fabric-loader:0.19.5", "url": "https://maven.fabricmc.net", "sha1": "ff9e65cffca4a67f31523e1807fe0855940fcbfa"}
            ]
        }))
        .unwrap();

        let merged = merge(vanilla.clone(), &profile).unwrap();
        assert_eq!(merged.id, "1.21.11");
        assert_eq!(merged.main_class, "net.fabricmc.loader.impl.launch.knot.KnotClient");
        let names: Vec<_> = merged.libraries.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["org.ow2.asm:asm:9.10.1", "net.fabricmc:fabric-loader:0.19.5", "com.mojang:brigadier:1.3.10"]);
        let loader = merged.libraries[1].downloads.artifact.as_ref().unwrap();
        assert_eq!(loader.url, "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar");
        assert_eq!(loader.path.as_deref(), Some("net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar"));
        assert_eq!(loader.sha1, "ff9e65cffca4a67f31523e1807fe0855940fcbfa");
        let args = merged.arguments.as_ref().unwrap();
        assert!(matches!(args.jvm.last(), Some(Argument::Plain(a)) if a.starts_with("-DFabricMcEmu=")));
        assert_eq!(args.game.len(), 2);
        // Der Classpath enthält die Fabric-JARs und weiter das Vanilla-Client-JAR.
        let cp = crate::services::launch::classpath(&merged, &Dirs::new("/d"), &Env { os: "linux", arch: "x86_64", features: Vec::new() });
        assert_eq!(cp.len(), 4);
        assert_eq!(cp.last(), Some(&Dirs::new("/d").version_file("1.21.11", "jar")));
        assert_eq!(install::java_component(&merged), install::java_component(&vanilla));

        let other = Profile { inherits_from: "1.20.1".into(), ..profile.clone() };
        assert!(merge(vanilla.clone(), &other).is_err());
        let mut no_sha = profile;
        no_sha.libraries[0].sha1 = None;
        assert!(merge(vanilla, &no_sha).is_err());
    }
}
