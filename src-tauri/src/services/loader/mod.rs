//! Mod-Loader: Loader-Versionen, die Installation samt Loader in der nötigen Reihenfolge und die Versions-JSON
//! zum Start. Fabric und Quilt liefern ein fertiges Profil (`fabric`), Forge und NeoForge einen Installer
//! (`forge`). Beide Profile erben per `inheritsFrom` von der Vanilla-Version und werden mit ihr zusammengeführt.
pub mod fabric;
pub mod forge;
mod maven;

use std::cmp::Ordering;
use std::collections::HashSet;
use std::fmt;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::{Instance, ModLoader};
use crate::services::install::{self, InstallStep, OnProgress};
use crate::services::mojang::{Argument, Library, VersionJson};
use crate::services::{download, Dirs};
use maven::library_key;

/// Loader-Version für das Frontend (`loader_versions`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersion {
    pub version: String,
    /// Quilt-Meta kennt kein `stable`; dort gilt eine Version ohne Zusatz (`-beta.3`) als stabil.
    #[serde(default)]
    pub stable: bool,
}

impl LoaderVersion {
    /// Stabil ist eine Version ohne Zusatz wie `-beta.3`.
    fn from_tag(version: String) -> Self {
        Self { stable: !version.contains('-'), version }
    }
}

/// Minecraft-Version mit Mod-Loader, wie eine Instanz sie wählt.
#[derive(Debug, Clone, Copy)]
pub struct GameChoice<'a> {
    pub mc: &'a str,
    pub loader: ModLoader,
    /// Ohne Angabe installiert `plan_install` die neueste stabile Loader-Version.
    pub loader_version: Option<&'a str>,
}

impl<'a> From<&'a Instance> for GameChoice<'a> {
    fn from(instance: &'a Instance) -> Self {
        Self { mc: &instance.minecraft_version, loader: instance.loader, loader_version: instance.loader_version.as_deref() }
    }
}

impl<'a> GameChoice<'a> {
    /// Die gewählte Loader-Version einer installierten Instanz.
    fn installed_target(self) -> AppResult<LoaderTarget<'a>> {
        let version =
            self.loader_version.ok_or_else(|| AppError::invalid(coded!("errors.game.instanceWithoutLoaderVersion")))?;
        LoaderTarget::new(self.loader, self.mc, version)
    }
}

/// Eine bestimmte Loader-Version für eine Minecraft-Version. Beide landen in URLs und Pfaden, deshalb nur als
/// geprüfte Segmente.
#[derive(Debug, Clone, Copy)]
struct LoaderTarget<'a> {
    loader: ModLoader,
    mc: &'a str,
    version: &'a str,
}

impl<'a> LoaderTarget<'a> {
    fn new(loader: ModLoader, mc: &'a str, version: &'a str) -> AppResult<Self> {
        Ok(Self { loader, mc: segment(mc)?, version: segment(version)? })
    }

    fn name(self) -> &'static str {
        self.loader.display_name()
    }

    /// Lehnt der Server mit 4xx ab, gibt es diese Loader-Version nicht.
    fn unknown_on_client_error(self, err: AppError) -> AppError {
        match err {
            AppError::Http(e) if e.status().is_some_and(|s| s.is_client_error()) => {
                AppError::NotFound(
                    coded!("errors.game.loaderVersionNotFound", loader = self.name(), version = self.version, mc = self.mc).into(),
                )
            }
            other => other,
        }
    }
}

impl fmt::Display for LoaderTarget<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} für {}", self.name(), self.version, self.mc)
    }
}

/// Versions-IDs landen in URLs und Pfaden: nur einzelne, harmlose Segmente zulassen.
fn segment(s: &str) -> AppResult<&str> {
    if s.is_empty() || s.contains("..") || s.contains(['/', '\\', '?', '#', '%', ':']) {
        return Err(AppError::invalid(coded!("errors.game.invalidVersion", version = s)));
    }
    Ok(s)
}

