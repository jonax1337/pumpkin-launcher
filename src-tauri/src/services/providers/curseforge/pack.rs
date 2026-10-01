//! CurseForge-Modpack als Installationsplan: das Pack-Zip laden, `manifest.json` lesen, die Dateien über den Proxy
//! auflösen und die Overrides übernehmen. Was nur über die Webseite geladen werden darf, kommt als `Blocked` zurück.
use super::{
    codes::{mod_kind, CLASS_MODPACK},
    dto::{CfFile, CfMod, WEBSITE},
    parse_cf_id,
    proxy::{file_of, files_by_id, mod_of, mods_by_id},
};
use crate::{
    error::{AppError, AppResult},
    models::{instance_name, Instance, ModKind, ModLoader, NewInstance},
    services::{
        content::{self, Blob, Pack, TempFile},
        forge,
        limits::{MANIFEST_LIMIT, PLAN_FILES, ZIP_LIMIT},
        modrinth::{self, identifier},
        progress::{Phase, ProgressFn},
        providers::{remote_file::mib_progress, zip_files, PackRequest, RemoteFile},
        transport::read_capped_io,
        zip_guard::ensure_no_file_as_parent,
        Dirs,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::{Arc, Mutex},
};

/// Eine Datei, die CurseForge nur über die Webseite ausliefert; der Nutzer lädt sie dort und der Launcher holt sie ab.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Blocked {
    pub project_id: u32,
    pub file_id: u32,
    pub name: String,
    pub file_name: String,
    /// Seite des Projekts auf CurseForge.
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    minecraft: ManifestMinecraft,
    #[serde(default)]
    files: Vec<ManifestFile>,
    #[serde(default = "overrides_dir")]
    overrides: String,
}

fn overrides_dir() -> String {
    "overrides".into()
}

#[derive(Debug, Deserialize)]
struct ManifestMinecraft {
    version: String,
    #[serde(rename = "modLoaders", default)]
    mod_loaders: Vec<ManifestLoader>,
}

#[derive(Debug, Deserialize)]
struct ManifestLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    #[serde(rename = "projectID")]
    project_id: u32,
    #[serde(rename = "fileID")]
    file_id: u32,
}

impl Manifest {
    fn ensure_file_count(&self) -> AppResult<()> {
        if self.files.len() > PLAN_FILES {
            return Err(AppError::invalid("Zu viele Pack-Dateien"));
        }
        Ok(())
    }

    /// Zip-Ordner der Overrides. Er kommt aus dem Manifest: nur einfache Namen.
    fn overrides_prefix(&self) -> AppResult<String> {
        if self.overrides.is_empty() || self.overrides.contains(['/', '\\', ':']) || self.overrides.starts_with('.') {
            return Err(AppError::invalid("Ungültiger Overrides-Ordner im Pack"));
        }
        Ok(format!("{}/", self.overrides))
    }
}

/// Dateien, Herkunft und gesperrte Dateien eines Manifests.
#[derive(Default)]
struct Listed {
    /// Zielpfad im Spielordner und Quelle der Datei.
    files: Vec<(String, RemoteFile)>,
    /// Dateiname -> (Projekt, Datei) der Mods, die das Pack von CurseForge bezieht.
    origins: HashMap<String, (u32, u32)>,
    blocked: Vec<Blocked>,
}

/// `forge-47.1.3` -> (Forge, 47.1.3); Loader, die Pumpkin Launcher nicht kennt, sind ein Fehler.
fn manifest_loader(m: &ManifestMinecraft) -> AppResult<(ModLoader, Option<String>)> {
    let Some(l) = m.mod_loaders.iter().find(|l| l.primary).or(m.mod_loaders.first()) else { return Ok((ModLoader::Vanilla, None)) };
    let (name, version) = l.id.split_once('-').ok_or_else(|| AppError::invalid("Loader im Pack nicht lesbar"))?;
    let Some(loader) = ModLoader::from_modded_name(name) else {
        return Err(AppError::invalid(format!("Das Pack braucht den Loader „{name}“, den Pumpkin Launcher nicht kennt")));
    };
    identifier(version)?;
    identifier(&m.version)?;
    forge::check_loader(loader, &m.version)?;
    Ok((loader, Some(version.to_string())))
}

