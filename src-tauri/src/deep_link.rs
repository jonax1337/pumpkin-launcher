//! Links von außen. `pumpkin://` gehört dem Launcher immer; `modrinth://` und `curseforge://` gehören anderen Programmen
//! und kommen erst an, wenn der Nutzer sie in den Einstellungen dem Launcher überlässt (`deep_link_set_foreign`).
//!
//! Jede Webseite kann solche Links auslösen, deshalb ist alles hier misstrauisch: Die Adresse wird streng zerlegt
//! (Zeichen, Längen, einmal Prozent-Dekodieren und danach neu prüfen), Unbekanntes wird mit einer Logzeile verworfen,
//! und nichts startet das Spiel von selbst. Ein Start fragt in der Oberfläche nach, außer der Link trägt den Token
//! einer vom Nutzer angelegten Verknüpfung (`services::shortcut_key`).
//!
//! ```text
//! pumpkin://launch/<instanz>[?world=<ordner> | ?server=<host[:port]>][&s=<token>]   Instanz starten
//! pumpkin://open/<instanz>                                                          Seite der Instanz öffnen
//! pumpkin://install/modrinth/<mod|modpack|shader|resourcepack|datapack>/<slug-oder-id>
//! modrinth://<mod|modpack|shader|resourcepack|datapack>/<slug-oder-id>
//! curseforge://install?addonId=<n>[&fileId=<n>]
//! ```
//!
//! Beim ersten Start steht der Link in der Kommandozeile (Windows, Linux), bei einem zweiten Start meldet ihn die
//! laufende Instanz (Single-Instance) und auf macOS das Betriebssystem. Die Oberfläche holt ihn mit `deep_link_take`
//! ab; `deep-link-opened` sagt ihr, dass etwas Neues wartet.
use std::sync::Mutex;

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::models::QuickPlay;
use crate::services::providers::ProjectType;
use crate::services::shortcut_key::ShortcutKey;
use crate::services::{blocking, lock, modrinth, require_plain_name, servers};

const PUMPKIN_SCHEME: &str = "pumpkin";
const MODRINTH_SCHEME: &str = "modrinth";
const CURSEFORGE_SCHEME: &str = "curseforge";

/// Die Schemas anderer Programme, die der Nutzer dem Launcher überlassen kann.
const FOREIGN_SCHEMES: [&str; 2] = [MODRINTH_SCHEME, CURSEFORGE_SCHEME];

/// Längster Link, den der Launcher überhaupt ansieht.
const MAX_LINK_LEN: usize = 1024;
const MAX_ID_LEN: usize = 64;
/// So viele Links warten höchstens auf die Oberfläche; eine Webseite soll nicht beliebig viele Dialoge anstoßen können.
const MAX_PENDING: usize = 8;

/// Kodiert die Instanz-ID im Link: alles außer Buchstaben, Ziffern, `-` und `_`.
const ID_ESCAPED: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_');

/// Der Link, den eine Verknüpfung öffnet. `token` muss URL-sicher sein (`ShortcutKey::token_for` liefert Hex).
pub fn launch_link(instance_id: &str, token: &str) -> String {
    format!("{PUMPKIN_SCHEME}://launch/{}?s={token}", utf8_percent_encode(instance_id, ID_ESCAPED))
}

/// Ein geprüfter Link. Der Token steht noch unbeglaubigt darin; ob er gilt, entscheidet `DeepLinkRequest::resolve`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLink {
    Launch { instance_id: String, quick_play: Option<QuickPlay>, token: Option<String> },
    Open { instance_id: String },
    InstallModrinth { kind: ProjectType, slug: String },
    InstallCurseforge { addon_id: u32 },
}

/// Warum ein Link nicht angenommen wird; nur für das Protokoll.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum Rejection {
    #[error("keine zulässige Adresse")]
    Malformed,
    #[error("unbekanntes Schema")]
    UnknownScheme,
    #[error("unbekanntes Ziel")]
    UnknownTarget,
    #[error("ungültiger Wert: {0}")]
    InvalidValue(&'static str),
}

#[derive(Clone, Copy)]
enum Scheme {
    Pumpkin,
    Modrinth,
    CurseForge,
}

impl Scheme {
    fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            PUMPKIN_SCHEME => Some(Self::Pumpkin),
            MODRINTH_SCHEME => Some(Self::Modrinth),
            CURSEFORGE_SCHEME => Some(Self::CurseForge),
            _ => None,
        }
    }
}

