//! Suchanfrage an einen Katalog (Modrinth oder Anbieter): die Grenzen und die Sortierung werden einmal geprüft und
//! überall gleich verstanden.
use crate::{
    coded,
    error::{AppError, AppResult},
    services::modrinth::identifier,
};

/// Was gesucht wird, so wie das Frontend es als `projectType` nennt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectType {
    Mod,
    Modpack,
    ResourcePack,
    Shader,
    Datapack,
}

impl ProjectType {
    pub fn parse(name: &str) -> AppResult<Self> {
        match name {
            "mod" => Ok(Self::Mod),
            "modpack" => Ok(Self::Modpack),
            "resourcepack" => Ok(Self::ResourcePack),
            "shader" => Ok(Self::Shader),
            "datapack" => Ok(Self::Datapack),
            _ => Err(AppError::invalid(coded!("errors.providers.invalidSearch"))),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::Modpack => "modpack",
            Self::ResourcePack => "resourcepack",
            Self::Shader => "shader",
            Self::Datapack => "datapack",
        }
    }
}

/// Sortierung der Treffer, so wie das Frontend sie als `index` nennt (Namen von Modrinth).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortIndex {
    Relevance,
    Downloads,
    Follows,
    Newest,
    Updated,
}

impl SortIndex {
    /// `None` = keine Sortierung gewünscht; unbekannte Namen sind ein Fehler.
    pub fn parse(name: Option<&str>) -> AppResult<Option<Self>> {
        match name {
            None => Ok(None),
            Some("relevance") => Ok(Some(Self::Relevance)),
            Some("downloads") => Ok(Some(Self::Downloads)),
            Some("follows") => Ok(Some(Self::Follows)),
            Some("newest") => Ok(Some(Self::Newest)),
            Some("updated") => Ok(Some(Self::Updated)),
            Some(_) => Err(AppError::invalid(coded!("errors.providers.invalidSort"))),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::Downloads => "downloads",
            Self::Follows => "follows",
            Self::Newest => "newest",
            Self::Updated => "updated",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SearchQuery {
    pub query: String,
    pub project_type: ProjectType,
    /// Minecraft-Version.
    pub mc: Option<String>,
    pub loader: Option<String>,
    /// Kategorie des Anbieters (Modrinth-Name wie `adventure`); nur Modrinth wertet sie aus.
    pub category: Option<String>,
    pub offset: u32,
    pub index: Option<SortIndex>,
}

impl SearchQuery {
    /// Die gewünschte Sortierung; ohne Wunsch zählen ohne Suchbegriff die beliebtesten Projekte zuerst.
    pub fn sort(&self) -> SortIndex {
        self.index.unwrap_or(if self.query.trim().is_empty() { SortIndex::Downloads } else { SortIndex::Relevance })
    }

    /// Lehnt zu lange Suchbegriffe, zu große Versätze und Filter ab, die keine Kennung sind. Die Grenzen
    /// unterscheiden sich je Katalog.
    pub fn ensure_within(&self, max_query_len: usize, max_offset: u32) -> AppResult<()> {
        if self.query.len() > max_query_len || self.offset > max_offset {
            return Err(AppError::invalid(coded!("errors.providers.invalidSearch")));
        }
        self.mc.iter().chain(&self.loader).chain(&self.category).try_for_each(|filter| identifier(filter))
    }

    #[cfg(test)]
    pub(crate) fn of(query: &str, project_type: ProjectType) -> Self {
        Self { query: query.into(), project_type, mc: None, loader: None, category: None, offset: 0, index: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_types_round_trip_and_unknown_ones_are_refused() {
        for name in ["mod", "modpack", "resourcepack", "shader", "datapack"] {
            assert_eq!(ProjectType::parse(name).unwrap().name(), name);
        }
        assert!(ProjectType::parse("plugin").is_err());
    }

    #[test]
    fn sort_names_round_trip_and_unknown_ones_are_refused() {
        for name in ["relevance", "downloads", "follows", "newest", "updated"] {
            assert_eq!(SortIndex::parse(Some(name)).unwrap().unwrap().name(), name);
        }
        assert_eq!(SortIndex::parse(None).unwrap(), None);
        assert_eq!(SortIndex::parse(Some("random")).unwrap_err().to_string(), "Ungültige Sortierung");
    }

    #[test]
    fn without_a_wish_the_default_sort_depends_on_the_query() {
        let mut search = SearchQuery::of("  ", ProjectType::Mod);
        assert_eq!(search.sort(), SortIndex::Downloads);
        search.query = "sodium".into();
        assert_eq!(search.sort(), SortIndex::Relevance);
        search.index = Some(SortIndex::Newest);
        assert_eq!(search.sort(), SortIndex::Newest);
    }

    #[test]
    fn limits_and_filters_are_checked_once_for_every_catalog() {
        let search = SearchQuery { mc: Some("1.20.1".into()), loader: Some("fabric".into()), ..SearchQuery::of("jei", ProjectType::Mod) };
        assert!(search.ensure_within(3, 0).is_ok());
        assert!(search.ensure_within(2, 0).is_err(), "Suchbegriff zu lang");
        assert!(SearchQuery { offset: 1, ..search.clone() }.ensure_within(3, 0).is_err(), "Versatz zu groß");
        assert!(SearchQuery { mc: Some("../x".into()), ..search.clone() }.ensure_within(3, 0).is_err());
        assert!(SearchQuery { loader: Some("a b".into()), ..search.clone() }.ensure_within(3, 0).is_err());
        assert!(SearchQuery { category: Some("a b".into()), ..search }.ensure_within(3, 0).is_err());
    }
}
