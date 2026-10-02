//! Woher die Stände eines Pack-Updates kommen: die neue Pack-Version (aus der Quelle der Instanz oder einer
//! `.mrpack`-Datei) als Liste neuer Dateien, und was das installierte Pack abgelegt hat.
use std::{
    borrow::Cow,
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use super::{PackFiles, PackTarget};
use crate::{
    coded,
    error::{AppError, AppResult},
    models::{Instance, ModpackOrigin},
    services::{
        blocking,
        content::{self, Blob, Fetch, Pack, TempFile},
        download::sha1_hex,
        mods,
        progress::ProgressFn,
        providers::{self, PackRequest, Source},
        Dirs,
    },
};

/// Name, unter dem das neue Pack geplant wird; die Instanz behält ihren eigenen.
const PLAN_NAME: &str = "Pack-Update";

/// Datei des neuen Packs, Pfad relativ zum Spielordner mit `/`.
pub(super) struct NewFile {
    pub(super) path: String,
    /// `None`, solange die Quelle keinen SHA-1 nennt und die Datei noch nicht geladen ist.
    pub(super) sha1: Option<String>,
    pub(super) body: Body,
}

/// Wo die Bytes einer neuen Datei liegen.
pub(super) enum Body {
    /// Noch zu laden.
    Fetch(Fetch),
    /// Im Pack-Archiv.
    Blob(Blob),
    /// Geladen und im Mod-Cache (Inhalte).
    Cached,
    /// Geladen und im Arbeitsordner des Updates.
    Spilled(PathBuf),
}

impl NewFile {
    pub(super) fn bytes(&self, dirs: &Dirs) -> AppResult<Cow<'_, [u8]>> {
        match &self.body {
            Body::Blob(blob) => blob.bytes(),
            Body::Cached => {
                let sha1 = self.sha1.as_deref().ok_or_else(not_loaded)?;
                Ok(Cow::Owned(fs::read(mods::cache_path(dirs, sha1)?)?))
            }
            Body::Spilled(path) => Ok(Cow::Owned(fs::read(path)?)),
            Body::Fetch(_) => Err(not_loaded()),
        }
    }
}

fn not_loaded() -> AppError {
    AppError::invalid(coded!("errors.packs.update.fileNotLoaded"))
}

/// Die neue Pack-Version: Minecraft-Version und Loader (in `game`), Herkunft und Dateien.
pub(super) struct Release {
    pub(super) game: Instance,
    pub(super) origin: ModpackOrigin,
    pub(super) files: Vec<NewFile>,
    /// Aus `pumpkin.json` eigener Exporte: Dateiname → `required_by`.
    pub(super) required_by: HashMap<String, Vec<String>>,
    /// Dateiname → (CurseForge-Projekt, Datei).
    pub(super) origins: HashMap<String, (u32, u32)>,
    /// Zuletzt: wird nach den Dateien verworfen, damit das Zip vor dem Löschen geschlossen ist.
    _temp: Option<TempFile>,
}

impl Release {
    pub(super) fn of(pack: Pack, origin: ModpackOrigin) -> AppResult<Self> {
        let Pack { instance, downloads, overrides, required_by, origins, temp } = pack;
        let mut files: Vec<NewFile> = downloads
            .into_iter()
            .map(|(path, fetch)| NewFile { path: slashed(&path), sha1: fetch.sha1(), body: Body::Fetch(fetch) })
            .collect();
        for (path, blob) in overrides {
            let sha1 = sha1_hex(&blob.bytes()?);
            files.push(NewFile { path: slashed(&path), sha1: Some(sha1), body: Body::Blob(blob) });
        }
        Ok(Self { game: instance, origin, files, required_by, origins, _temp: temp })
    }
}

