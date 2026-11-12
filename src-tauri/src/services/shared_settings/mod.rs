//! Serverliste und Spieloptionen, die sich Instanzen teilen (`Instance::sharing`). Minecraft ersetzt beide Dateien beim
//! Speichern durch eine neue, ein Link ginge dabei verloren: der Launcher gleicht deshalb selbst ab. Die gemeinsame
//! Kopie liegt unter `Dirs::shared_settings`. Vor dem Start bekommt die Instanz sie (`before_launch`), nach dem Ende
//! fließen ihre Änderungen zurück (`after_exit`). Was sie beim Start bekam, hält `Dirs::shared_base` fest, solange das
//! Spiel läuft: daran erkennt der Abgleich, was diese Sitzung geändert hat, und überschreibt nichts, was eine
//! gleichzeitig laufende Instanz geändert hat.
mod options;
mod servers;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::{
    error::AppResult,
    models::{Instance, Sharing},
    services::{lock, none_if_missing, write_atomic, Dirs},
};

/// Hüter der gemeinsamen Kopie: Starts, Spielenden und Änderungen aus dem Launcher gleichen nacheinander ab.
#[derive(Default)]
pub struct SharedSettings {
    held: Mutex<()>,
}

impl SharedSettings {
    /// Gibt der Instanz, was sie teilt. Hat eine frühere Sitzung nicht mehr abgeglichen (der Launcher war vor dem Spiel
    /// zu), kommen deren Änderungen zuerst zurück. Serverliste und Optionen gehen unabhängig: scheitert eine, bekommt die
    /// Instanz die andere trotzdem; der Fehler ist der erste.
    pub fn before_launch(&self, dirs: &Dirs, instance: &Instance) -> AppResult<()> {
        let _held = lock(&self.held);
        let id = &instance.id;
        let servers = servers::take_back(dirs, id).and_then(|()| match instance.sharing.servers {
            true => servers::hand_out(dirs, id),
            false => Ok(()),
        });
        let options = options::take_back(dirs, id).and_then(|()| match instance.sharing.options {
            true => options::hand_out(dirs, instance),
            false => Ok(()),
        });
        servers.and(options)
    }

    /// Übernimmt, was die beendete Sitzung geändert hat, in die gemeinsame Kopie.
    pub fn after_exit(&self, dirs: &Dirs, instance_id: &str) -> AppResult<()> {
        let _held = lock(&self.held);
        take_back(dirs, instance_id)
    }

    /// Vor dem Umschalten auf `wanted` (das Spiel der Instanz läuft nicht): Ein liegengebliebener Startstand wird zuerst
    /// abgeglichen, solange er noch zum geteilten Stand gehört. Neu Eingeschaltetes nimmt die Instanz auf: ihre Server
    /// kommen zur gemeinsamen Liste; ihre Optionen werden zur gemeinsamen Kopie, wenn es noch keine gibt, sonst bekommt
    /// sie beim nächsten Start die gemeinsamen. Ausschalten ändert die Dateien nicht, die Instanz behält ihren Stand.
    pub fn change(&self, dirs: &Dirs, instance: &Instance, wanted: Sharing) -> AppResult<()> {
        let _held = lock(&self.held);
        take_back(dirs, &instance.id)?;
        if wanted.servers && !instance.sharing.servers {
            servers::join(dirs, &instance.id)?;
        }
        if wanted.options && !instance.sharing.options {
            options::join(dirs, instance)?;
        }
        Ok(())
    }

    /// Führt `work` mit dem Ordner aus, dessen `servers.dat` die Serverliste der Instanz ist (`server_list_dir`);
    /// die gemeinsame ändert dabei kein Abgleich.
    pub fn with_server_list<T>(&self, dirs: &Dirs, instance: &Instance, work: impl FnOnce(&Path) -> AppResult<T>) -> AppResult<T> {
        let _held = instance.sharing.servers.then(|| lock(&self.held));
        work(&server_list_dir(dirs, instance))
    }
}

/// Der Ordner, dessen `servers.dat` die Serverliste der Instanz ist: die gemeinsame oder ihre. Lesen geht ohne
/// `with_server_list`, denn jede Datei wird atomar ersetzt.
pub fn server_list_dir(dirs: &Dirs, instance: &Instance) -> PathBuf {
    if instance.sharing.servers { dirs.shared_settings() } else { dirs.game_dir(&instance.id) }
}