/// Plant ein CurseForge-Modpack: lädt das Zip, liest `manifest.json`, holt alle Dateien (mit Prüfsumme) und übernimmt
/// die Overrides. Was nur über die Webseite geladen werden darf, kommt als `Blocked` zurück.
pub(crate) async fn plan_pack(
    client: &reqwest::Client,
    dirs: &Dirs,
    request: &PackRequest,
    progress: ProgressFn<'_>,
) -> AppResult<(Pack, Vec<Blocked>)> {
    let name = instance_name(&request.name)?;
    let (project, file_no) = (parse_cf_id(&request.project_id)?, parse_cf_id(&request.version_id)?);
    let pack_file = modpack_file(client, project, file_no).await?;
    let temp = download_pack_zip(dirs, &pack_file, progress).await?;
    let mut zip = zip::ZipArchive::new(fs::File::open(&temp.0)?)?;
    let manifest = read_manifest(&mut zip)?;
    let (loader, loader_version) = manifest_loader(&manifest.minecraft)?;
    manifest.ensure_file_count()?;
    let prefix = manifest.overrides_prefix()?;
    let (infos, mods) = fetch_manifest_entries(client, &manifest).await?;
    let listed = classify_files(&manifest, &infos, &mods)?;
    let instance = Instance::from_new(NewInstance { name: name.into(), minecraft_version: manifest.minecraft.version, loader, loader_version });
    let mut pack = merge_overrides(zip, &prefix, instance, listed.files)?;
    pack.origins = listed.origins;
    pack.temp = Some(temp);
    Ok((pack, listed.blocked))
}

/// Die Pack-Datei, nachdem feststeht, dass das Projekt ein Modpack ist.
async fn modpack_file(client: &reqwest::Client, project: u32, file_no: u32) -> AppResult<CfFile> {
    let pack_mod = mod_of(client, project).await?;
    if pack_mod.class_id != Some(CLASS_MODPACK) {
        return Err(AppError::invalid("Projekt ist kein Modpack"));
    }
    file_of(client, project, file_no).await
}

/// Lädt das Pack-Zip in den Zwischenspeicher; es verschwindet mit dem `TempFile`.
async fn download_pack_zip(dirs: &Dirs, pack_file: &CfFile, progress: ProgressFn<'_>) -> AppResult<TempFile> {
    let temp = TempFile::in_cache(dirs)?;
    let source = RemoteFile { size: pack_file.file_length.min(ZIP_LIMIT), ..pack_file.remote_file()? };
    progress(Phase::Download, 0, 0);
    source.download_to(&modrinth::download_client()?, &temp.0, &mib_progress(progress)).await?;
    Ok(temp)
}

fn read_manifest(zip: &mut zip::ZipArchive<fs::File>) -> AppResult<Manifest> {
    let entry = zip.by_name("manifest.json")?;
    Ok(serde_json::from_slice(&read_capped_io(entry, MANIFEST_LIMIT, "manifest.json zu groß")?)?)
}

/// Datei- und Projektangaben aller Manifest-Einträge, in Blöcken geholt.
async fn fetch_manifest_entries(
    client: &reqwest::Client,
    manifest: &Manifest,
) -> AppResult<(HashMap<u64, CfFile>, HashMap<u64, CfMod>)> {
    let file_ids: Vec<u64> = manifest.files.iter().map(|f| u64::from(f.file_id)).collect();
    let infos = files_by_id(client, &file_ids).await?;
    let mut project_ids: Vec<u64> = manifest.files.iter().map(|f| u64::from(f.project_id)).collect();
    project_ids.sort_unstable();
    project_ids.dedup();
    let mods = mods_by_id(client, &project_ids).await?;
    Ok((infos, mods))
}