pub fn parse(raw: &str) -> Result<DeepLink, Rejection> {
    let (scheme, rest) = split_scheme(raw)?;
    let locator = Locator::of(rest)?;
    match scheme {
        Scheme::Pumpkin => pumpkin_link(&locator),
        Scheme::Modrinth => modrinth_link(&locator),
        Scheme::CurseForge => curseforge_link(&locator),
    }
}

/// Nur Zeichen, die in einer Adresse vorkommen dürfen: Anführungszeichen, Leerraum, `\` und Ähnliches würden die
/// Kommandozeile des Programmaufrufs verlassen, und Windows reicht den Link dort in Anführungszeichen weiter.
fn is_link_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c)
}

fn split_scheme(raw: &str) -> Result<(Scheme, &str), Rejection> {
    if raw.len() > MAX_LINK_LEN || !raw.chars().all(is_link_char) {
        return Err(Rejection::Malformed);
    }
    let (name, rest) = raw.split_once("://").ok_or(Rejection::Malformed)?;
    Ok((Scheme::from_name(name).ok_or(Rejection::UnknownScheme)?, rest))
}

/// Der Teil hinter `://`: Host, Pfad und Abfrage, jeweils einmal dekodiert.
struct Locator {
    host: String,
    path: Vec<String>,
    query: Query,
}

impl Locator {
    fn of(rest: &str) -> Result<Self, Rejection> {
        let without_fragment = rest.split('#').next().unwrap_or_default();
        let (target, query) = without_fragment.split_once('?').unwrap_or((without_fragment, ""));
        // Browser hängen an einen Link ohne Pfad gern einen Schrägstrich an.
        let target = target.strip_suffix('/').unwrap_or(target);
        let mut segments = target.split('/').map(decode_once).collect::<Result<Vec<_>, _>>()?;
        let host = segments.remove(0).to_ascii_lowercase();
        Ok(Self { host, path: segments, query: Query::of(query)? })
    }
}

/// Prozent-Dekodieren, genau einmal: Was dabei entsteht, prüft der Aufrufer wie jede andere Eingabe.
fn decode_once(encoded: &str) -> Result<String, Rejection> {
    percent_decode_str(encoded).decode_utf8().map(|text| text.into_owned()).map_err(|_| Rejection::Malformed)
}

fn decode_pair(pair: &str) -> Result<(String, String), Rejection> {
    let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
    Ok((decode_once(name)?, decode_once(value)?))
}

struct Query(Vec<(String, String)>);

impl Query {
    fn of(query: &str) -> Result<Self, Rejection> {
        let pairs = query.split('&').filter(|pair| !pair.is_empty()).map(decode_pair);
        pairs.collect::<Result<Vec<_>, _>>().map(Self)
    }

    /// Der Wert von `name`. Ein Name, der zweimal vorkommt, ist mehrdeutig und wird abgelehnt.
    fn value(&self, name: &'static str) -> Result<Option<&str>, Rejection> {
        let mut values = self.0.iter().filter(|(key, _)| key == name).map(|(_, value)| value.as_str());
        let first = values.next();
        match values.next() {
            Some(_) => Err(Rejection::InvalidValue(name)),
            None => Ok(first),
        }
    }
}

fn pumpkin_link(link: &Locator) -> Result<DeepLink, Rejection> {
    match (link.host.as_str(), link.path.as_slice()) {
        ("launch", [id]) => Ok(DeepLink::Launch {
            instance_id: instance_id(id)?,
            quick_play: quick_play_of(&link.query)?,
            token: link.query.value("s")?.map(str::to_owned),
        }),
        ("open", [id]) => Ok(DeepLink::Open { instance_id: instance_id(id)? }),
        ("install", [provider, kind, project]) if provider.eq_ignore_ascii_case(MODRINTH_SCHEME) => {
            modrinth_project(kind, project)
        }
        _ => Err(Rejection::UnknownTarget),
    }
}

/// `modrinth://<art>/<slug-oder-id>`. Die Art ist nur ein Hinweis: Auch Shader und Ressourcenpakete heißen dort `mod`,
/// die Oberfläche fragt das Projekt deshalb nach seiner wirklichen Art.
fn modrinth_link(link: &Locator) -> Result<DeepLink, Rejection> {
    match link.path.as_slice() {
        [project] => modrinth_project(&link.host, project),
        _ => Err(Rejection::UnknownTarget),
    }
}

