//! Technic: öffentliche Suche und Pack-Details ohne Schlüssel. Die Pack-Zips liegen auf beliebigen
//! Servern der Autoren (meist Dropbox oder GitHub), ohne Prüfsumme. Pumpkin Launcher lädt sie trotzdem,
//! aber nur über `net::download_public` (HTTPS, öffentliche Adressen) und entpackt sie mit denselben
//! Pfad- und Größenregeln wie ein `.mrpack`. Loader und Minecraft-Version stehen in `bin/version.json`.
use super::{json, net, segment, zip_files, MIB, ZIP_LIMIT};
use crate::{
    error::AppResult,
    models::{Instance, ModLoader, NewInstance},
    services::{
        content::{Blob, Pack, TempFile},
        forge,
        modrinth::{identifier, invalid, File, Hit, Project, SearchResponse, Version},
        Dirs,
    },
};
use futures::StreamExt;
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Read,
    sync::{Arc, Mutex},
};

const API: &str = "https://api.technicpack.net";
/// Die API verlangt eine Build-Nummer des Technic-Launchers; jede Zahl wird akzeptiert.
const BUILD: &str = "999";

#[derive(Deserialize)]
struct Listing {
    #[serde(default)]
    modpacks: Vec<Entry>,
}
#[derive(Deserialize)]
struct Entry {
    slug: String,
}
#[derive(Deserialize)]
struct Detail {
    name: String,
    #[serde(rename = "displayName", default)]
    display_name: Option<String>,
    #[serde(default)]
    user: Option<String>,
    #[serde(rename = "platformUrl", default)]
    platform_url: Option<String>,
    #[serde(default)]
    minecraft: Option<String>,
    #[serde(default)]
    installs: u64,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<Image>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    tags: Option<String>,
    /// Adresse des Pack-Zips (nicht bei Solder-Packs).
    #[serde(default)]
    url: Option<String>,
    /// Solder-Packs setzen sich aus vielen Teil-Zips zusammen (ältere Technik).
    #[serde(default)]
    solder: Option<String>,
}
#[derive(Deserialize)]
struct Image {
    #[serde(default)]
    url: Option<String>,
}

/// Beschreibung ohne HTML-Tags und Zeilenumbrüche, für die Zeile im Katalog.
fn plain(s: &str) -> String {
    let mut out = String::new();
    let mut tag = false;
    for c in s.chars() {
        match c {
            '<' => tag = true,
            '>' => tag = false,
            c if !tag => out.push(c),
            _ => {}
        }
    }
    let text = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > 220 { format!("{}…", text.chars().take(219).collect::<String>().trim_end()) } else { text }
}

fn title(d: &Detail) -> String {
    d.display_name.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| d.name.clone())
}

fn hit(d: &Detail) -> Hit {
    Hit {
        project_id: d.name.clone(),
        slug: d.name.clone(),
        title: title(d),
        description: plain(d.description.as_deref().unwrap_or_default()),
        icon_url: d.icon.as_ref().and_then(|i| i.url.clone()),
        project_type: "modpack".into(),
        downloads: d.installs,
        author: d.user.clone().unwrap_or_default(),
        categories: d
            .tags
            .as_deref()
            .unwrap_or_default()
            .split(',')
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty())
            .collect(),
    }
}

async fn detail(client: &reqwest::Client, slug: &str) -> AppResult<Detail> {
    segment(slug)?;
    let d: Detail = json(client, &format!("{API}/modpack/{slug}?build={BUILD}")).await?;
    if d.name != slug {
        return Err(invalid("Technic-Pack stimmt nicht überein"));
    }
    Ok(d)
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    kind: &str,
    mc: Option<&str>,
    offset: u32,
    index: Option<&str>,
) -> AppResult<SearchResponse> {
    if query.len() > 512 {
        return Err(invalid("Ungültige Suche"));
    }
    let empty = SearchResponse { hits: Vec::new(), total_hits: 0, offset, limit: 20 };
    // Technic liefert eine einzige Seite ohne Versatz.
    if kind != "modpack" || offset > 0 {
        return Ok(empty);
    }
    let query = query.trim();
    let mut url = reqwest::Url::parse(&format!("{API}/{}", if query.is_empty() { "trending" } else { "search" }))
        .map_err(|e| invalid(e.to_string()))?;
    url.query_pairs_mut().append_pair("build", BUILD);
    if !query.is_empty() {
        url.query_pairs_mut().append_pair("q", query);
    }
    let listing: Listing = json(client, url.as_str()).await?;
    let details: Vec<Detail> = futures::stream::iter(listing.modpacks.into_iter().filter(|e| segment(&e.slug).is_ok()).take(20))
        .map(|e| async move { detail(client, &e.slug).await.ok() })
        .buffered(8)
        .filter_map(|d| async move { d })
        .collect()
        .await;
    let mut details: Vec<Detail> = details.into_iter().filter(|d| mc.is_none_or(|mc| d.minecraft.as_deref() == Some(mc))).collect();
    match index {
        Some("downloads") => details.sort_by_key(|d| std::cmp::Reverse(d.installs)),
        None | Some("relevance" | "follows" | "newest" | "updated") => {}
        Some(_) => return Err(invalid("Ungültige Sortierung")),
    }
    let hits: Vec<Hit> = details.iter().map(hit).collect();
    Ok(SearchResponse { total_hits: hits.len() as u64, hits, offset, limit: 20 })
}

