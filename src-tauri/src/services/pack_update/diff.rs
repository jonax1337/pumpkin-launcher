//! Was ein Pack-Update mit jeder Datei tut. Grundlage sind drei Stände: was das alte Pack abgelegt hat, was das neue
//! bringt und was im Spielordner liegt. Ersetzt oder entfernt wird nur, was noch so daliegt, wie das alte Pack es
//! brachte; was der Spieler geändert, hinzugefügt, ausgeschaltet oder entfernt hat, bleibt so.
use std::collections::HashSet;

/// Stand einer Pack-Datei beim Spieler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum OnDisk {
    Absent,
    /// Liegt im Spielordner, mit diesem SHA-1.
    Present(String),
    /// Ausgeschalteter Inhalt: die Datei fehlt, sein Eintrag (mit diesem SHA-1) bleibt.
    Disabled(String),
    /// Ordner oder Verknüpfung, wo das Pack eine Datei hat.
    Other,
}

/// Was das Update mit einer Datei tut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Action {
    /// Neue Datei des Packs ablegen.
    Place,
    /// Unveränderte Datei des alten Packs gegen die neue tauschen.
    Replace,
    /// Unveränderte Datei, die das neue Pack nicht mehr hat, entfernen.
    Remove,
    /// Ausgeschalteter Inhalt in neuer Fassung: nur in den Mod-Cache, der Eintrag bleibt aus.
    Stash,
    /// Ausgeschalteter Inhalt, den das neue Pack nicht mehr hat: sein Eintrag geht.
    Drop,
    /// Vom Spieler geändert oder selbst angelegt: bleibt.
    Keep,
    /// Nichts zu tun: schon aktuell oder vom Spieler entfernt.
    Leave,
}

/// Eine Datei des alten oder neuen Packs (Pfad relativ zum Spielordner, mit `/`) mit ihren drei Ständen.
#[derive(Debug, Clone)]
pub(super) struct Step {
    pub(super) path: String,
    pub(super) old: Option<String>,
    pub(super) new: Option<String>,
    pub(super) disk: OnDisk,
    pub(super) action: Action,
}

impl Step {
    pub(super) fn new(path: String, old: Option<String>, new: Option<String>, disk: OnDisk) -> Self {
        let action = decide(old.as_deref(), new.as_deref(), &disk);
        Self { path, old, new, disk, action }
    }

    /// Der Stand des alten Packs, wenn er unverändert daliegt und trotzdem bleibt; das gibt es nur bei festgehaltenen
    /// Inhalten ([`respect_pinned`]).
    pub(super) fn held_old(&self) -> Option<&str> {
        let on_disk = match &self.disk {
            OnDisk::Present(sha1) | OnDisk::Disabled(sha1) => Some(sha1.as_str()),
            OnDisk::Absent | OnDisk::Other => None,
        };
        self.old.as_deref().filter(|old| self.action == Action::Keep && on_disk == Some(*old))
    }
}

/// Die Entscheidung für eine Datei: `old` und `new` sind die SHA-1 im alten und neuen Pack (fehlt = nicht dabei).
pub(super) fn decide(old: Option<&str>, new: Option<&str>, disk: &OnDisk) -> Action {
    let untouched = |on_disk: &str| old == Some(on_disk);
    match (new, disk) {
        (_, OnDisk::Other) => Action::Keep,
        (Some(new), OnDisk::Present(d) | OnDisk::Disabled(d)) if d == new => Action::Leave,
        (Some(_), OnDisk::Absent) if old.is_none() => Action::Place,
        (_, OnDisk::Absent) => Action::Leave,
        (Some(_), OnDisk::Present(d)) if untouched(d) => Action::Replace,
        (Some(_), OnDisk::Disabled(d)) if untouched(d) => Action::Stash,
        (None, OnDisk::Present(d)) if untouched(d) => Action::Remove,
        (None, OnDisk::Disabled(d)) if untouched(d) => Action::Drop,
        (_, OnDisk::Present(_) | OnDisk::Disabled(_)) => Action::Keep,
    }
}

/// Bringt das neue Pack ein Projekt unter neuem Dateinamen, das der Spieler im alten ausgeschaltet oder entfernt hat,
/// bleibt das so: ausgeschaltet kommt die neue Fassung nur in den Cache, entfernt bleibt sie weg. `project_of` nennt
/// das Projekt zu einem SHA-1, soweit es bekannt ist.
pub(super) fn respect_switched_off(steps: &mut [Step], project_of: impl Fn(&str) -> Option<String>) {
    let old_project = |step: &Step| step.old.as_deref().and_then(&project_of);
    let switched_off: HashSet<String> = steps.iter().filter(|s| s.action == Action::Drop).filter_map(old_project).collect();
    let removed: HashSet<String> = steps
        .iter()
        .filter(|s| s.new.is_none() && s.disk == OnDisk::Absent)
        .filter_map(old_project)
        .collect();
    for step in steps.iter_mut().filter(|s| s.action == Action::Place) {
        let Some(project) = step.new.as_deref().and_then(&project_of) else { continue };
        if switched_off.contains(&project) {
            step.action = Action::Stash;
        } else if removed.contains(&project) {
            step.action = Action::Leave;
        }
    }
}