fn modrinth_project(kind: &str, project: &str) -> Result<DeepLink, Rejection> {
    let kind = ProjectType::parse(&kind.to_ascii_lowercase()).map_err(|_| Rejection::UnknownTarget)?;
    modrinth::identifier(project).map_err(|_| Rejection::InvalidValue("project"))?;
    Ok(DeepLink::InstallModrinth { kind, slug: project.to_owned() })
}

/// Die Install-Schaltfläche der CurseForge-Webseite: `curseforge://install?addonId=<n>&fileId=<n>`. Der Launcher öffnet
/// das Projekt und lässt die Version wählen; `fileId` muss deshalb nur eine Zahl sein, wenn er dasteht.
fn curseforge_link(link: &Locator) -> Result<DeepLink, Rejection> {
    if link.host != "install" || !link.path.is_empty() {
        return Err(Rejection::UnknownTarget);
    }
    let addon_id = link.query.value("addonId")?.ok_or(Rejection::InvalidValue("addonId"))?;
    link.query.value("fileId")?.map(|id| number(id, "fileId")).transpose()?;
    Ok(DeepLink::InstallCurseforge { addon_id: number(addon_id, "addonId")? })
}

fn number(text: &str, name: &'static str) -> Result<u32, Rejection> {
    let digits = !text.is_empty() && text.len() <= 10 && text.bytes().all(|byte| byte.is_ascii_digit());
    digits.then(|| text.parse::<u32>().ok()).flatten().filter(|number| *number != 0).ok_or(Rejection::InvalidValue(name))
}

fn instance_id(text: &str) -> Result<String, Rejection> {
    let valid = !text.is_empty()
        && text.len() <= MAX_ID_LEN
        && text.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid.then(|| text.to_owned()).ok_or(Rejection::InvalidValue("instance"))
}

/// `world=<Ordnername>` oder `server=<host[:port]>` (Quick Play), nie beides. Das Backend prüft das Ziel beim Start noch einmal.
fn quick_play_of(query: &Query) -> Result<Option<QuickPlay>, Rejection> {
    match (query.value("world")?, query.value("server")?) {
        (None, None) => Ok(None),
        (Some(world), None) => require_plain_name(world)
            .map(|id| Some(QuickPlay::World { id: id.to_owned() }))
            .map_err(|_| Rejection::InvalidValue("world")),
        (None, Some(server)) => servers::parse_address(server)
            .map(|_| Some(QuickPlay::Server { address: server.to_owned() }))
            .ok_or(Rejection::InvalidValue("server")),
        (Some(_), Some(_)) => Err(Rejection::InvalidValue("world and server")),
    }
}

/// Was die Oberfläche von einem Link bekommt. Der Token verlässt das Backend nicht: `trusted` sagt nur, ob er galt.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DeepLinkRequest {
    /// `trusted`: Der Link stammt aus einer Verknüpfung des Nutzers und startet ohne Rückfrage.
    Launch { instance_id: String, quick_play: Option<QuickPlay>, trusted: bool },
    Open { instance_id: String },
    InstallModrinth { content_type: &'static str, project: String },
    InstallCurseforge { addon_id: u32 },
}

impl DeepLinkRequest {
    fn resolve(link: DeepLink, key: &ShortcutKey) -> Self {
        match link {
            DeepLink::Launch { instance_id, quick_play, token } => {
                // Der Token deckt nur die Instanz ab: ein Ziel (Welt, Server) hängt jeder an den Link, der ihn kennt.
                let trusted = quick_play.is_none() && token.is_some_and(|token| key.accepts(&instance_id, &token));
                Self::Launch { instance_id, quick_play, trusted }
            }
            DeepLink::Open { instance_id } => Self::Open { instance_id },
            DeepLink::InstallModrinth { kind, slug } => Self::InstallModrinth { content_type: kind.name(), project: slug },
            DeepLink::InstallCurseforge { addon_id } => Self::InstallCurseforge { addon_id },
        }
    }
}

/// Die Links, die noch niemand abgeholt hat.
#[derive(Default)]
pub struct DeepLinkInbox(Mutex<Vec<DeepLink>>);

impl DeepLinkInbox {
    /// Die Links, mit denen dieser Prozess gestartet wurde.
    pub fn from_process_args() -> Self {
        let args: Vec<String> = std::env::args_os().filter_map(|arg| arg.into_string().ok()).collect();
        let inbox = Self::default();
        inbox.push(links_in_args(&args));
        inbox
    }

