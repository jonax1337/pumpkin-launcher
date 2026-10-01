//! Dateien, die der Nutzer auf CurseForge von Hand geladen hat: aus dem Downloads-Ordner in die Instanz holen.
use super::{
    codes::mod_kind,
    dto::CfFile,
    install::{check_file_name, Planned},
    proxy::{file_of, mod_of},
};
use crate::{
    error::{AppError, AppResult},
    models::{Instance, ModSource},
    services::{
        content::{self, StagedInstall},
        download, limits::FILE_LIMIT, modrinth, mods,
    },
    state::AppState,
};
use std::{fs, path::{Path, PathBuf}};

/// Die Datei, auf die der Launcher im Downloads-Ordner wartet.
pub struct ManualDownload<'a> {
    pub project_id: u32,
    pub file_id: u32,
    pub file_name: &'a str,
}

/// Downloads-Ordner des Systems: auch verschoben (Windows) oder mit übersetztem Namen (XDG unter Linux).
/// Ohne `user-dirs.dirs` (minimale Linux-Systeme) kennt `dirs` keinen, dann gilt `~/Downloads`.
fn downloads_dir() -> Option<PathBuf> {
    dirs::download_dir().or_else(|| dirs::home_dir().map(|home| home.join("Downloads"))).filter(|dir| dir.is_dir())
}

/// Dateien im Downloads-Ordner, die nach `file_name` aussehen (Browser hängen bei Doppelten ` (1)` an).
fn download_candidates(dir: &Path, file_name: &str) -> AppResult<Vec<PathBuf>> {
    let (stem, ext) = file_name.rsplit_once('.').unwrap_or((file_name, ""));
    let mut found = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let candidate = name == file_name || (name.starts_with(stem) && name.ends_with(&format!(".{ext}")));
        if candidate && entry.file_type()?.is_file() {
            found.push(entry.path());
        }
    }
    Ok(found)
}

/// Die Kandidatin, deren Größe und SHA-1 zur Datei bei CurseForge passen.
fn verified_download(candidates: &[PathBuf], file: &CfFile) -> AppResult<Option<Vec<u8>>> {
    let Some(expected) = file.sha1() else { return Ok(None) };
    if file.file_length > FILE_LIMIT {
        return Ok(None);
    }
    for path in candidates {
        if fs::metadata(path)?.len() != file.file_length {
            continue;
        }
        let data = fs::read(path)?;
        if download::sha1_hex(&data) == expected {
            return Ok(Some(data));
        }
    }
    Ok(None)
}

/// Holt eine manuell geladene Datei aus dem Downloads-Ordner und trägt sie in die Instanz ein.
/// `None` = noch nicht da (der Nutzer lädt noch).
pub async fn adopt_download(state: &AppState, instance_id: &str, wanted: &ManualDownload<'_>) -> AppResult<Option<Instance>> {
    let instance = state.instances.get(instance_id)?;
    if instance.mods.iter().any(|x| matches!(x.source, ModSource::CurseForge { file_id, .. } if file_id == wanted.file_id)) {
        return Ok(Some(instance));
    }
    // Die Oberfläche fragt alle paar Sekunden: CurseForge erst bemühen, wenn eine passend benannte Datei da ist.
    let Some(candidates) = candidates_in_downloads(wanted.file_name)? else { return Ok(None) };
    let client = modrinth::client()?;
    let project = mod_of(&client, wanted.project_id).await?;
    let kind = mod_kind(project.class_id)?;
    let file = file_of(&client, wanted.project_id, wanted.file_id).await?;
    let Some(data) = verified_download(&candidates, &file)? else { return Ok(None) };
    check_file_name(&file.file_name, kind)?;
    place(state, instance_id, instance, &Planned { project, file, kind }, &data).map(Some)
}

/// Kandidaten im Downloads-Ordner; `None`, wenn es den Ordner nicht gibt oder keine Datei passend heißt.
fn candidates_in_downloads(file_name: &str) -> AppResult<Option<Vec<PathBuf>>> {
    let Some(dir) = downloads_dir() else { return Ok(None) };
    let candidates = download_candidates(&dir, file_name)?;
    Ok(if candidates.is_empty() { None } else { Some(candidates) })
}

/// Legt die geprüfte Datei in die Instanz und trägt sie ein; scheitert etwas, bleibt die Datei nicht liegen.
fn place(state: &AppState, instance_id: &str, mut instance: Instance, planned: &Planned, data: &[u8]) -> AppResult<Instance> {
    let target = planned.target(&state.dirs.game_dir(instance_id));
    if instance.mods.iter().any(|x| x.file_name.eq_ignore_ascii_case(&planned.file.file_name)) {
        return Err(AppError::invalid("Mod-Dateinamen kollidieren"));
    }
    let staged = StagedInstall::new(&state.dirs.root);
    staged.reserve(&target)?;
    staged.commit_or_rollback(|staged| {
        staged.write_file(target, data)?;
        let sha1 = mods::cache_bytes(&state.dirs, data)?;
        let entry = planned.mod_entry(sha1, Vec::new(), &instance.mods)?;
        instance.mods.push(entry);
        content::commit_mods(state, instance_id, instance.mods)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::providers::curseforge::dto::fixtures::file;
    use serde_json::json;

    #[test]
    fn downloads_folder_lookup_checks_size_and_hash() {
        let dir = std::env::temp_dir().join(crate::models::new_id());
        fs::create_dir_all(&dir).unwrap();
        let data = b"jar-bytes";
        let f = file(json!({
            "id": 1, "modId": 2, "fileName": "a-1.0.jar", "fileLength": data.len(),
            "hashes": [{"value": download::sha1_hex(data), "algo": 1}]
        }));
        let found = || verified_download(&download_candidates(&dir, &f.file_name).unwrap(), &f).unwrap();
        assert!(download_candidates(&dir, &f.file_name).unwrap().is_empty());
        // Falscher Inhalt gleicher Größe wird nicht akzeptiert, der echte unter Browser-Namen schon.
        fs::write(dir.join("a-1.0.jar"), b"jar-bytez").unwrap();
        fs::write(dir.join("b-1.0.jar"), data).unwrap();
        assert_eq!(download_candidates(&dir, &f.file_name).unwrap().len(), 1);
        assert!(found().is_none());
        fs::write(dir.join("a-1.0 (1).jar"), data).unwrap();
        assert_eq!(found().unwrap(), data);
        fs::remove_dir_all(dir).unwrap();
    }
}
