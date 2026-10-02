//! Die Inhaltsliste nach einem Pack-Update: Einträge ersetzter, entfernter und ausgeschalteter Pack-Inhalte gehen,
//! die neuen Stände kommen dazu. Was der Spieler selbst hinzugefügt hat, bleibt unberührt.
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use super::diff::{Action, OnDisk, Step};
use crate::{
    models::Mod,
    services::{
        content::{content_file, CachedFile, ContentFile, Recognition},
        mods::game_path,
    },
};

/// Was das neue Pack über seine Inhalte weiß.
pub(super) struct PackContent<'a> {
    /// Modrinth-Erkennung der neuen Inhalte.
    pub(super) recognition: &'a Recognition,
    /// Aus `pumpkin.json` eigener Exporte: Dateiname → `required_by`.
    pub(super) required_by: &'a HashMap<String, Vec<String>>,
    /// Dateiname → (CurseForge-Projekt, Datei).
    pub(super) origins: &'a HashMap<String, (u32, u32)>,
}

impl PackContent<'_> {
    /// Hängt die Einträge der ankommenden Dateien an; sie gehören zum Pack.
    fn append(&self, mods: &mut Vec<Mod>, arriving: &[CachedFile]) {
        let first_new = mods.len();
        if self.required_by.is_empty() {
            self.recognition.append_recorded(mods, arriving, self.origins);
        } else {
            self.recognition.append_entries(mods, arriving, self.origins);
            for m in &mut mods[first_new..] {
                m.required_by = self.required_by.get(&m.file_name).cloned().unwrap_or_default();
            }
        }
        for m in &mut mods[first_new..] {
            m.pack_managed = true;
        }
    }
}

/// Die neue Inhaltsliste aus der alten und den Schritten des Updates.
pub(super) fn reconcile(old: &[Mod], steps: &[Step], pack: &PackContent<'_>) -> Vec<Mod> {
    let content: Vec<(&Step, ContentFile)> =
        steps.iter().filter_map(|s| Some((s, content_file(Path::new(&s.path))?))).collect();
    let gone: HashSet<String> = content
        .iter()
        .filter(|(s, _)| matches!(s.action, Action::Replace | Action::Remove | Action::Stash | Action::Drop))
        .map(|(s, _)| s.path.to_lowercase())
        .collect();
    let mut mods: Vec<Mod> = old.iter().filter(|m| !gone.contains(&game_path(m).to_lowercase())).cloned().collect();
    let arriving: Vec<CachedFile> = content
        .into_iter()
        .filter(|(s, _)| arrives(s, &mods))
        .filter_map(|(s, file)| {
            let enabled = s.action != Action::Stash;
            Some(CachedFile { sha1: s.new.clone()?, file: ContentFile { enabled, ..file } })
        })
        .collect();
    mods.retain(|m| !arriving.iter().any(|a| a.file.kind == m.kind && a.file.file_name.eq_ignore_ascii_case(&m.file_name)));
    pack.append(&mut mods, &arriving);
    mods
}

/// Kommt der neue Stand in die Liste? Neu abgelegt, ersetzt oder ausgeschaltet gecacht immer; liegt er schon so da
/// (etwa nach einem abgebrochenen Update), nur, wenn noch kein Eintrag auf die Datei zeigt.
fn arrives(step: &Step, mods: &[Mod]) -> bool {
    match step.action {
        Action::Place | Action::Replace | Action::Stash => true,
        Action::Leave => {
            matches!(&step.disk, OnDisk::Present(d) if step.new.as_ref() == Some(d))
                && !mods.iter().any(|m| game_path(m).eq_ignore_ascii_case(&step.path))
        }
        Action::Remove | Action::Drop | Action::Keep => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ModKind, ModSource};

    fn entry(file_name: &str, sha1: &str, enabled: bool) -> Mod {
        Mod {
            id: file_name.into(),
            name: file_name.into(),
            version: String::new(),
            source: ModSource::Local,
            file_name: file_name.into(),
            sha1: Some(sha1.into()),
            enabled,
            kind: ModKind::Mod,
            required_by: Vec::new(),
            pinned: false,
            pack_managed: false,
        }
    }

    fn step(path: &str, old: Option<&str>, new: Option<&str>, disk: OnDisk) -> Step {
        Step::new(path.into(), old.map(Into::into), new.map(Into::into), disk)
    }

    fn state(mods: &[Mod]) -> Vec<(&str, &str, bool)> {
        mods.iter().map(|m| (m.file_name.as_str(), m.sha1.as_deref().unwrap(), m.enabled)).collect()
    }

    #[test]
    fn pack_entries_follow_the_update_and_own_entries_stay() {
        let old = [entry("a-1.jar", "a1", true), entry("b-1.jar", "b1", false), entry("eigen.jar", "e", true), entry("d.jar", "d1", true)];
        let steps = [
            step("mods/a-1.jar", Some("a1"), None, OnDisk::Present("a1".into())),
            step("mods/a-2.jar", None, Some("a2"), OnDisk::Absent),
            step("mods/b-1.jar", Some("b1"), Some("b2"), OnDisk::Disabled("b1".into())),
            step("mods/d.jar", Some("d1"), Some("d2"), OnDisk::Present("d1".into())),
            step("config/x.toml", Some("x1"), Some("x2"), OnDisk::Present("x1".into())),
        ];
        let recognition = Recognition::default();
        let pack = PackContent { recognition: &recognition, required_by: &HashMap::new(), origins: &HashMap::new() };

        let mods = reconcile(&old, &steps, &pack);

        assert_eq!(state(&mods), [("eigen.jar", "e", true), ("a-2.jar", "a2", true), ("b-1.jar", "b2", false), ("d.jar", "d2", true)]);
    }

    #[test]
    fn content_the_update_brings_belongs_to_the_pack() {
        let old = [entry("eigen.jar", "e", true)];
        let steps = [step("mods/neu.jar", None, Some("n"), OnDisk::Absent)];
        let recognition = Recognition::default();
        let owners = HashMap::from([("neu.jar".to_string(), vec!["x".to_string()])]);
        for required_by in [HashMap::new(), owners] {
            let pack = PackContent { recognition: &recognition, required_by: &required_by, origins: &HashMap::new() };

            let managed: Vec<(String, bool)> =
                reconcile(&old, &steps, &pack).into_iter().map(|m| (m.file_name, m.pack_managed)).collect();

            assert_eq!(managed, [("eigen.jar".to_string(), false), ("neu.jar".to_string(), true)]);
        }
    }

    #[test]
    fn files_already_in_place_without_an_entry_are_listed() {
        let steps = [step("mods/neu.jar", Some("alt"), Some("n"), OnDisk::Present("n".into()))];
        let recognition = Recognition::default();
        let pack = PackContent { recognition: &recognition, required_by: &HashMap::new(), origins: &HashMap::new() };

        assert_eq!(state(&reconcile(&[], &steps, &pack)), [("neu.jar", "n", true)]);
        let listed = [entry("neu.jar", "n", true)];
        assert_eq!(reconcile(&listed, &steps, &pack).len(), 1, "kein zweiter Eintrag");
    }

    #[test]
    fn own_exports_carry_their_required_by() {
        let steps = [step("mods/lib.jar", None, Some("l"), OnDisk::Absent)];
        let recognition = Recognition::default();
        let required_by = HashMap::from([("lib.jar".to_string(), vec!["owner".to_string()])]);
        let pack = PackContent { recognition: &recognition, required_by: &required_by, origins: &HashMap::new() };

        assert_eq!(reconcile(&[], &steps, &pack)[0].required_by, ["owner"]);
    }
}
