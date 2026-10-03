//! Services: Persistenz, Auth, Installation (Mojang-Formate, Downloads, Java), Spielstart, Kopie, Export und
//! Import von Instanzen, Welten und Server, Skins und Support.
mod dataurl;
mod dirs;
mod fsutil;
mod server_srv;
mod tasks;
#[cfg(test)]
mod testutil;

pub mod auth;
pub mod content;
pub mod datapacks;
pub mod crashreport;
pub mod debuginfo;
pub mod download;
pub mod duplicate;
pub mod endpoint_url;
pub mod friends;
pub mod gamesignal;
pub mod gamelog;
pub mod imports;
pub mod install;
pub mod java;
pub mod javadetect;
pub mod lan_detect;
pub mod launch;
pub mod launch_args;
pub mod limits;
pub mod loader;
pub mod local_files;
pub mod logshare;
pub mod migrate;
pub mod modrinth;
pub mod modbridge;
pub mod mods;
pub mod mojang;
pub mod mrpack;
pub mod p2p;
pub mod pack_update;
pub mod pack_selection;
pub mod presence;
pub mod progress;
pub mod providers;
pub mod rules;
pub mod screenshots;
pub mod secrets;
pub mod server_ping;
pub mod servers;
pub mod shared_types;
pub mod sessionlog;
pub mod skins;
pub mod sockowner;
pub mod storage;
pub mod store;
pub mod system;
pub mod templates;
pub mod transport;
pub mod worlds;
pub mod zip_guard;

pub(crate) use dataurl::{data_url, PNG_DATA_URL};
pub use dirs::Dirs;
pub use loader::forge;
pub(crate) use dirs::REGENERATED;
pub(crate) use fsutil::{
    add_zip_file, copy_files, entries, find_listed, first_free_name, free_name, has_extension, none_if_missing,
    remove_logged, require_plain_name, strip_extension, trash_listed, walk, write_atomic, write_zip_atomic,
};
pub(crate) use tasks::{blocking, check_cancelled, lock, until_phases_end};
#[cfg(test)]
pub(crate) use testutil::{compound, gzip_nbt, write_files};