/// Festgehaltene Inhalte (`pinned`, Pfade kleingeschrieben) bleiben auf ihrer Version: das Pack ersetzt oder entfernt
/// sie nicht, und eine neue Datei desselben Projekts unter anderem Namen kommt nicht daneben. `project_of` nennt das
/// Projekt zu einem SHA-1, soweit es bekannt ist.
pub(super) fn respect_pinned(steps: &mut [Step], pinned: &HashSet<String>, project_of: impl Fn(&str) -> Option<String>) {
    let mut held_projects = HashSet::new();
    let changing = |s: &Step| matches!(s.action, Action::Replace | Action::Remove | Action::Stash | Action::Drop);
    for step in steps.iter_mut().filter(|s| changing(s) && pinned.contains(&s.path.to_lowercase())) {
        step.action = Action::Keep;
        held_projects.extend(step.old.as_deref().and_then(&project_of));
    }
    for step in steps.iter_mut().filter(|s| s.action == Action::Place) {
        if step.new.as_deref().and_then(&project_of).is_some_and(|project| held_projects.contains(&project)) {
            step.action = Action::Leave;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn present(sha1: &str) -> OnDisk {
        OnDisk::Present(sha1.into())
    }

    #[test]
    fn untouched_pack_files_follow_the_new_pack() {
        assert_eq!(decide(Some("a"), Some("b"), &present("a")), Action::Replace);
        assert_eq!(decide(Some("a"), None, &present("a")), Action::Remove);
        assert_eq!(decide(None, Some("b"), &OnDisk::Absent), Action::Place);
        assert_eq!(decide(Some("a"), Some("a"), &present("a")), Action::Leave);
    }

    #[test]
    fn files_the_player_changed_or_added_stay() {
        // Geänderte Konfiguration: das Pack ändert sie auch, die des Spielers bleibt.
        assert_eq!(decide(Some("a"), Some("b"), &present("eigen")), Action::Keep);
        // Das neue Pack bringt eine Datei, die der Spieler schon selbst angelegt hat.
        assert_eq!(decide(None, Some("b"), &present("eigen")), Action::Keep);
        // Das Pack lässt eine Datei fallen, die der Spieler geändert hat.
        assert_eq!(decide(Some("a"), None, &present("eigen")), Action::Keep);
        // Wo eine Datei hin soll, liegt ein Ordner.
        assert_eq!(decide(None, Some("b"), &OnDisk::Other), Action::Keep);
        // Das neue Pack bringt genau den Stand, den der Spieler schon hat.
        assert_eq!(decide(Some("a"), Some("eigen"), &present("eigen")), Action::Leave);
    }

    #[test]
    fn removed_files_stay_removed() {
        assert_eq!(decide(Some("a"), Some("b"), &OnDisk::Absent), Action::Leave);
        assert_eq!(decide(Some("a"), None, &OnDisk::Absent), Action::Leave);
    }

    #[test]
    fn switched_off_content_stays_off() {
        let off = OnDisk::Disabled("a".into());
        assert_eq!(decide(Some("a"), Some("b"), &off), Action::Stash);
        assert_eq!(decide(Some("a"), None, &off), Action::Drop);
        assert_eq!(decide(Some("a"), Some("a"), &off), Action::Leave);
        // Ein eigener ausgeschalteter Inhalt unter einem Namen, den das Pack jetzt auch nutzt.
        assert_eq!(decide(None, Some("b"), &OnDisk::Disabled("eigen".into())), Action::Keep);
    }

    #[test]
    fn renamed_files_of_switched_off_or_removed_projects_stay_off() {
        let mut steps = vec![
            Step::new("mods/iris-1.jar".into(), Some("i1".into()), None, OnDisk::Disabled("i1".into())),
            Step::new("mods/iris-2.jar".into(), None, Some("i2".into()), OnDisk::Absent),
            Step::new("mods/jei-1.jar".into(), Some("j1".into()), None, OnDisk::Absent),
            Step::new("mods/jei-2.jar".into(), None, Some("j2".into()), OnDisk::Absent),
            Step::new("mods/neu.jar".into(), None, Some("n1".into()), OnDisk::Absent),
        ];
        let project = |sha1: &str| sha1.get(..1).filter(|p| *p != "n").map(str::to_owned);

        respect_switched_off(&mut steps, project);

        let actions: Vec<Action> = steps.iter().map(|s| s.action).collect();
        assert_eq!(actions, [Action::Drop, Action::Stash, Action::Leave, Action::Leave, Action::Place]);
    }

    #[test]
    fn pinned_content_stays_on_its_version() {
        let mut steps = vec![
            Step::new("mods/a.jar".into(), Some("a1".into()), Some("a2".into()), present("a1")),
            Step::new("mods/b-1.jar".into(), Some("b1".into()), None, present("b1")),
            Step::new("mods/b-2.jar".into(), None, Some("b2".into()), OnDisk::Absent),
            Step::new("mods/c.jar".into(), Some("c1".into()), Some("c2".into()), present("c1")),
            Step::new("mods/neu.jar".into(), None, Some("n1".into()), OnDisk::Absent),
        ];
        let pinned = HashSet::from(["mods/a.jar".to_string(), "mods/b-1.jar".to_string()]);
        let project = |sha1: &str| sha1.get(..1).filter(|p| *p != "n").map(str::to_owned);

        respect_pinned(&mut steps, &pinned, project);

        let actions: Vec<Action> = steps.iter().map(|s| s.action).collect();
        assert_eq!(actions, [Action::Keep, Action::Keep, Action::Leave, Action::Replace, Action::Place]);
        let held: Vec<Option<&str>> = steps.iter().map(Step::held_old).collect();
        assert_eq!(held, [Some("a1"), Some("b1"), None, None, None]);
        assert_eq!(Step::new("c.toml".into(), Some("a".into()), Some("b".into()), present("eigen")).held_old(), None);
    }
}