    fn push(&self, links: Vec<DeepLink>) {
        let mut pending = lock(&self.0);
        for link in links {
            if pending.len() >= MAX_PENDING {
                tracing::warn!("Zu viele wartende Links, die übrigen werden verworfen");
                return;
            }
            pending.push(link);
        }
    }

    fn take_all(&self) -> Vec<DeepLink> {
        std::mem::take(&mut *lock(&self.0))
    }
}

/// Die Links unter den Argumenten (das erste ist das Programm). Alles andere in der Kommandozeile, etwa eine
/// `.mrpack`-Datei, geht diesen Weg nichts an.
pub fn links_in_args(args: &[String]) -> Vec<DeepLink> {
    links_in(args.iter().skip(1).map(String::as_str))
}

fn links_in<'a>(candidates: impl Iterator<Item = &'a str>) -> Vec<DeepLink> {
    candidates.filter(|candidate| has_launcher_scheme(candidate)).filter_map(accept).collect()
}

fn has_launcher_scheme(candidate: &str) -> bool {
    candidate.split_once("://").is_some_and(|(name, _)| Scheme::from_name(name).is_some())
}

/// Ein abgelehnter Link steht nur mit dem Grund im Protokoll: sein Token wäre sonst im Protokoll zu lesen.
fn accept(candidate: &str) -> Option<DeepLink> {
    parse(candidate).inspect_err(|reason| tracing::warn!(%reason, "Link abgelehnt")).ok()
}

/// Merkt sich die Links eines weiteren Starts und sagt der Oberfläche Bescheid.
/// Vor dem Ende von `setup` gibt es den Posteingang noch nicht; dann stehen die Links schon in der Kommandozeile.
fn announce(app: &AppHandle, links: Vec<DeepLink>) {
    let Some(inbox) = app.try_state::<DeepLinkInbox>() else {
        return;
    };
    if links.is_empty() {
        return;
    }
    inbox.push(links);
    if let Err(err) = app.emit("deep-link-opened", ()) {
        tracing::warn!(%err, "Event deep-link-opened nicht gesendet");
    }
}

/// Zweiter Start: Argumente wie bei einem ersten.
pub fn announce_args(app: &AppHandle, args: &[String]) {
    announce(app, links_in_args(args));
}

/// macOS meldet Links als Ereignis statt in der Kommandozeile.
#[cfg(target_os = "macos")]
pub fn announce_urls(app: &AppHandle, urls: &[tauri::Url]) {
    announce(app, links_in(urls.iter().map(tauri::Url::as_str)));
}

/// Ein AppImage ohne Systemintegration hat `pumpkin://` bei niemandem angemeldet, und ohne das öffnet keine Verknüpfung
/// den Launcher. Die Anmeldung läuft abseits des Starts: sie ruft `xdg-mime` und `update-desktop-database` auf.
#[cfg(target_os = "linux")]
pub fn register_scheme_for_appimage(app: &AppHandle) {
    if app.env().appimage.is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = app.deep_link().register(PUMPKIN_SCHEME) {
            tracing::warn!(%err, "pumpkin:// ließ sich für das AppImage nicht anmelden");
        }
    });
}

/// Die Links, die auf die Oberfläche warten, mit beglaubigtem Token (siehe [`DeepLinkRequest`]).
#[tauri::command]
pub fn deep_link_take(inbox: State<'_, DeepLinkInbox>, key: State<'_, ShortcutKey>) -> Vec<DeepLinkRequest> {
    inbox.take_all().into_iter().map(|link| DeepLinkRequest::resolve(link, &key)).collect()
}

/// Gehören `modrinth://` und `curseforge://` zurzeit diesem Launcher? Das System weiß es, nicht eine Einstellung:
/// Ein anderes Programm kann die Schemas jederzeit zurückholen.
#[tauri::command]
pub async fn deep_link_foreign_enabled(app: AppHandle) -> AppResult<bool> {
    blocking(move |_| foreign_schemes_registered(&app)).await
}

/// Überlässt die fremden Schemas dem Launcher oder gibt sie wieder frei; liefert, ob sie ihm danach gehören.
/// Auf macOS legt nur das Bündel die Schemas fest: dort ist es ein Fehler.
#[tauri::command]
pub async fn deep_link_set_foreign(app: AppHandle, enabled: bool) -> AppResult<bool> {
    blocking(move |_| {
        if enabled { register_foreign_schemes(&app)? } else { unregister_foreign_schemes(&app)? }
        foreign_schemes_registered(&app)
    })
    .await
}

