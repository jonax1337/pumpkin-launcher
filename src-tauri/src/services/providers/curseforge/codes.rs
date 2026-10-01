//! Zahlencodes der CurseForge-API für Klassen, Loader und Sortierung und ihre Übersetzung in die Begriffe des Launchers.
use crate::{
    error::{AppError, AppResult},
    models::{ModKind, ModLoader},
    services::providers::{ProjectType, SortIndex},
};

/// `modLoaderType` der API.
const LOADER_FORGE: u8 = 1;
const LOADER_FABRIC: u8 = 4;
const LOADER_QUILT: u8 = 5;
const LOADER_NEOFORGE: u8 = 6;

/// `sortField` der Suche (1 wäre „Hervorgehoben“, 11 „Veröffentlicht“).
const SORT_POPULARITY: u8 = 2;
const SORT_UPDATED: u8 = 3;
const SORT_DOWNLOADS: u8 = 6;
const SORT_NEWEST: u8 = 11;

const CLASS_MOD: u32 = 6;
pub(super) const CLASS_MODPACK: u32 = 4471;
const CLASS_RESOURCEPACK: u32 = 12;
const CLASS_SHADER: u32 = 6552;

pub(super) fn class_of(kind: ProjectType) -> AppResult<u32> {
    match kind {
        ProjectType::Mod => Ok(CLASS_MOD),
        ProjectType::Modpack => Ok(CLASS_MODPACK),
        ProjectType::ResourcePack => Ok(CLASS_RESOURCEPACK),
        ProjectType::Shader => Ok(CLASS_SHADER),
        ProjectType::Datapack => Err(AppError::invalid("Ungültige Suche")),
    }
}

pub(super) fn kind_name(class_id: Option<u32>) -> &'static str {
    match class_id {
        Some(CLASS_MODPACK) => "modpack",
        Some(CLASS_RESOURCEPACK) => "resourcepack",
        Some(CLASS_SHADER) => "shader",
        _ => "mod",
    }
}

/// Inhaltsart einer Mod-Datei für die Instanz; Modpacks und Sonstiges sind hier keine.
pub(super) fn mod_kind(class_id: Option<u32>) -> AppResult<ModKind> {
    match class_id {
        Some(CLASS_MOD) => Ok(ModKind::Mod),
        Some(CLASS_RESOURCEPACK) => Ok(ModKind::ResourcePack),
        Some(CLASS_SHADER) => Ok(ModKind::Shader),
        _ => Err(AppError::invalid("Das ist keine Mod, kein Ressourcenpaket und kein Shader")),
    }
}

pub(super) fn sort_field(sort: SortIndex) -> u8 {
    match sort {
        SortIndex::Relevance | SortIndex::Follows => SORT_POPULARITY,
        SortIndex::Downloads => SORT_DOWNLOADS,
        SortIndex::Updated => SORT_UPDATED,
        SortIndex::Newest => SORT_NEWEST,
    }
}

/// CurseForge-Nummer des Loaders; Vanilla hat keine.
fn loader_type(loader: ModLoader) -> Option<u8> {
    match loader {
        ModLoader::Forge => Some(LOADER_FORGE),
        ModLoader::Fabric => Some(LOADER_FABRIC),
        ModLoader::Quilt => Some(LOADER_QUILT),
        ModLoader::NeoForge => Some(LOADER_NEOFORGE),
        ModLoader::Vanilla => None,
    }
}

pub(super) fn loader_type_of(name: &str) -> Option<u8> {
    ModLoader::from_name(name).and_then(loader_type)
}

/// CurseForge-Loader der Instanz in Vorzugsreihenfolge; Quilt lädt auch Fabric-Mods.
pub(super) fn loader_types(loader: ModLoader) -> impl Iterator<Item = u8> {
    let fallback = (loader == ModLoader::Quilt).then_some(ModLoader::Fabric);
    [Some(loader), fallback].into_iter().flatten().filter_map(loader_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes_and_kinds() {
        let classes = [ProjectType::Mod, ProjectType::Modpack, ProjectType::Shader, ProjectType::ResourcePack].map(|t| class_of(t).unwrap());
        assert_eq!(classes, [6, 4471, 6552, 12]);
        assert!(class_of(ProjectType::Datapack).is_err());
        assert_eq!((kind_name(Some(4471)), kind_name(Some(12)), kind_name(None)), ("modpack", "resourcepack", "mod"));
        assert!(mod_kind(Some(CLASS_MODPACK)).is_err() && mod_kind(Some(CLASS_MOD)).is_ok());
        let folders = [6, 12, 6552, 17].map(|class| mod_kind(Some(class)).ok().map(ModKind::folder));
        assert_eq!(folders, [Some("mods"), Some("resourcepacks"), Some("shaderpacks"), None]);
    }

    #[test]
    fn sorting_follows_the_search_field_codes() {
        assert_eq!(sort_field(SortIndex::Relevance), sort_field(SortIndex::Follows));
        assert_eq!([SortIndex::Downloads, SortIndex::Updated, SortIndex::Newest].map(sort_field), [6, 3, 11]);
    }
}