/// Gleicht beide Arten ab, auch wenn eine scheitert; der Fehler ist der erste.
fn take_back(dirs: &Dirs, instance_id: &str) -> AppResult<()> {
    let servers = servers::take_back(dirs, instance_id);
    let options = options::take_back(dirs, instance_id);
    servers.and(options)
}

/// Was die Instanz beim Start unter `name` bekam; `None`, wenn ihr Spiel nichts Geteiltes bekommen hat.
fn read_base(dirs: &Dirs, instance_id: &str, name: &str) -> AppResult<Option<Vec<u8>>> {
    Ok(none_if_missing(fs::read(dirs.shared_base(instance_id).join(name)))?)
}

fn write_base(dirs: &Dirs, instance_id: &str, name: &str, bytes: &[u8]) -> AppResult<()> {
    let dir = dirs.shared_base(instance_id);
    fs::create_dir_all(&dir)?;
    write_atomic(&dir.join(name), bytes)
}

fn remove_base(dirs: &Dirs, instance_id: &str, name: &str) -> AppResult<()> {
    none_if_missing(fs::remove_file(dirs.shared_base(instance_id).join(name)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{new_id, ModLoader, NewInstance},
        services::{
            compound,
            options_txt::{read_text, write_text},
            servers::{self as server_file, FILE as SERVERS},
        },
    };
    use fastnbt::Value;

    fn sharing_instance() -> Instance {
        let new = NewInstance { name: "Test".into(), minecraft_version: "1.21.1".into(), loader: ModLoader::Vanilla, loader_version: None };
        Instance { sharing: Sharing { servers: true, options: true }, ..Instance::from_new(new) }
    }

    fn servers(addresses: &[&str]) -> Vec<Value> {
        addresses.iter().map(|address| compound(vec![("name", Value::String((*address).into())), ("ip", Value::String((*address).into()))])).collect()
    }

    fn addresses(dir: &Path) -> Vec<String> {
        server_file::visible_entries(dir).unwrap().iter().map(|entry| server_file::address_of(entry).to_owned()).collect()
    }

    #[test]
    fn a_leftover_snapshot_is_settled_before_sharing_is_switched_off() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        let shared = SharedSettings::default();
        let instance = sharing_instance();
        let (game, options) = (dirs.game_dir(&instance.id), dirs.game_dir(&instance.id).join("options.txt"));
        server_file::replace_visible(&dirs.shared_settings(), servers(&["a", "b"])).unwrap();
        write_text(&dirs.shared_settings().join("options.txt"), "version:3955\nfov:0.0\n").unwrap();

        // Übergeben, im Spiel geändert, doch das Ende hat der Launcher nicht mehr erlebt.
        shared.before_launch(&dirs, &instance).unwrap();
        server_file::replace_visible(&game, servers(&["a", "b", "c"])).unwrap();
        write_text(&options, "version:3955\nfov:0.5\n").unwrap();

        shared.change(&dirs, &instance, Sharing::default()).unwrap();
        let private = Instance { sharing: Sharing::default(), ..instance };
        server_file::replace_visible(&game, servers(&["c"])).unwrap();
        write_text(&options, "version:3955\nfov:1.0\n").unwrap();
        shared.before_launch(&dirs, &private).unwrap();

        assert_eq!(addresses(&dirs.shared_settings()), ["a", "b", "c"]);
        assert_eq!(read_text(&dirs.shared_settings().join("options.txt")).unwrap(), "version:3955\nfov:0.5\n");
        assert_eq!(addresses(&game), ["c"], "die eigene Liste bleibt, wie sie ist");
        assert!(!dirs.shared_base(&private.id).join(SERVERS).exists());
        fs::remove_dir_all(&dirs.root).unwrap();
    }

    #[test]
    fn a_broken_server_list_does_not_keep_the_options_from_being_shared() {
        let dirs = Dirs::new(std::env::temp_dir().join(new_id()));
        let shared = SharedSettings::default();
        let instance = sharing_instance();
        write_text(&dirs.shared_settings().join("options.txt"), "version:3955\nfov:0.5\n").unwrap();
        fs::create_dir_all(dirs.shared_settings()).unwrap();
        fs::write(dirs.shared_settings().join(SERVERS), b"kein NBT").unwrap();

        assert!(shared.before_launch(&dirs, &instance).is_err());
        let options = read_text(&dirs.game_dir(&instance.id).join("options.txt")).unwrap();
        assert_eq!(options, "fov:0.5\nversion:3955\n");
        fs::remove_dir_all(&dirs.root).unwrap();
    }
}