fn slashed(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Die Pack-Version, auf die `target` die Instanz bringen soll.
pub(super) async fn release(
    client: &reqwest::Client,
    dirs: &Dirs,
    instance: &Instance,
    target: &PackTarget,
    progress: ProgressFn<'_>,
) -> AppResult<Release> {
    match (target, &instance.modpack) {
        (PackTarget::File { path }, Some(ModpackOrigin::File { .. })) => {
            let (dirs, path) = (dirs.clone(), PathBuf::from(path));
            blocking(move |_| file_release(&dirs, &path)).await
        }
        (PackTarget::Version { version_id }, Some(origin)) => version_release(client, dirs, origin, version_id, progress).await,
        _ => Err(AppError::invalid(coded!("errors.packs.update.notUpdatable"))),
    }
}

async fn version_release(
    client: &reqwest::Client,
    dirs: &Dirs,
    origin: &ModpackOrigin,
    version_id: &str,
    progress: ProgressFn<'_>,
) -> AppResult<Release> {
    let request = |source: Source, project_id: String| PackRequest {
        source,
        project_id,
        version_id: version_id.to_owned(),
        name: PLAN_NAME.into(),
    };
    match origin {
        ModpackOrigin::Modrinth { project_id, .. } => modrinth_release(client, dirs, project_id, version_id, progress).await,
        ModpackOrigin::CurseForge { project_id, .. } => {
            provider_release(client, dirs, request(Source::CurseForge, project_id.to_string()), progress).await
        }
        ModpackOrigin::Provider { source, project_id, .. } => {
            provider_release(client, dirs, request(Source::parse(source)?, project_id.clone()), progress).await
        }
        ModpackOrigin::File { .. } => Err(AppError::invalid(coded!("errors.packs.update.chooseNewerFile"))),
    }
}

async fn modrinth_release(
    client: &reqwest::Client,
    dirs: &Dirs,
    project_id: &str,
    version_id: &str,
    progress: ProgressFn<'_>,
) -> AppResult<Release> {
    let (version, data) = content::modrinth_pack(client, version_id, progress).await?;
    if version.project_id != project_id {
        return Err(AppError::invalid(coded!("errors.packs.update.otherModpack")));
    }
    let origin = ModpackOrigin::Modrinth { project_id: version.project_id, version_id: version.id };
    Release::of(content::unpack(&data, PLAN_NAME, dirs)?, origin)
}

/// Plan eines Anbieters. Ein Update braucht alle Dateien: was CurseForge nur über die Webseite ausliefert, lässt
/// sich nicht ohne den Nutzer laden.
async fn provider_release(
    client: &reqwest::Client,
    dirs: &Dirs,
    request: PackRequest,
    progress: ProgressFn<'_>,
) -> AppResult<Release> {
    let (pack, blocked) = providers::plan_pack(client, dirs, &request, progress).await?;
    if !blocked.is_empty() {
        return Err(AppError::invalid(coded!("errors.packs.update.webOnlyFiles", count = blocked.len())));
    }
    Release::of(pack, request.origin()?)
}

fn file_release(dirs: &Dirs, path: &Path) -> AppResult<Release> {
    let data = content::local_pack(path)?;
    Release::of(content::unpack(&data, PLAN_NAME, dirs)?, content::file_origin(&data)?)
}

/// Was das installierte Pack abgelegt hat, als (Pfad, SHA-1): aus der Dateiliste der Instanz. Instanzen, die vor ihr
/// installiert wurden, planen die installierte Version neu; das geht nicht bei Technic (nur die neueste Version) und
/// nicht bei Dateien.
pub(super) async fn installed(
    client: &reqwest::Client,
    dirs: &Dirs,
    instance: &Instance,
    progress: ProgressFn<'_>,
) -> AppResult<Vec<(String, String)>> {
    if let Some(placed) = PackFiles::load(dirs, &instance.id)? {
        return Ok(placed.iter().map(|(path, sha1)| (path.to_owned(), sha1.to_owned())).collect());
    }
    let origin = instance.modpack.as_ref().ok_or_else(no_pack_files)?;
    let version_id = reloadable_version(origin).ok_or_else(no_pack_files)?;
    let release = version_release(client, dirs, origin, &version_id, progress).await?;
    Ok(release.files.into_iter().filter_map(|f| Some((f.path, f.sha1?))).collect())
}

/// Die installierte Version, sofern sie sich erneut laden lässt.
fn reloadable_version(origin: &ModpackOrigin) -> Option<String> {
    match origin {
        ModpackOrigin::Modrinth { version_id, .. } => Some(version_id.clone()),
        ModpackOrigin::CurseForge { file_id, .. } => Some(file_id.to_string()),
        ModpackOrigin::Provider { source, version_id, .. } if source != Source::Technic.key() => Some(version_id.clone()),
        ModpackOrigin::Provider { .. } | ModpackOrigin::File { .. } => None,
    }
}

fn no_pack_files() -> AppError {
    AppError::invalid(coded!("errors.packs.update.noPackFiles"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_versions_that_can_be_loaded_again_give_the_installed_state() {
        let provider = |source: &str| ModpackOrigin::Provider { source: source.into(), project_id: "p".into(), version_id: "7".into() };

        assert_eq!(reloadable_version(&ModpackOrigin::Modrinth { project_id: "p".into(), version_id: "v1".into() }).unwrap(), "v1");
        assert_eq!(reloadable_version(&ModpackOrigin::CurseForge { project_id: 1, file_id: 42 }).unwrap(), "42");
        assert_eq!(reloadable_version(&provider("ftb")).unwrap(), "7");
        assert!(reloadable_version(&provider("technic")).is_none());
        assert!(reloadable_version(&ModpackOrigin::File { name: "a".into(), version: "1".into() }).is_none());
    }
}
