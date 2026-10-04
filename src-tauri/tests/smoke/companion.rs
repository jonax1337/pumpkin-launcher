//! Mods, die eine Zelle neben der eingespeisten braucht. Die Mod meldet heute noch `fabric-api` als Abhängigkeit
//! (`mod/descriptors/fabric/fabric.mod.json`); bis ein Paket sie entfernt, legt der Rauchtest die Fabric API in den
//! Mods-Ordner der Rauchtest-Instanz. Das ist ein Zustand der Instanz, nicht der Einspeisung.
use std::fs;
use std::path::{Path, PathBuf};

use launcher_lib::models::ModLoader;
use data_encoding::HEXLOWER;
use sha1::{Digest, Sha1};

const FABRIC_MAVEN: &str = "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api";

/// Die Fabric API je Minecraft-Version, je die, gegen die der Knoten gebaut ist (`mod/versions/<Knoten>/gradle.properties`).
const FABRIC_API: [(&str, &str); 2] = [("26.3", "0.161.0+26.3"), ("1.21.1", "0.116.17+1.21.1")];

/// Legt die Begleit-Mods der Zelle in `mods_dir` und liefert die Dateien.
pub async fn provide(client: &reqwest::Client, loader: ModLoader, minecraft: &str, mods_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if loader != ModLoader::Fabric {
        return Ok(Vec::new());
    }
    let version = FABRIC_API.iter().find(|(known, _)| *known == minecraft).map(|(_, version)| *version).ok_or_else(|| format!("keine Fabric API für Minecraft {minecraft} hinterlegt"))?;
    fs::create_dir_all(mods_dir).map_err(|error| error.to_string())?;
    let file = mods_dir.join(format!("fabric-api-{version}.jar"));
    if !file.is_file() {
        let url = format!("{FABRIC_MAVEN}/{version}/fabric-api-{version}.jar");
        fetch_verified(client, &url, &file).await?;
    }
    Ok(vec![file])
}

/// Lädt `url` nach `target` und prüft die SHA-1, die der Maven-Server neben der Datei veröffentlicht.
async fn fetch_verified(client: &reqwest::Client, url: &str, target: &Path) -> Result<(), String> {
    let bytes = get(client, url).await?;
    let expected = String::from_utf8(get(client, &format!("{url}.sha1")).await?).map_err(|error| error.to_string())?;
    let actual = HEXLOWER.encode(&Sha1::digest(&bytes));
    if expected.split_whitespace().next() != Some(actual.as_str()) {
        return Err(format!("{url}: SHA-1 stimmt nicht (erwartet {}, erhalten {actual})", expected.trim()));
    }
    fs::write(target, bytes).map_err(|error| error.to_string())
}

async fn get(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.and_then(reqwest::Response::error_for_status).map_err(|error| format!("{url}: {error}"))?;
    response.bytes().await.map(|bytes| bytes.to_vec()).map_err(|error| format!("{url}: {error}"))
}