pub async fn project(client: &reqwest::Client, slug: &str) -> AppResult<Project> {
    let d = detail(client, slug).await?;
    let text = d.description.clone().unwrap_or_default();
    Ok(Project {
        id: d.name.clone(),
        slug: d.name.clone(),
        title: title(&d),
        description: plain(&text),
        body: text,
        icon_url: d.icon.as_ref().and_then(|i| i.url.clone()),
        project_type: "modpack".into(),
        client_side: "optional".into(),
        server_side: "optional".into(),
        web_url: d.platform_url.clone(),
    })
}

pub async fn versions(client: &reqwest::Client, slug: &str) -> AppResult<Vec<Version>> {
    let d = detail(client, slug).await?;
    let number = d.version.clone().filter(|v| !v.is_empty()).unwrap_or_else(|| "1".into());
    Ok(vec![Version {
        id: number.clone(),
        project_id: d.name.clone(),
        name: number.clone(),
        version_number: number,
        game_versions: d.minecraft.clone().into_iter().collect(),
        // Technic nennt keinen Loader.
        loaders: Vec::new(),
        version_type: "release".into(),
        date_published: String::new(),
        files: d
            .platform_url
            .iter()
            .map(|url| File { hashes: BTreeMap::new(), url: url.clone(), filename: String::new(), primary: true, size: 0 })
            .collect(),
        dependencies: Vec::new(),
    }])
}

/// Minecraft-Version, Loader und Loader-Version aus dem Launcher-Profil `bin/version.json`.
/// Der Loader steht in den Bibliotheken (`net.fabricmc:fabric-loader:0.15.3`, `net.minecraftforge:forge:1.20.1-47.1.3` …).
fn loader_from(profile: &serde_json::Value) -> AppResult<(String, ModLoader, Option<String>)> {
    let id = profile["id"].as_str().unwrap_or_default();
    let mc = profile["inheritsFrom"]
        .as_str()
        .map(str::to_string)
        // Ältere Profile heißen `1.20.1-forge-47.1.3`.
        .or_else(|| id.split('-').next().filter(|s| s.starts_with(|c: char| c.is_ascii_digit())).map(str::to_string))
        .ok_or_else(|| invalid("Minecraft-Version im Pack nicht erkennbar"))?;
    identifier(&mc)?;
    let names: Vec<&str> = profile["libraries"].as_array().map(|a| a.iter().filter_map(|l| l["name"].as_str()).collect()).unwrap_or_default();
    let version = |prefix: &str| -> Option<String> {
        let v = names.iter().find_map(|n| n.strip_prefix(prefix))?;
        // Klassifikator (`:universal`) und die vorangestellte Minecraft-Version gehören nicht zur Loader-Version.
        let v = v.split(':').next()?;
        Some(v.strip_prefix(&format!("{mc}-")).unwrap_or(v).to_string())
    };
    let found = if let Some(v) = version("net.fabricmc:fabric-loader:") {
        (ModLoader::Fabric, Some(v))
    } else if let Some(v) = version("org.quiltmc:quilt-loader:") {
        (ModLoader::Quilt, Some(v))
    } else if let Some(v) = version("net.neoforged:neoforge:").or_else(|| version("net.neoforged:forge:")) {
        (ModLoader::NeoForge, Some(v))
    } else if let Some(v) = version("net.minecraftforge:forge:").or_else(|| version("net.minecraftforge:fmlloader:")) {
        (ModLoader::Forge, Some(v))
    } else {
        (ModLoader::Vanilla, None)
    };
    if let Some(v) = &found.1 {
        identifier(v)?;
    }
    match found.0 {
        ModLoader::Forge => forge::check_supported(forge::Kind::Forge, &mc)?,
        ModLoader::NeoForge => forge::check_supported(forge::Kind::NeoForge, &mc)?,
        _ => {}
    }
    Ok((mc, found.0, found.1))
}