/// Versionsvergleich für Loader-Versionen (`0.29.2` > `0.29.2-beta.4` > `0.28.10`): Zahlen
/// numerisch, eine Vorabversion (`-…`) liegt vor derselben Version ohne Zusatz.
fn compare_versions(a: &str, b: &str) -> Ordering {
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

/// Loader-Versionen zu einer Minecraft-Version, neueste zuerst (Vanilla: keine).
pub async fn versions(client: &reqwest::Client, loader: ModLoader, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    match loader {
        ModLoader::Vanilla => Ok(Vec::new()),
        ModLoader::Fabric | ModLoader::Quilt => fabric::loader_versions(client, loader, mc).await,
        ModLoader::Forge | ModLoader::NeoForge => forge::loader_versions(client, loader, mc).await,
    }
}

/// Die gewünschte Loader-Version oder, ohne Wunsch, die vorgegebene (`default_version`).
async fn resolve_version(client: &reqwest::Client, choice: GameChoice<'_>) -> AppResult<String> {
    if let Some(wanted) = choice.loader_version.map(str::trim).filter(|v| !v.is_empty()) {
        return Ok(segment(wanted)?.to_owned());
    }
    let available = versions(client, choice.loader, choice.mc).await?;
    default_version(choice.loader, &available)
        .map(|v| v.version.clone())
        .ok_or_else(|| {
            AppError::NotFound(
                coded!("errors.game.loaderForMinecraftNotFound", loader = choice.loader.display_name(), mc = choice.mc).into(),
            )
        })
}

/// Die neueste stabile Version; Forge und NeoForge nehmen ohne stabile die neueste überhaupt.
fn default_version(loader: ModLoader, versions: &[LoaderVersion]) -> Option<&LoaderVersion> {
    let newest = |stable_only: bool| versions.iter().filter(|v| !stable_only || v.stable)
        .max_by(|a, b| compare_versions(&a.version, &b.version));
    let stable = newest(true);
    match loader {
        ModLoader::Forge | ModLoader::NeoForge => stable.or_else(|| newest(false)),
        _ => stable,
    }
}

/// Löst die Loader-Version auf und lädt die Versions-JSON, bei Fabric und Quilt schon mit dem Profil
/// zusammengeführt: Die Vanilla-Installation lädt so deren Libraries mit. Die Installation selbst folgt mit
/// [`InstallPlan::install`], vorher kann der Aufrufer die aufgelöste Loader-Version festhalten.
pub async fn plan_install(
    client: &reqwest::Client,
    dirs: &Dirs,
    choice: GameChoice<'_>,
    on_progress: OnProgress<'_>,
) -> AppResult<InstallPlan> {
    let version = install::fetch_version(client, dirs, choice.mc).await?;
    let mut plan = InstallPlan { version, mc: choice.mc.to_owned(), loader: choice.loader, loader_version: None };
    if choice.loader == ModLoader::Vanilla {
        return Ok(plan);
    }
    on_progress(InstallStep::Loader, 0, 1);
    let loader_version = resolve_version(client, choice).await?;
    let target = LoaderTarget::new(choice.loader, choice.mc, &loader_version)?;
    if matches!(choice.loader, ModLoader::Fabric | ModLoader::Quilt) {
        plan.version = merge(plan.version, &fabric::fetch_profile(client, dirs, target).await?)?;
    }
    plan.loader_version = Some(loader_version);
    on_progress(InstallStep::Loader, 1, 1);
    Ok(plan)
}

/// Eine aufgelöste Installation (siehe [`plan_install`]).
pub struct InstallPlan {
    version: VersionJson,
    mc: String,
    loader: ModLoader,
    loader_version: Option<String>,
}

/// Eine installierte Version, bereit zum Start.
pub struct InstalledGame {
    pub version: VersionJson,
    pub java: PathBuf,
}

impl InstallPlan {
    /// Die aufgelöste Loader-Version; ohne Mod-Loader keine.
    pub fn loader_version(&self) -> Option<&str> {
        self.loader_version.as_deref()
    }

    /// Installiert Vanilla und danach Forge bzw. NeoForge: Deren Processors brauchen Java und patchen das
    /// Client-JAR.
    pub async fn install(
        self,
        client: &reqwest::Client,
        dirs: &Dirs,
        instance_id: &str,
        on_progress: OnProgress<'_>,
    ) -> AppResult<InstalledGame> {
        let java = install::install(client, dirs, &self.version, instance_id, on_progress).await?;
        let version = match (self.loader, &self.loader_version) {
            (ModLoader::Forge | ModLoader::NeoForge, Some(loader_version)) => {
                let target = LoaderTarget::new(self.loader, &self.mc, loader_version)?;
                let on_loader = |done, total| on_progress(InstallStep::Loader, done, total);
                let profile = forge::install(client, dirs, target, &java, &on_loader).await?;
                merge(self.version, &profile)?
            }
            _ => self.version,
        };
        Ok(InstalledGame { version, java })
    }
}

/// Versions-JSON zum Start: Vanilla, mit Mod-Loader mit dessen installiertem Profil zusammengeführt.
pub async fn installed_version(dirs: &Dirs, choice: GameChoice<'_>) -> AppResult<VersionJson> {
    let version = install::installed_version(dirs, choice.mc).await?;
    match choice.loader {
        ModLoader::Vanilla => Ok(version),
        ModLoader::Fabric | ModLoader::Quilt => {
            merge(version, &installed_profile::<fabric::Profile>(dirs, choice.installed_target()?).await?)
        }
        ModLoader::Forge | ModLoader::NeoForge => {
            merge(version, &installed_profile::<forge::Profile>(dirs, choice.installed_target()?).await?)
        }
    }
}

/// Ein Loader-Profil: Versions-JSON mit `inheritsFrom` auf die Vanilla-Version.
trait LoaderProfile: DeserializeOwned {
    /// ID des Profils wie in ihm selbst; abgelegt wird es unter `versions/<id>/<id>.json`.
    fn id_for(target: LoaderTarget) -> String;
    fn inherits_from(&self) -> &str;
    fn main_class(&self) -> &str;
    /// Libraries im Vanilla-Format, in der Reihenfolge des Profils.
    fn libraries(&self) -> AppResult<Vec<Library>>;
    /// (JVM-, Spielargumente), angehängt an die der Version.
    fn arguments(&self) -> (Vec<Argument>, Vec<Argument>);
}

fn profile_path<P: LoaderProfile>(dirs: &Dirs, target: LoaderTarget) -> PathBuf {
    dirs.version_file(&P::id_for(target), "json")
}

/// Liest ein installiertes Profil (für den Start ohne Netz).
async fn installed_profile<P: LoaderProfile>(dirs: &Dirs, target: LoaderTarget<'_>) -> AppResult<P> {
    download::read_json(&profile_path::<P>(dirs, target)).await.map_err(|err| err.or_not_installed(target))
}

/// Legt das Profil ab; danach gilt die Loader-Version als installiert.
async fn save_profile<P: LoaderProfile>(dirs: &Dirs, target: LoaderTarget<'_>, json: &[u8]) -> AppResult<()> {
    let path = profile_path::<P>(dirs, target);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    Ok(tokio::fs::write(&path, json).await?)
}

/// Vanilla-Versions-JSON plus Loader-Profil: Loader-Main-Class, Loader-Libraries vor den Vanilla-Libraries,
/// Argumente angehängt. Die ID bleibt die Vanilla-ID, weil Client-JAR und Assets daran hängen; NeoForge schließt
/// über `-DignoreList=…,${version_name}.jar` genau dieses JAR aus.
fn merge(mut version: VersionJson, profile: &impl LoaderProfile) -> AppResult<VersionJson> {
    if profile.inherits_from() != version.id {
        return Err(AppError::invalid(coded!(
            "errors.game.loaderProfileInheritsFrom",
            inherits = profile.inherits_from(),
            mc = version.id
        )));
    }
    let vanilla = std::mem::take(&mut version.libraries);
    version.libraries = replace_libraries(profile.libraries()?, vanilla);
    version.main_class = profile.main_class().to_owned();
    // Loader-Profile gibt es nur für Versionen mit `arguments`; das Legacy-Format
    // (`minecraftArguments`) bekommt daher keine Profil-Argumente.
    if let Some(args) = version.arguments.as_mut() {
        let (jvm, game) = profile.arguments();
        args.jvm.extend(jvm);
        args.game.extend(game);
    }
    crate::services::mojang::secure_logging_libraries(&mut version.libraries);
    Ok(version)
}

/// Loader-Libraries vorne; sie ersetzen Vanilla-Libraries mit gleicher Koordinate (ohne Version).
fn replace_libraries(loader: Vec<Library>, vanilla: Vec<Library>) -> Vec<Library> {
    let replaced: HashSet<String> = loader.iter().map(|l| library_key(&l.name)).collect();
    let mut libraries = loader;
    libraries.extend(vanilla.into_iter().filter(|l| !replaced.contains(&library_key(&l.name))));
    libraries
}

/// Vorlagen für die Tests der Loader-Module.
#[cfg(test)]
mod test_support {
    use crate::services::mojang::VersionJson;

    /// Vanilla-Versions-JSON `id` mit zwei Libraries (ASM, Brigadier), wie sie Loader-Profile teils ersetzen.
    pub fn vanilla_version(id: &str) -> VersionJson {
        serde_json::from_value(serde_json::json!({
            "id": id, "type": "release", "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "17", "sha1": "x", "url": "u"},
            "downloads": {"client": {"sha1": "x", "url": "u"}},
            "libraries": [
                {"name": "org.ow2.asm:asm:9.6", "downloads": {"artifact": {"path": "org/ow2/asm/asm/9.6/asm-9.6.jar", "sha1": "x", "url": "u"}}},
                {"name": "com.mojang:brigadier:1.3.10", "downloads": {"artifact": {"path": "com/mojang/brigadier/1.3.10/brigadier-1.3.10.jar", "sha1": "x", "url": "u"}}}
            ],
            "arguments": {"jvm": ["-cp", "${classpath}"], "game": ["--version", "${version_name}"]}
        }))
        .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order() {
        let mut v = ["0.28.10", "0.29.2-beta.4", "0.29.2", "0.29.2-beta.10", "0.20.0-beta.9", "0.9.1"];
        v.sort_by(|a, b| compare_versions(b, a));
        assert_eq!(v, ["0.29.2", "0.29.2-beta.10", "0.29.2-beta.4", "0.28.10", "0.20.0-beta.9", "0.9.1"]);
        assert!(LoaderVersion::from_tag("0.29.2".into()).stable);
        assert!(!LoaderVersion::from_tag("0.29.2-beta.4".into()).stable);
    }

    #[test]
    fn default_version_falls_back_to_betas_only_for_forge_and_neoforge() {
        let betas = [LoaderVersion::from_tag("21.1.0-beta".into())];
        assert_eq!(default_version(ModLoader::NeoForge, &betas).map(|v| v.version.as_str()), Some("21.1.0-beta"));
        assert!(default_version(ModLoader::Quilt, &betas).is_none());
        assert!(LoaderTarget::new(ModLoader::Fabric, "1.21.1", "../x").is_err());
    }
}