/// Sortiert die Manifest-Einträge: ladbare Dateien in ihren Ordner, nur über die Webseite erhältliche als `Blocked`;
/// Dateien anderer Klassen (Welten, Konfigurationen, Unbekanntes) fallen weg.
fn classify_files(manifest: &Manifest, infos: &HashMap<u64, CfFile>, mods: &HashMap<u64, CfMod>) -> AppResult<Listed> {
    let mut listed = Listed::default();
    for entry in &manifest.files {
        let file = infos
            .get(&u64::from(entry.file_id))
            .ok_or_else(|| AppError::invalid(format!("Datei {} gibt es bei CurseForge nicht mehr", entry.file_id)))?;
        let project = mods.get(&u64::from(entry.project_id));
        let Some(folder) = mod_kind(project.and_then(|m| m.class_id)).ok().map(ModKind::folder) else { continue };
        if file.file_name.is_empty() || file.file_name.contains(['/', '\\']) {
            return Err(AppError::invalid(format!("Unerwarteter Dateiname {}", file.file_name)));
        }
        match file.remote_file() {
            Ok(remote) => {
                listed.files.push((format!("{folder}/{}", file.file_name), remote));
                listed.origins.insert(file.file_name.clone(), (entry.project_id, entry.file_id));
            }
            Err(_) => listed.blocked.push(Blocked {
                project_id: entry.project_id,
                file_id: entry.file_id,
                name: project.map_or_else(|| file.display_name.clone(), |m| m.name.clone()),
                file_name: file.file_name.clone(),
                url: project.and_then(CfMod::website).unwrap_or_else(|| format!("{WEBSITE}minecraft")),
            }),
        }
    }
    Ok(listed)
}

