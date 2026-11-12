//! Die gemeinsame Serverliste. Abgeglichen wird nach Adresse; versteckte Einträge (Quick Play) bleiben bei ihrer
//! Instanz. Der Startstand ist eine `servers.dat` unter `Dirs::shared_base`.
use std::collections::{HashMap, HashSet};

use fastnbt::Value;

use super::remove_base;
use crate::{
    error::AppResult,
    services::{servers, Dirs},
};

pub(super) fn hand_out(dirs: &Dirs, instance_id: &str) -> AppResult<()> {
    let shared = servers::visible_entries(&dirs.shared_settings())?;
    servers::replace_visible(&dirs.game_dir(instance_id), shared.clone())?;
    servers::replace_visible(&dirs.shared_base(instance_id), shared)
}

/// Übernimmt die Änderungen der Sitzung. Fehlt die Liste der Instanz ganz (von Hand gelöscht), gilt das nicht als
/// Löschen aller Server: der Startstand verfällt dann ohne Abgleich.
pub(super) fn take_back(dirs: &Dirs, instance_id: &str) -> AppResult<()> {
    let base_dir = dirs.shared_base(instance_id);
    if !base_dir.join(servers::FILE).is_file() {
        return Ok(());
    }
    let game_dir = dirs.game_dir(instance_id);
    if game_dir.join(servers::FILE).is_file() {
        let given = servers::visible_entries(&base_dir)?;
        let own = servers::visible_entries(&game_dir)?;
        let shared_dir = dirs.shared_settings();
        let shared = servers::visible_entries(&shared_dir)?;
        servers::replace_visible(&shared_dir, merge(shared, &given, own))?;
    }
    remove_base(dirs, instance_id, servers::FILE)
}

/// Die gemeinsame Liste bekommt die Server der Instanz dazu, die sie noch nicht hat.
pub(super) fn join(dirs: &Dirs, instance_id: &str) -> AppResult<()> {
    let shared_dir = dirs.shared_settings();
    let mut shared = servers::visible_entries(&shared_dir)?;
    let known = addresses(&shared);
    let own = servers::visible_entries(&dirs.game_dir(instance_id))?;
    shared.extend(own.into_iter().filter(|entry| !known.contains(servers::address_of(entry))));
    servers::replace_visible(&shared_dir, shared)
}

/// Drei-Wege-Abgleich nach Adresse; `given` ist die Liste, die die Instanz beim Start bekam. Die Liste der Instanz
/// gibt die Reihenfolge vor. Einen Eintrag, den die Sitzung nicht geändert hat, gibt es so, wie er gemeinsam inzwischen
/// ist; was sie geändert oder hinzugefügt hat, so, wie sie es hat. Was sie seit dem Start gelöscht hat, fehlt danach;
/// was eine andere Instanz inzwischen gelöscht hat, ebenso; was eine andere hinzugefügt hat, kommt ans Ende.
fn merge(shared: Vec<Value>, given: &[Value], own: Vec<Value>) -> Vec<Value> {
    let given: HashMap<&str, &Value> = given.iter().map(|entry| (servers::address_of(entry), entry)).collect();
    let own_addresses = addresses(&own);
    let fresh: Vec<Value> = shared
        .iter()
        .filter(|entry| !given.contains_key(servers::address_of(entry)) && !own_addresses.contains(servers::address_of(entry)))
        .cloned()
        .collect();
    let mut current: HashMap<String, Value> =
        shared.into_iter().map(|entry| (servers::address_of(&entry).to_owned(), entry)).collect();
    let kept = own.into_iter().filter_map(|entry| match given.get(servers::address_of(&entry)) {
        None => Some(entry),
        Some(before) if !servers::same_server(before, &entry) => Some(entry),
        // Unverändert in dieser Sitzung: der gemeinsame Stand gilt; fehlt er, hat eine andere Instanz gelöscht.
        Some(_) => current.remove(servers::address_of(&entry)),
    });
    let mut merged: Vec<Value> = kept.collect();
    merged.extend(fresh);
    merged
}

fn addresses(entries: &[Value]) -> HashSet<String> {
    entries.iter().map(|entry| servers::address_of(entry).to_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::new_id, services::compound};

    fn named(name: &str, address: &str) -> Value {
        compound(vec![("name", Value::String(name.into())), ("ip", Value::String(address.into()))])
    }

    fn list(addresses: &[&str]) -> Vec<Value> {
        addresses.iter().map(|address| named(&address.to_uppercase(), address)).collect()
    }

    fn shown(entries: &[Value]) -> Vec<&str> {
        entries.iter().map(servers::address_of).collect()
    }

    #[test]
    fn the_session_keeps_its_order_and_its_additions_and_deletions() {
        let merged = merge(list(&["a", "b", "c"]), &list(&["a", "b", "c"]), list(&["c", "a", "d"]));
        assert_eq!(shown(&merged), ["c", "a", "d"]);
    }

    #[test]
    fn changes_of_another_instance_during_the_session_survive() {
        // Während die Instanz lief, hat eine andere „b“ gelöscht, „a“ umbenannt und „x“ hinzugefügt.
        let shared = vec![named("Hub", "a"), named("C", "c"), named("X", "x")];
        let merged = merge(shared, &list(&["a", "b", "c"]), list(&["a", "b", "c"]));
        assert_eq!(merged, [named("Hub", "a"), named("C", "c"), named("X", "x")]);
    }

    #[test]
    fn an_entry_the_session_changed_wins_and_a_new_icon_alone_is_no_change() {
        let renamed = named("Neu", "a");
        assert_eq!(merge(vec![named("Hub", "a")], &list(&["a"]), vec![renamed.clone()]), [renamed]);

        let pinged = compound(vec![("name", Value::String("A".into())), ("ip", Value::String("a".into())), ("icon", Value::String("iVBO".into()))]);
        assert_eq!(merge(vec![named("Hub", "a")], &list(&["a"]), vec![pinged]), [named("Hub", "a")]);
    }

    #[test]
    fn a_session_hands_out_the_shared_list_and_brings_back_its_changes() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        servers::replace_visible(&dirs.game_dir("first"), list(&["mine"])).unwrap();
        join(&dirs, "first").unwrap();
        servers::replace_visible(&dirs.game_dir("second"), list(&["old"])).unwrap();

        hand_out(&dirs, "second").unwrap();
        assert_eq!(shown(&servers::visible_entries(&dirs.game_dir("second")).unwrap()), ["mine"]);
        servers::replace_visible(&dirs.game_dir("second"), list(&["mine", "new"])).unwrap();
        take_back(&dirs, "second").unwrap();

        assert_eq!(shown(&servers::visible_entries(&dirs.shared_settings()).unwrap()), ["mine", "new"]);
        assert!(!dirs.shared_base("second").join(servers::FILE).exists(), "nach dem Abgleich gibt es keinen Startstand mehr");
        take_back(&dirs, "second").unwrap();
        std::fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn a_missing_list_in_the_instance_deletes_nothing_shared() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        servers::replace_visible(&dirs.shared_settings(), list(&["a", "b"])).unwrap();
        hand_out(&dirs, "i").unwrap();
        std::fs::remove_file(dirs.game_dir("i").join(servers::FILE)).unwrap();
        take_back(&dirs, "i").unwrap();
        assert_eq!(shown(&servers::visible_entries(&dirs.shared_settings()).unwrap()), ["a", "b"]);
        assert!(!dirs.shared_base("i").join(servers::FILE).exists());
        std::fs::remove_dir_all(&dirs.root).unwrap();
    }
}