/// Liest das Pack-Zip (nur das Inhaltsverzeichnis) und plant die Dateien. Regeln wie beim `.mrpack`:
/// sichere Pfade, keine Sonderdateien, keine Doppelten, Größen- und Kompressionsgrenzen.
/// `bin/` gehört dem Technic-Launcher und wird nicht übernommen.
fn inspect(temp: TempFile, name: &str) -> AppResult<Pack> {
    let mut zip = zip::ZipArchive::new(fs::File::open(&temp.0)?)?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    // Manche Zips haben einen einzelnen Ordner um alles.
    let prefix = if names.iter().any(|n| n == "bin/version.json") {
        String::new()
    } else {
        let mut wrapped = names.iter().filter_map(|n| n.strip_suffix("/bin/version.json")).filter(|p| !p.contains('/'));
        match (wrapped.next(), wrapped.next()) {
            (Some(p), None) => format!("{p}/"),
            _ => return Err(invalid("Das ist kein Technic-Pack: bin/version.json fehlt")),
        }
    };
    let profile: serde_json::Value = {
        let entry = zip.by_name(&format!("{prefix}bin/version.json"))?;
        let mut bytes = Vec::new();
        entry.take(8 * MIB + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > 8 * MIB {
            return Err(invalid("version.json zu groß"));
        }
        serde_json::from_slice(&bytes)?
    };
    let (mc, loader, loader_version) = loader_from(&profile)?;

    let files = zip_files(&mut zip, &prefix, &["bin"])?;
    let archive = Arc::new(Mutex::new(zip));
    let instance = Instance::from_new(NewInstance { name: name.trim().into(), minecraft_version: mc, loader, loader_version });
    Ok(Pack {
        instance,
        downloads: Vec::new(),
        overrides: files.into_iter().map(|(path, index)| (path, Blob::Zip { archive: archive.clone(), index })).collect(),
        required_by: HashMap::new(),
        origins: HashMap::new(),
        temp: Some(temp),
    })
}

/// Lädt das Pack-Zip des Autors in den Zwischenspeicher und plant daraus die Instanz. Fortschritt in MiB.
pub(crate) async fn plan(
    client: &reqwest::Client,
    dirs: &Dirs,
    slug: &str,
    name: &str,
    progress: &(dyn Fn(&str, u64, u64) + Send + Sync),
) -> AppResult<Pack> {
    if name.trim().is_empty() || name.len() > 200 {
        return Err(invalid("Ungültiger Instanzname"));
    }
    let d = detail(client, slug).await?;
    if d.solder.is_some() {
        return Err(invalid("Dieses Modpack nutzt Technic Solder (ältere Technik) und lässt sich nicht installieren"));
    }
    let url = d.url.filter(|u| !u.is_empty()).ok_or_else(|| invalid("Das Modpack hat keine Download-Adresse"))?;
    let tmp = dirs.root.join("cache").join("tmp");
    fs::create_dir_all(&tmp)?;
    let temp = TempFile(tmp.join(format!("{}.zip", crate::models::new_id())));
    progress("download", 0, 0);
    // Nur bei jedem vollen MiB melden, nicht bei jedem Netzwerk-Häppchen.
    let last = std::sync::atomic::AtomicU64::new(u64::MAX);
    net::download_public(&url, &temp.0, ZIP_LIMIT, &|done, total| {
        if last.swap(done / MIB, std::sync::atomic::Ordering::Relaxed) != done / MIB {
            progress("download", done / MIB, total / MIB);
        }
    })
    .await?;
    inspect(temp, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn detail_of(v: serde_json::Value) -> Detail {
        serde_json::from_value(v).unwrap()
    }

    #[tokio::test]
    #[ignore = "braucht Netzwerk"]
    async fn live_trending_search_and_detail() {
        let client = crate::services::modrinth::client().unwrap();
        let trending = search(&client, "", "modpack", None, 0, Some("downloads")).await.unwrap();
        assert!(trending.hits.len() > 3, "Trending leer");
        let found = search(&client, "cobblemon", "modpack", Some("1.21.1"), 0, None).await.unwrap();
        eprintln!("{} Treffer, erster: {:?}", found.hits.len(), found.hits.first().map(|h| (&h.title, h.downloads)));
        assert!(found.hits.iter().all(|h| !h.title.is_empty()));
        let slug = &trending.hits[0].project_id;
        let p = project(&client, slug).await.unwrap();
        let v = versions(&client, slug).await.unwrap();
        assert!(p.web_url.as_deref().is_some_and(|u| u.starts_with("https://www.technicpack.net/")) && v.len() == 1);
    }

    /// `cargo test live_ -- --ignored --nocapture`; lädt ein echtes Pack (rund 32 MB) und legt die Instanz an.
    #[tokio::test]
    #[ignore = "braucht Netzwerk und lädt rund 32 MB"]
    async fn live_install_small_pack() {
        use crate::{services::content, state::AppState};
        let client = crate::services::modrinth::client().unwrap();
        let root = std::env::temp_dir().join(crate::models::new_id());
        let state = AppState::load(&root).unwrap();
        let pack = plan(&client, &state.dirs, "deadwood-fabric", "Live-Test", &|phase, done, total| eprintln!("{phase}: {done}/{total} MiB")).await.unwrap();
        let instance = content::import_plan(&state, pack, None, &|_, _, _| {}).await.unwrap();
        let jars = std::fs::read_dir(state.dirs.game_dir(&instance.id).join("mods")).unwrap().count();
        eprintln!("{} {:?} {:?}, {jars} Mods, {} erfasst", instance.minecraft_version, instance.loader, instance.loader_version, instance.mods.len());
        assert_eq!((instance.loader, instance.minecraft_version.as_str()), (ModLoader::Fabric, "1.20.4"));
        assert!(jars > 20 && instance.mods.len() >= jars);
        assert!(!state.dirs.game_dir(&instance.id).join("bin").exists(), "bin/ gehört dem Technic-Launcher");
        let left: Vec<_> = std::fs::read_dir(state.dirs.root.join("cache").join("tmp")).unwrap().collect();
        assert!(left.is_empty(), "Zwischenspeicher nicht aufgeräumt: {left:?}");
        std::fs::remove_dir_all(root).unwrap();
    }

    fn profile(id: &str, inherits: Option<&str>, libs: &[&str]) -> serde_json::Value {
        let mut p = json!({"id": id, "libraries": libs.iter().map(|n| json!({"name": n})).collect::<Vec<_>>()});
        if let Some(i) = inherits {
            p["inheritsFrom"] = json!(i);
        }
        p
    }

    #[test]
    fn loader_comes_from_the_profile_libraries() {
        let got = |p: serde_json::Value| loader_from(&p);
        assert_eq!(
            got(profile("1.20.4", Some("1.20.4"), &["net.fabricmc:sponge-mixin:0.12.5", "net.fabricmc:fabric-loader:0.15.3"])).unwrap(),
            ("1.20.4".to_string(), ModLoader::Fabric, Some("0.15.3".to_string()))
        );
        assert_eq!(got(profile("q", Some("1.20.1"), &["org.quiltmc:quilt-loader:0.26.0"])).unwrap().1, ModLoader::Quilt);
        let neo = got(profile("x", Some("1.21.1"), &["net.neoforged:neoforge:21.1.172"])).unwrap();
        assert_eq!((neo.1, neo.2.as_deref()), (ModLoader::NeoForge, Some("21.1.172")));
        // Forge trägt die Minecraft-Version vor der Loader-Version und manchmal einen Klassifikator.
        let forge = got(profile("1.20.1-forge-47.1.3", None, &["net.minecraftforge:forge:1.20.1-47.1.3:universal"])).unwrap();
        assert_eq!((forge.0.as_str(), forge.1, forge.2.as_deref()), ("1.20.1", ModLoader::Forge, Some("47.1.3")));
        assert_eq!(got(profile("1.21.1", Some("1.21.1"), &["org.ow2.asm:asm:9.6"])).unwrap().1, ModLoader::Vanilla);
    }

    #[test]
    fn loaders_the_launcher_cannot_start_are_refused() {
        // Forge vor 1.17 und unlesbare Profile.
        assert!(loader_from(&profile("1.12.2", Some("1.12.2"), &["net.minecraftforge:forge:1.12.2-14.23.5.2860"])).is_err());
        assert!(loader_from(&json!({"libraries": []})).is_err());
        assert!(loader_from(&profile("1.20.1", Some("../x"), &[])).is_err());
    }

    fn write_zip(entries: &[(&str, &[u8])]) -> TempFile {
        let path = std::env::temp_dir().join(format!("{}.zip", crate::models::new_id()));
        let mut w = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
        TempFile(path)
    }
    const FABRIC: &[u8] = br#"{"id":"1.20.4","inheritsFrom":"1.20.4","libraries":[{"name":"net.fabricmc:fabric-loader:0.15.3"}]}"#;

    #[test]
    fn pack_zip_becomes_a_plan_without_the_launcher_folder() {
        let temp = write_zip(&[
            ("bin/version.json", FABRIC),
            ("bin/modpack.jar", b"launcher internals"),
            ("mods/a.jar", b"a"),
            ("config/x/y.toml", b"cfg"),
        ]);
        let pack = inspect(temp, "  Test ").unwrap();
        assert_eq!((pack.instance.name.as_str(), pack.instance.loader, pack.instance.minecraft_version.as_str()), ("Test", ModLoader::Fabric, "1.20.4"));
        let mut got: Vec<_> = pack.overrides.iter().map(|(p, b)| (p.to_string_lossy().to_string(), b.bytes().unwrap().into_owned())).collect();
        got.sort();
        assert_eq!(got, vec![("config/x/y.toml".to_string(), b"cfg".to_vec()), ("mods/a.jar".to_string(), b"a".to_vec())]);
        // Das Zip bleibt bis zum Verwerfen des Plans, danach ist es weg.
        let path = pack.temp.as_ref().unwrap().0.clone();
        assert!(path.exists());
        drop(pack);
        assert!(!path.exists());
    }

    #[test]
    fn wrapped_pack_folder_is_unwrapped() {
        let pack = inspect(write_zip(&[("MyPack/bin/version.json", FABRIC), ("MyPack/mods/a.jar", b"a"), ("other/x.txt", b"ignored")]), "t").unwrap();
        let names: Vec<_> = pack.overrides.iter().map(|(p, _)| p.to_string_lossy().to_string()).collect();
        assert_eq!(names, ["mods/a.jar"]);
    }

    #[test]
    fn hostile_zips_are_refused() {
        for bad in ["../evil.txt", "mods/../../evil", "/abs.txt", "CON.jar", "mods/NUL", "a\\b"] {
            assert!(inspect(write_zip(&[("bin/version.json", FABRIC), (bad, b"x")]), "t").is_err(), "{bad}");
        }
        assert!(inspect(write_zip(&[("mods/a.jar", b"a")]), "t").is_err(), "ohne bin/version.json");
        assert!(inspect(write_zip(&[("bin/version.json", FABRIC), ("Mods/a.jar", b"1"), ("mods/A.jar", b"2")]), "t").is_err(), "Doppelte");
        assert!(inspect(write_zip(&[("bin/version.json", FABRIC), ("mods", b"file"), ("mods/a.jar", b"x")]), "t").is_err(), "Datei/Ordner");
        assert!(inspect(write_zip(&[("A/bin/version.json", FABRIC), ("B/bin/version.json", FABRIC)]), "t").is_err(), "mehrdeutig");
    }

    #[test]
    fn plain_text_drops_tags_and_shortens() {
        assert_eq!(plain("<p>Hallo <b>Welt</b></p>\n\n  zwei"), "Hallo Welt zwei");
        let long = plain(&"a ".repeat(300));
        assert!(long.ends_with('…') && long.chars().count() <= 220);
    }

    #[test]
    fn hit_uses_display_name_and_tags() {
        let d = detail_of(json!({
            "name": "cobblemon", "displayName": "Cobblemon Modpack [Fabric]", "user": "Cobblemon", "installs": 84183,
            "minecraft": "1.21.1", "description": "Das offizielle Modpack", "tags": "Pokemon,Adventure",
            "icon": {"url": "https://cdn.technicpack.net/platform2/pack-icons/1.png"}, "platformUrl": "https://www.technicpack.net/modpack/cobblemon.1"
        }));
        let h = hit(&d);
        assert_eq!((h.project_id.as_str(), h.title.as_str(), h.downloads), ("cobblemon", "Cobblemon Modpack [Fabric]", 84183));
        assert_eq!(h.categories, ["pokemon", "adventure"]);
        let bare = hit(&detail_of(json!({"name": "x", "displayName": " ", "tags": null, "user": null, "icon": null})));
        assert_eq!((bare.title.as_str(), bare.author.as_str(), bare.categories.len()), ("x", "", 0));
    }
}
