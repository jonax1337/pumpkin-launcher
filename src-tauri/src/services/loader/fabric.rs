//! Fabric und Quilt über ihre Meta-Server (meta.fabricmc.net/v2, meta.quiltmc.org/v3): Loader-Versionen
//! je Minecraft-Version und das Launcher-Profil, eine Versions-JSON mit `inheritsFrom` auf die
//! Vanilla-Version. Beide Meta-Server liefern dasselbe Format.
use serde::{Deserialize, Serialize};

use super::maven::{artifact_url, maven_path, maven_sha1};
use super::{compare_versions, save_profile, segment, LoaderProfile, LoaderTarget, LoaderVersion};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::ModLoader;
use crate::services::download::{self, is_sha1};
use crate::services::mojang::{Argument, Download, Library};
use crate::services::Dirs;

/// Meta-Server von Fabric bzw. seinem Fork Quilt und das Präfix ihrer Profil-IDs.
struct Meta {
    url: &'static str,
    id_prefix: &'static str,
}

const FABRIC: Meta = Meta { url: "https://meta.fabricmc.net/v2", id_prefix: "fabric-loader" };
const QUILT: Meta = Meta { url: "https://meta.quiltmc.org/v3", id_prefix: "quilt-loader" };

/// Meta-Server des Loaders; dieses Modul bedient nur Fabric und Quilt.
fn meta(loader: ModLoader) -> &'static Meta {
    if loader == ModLoader::Quilt {
        &QUILT
    } else {
        &FABRIC
    }
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

impl MavenLibrary {
    fn artifact_url(&self) -> AppResult<String> {
        artifact_url(&self.url, &self.name)
    }

    fn to_library(&self) -> AppResult<Library> {
        let sha1 = self.sha1.clone().filter(|s| is_sha1(s));
        let sha1 = sha1.ok_or_else(|| AppError::invalid(coded!("errors.game.loaderLibraryWithoutSha1", name = self.name)))?;
        Ok(Library::from_artifact(&self.name, Download { path: Some(maven_path(&self.name)?), sha1, url: self.artifact_url()? }))
    }
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

impl LoaderProfile for Profile {
    /// `fabric-loader-<loader>-<mc>` bzw. `quilt-loader-…`.
    fn id_for(target: LoaderTarget) -> String {
        format!("{}-{}-{}", meta(target.loader).id_prefix, target.version, target.mc)
    }

    fn inherits_from(&self) -> &str {
        &self.inherits_from
    }

    fn main_class(&self) -> &str {
        &self.main_class
    }

    fn libraries(&self) -> AppResult<Vec<Library>> {
        self.libraries.iter().map(MavenLibrary::to_library).collect()
    }

    fn arguments(&self) -> (Vec<Argument>, Vec<Argument>) {
        let plain = |v: &[String]| v.iter().cloned().map(Argument::Plain).collect::<Vec<_>>();
        (plain(&self.arguments.jvm), plain(&self.arguments.game))
    }
}

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst. Unbekannte Version → leere Liste.
pub(super) async fn loader_versions(client: &reqwest::Client, loader: ModLoader, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    let url = format!("{}/versions/loader/{}", meta(loader).url, segment(mc)?);
    let entries: Vec<LoaderEntry> = download::get_json(client, &url).await?;
    let versions = entries.into_iter().map(|e| e.loader);
    if loader != ModLoader::Quilt {
        return Ok(versions.collect());
    }
    // Quilt-Meta liefert ungeordnet und ohne `stable`.
    let mut versions: Vec<LoaderVersion> = versions.map(|v| LoaderVersion::from_tag(v.version)).collect();
    versions.sort_by(|a, b| compare_versions(&b.version, &a.version));
    Ok(versions)
}

/// Lädt das Profil, ergänzt fehlende SHA-1 aus den `.sha1`-Dateien des Maven-Repos und cacht es
/// unter `versions/<profil-id>/<profil-id>.json` (für den Start ohne Netz).
pub(super) async fn fetch_profile(client: &reqwest::Client, dirs: &Dirs, target: LoaderTarget<'_>) -> AppResult<Profile> {
    let url = format!("{}/versions/loader/{}/{}/profile/json", meta(target.loader).url, target.mc, target.version);
    let mut profile: Profile = download::get_json(client, &url).await.map_err(|err| target.unknown_on_client_error(err))?;
    if profile.inherits_from != target.mc {
        return Err(AppError::invalid(coded!(
            "errors.game.loaderProfileInherits",
            loader = target.name(),
            inherits = profile.inherits_from,
            mc = target.mc
        )));
    }
    for lib in profile.libraries.iter_mut().filter(|l| l.sha1.is_none()) {
        lib.sha1 = Some(maven_sha1(client, &lib.artifact_url()?).await?);
    }
    save_profile::<Profile>(dirs, target, &serde_json::to_vec_pretty(&profile)?).await?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::launch;
    use crate::services::loader::merge;
    use crate::services::loader::test_support::vanilla_version;
    use crate::services::rules::Env;

    #[test]
    fn profile_ids_name_flavor_loader_and_minecraft() {
        let quilt = LoaderTarget::new(ModLoader::Quilt, "1.21.1", "0.29.2").unwrap();
        assert_eq!(Profile::id_for(quilt), "quilt-loader-0.29.2-1.21.1");
        let fabric = LoaderTarget::new(ModLoader::Fabric, "1.21.11", "0.19.5").unwrap();
        assert_eq!(Profile::id_for(fabric), "fabric-loader-0.19.5-1.21.11");
    }

    #[test]
    fn merge_with_vanilla() {
        let vanilla = vanilla_version("1.21.11");
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
        let cp = launch::classpath(&merged, &Dirs::new("/d"), &Env { os: "linux", arch: "x86_64", features: Vec::new() });
        assert_eq!(cp.len(), 4);
        assert_eq!(cp.last(), Some(&Dirs::new("/d").version_file("1.21.11", "jar")));
        assert_eq!(merged.java_component(), vanilla.java_component());

        let other = Profile { inherits_from: "1.20.1".into(), ..profile.clone() };
        assert!(merge(vanilla.clone(), &other).is_err());
        let mut no_sha = profile;
        no_sha.libraries[0].sha1 = None;
        assert!(merge(vanilla, &no_sha).is_err());
    }
}