/// Plan aus den Dateien zum Laden und den Overrides des Zips. Overrides gewinnen gegen gleichnamige Downloads (wie im
/// CurseForge-Launcher), dürfen sich aber auch nicht als Datei und Ordner mit den Downloads in die Quere kommen.
fn merge_overrides(
    mut zip: zip::ZipArchive<fs::File>,
    prefix: &str,
    instance: Instance,
    mut files: Vec<(String, RemoteFile)>,
) -> AppResult<Pack> {
    let overrides = zip_files(&mut zip, prefix, &[])?;
    let override_paths: HashSet<String> = overrides.iter().map(|(p, _)| p.to_string_lossy().to_lowercase()).collect();
    files.retain(|(path, _)| !override_paths.contains(&path.to_lowercase()));
    let mut pack = content::plan_pack(instance, files)?;
    let downloads: HashSet<String> = pack.downloads.iter().map(|(p, _)| p.to_string_lossy().to_lowercase()).collect();
    ensure_no_file_as_parent(&override_paths, &downloads)?;
    let archive = Arc::new(Mutex::new(zip));
    pack.overrides = overrides.into_iter().map(|(path, index)| (path, Blob::Zip { archive: archive.clone(), index })).collect();
    Ok(pack)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manifest_loader_ids() {
        let mc = |v: &str, loaders: &[&str]| ManifestMinecraft {
            version: v.into(),
            mod_loaders: loaders.iter().map(|id| ManifestLoader { id: (*id).into(), primary: true }).collect(),
        };
        assert_eq!(manifest_loader(&mc("1.20.1", &["forge-47.1.3"])).unwrap(), (ModLoader::Forge, Some("47.1.3".to_string())));
        assert_eq!(manifest_loader(&mc("1.21.1", &["neoforge-21.1.172"])).unwrap().0, ModLoader::NeoForge);
        assert_eq!(manifest_loader(&mc("1.20.1", &["fabric-0.15.7"])).unwrap().0, ModLoader::Fabric);
        assert_eq!(manifest_loader(&mc("1.21.1", &[])).unwrap(), (ModLoader::Vanilla, None));
        // Forge vor 1.17, fremde Loader und kaputte IDs.
        assert!(manifest_loader(&mc("1.12.2", &["forge-14.23.5.2860"])).is_err());
        assert!(manifest_loader(&mc("1.20.1", &["cauldron-1"])).is_err());
        assert!(manifest_loader(&mc("1.20.1", &["forge"])).is_err());
        assert!(manifest_loader(&mc("1.20.1", &["forge-../x"])).is_err());
    }

    #[test]
    fn manifest_parses_like_curseforge_writes_it() {
        let m: Manifest = serde_json::from_value(json!({
            "minecraft": {"version": "1.20.1", "modLoaders": [{"id": "forge-47.1.3", "primary": true}]},
            "manifestType": "minecraftModpack", "manifestVersion": 1, "name": "P", "version": "1", "author": "a",
            "files": [{"projectID": 238222, "fileID": 4593548, "required": true}], "overrides": "overrides"
        }))
        .unwrap();
        assert_eq!((m.files.len(), m.files[0].project_id, m.files[0].file_id, m.overrides.as_str()), (1, 238222, 4593548, "overrides"));
        let bare: Manifest = serde_json::from_value(json!({"minecraft": {"version": "1.20.1"}})).unwrap();
        assert_eq!(bare.overrides, "overrides");
    }

    /// Ganzes Modpack von CurseForge (Fabulously Optimized): Manifest, alle Mods mit Prüfsumme, Overrides.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und den Worker, lädt mehrere zehn MB"]
    async fn live_install_pack() {
        use crate::{
            models::new_id,
            services::providers::{curseforge, ProjectType, SearchQuery, Source, VersionFilter},
            state::AppState,
        };
        let client = modrinth::client().unwrap();
        // `LIVE_PACK=all-the-mods-10` probiert ein fettes Pack aus (mehrere GB), Standard ist ein kleines.
        let slug = std::env::var("LIVE_PACK").unwrap_or_else(|_| "fabulously-optimized".into());
        let hits = curseforge::search(&client, &SearchQuery::of(&slug.replace('-', " "), ProjectType::Modpack)).await.unwrap();
        let pack = hits.hits.iter().find(|h| h.slug == slug).unwrap_or_else(|| panic!("{slug} fehlt"));
        let v = curseforge::versions(&client, &pack.project_id, &VersionFilter::default()).await.unwrap();
        let file = v.iter().find(|v| v.version_type == "release" && v.files[0].size > 0 && !v.files[0].url.is_empty()).expect("keine Release-Datei");
        eprintln!("Pack-Datei {} ({} Bytes)", file.name, file.files[0].size);
        let root = std::env::temp_dir().join(new_id());
        let state = AppState::load(&root).unwrap();
        let request = PackRequest { source: Source::CurseForge, project_id: pack.project_id.clone(), version_id: file.id.clone(), name: "Live-Pack".into() };
        let (plan, blocked) = plan_pack(&client, &state.dirs, &request, &|p, d, t| eprintln!("{p:?}: {d}/{t}")).await.unwrap();
        eprintln!("{} Downloads, {} Overrides, {} gesperrt", plan.downloads.len(), plan.overrides.len(), blocked.len());
        let instance = content::import_plan(&state, plan, None, &|_, _, _| {}).await.unwrap();
        let jars = std::fs::read_dir(state.dirs.game_dir(&instance.id).join("mods")).unwrap().count();
        let cf = instance.mods.iter().filter(|m| matches!(m.source, crate::models::ModSource::CurseForge { .. })).count();
        eprintln!("{} {:?} {:?}: {jars} Mods, davon {cf} als CurseForge erfasst", instance.minecraft_version, instance.loader, instance.loader_version);
        assert!(jars > 10 && instance.mods.len() >= jars);
        assert_ne!(instance.loader, ModLoader::Vanilla);
        let left: Vec<_> = std::fs::read_dir(state.dirs.root.join("cache").join("tmp")).unwrap().collect();
        assert!(left.is_empty(), "Zwischenspeicher nicht aufgeräumt");
        std::fs::remove_dir_all(root).unwrap();
    }
}