fn foreign_schemes_registered(app: &AppHandle) -> AppResult<bool> {
    for scheme in FOREIGN_SCHEMES {
        if !app.deep_link().is_registered(scheme).map_err(registration_error)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn register_foreign_schemes(app: &AppHandle) -> AppResult<()> {
    FOREIGN_SCHEMES.into_iter().try_for_each(|scheme| app.deep_link().register(scheme).map_err(registration_error))
}

/// Gibt nur frei, was dem Launcher gehört: Hat ein anderes Programm das Schema inzwischen übernommen, bleibt es dort.
fn unregister_foreign_schemes(app: &AppHandle) -> AppResult<()> {
    for scheme in FOREIGN_SCHEMES {
        if app.deep_link().is_registered(scheme).map_err(registration_error)? {
            app.deep_link().unregister(scheme).map_err(registration_error)?;
        }
    }
    Ok(())
}

fn registration_error(err: tauri_plugin_deep_link::Error) -> AppError {
    AppError::invalid(coded!("errors.app.deepLink.registrationFailed").with_details(err.to_string()))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::models::new_id;

    const ID: &str = "0b9b6e0e-4b1c-4d2e-8f55-1c2d3e4f5a6b";

    fn launch(instance_id: &str, quick_play: Option<QuickPlay>, token: Option<&str>) -> DeepLink {
        DeepLink::Launch { instance_id: instance_id.into(), quick_play, token: token.map(str::to_owned) }
    }

    fn refused(raw: &str) -> Rejection {
        parse(raw).expect_err(raw)
    }

    #[test]
    fn launch_links_name_an_instance_with_an_optional_target_and_token() {
        assert_eq!(parse(&format!("pumpkin://launch/{ID}")), Ok(launch(ID, None, None)));
        assert_eq!(parse(&format!("pumpkin://launch/{ID}/")), Ok(launch(ID, None, None)));
        assert_eq!(parse(&format!("PUMPKIN://Launch/{ID}?s=ab12")), Ok(launch(ID, None, Some("ab12"))));
        assert_eq!(
            parse(&format!("pumpkin://launch/{ID}?world=Neue%20Welt%20%C3%A4")),
            Ok(launch(ID, Some(QuickPlay::World { id: "Neue Welt ä".into() }), None))
        );
        assert_eq!(
            parse(&format!("pumpkin://launch/{ID}?server=mc.example.net:25570&unknown=1#frag")),
            Ok(launch(ID, Some(QuickPlay::Server { address: "mc.example.net:25570".into() }), None))
        );
    }

    #[test]
    fn the_link_of_a_shortcut_parses_back_into_its_instance_and_token() {
        let link = launch_link("instanz-1_b", "0f9a");

        assert_eq!(link, "pumpkin://launch/instanz-1_b?s=0f9a");
        assert_eq!(parse(&link), Ok(launch("instanz-1_b", None, Some("0f9a"))));
    }

    #[test]
    fn an_id_with_other_characters_is_encoded_in_the_link_and_refused_when_parsed() {
        let link = launch_link("a/b c", "00");

        assert_eq!(link, "pumpkin://launch/a%2Fb%20c?s=00");
        assert_eq!(parse(&link), Err(Rejection::InvalidValue("instance")));
    }

    #[test]
    fn open_and_install_links_parse() {
        assert_eq!(parse(&format!("pumpkin://open/{ID}")), Ok(DeepLink::Open { instance_id: ID.into() }));
        for (name, kind) in [
            ("mod", ProjectType::Mod),
            ("modpack", ProjectType::Modpack),
            ("shader", ProjectType::Shader),
            ("resourcepack", ProjectType::ResourcePack),
            ("datapack", ProjectType::Datapack),
        ] {
            let expected = Ok(DeepLink::InstallModrinth { kind, slug: "sodium".into() });
            assert_eq!(parse(&format!("pumpkin://install/modrinth/{name}/sodium")), expected);
            assert_eq!(parse(&format!("modrinth://{name}/sodium")), expected);
        }
        assert_eq!(
            parse("modrinth://mod/AANobbMI"),
            Ok(DeepLink::InstallModrinth { kind: ProjectType::Mod, slug: "AANobbMI".into() })
        );
    }

    #[test]
    fn curseforge_links_name_an_addon_and_optionally_a_file() {
        assert_eq!(
            parse("curseforge://install?addonId=238222&fileId=4567890"),
            Ok(DeepLink::InstallCurseforge { addon_id: 238222 })
        );
        assert_eq!(parse("curseforge://install/?addonId=1"), Ok(DeepLink::InstallCurseforge { addon_id: 1 }));
    }

    #[test]
    fn invalid_curseforge_links_are_refused() {
        for raw in [
            "curseforge://install",
            "curseforge://install?fileId=1",
            "curseforge://install?addonId=",
            "curseforge://install?addonId=0",
            "curseforge://install?addonId=-1",
            "curseforge://install?addonId=1a",
            "curseforge://install?addonId=99999999999",
            "curseforge://install?addonId=4294967296",
            "curseforge://install?addonId=1&addonId=2",
            "curseforge://install?addonId=1&fileId=x",
        ] {
            assert!(matches!(refused(raw), Rejection::InvalidValue(_)), "{raw}");
        }
        assert_eq!(refused("curseforge://uninstall?addonId=1"), Rejection::UnknownTarget);
        assert_eq!(refused("curseforge://install/extra?addonId=1"), Rejection::UnknownTarget);
    }

    #[test]
    fn a_path_that_leaves_the_id_is_refused_however_it_is_written() {
        for raw in [
            "pumpkin://launch/..%2f..",
            "pumpkin://launch/..%2F..%2Fetc",
            "pumpkin://launch/%2e%2e",
            "pumpkin://launch/..",
            "pumpkin://launch/a%252fb",
            "pumpkin://launch/a%5cb",
            "pumpkin://launch/a%00b",
            "pumpkin://launch/a%0ab",
            "pumpkin://launch/a%20b",
            "pumpkin://launch/%E4",
            "pumpkin://launch//",
            "pumpkin://launch/",
            "pumpkin://open/",
            "pumpkin://install/modrinth/mod/..",
            "pumpkin://install/modrinth/mod/a%2fb",
            "pumpkin://install/modrinth/mod/%2e%2e",
        ] {
            assert!(matches!(refused(raw), Rejection::InvalidValue(_) | Rejection::Malformed | Rejection::UnknownTarget), "{raw}");
        }
    }

    #[test]
    fn overlong_values_are_refused() {
        let long_id = "a".repeat(MAX_ID_LEN + 1);
        assert_eq!(refused(&format!("pumpkin://launch/{long_id}")), Rejection::InvalidValue("instance"));
        assert!(parse(&format!("pumpkin://launch/{}", "a".repeat(MAX_ID_LEN))).is_ok());
        assert_eq!(refused(&format!("pumpkin://launch/{ID}?s={}", "a".repeat(MAX_LINK_LEN))), Rejection::Malformed);
        assert!(matches!(refused(&format!("pumpkin://install/modrinth/mod/{}", "a".repeat(200))), Rejection::InvalidValue("project")));
        assert!(matches!(refused(&format!("pumpkin://launch/{ID}?world={}", "a".repeat(300))), Rejection::InvalidValue("world")));
    }

    #[test]
    fn unknown_schemes_hosts_and_paths_are_refused() {
        assert_eq!(refused("https://example.com/launch/a"), Rejection::UnknownScheme);
        assert_eq!(refused("file:///C:/Windows/notepad.exe"), Rejection::UnknownScheme);
        assert_eq!(refused("pumpkin-evil://launch/a"), Rejection::UnknownScheme);
        assert_eq!(refused("pumpkin:launch/a"), Rejection::Malformed);
        assert_eq!(refused("launch/a"), Rejection::Malformed);
        for raw in [
            "pumpkin://",
            "pumpkin://delete/a",
            "pumpkin://launch",
            "pumpkin://launch/a/b",
            "pumpkin://open/a/b",
            "pumpkin://install",
            "pumpkin://install/modrinth/mod",
            "pumpkin://install/curseforge/mod/a",
            "pumpkin://install/modrinth/plugin/a",
            "pumpkin://install/modrinth/mod/a/b",
            "pumpkin:///launch/a",
            "modrinth://",
            "modrinth://version/abc",
            "modrinth://server/abc",
            "modrinth://mod",
            "modrinth://mod/a/b",
            "modrinth://launch/instance/a",
        ] {
            assert_eq!(refused(raw), Rejection::UnknownTarget, "{raw}");
        }
    }

    #[test]
    fn characters_that_could_leave_a_command_line_are_refused() {
        for raw in [
            "pumpkin://launch/a\" --flag \"b",
            "pumpkin://launch/a b",
            "pumpkin://launch/a\\b",
            "pumpkin://launch/a\nb",
            "pumpkin://launch/a^b",
            "pumpkin://launch/a`b",
            "pumpkin://launch/<a>",
            "pumpkin://launch/ä",
        ] {
            assert_eq!(refused(raw), Rejection::Malformed, "{raw:?}");
        }
    }

    #[test]
    fn a_launch_target_is_checked_and_never_both_a_world_and_a_server() {
        for raw in [
            "world=..%2Fsaves",
            "world=a%2Fb",
            "world=CON",
            "world=a%00b",
            "server=--demo",
            "server=a%20b",
            "server=host:0",
            "server=host:70000",
            "server=",
            "world=A&server=mc.example.net",
            "world=A&world=B",
            "s=a&s=b",
        ] {
            assert!(matches!(refused(&format!("pumpkin://launch/{ID}?{raw}")), Rejection::InvalidValue(_)), "{raw}");
        }
    }

    #[test]
    fn the_inbox_hands_every_link_over_once_and_holds_a_limited_number() {
        let inbox = DeepLinkInbox::default();
        assert!(inbox.take_all().is_empty());

        inbox.push(vec![DeepLink::Open { instance_id: "a".into() }; MAX_PENDING + 3]);

        assert_eq!(inbox.take_all().len(), MAX_PENDING);
        assert!(inbox.take_all().is_empty());
    }

    #[test]
    fn only_links_of_the_launcher_are_taken_from_the_arguments() {
        let args: Vec<String> = [
            "pumpkin-launcher.exe",
            "pack.mrpack",
            "--flag",
            "https://example.com/",
            "pumpkin://launch/not valid",
            "modrinth://mod/sodium",
            "pumpkin://open/a",
        ]
        .map(String::from)
        .to_vec();

        assert_eq!(
            links_in_args(&args),
            [
                DeepLink::InstallModrinth { kind: ProjectType::Mod, slug: "sodium".into() },
                DeepLink::Open { instance_id: "a".into() },
            ]
        );
        assert!(links_in_args(&["pumpkin://open/a".to_owned()]).is_empty(), "das erste Argument ist das Programm");
    }

    #[test]
    fn a_launch_is_trusted_only_with_the_token_of_its_instance_and_without_a_target() {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        let key = ShortcutKey::in_dir(&dir);
        let token = key.token_for(ID).unwrap();
        let trusted = |link: DeepLink| match DeepLinkRequest::resolve(link, &key) {
            DeepLinkRequest::Launch { trusted, .. } => trusted,
            other => panic!("{other:?}"),
        };
        let world = Some(QuickPlay::World { id: "Welt".into() });

        assert!(trusted(launch(ID, None, Some(token.as_str()))));
        assert!(!trusted(launch(ID, None, None)));
        assert!(!trusted(launch(ID, None, Some("0000"))));
        assert!(!trusted(launch(ID, None, Some("kein hex"))));
        assert!(!trusted(launch("andere-instanz", None, Some(token.as_str()))));
        assert!(!trusted(launch(ID, world, Some(token.as_str()))));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn requests_reach_the_interface_in_camel_case_without_any_token() {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        let key = ShortcutKey::in_dir(&dir);

        let world_launch = DeepLinkRequest::resolve(launch("a", Some(QuickPlay::World { id: "Welt".into() }), Some("geheim")), &key);
        let install = DeepLinkRequest::resolve(DeepLink::InstallModrinth { kind: ProjectType::ResourcePack, slug: "x".into() }, &key);
        let curseforge = DeepLinkRequest::resolve(DeepLink::InstallCurseforge { addon_id: 7 }, &key);

        assert_eq!(
            serde_json::to_value(world_launch).unwrap(),
            serde_json::json!({"type": "launch", "instanceId": "a", "quickPlay": {"type": "world", "id": "Welt"}, "trusted": false})
        );
        assert_eq!(
            serde_json::to_value(install).unwrap(),
            serde_json::json!({"type": "installModrinth", "contentType": "resourcepack", "project": "x"})
        );
        assert_eq!(
            serde_json::to_value(curseforge).unwrap(),
            serde_json::json!({"type": "installCurseforge", "addonId": 7})
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
