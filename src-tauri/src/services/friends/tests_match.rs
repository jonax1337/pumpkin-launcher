//! Tests von Manifest, Modrinth-Abfrage und Abgleich (SPEC 13.1, Zeile R6): mit Fixtures und einer gefälschten
//! Modrinth-Schnittstelle, ohne Netz.
use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures::future::BoxFuture;
use serde_json::json;

use super::contract::{InstanceSummary, Invite, JoinPlan, JoinVerdict, MIN_MC_RELEASE_TIME};
use super::lookup::{LookupError, ModInfo, ModLookup, ModrinthApi, ModrinthLookup};
use super::manifest::{
    self, HashCache, Manifest, ManifestError, ManifestMod, VersionIndex, MAX_MANIFEST_MODS,
};
use super::matching::{self, Classification, LocalHashes};
use super::test_support::{error_key, TempDir};
use crate::error::{AppError, AppResult};
use crate::models::{Instance, Mod, ModKind, ModLoader, ModSource, NewInstance};
use crate::services::modrinth::{Project, Version};

fn hash(letter: char) -> String {
    letter.to_string().repeat(128)
}

fn file(letter: char, file_name: &str) -> ManifestMod {
    ManifestMod {
        sha512: hash(letter),
        file_name: file_name.into(),
    }
}

fn instance(id: &str, loader: ModLoader, mc: &str) -> Instance {
    let mut instance = Instance::from_new(NewInstance {
        name: format!("Instanz {id}"),
        minecraft_version: mc.into(),
        loader,
        loader_version: None,
    });
    instance.id = id.into();
    instance
}

fn mod_entry(file_name: &str, kind: ModKind, enabled: bool) -> Mod {
    Mod {
        id: file_name.into(),
        name: file_name.into(),
        version: "1".into(),
        source: ModSource::Local,
        file_name: file_name.into(),
        sha1: None,
        enabled,
        kind,
        required_by: Vec::new(),
        pinned: false,
        pack_managed: false,
    }
}

fn manifest_of(loader: ModLoader, mc: &str, mods: Vec<ManifestMod>) -> Manifest {
    Manifest {
        minecraft_version: mc.into(),
        loader,
        loader_version: None,
        mods,
    }
}

fn invite() -> Invite {
    Invite {
        id: "invite-1".into(),
        session_id: "session-1".into(),
        from: "ab".repeat(32),
        from_name: "Alex".into(),
        from_fingerprint: "abab abab abab abab".into(),
        title: "Inselwelt".into(),
        instance: InstanceSummary {
            name: "Fabric 26.3".into(),
            minecraft_version: "26.3".into(),
            loader: ModLoader::Fabric,
            loader_version: None,
            mod_count: 0,
        },
        received_at: 1,
        expires_at: 2,
        host_online: true,
    }
}

struct FakeLocal(HashMap<String, Vec<ManifestMod>>);

impl LocalHashes for FakeLocal {
    fn mods_of(&self, instance: &Instance) -> Vec<ManifestMod> {
        self.0.get(&instance.id).cloned().unwrap_or_default()
    }
}

fn info(title: &str, client_only: bool) -> ModInfo {
    ModInfo {
        title: title.into(),
        project_id: format!("project-{title}"),
        client_only,
    }
}

/// A, B, C braucht der Server, S und M sind reine Client-Mods auf Modrinth, X kennt Modrinth nicht (SPEC 5.6).
fn table_classification() -> Classification {
    Classification::Known(HashMap::from([
        (hash('a'), info("A", false)),
        (hash('b'), info("B", false)),
        (hash('c'), info("C", false)),
        (hash('s'), info("S", true)),
        (hash('m'), info("M", true)),
    ]))
}

fn table_file(name: char) -> ManifestMod {
    let file_name = format!("{}.jar", name.to_ascii_uppercase());
    file(name, &file_name)
}

fn table_mods(names: &str) -> Vec<ManifestMod> {
    names.chars().map(table_file).collect()
}

struct Row {
    host: (ModLoader, &'static str, &'static str),
    guests: Vec<(ModLoader, &'static str, &'static str)>,
}

fn plan_of(row: &Row, classification: &Classification) -> JoinPlan {
    let (loader, mc, mods) = row.host;
    let host = manifest_of(loader, mc, table_mods(mods));
    let mut instances = Vec::new();
    let mut local = HashMap::new();
    for (index, (loader, mc, mods)) in row.guests.iter().enumerate() {
        let guest = instance(&format!("guest-{index}"), *loader, mc);
        local.insert(guest.id.clone(), table_mods(mods));
        instances.push(guest);
    }
    matching::plan(
        &invite(),
        &host,
        &instances,
        &FakeLocal(local),
        classification,
    )
}

fn titles(refs: &[super::contract::ModRef]) -> Vec<&str> {
    refs.iter().map(|m| m.title.as_str()).collect()
}

const FABRIC: ModLoader = ModLoader::Fabric;
const VANILLA: ModLoader = ModLoader::Vanilla;

#[test]
fn vanilla_host_and_vanilla_guest_are_ready() {
    let plan = plan_of(
        &Row {
            host: (VANILLA, "26.3", ""),
            guests: vec![(VANILLA, "26.3", "")],
        },
        &table_classification(),
    );

    assert_eq!(plan.verdict, JoinVerdict::Ready);
    assert!(plan.candidates[0].matches);
    assert!(!plan.create_vanilla);
}

#[test]
fn vanilla_host_without_instance_offers_a_vanilla_instance() {
    let plan = plan_of(
        &Row {
            host: (VANILLA, "26.3", ""),
            guests: vec![],
        },
        &table_classification(),
    );

    assert_eq!(
        (plan.verdict, plan.create_vanilla),
        (JoinVerdict::NoInstance, true)
    );
}

#[test]
fn client_only_mods_of_the_host_are_not_required() {
    let row = Row {
        host: (FABRIC, "26.3", "abs"),
        guests: vec![(FABRIC, "26.3", "ab")],
    };

    assert_eq!(
        plan_of(&row, &table_classification()).verdict,
        JoinVerdict::Ready
    );
}

#[test]
fn a_mod_the_guest_lacks_is_missing() {
    let row = Row {
        host: (FABRIC, "26.3", "ab"),
        guests: vec![(FABRIC, "26.3", "a")],
    };

    let plan = plan_of(&row, &table_classification());

    assert_eq!(plan.verdict, JoinVerdict::MissingContent);
    assert_eq!(titles(&plan.candidates[0].missing), ["B"]);
    assert!(plan.candidates[0].extra.is_empty());
    assert!(!plan.create_vanilla);
}

#[test]
fn a_server_mod_only_the_guest_has_is_extra() {
    let row = Row {
        host: (FABRIC, "26.3", "a"),
        guests: vec![(FABRIC, "26.3", "ac")],
    };

    let plan = plan_of(&row, &table_classification());

    assert_eq!(plan.verdict, JoinVerdict::MissingContent);
    assert_eq!(titles(&plan.candidates[0].extra), ["C"]);
    assert!(plan.candidates[0].missing.is_empty());
}

#[test]
fn a_client_only_mod_only_the_guest_has_is_fine() {
    let row = Row {
        host: (FABRIC, "26.3", "a"),
        guests: vec![(FABRIC, "26.3", "am")],
    };

    assert_eq!(
        plan_of(&row, &table_classification()).verdict,
        JoinVerdict::Ready
    );
}

#[test]
fn an_unknown_mod_with_the_same_hash_on_both_sides_is_ready() {
    let row = Row {
        host: (FABRIC, "26.3", "ax"),
        guests: vec![(FABRIC, "26.3", "ax")],
    };

    assert_eq!(
        plan_of(&row, &table_classification()).verdict,
        JoinVerdict::Ready
    );
}

#[test]
fn an_unknown_mod_the_guest_lacks_is_missing_under_its_file_name() {
    let row = Row {
        host: (FABRIC, "26.3", "ax"),
        guests: vec![(FABRIC, "26.3", "a")],
    };

    let plan = plan_of(&row, &table_classification());

    let missing = &plan.candidates[0].missing;
    assert_eq!(
        (plan.verdict, titles(missing)),
        (JoinVerdict::MissingContent, vec!["X.jar"])
    );
    assert_eq!(missing[0].project_id, None);
}

#[test]
fn another_version_or_loader_is_no_candidate_and_never_offers_vanilla_to_a_modded_host() {
    let row = Row {
        host: (FABRIC, "26.3", ""),
        guests: vec![(FABRIC, "26.2", ""), (ModLoader::Quilt, "26.3", "")],
    };

    let plan = plan_of(&row, &table_classification());

    assert_eq!(
        (plan.verdict, plan.create_vanilla),
        (JoinVerdict::NoInstance, false)
    );
    assert!(plan.candidates.is_empty());
}

#[test]
fn a_host_older_than_1_16_5_is_unsupported_after_validation() {
    let versions = VersionIndex::new([
        ("1.16.4".to_owned(), "2020-10-29T15:49:37+00:00".to_owned()),
        ("26.3".to_owned(), "2026-09-01T10:00:00+00:00".to_owned()),
    ]);
    let old = manifest_of(FABRIC, "1.16.4", vec![]);

    let verdict = match manifest::validate(old, &versions) {
        Err(ManifestError::VersionUnsupported) => matching::version_unsupported(&invite()),
        other => panic!("{other:?}"),
    };

    assert_eq!(
        (verdict.verdict, verdict.create_vanilla),
        (JoinVerdict::VersionUnsupported, false)
    );
    assert!(verdict.candidates.is_empty());
}

#[test]
fn candidates_list_matches_first_then_the_fewest_differences() {
    let row = Row {
        host: (FABRIC, "26.3", "ab"),
        guests: vec![
            (FABRIC, "26.3", "cx"),
            (FABRIC, "26.3", "a"),
            (FABRIC, "26.3", "ab"),
        ],
    };

    let plan = plan_of(&row, &table_classification());

    let order: Vec<&str> = plan
        .candidates
        .iter()
        .map(|c| c.instance_id.as_str())
        .collect();
    assert_eq!(order, ["guest-2", "guest-1", "guest-0"]);
    assert_eq!(plan.verdict, JoinVerdict::Ready);
}

#[test]
fn a_failed_lookup_makes_every_mod_required_and_says_so() {
    let row = Row {
        host: (FABRIC, "26.3", "abs"),
        guests: vec![(FABRIC, "26.3", "ab")],
    };

    let plan = plan_of(&row, &Classification::LookupFailed);

    assert!(plan.lookup_failed);
    assert_eq!(plan.verdict, JoinVerdict::MissingContent);
    assert_eq!(titles(&plan.candidates[0].missing), ["S.jar"]);
}

#[test]
fn duplicate_files_count_once() {
    let host = manifest_of(
        FABRIC,
        "26.3",
        vec![table_file('a'), file('a', "A-copy.jar")],
    );
    let guest = instance("guest", FABRIC, "26.3");
    let local = FakeLocal(HashMap::from([("guest".to_owned(), table_mods("a"))]));

    let plan = matching::plan(&invite(), &host, &[guest], &local, &table_classification());

    assert_eq!(plan.verdict, JoinVerdict::Ready);
}

#[test]
fn only_hashes_of_hosts_and_candidates_are_looked_up_once() {
    let host = manifest_of(FABRIC, "26.3", table_mods("abs"));
    let instances = [
        instance("fits", FABRIC, "26.3"),
        instance("other", ModLoader::Quilt, "26.3"),
    ];
    let local = FakeLocal(HashMap::from([
        ("fits".to_owned(), table_mods("acx")),
        ("other".to_owned(), table_mods("m")),
    ]));

    let hashes = matching::hashes_to_classify(&host, &instances, &local);

    assert_eq!(
        hashes,
        ["a", "b", "c", "s", "x"].map(|l| hash(l.chars().next().unwrap()))
    );
}

struct FakeLookup {
    answer: Result<HashMap<String, ModInfo>, LookupError>,
}

impl ModLookup for FakeLookup {
    fn classify<'a>(
        &'a self,
        _: &'a [String],
    ) -> BoxFuture<'a, Result<HashMap<String, ModInfo>, LookupError>> {
        Box::pin(async { self.answer.clone() })
    }
}

#[tokio::test]
async fn classification_keeps_the_answer_or_records_the_failure() {
    let known = FakeLookup {
        answer: Ok(HashMap::from([(hash('a'), info("A", false))])),
    };
    let failing = FakeLookup {
        answer: Err(LookupError("offline".into())),
    };

    assert!(
        matches!(Classification::fetch(&known, &[hash('a')]).await, Classification::Known(map) if map.len() == 1)
    );
    assert!(matches!(
        Classification::fetch(&failing, &[hash('a')]).await,
        Classification::LookupFailed
    ));
}

fn modrinth_version(project_id: &str, sha512: &str) -> Version {
    serde_json::from_value(json!({
        "id": format!("version-{project_id}"), "project_id": project_id, "name": "N", "version_number": "1",
        "game_versions": ["26.3"], "loaders": ["fabric"], "dependencies": [],
        "files": [{ "hashes": { "sha512": sha512 }, "url": "https://cdn.modrinth.com/a.jar", "filename": "a.jar",
                    "primary": true, "size": 1 }]
    }))
    .unwrap()
}

fn modrinth_project(id: &str, server_side: &str) -> Project {
    Project {
        id: id.into(),
        title: format!("Titel {id}"),
        server_side: server_side.into(),
        ..Project::default()
    }
}

#[derive(Default)]
struct FakeApi {
    versions: HashMap<String, Version>,
    projects: Vec<Project>,
    offline: AtomicBool,
    version_calls: Mutex<Vec<Vec<String>>>,
    project_calls: Mutex<Vec<Vec<String>>>,
}

impl FakeApi {
    fn knowing(hashes_and_projects: &[(char, &str, &str)]) -> Self {
        let mut api = Self::default();
        for (letter, project_id, server_side) in hashes_and_projects {
            api.versions
                .insert(hash(*letter), modrinth_version(project_id, &hash(*letter)));
            api.projects.push(modrinth_project(project_id, server_side));
        }
        api
    }

    fn calls(&self) -> (usize, usize) {
        (
            self.version_calls.lock().unwrap().len(),
            self.project_calls.lock().unwrap().len(),
        )
    }

    fn fail_when_offline(&self) -> AppResult<()> {
        if self.offline.load(Ordering::SeqCst) {
            Err(AppError::invalid("offline"))
        } else {
            Ok(())
        }
    }
}

impl ModrinthApi for &'static FakeApi {
    fn versions_by_sha512<'a>(
        &'a self,
        hashes: &'a [String],
    ) -> BoxFuture<'a, AppResult<HashMap<String, Version>>> {
        Box::pin(async move {
            self.version_calls.lock().unwrap().push(hashes.to_vec());
            self.fail_when_offline()?;
            Ok(hashes
                .iter()
                .filter_map(|h| Some((h.clone(), self.versions.get(h)?.clone())))
                .collect())
        })
    }

    fn projects<'a>(&'a self, ids: &'a [String]) -> BoxFuture<'a, AppResult<Vec<Project>>> {
        Box::pin(async move {
            self.project_calls.lock().unwrap().push(ids.to_vec());
            self.fail_when_offline()?;
            Ok(self
                .projects
                .iter()
                .filter(|p| ids.contains(&p.id))
                .cloned()
                .collect())
        })
    }
}

/// Die Fake-Schnittstelle lebt für den ganzen Test; `leak` spart sich Arc und Lebensdauern in den Fixtures.
fn leaked(api: FakeApi) -> &'static FakeApi {
    Box::leak(Box::new(api))
}

fn lookup_over(api: &'static FakeApi, ttl: Duration) -> ModrinthLookup<&'static FakeApi> {
    ModrinthLookup::with(api, ttl)
}

const HOUR: Duration = Duration::from_secs(3600);

#[tokio::test]
async fn lookup_asks_modrinth_once_for_versions_and_once_for_projects() {
    let api = leaked(FakeApi::knowing(&[
        ('a', "pa", "required"),
        ('s', "ps", "unsupported"),
        ('b', "pa", "required"),
    ]));
    let lookup = lookup_over(api, HOUR);

    let found = lookup
        .classify(&[hash('a'), hash('s'), hash('b'), hash('x'), hash('a')])
        .await
        .unwrap();

    assert_eq!(api.calls(), (1, 1));
    assert_eq!(
        api.version_calls.lock().unwrap()[0].len(),
        4,
        "doppelte Hashes werden nur einmal gefragt"
    );
    assert_eq!(api.project_calls.lock().unwrap()[0], ["pa", "ps"]);
    assert_eq!(found.len(), 3, "X kennt Modrinth nicht");
    assert_eq!(
        found[&hash('a')],
        ModInfo {
            title: "Titel pa".into(),
            project_id: "pa".into(),
            client_only: false
        }
    );
    assert!(found[&hash('s')].client_only);
}

#[tokio::test]
async fn only_server_side_unsupported_projects_are_client_only() {
    let api = leaked(FakeApi::knowing(&[
        ('a', "p1", "required"),
        ('b', "p2", "optional"),
        ('c', "p3", "unsupported"),
    ]));

    let found = lookup_over(api, HOUR)
        .classify(&[hash('a'), hash('b'), hash('c')])
        .await
        .unwrap();

    let client_only: Vec<bool> = ['a', 'b', 'c']
        .iter()
        .map(|l| found[&hash(*l)].client_only)
        .collect();
    assert_eq!(client_only, [false, false, true]);
}

#[tokio::test]
async fn answers_including_misses_are_remembered_for_the_ttl() {
    let api = leaked(FakeApi::knowing(&[('a', "pa", "required")]));
    let lookup = lookup_over(api, HOUR);

    lookup.classify(&[hash('a'), hash('x')]).await.unwrap();
    let again = lookup.classify(&[hash('x'), hash('a')]).await.unwrap();

    assert_eq!(
        api.calls(),
        (1, 1),
        "auch X (kein Treffer) wird nicht erneut gefragt"
    );
    assert_eq!(again.len(), 1);
}

#[tokio::test]
async fn only_new_hashes_are_asked_for() {
    let api = leaked(FakeApi::knowing(&[
        ('a', "pa", "required"),
        ('b', "pb", "required"),
    ]));
    let lookup = lookup_over(api, HOUR);

    lookup.classify(&[hash('a')]).await.unwrap();
    lookup.classify(&[hash('a'), hash('b')]).await.unwrap();

    assert_eq!(api.version_calls.lock().unwrap()[1], [hash('b')]);
}

#[tokio::test]
async fn expired_answers_are_asked_for_again() {
    let api = leaked(FakeApi::knowing(&[('a', "pa", "required")]));
    let lookup = lookup_over(api, Duration::ZERO);

    lookup.classify(&[hash('a')]).await.unwrap();
    lookup.classify(&[hash('a')]).await.unwrap();

    assert_eq!(api.calls(), (2, 2));
}

#[tokio::test]
async fn a_failure_is_an_error_and_is_not_remembered() {
    let api = leaked(FakeApi::knowing(&[('a', "pa", "required")]));
    api.offline.store(true, Ordering::SeqCst);
    let lookup = lookup_over(api, HOUR);

    assert!(lookup.classify(&[hash('a')]).await.is_err());
    api.offline.store(false, Ordering::SeqCst);

    assert_eq!(lookup.classify(&[hash('a')]).await.unwrap().len(), 1);
}

#[tokio::test]
async fn nothing_is_asked_for_an_empty_list_or_unknown_files_only_cost_one_call() {
    let api = leaked(FakeApi::knowing(&[]));
    let lookup = lookup_over(api, HOUR);

    assert!(lookup.classify(&[]).await.unwrap().is_empty());
    assert_eq!(api.calls(), (0, 0));
    assert!(lookup.classify(&[hash('x')]).await.unwrap().is_empty());
    assert_eq!(
        api.calls(),
        (1, 0),
        "ohne Treffer gibt es kein Projekt nachzuschlagen"
    );
}

#[tokio::test]
async fn a_version_without_its_project_stays_unresolved() {
    let mut api = FakeApi::knowing(&[('a', "pa", "required")]);
    api.projects.clear();

    assert!(lookup_over(leaked(api), HOUR)
        .classify(&[hash('a')])
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn the_plan_follows_what_modrinth_says_through_the_real_lookup() {
    let api = leaked(FakeApi::knowing(&[
        ('a', "pa", "required"),
        ('s', "ps", "unsupported"),
    ]));
    let lookup = lookup_over(api, HOUR);
    let host = manifest_of(
        FABRIC,
        "26.3",
        vec![table_file('a'), table_file('s'), table_file('x')],
    );
    let guest = instance("guest", FABRIC, "26.3");
    let local = FakeLocal(HashMap::from([("guest".to_owned(), table_mods("a"))]));

    let hashes = matching::hashes_to_classify(&host, std::slice::from_ref(&guest), &local);
    let classification = Classification::fetch(&lookup, &hashes).await;
    let plan = matching::plan(&invite(), &host, &[guest], &local, &classification);

    assert_eq!(plan.verdict, JoinVerdict::MissingContent);
    assert_eq!(
        titles(&plan.candidates[0].missing),
        ["X.jar"],
        "S ist Client-Mod, X unbekannt"
    );
    assert!(!plan.lookup_failed);
}

fn mod_dir_hasher(
    known: &'static [(&'static str, char)],
) -> impl Fn(&std::path::Path) -> io::Result<String> {
    move |path| {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        known
            .iter()
            .find(|(file_name, _)| *file_name == name)
            .map(|(_, letter)| hash(*letter))
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "fehlt"))
    }
}

#[test]
fn the_manifest_lists_active_mods_only() {
    let mut host = instance("host", FABRIC, "26.3");
    host.loader_version = Some("0.19.5".into());
    host.mods = vec![
        mod_entry("sodium.jar", ModKind::Mod, true),
        mod_entry("lithium.jar", ModKind::Mod, true),
        mod_entry("off.jar", ModKind::Mod, false),
        mod_entry("pack.zip", ModKind::ResourcePack, true),
        mod_entry("shader.zip", ModKind::Shader, true),
    ];
    let hasher = mod_dir_hasher(&[
        ("sodium.jar", 'a'),
        ("lithium.jar", 'f'),
        ("off.jar", 'o'),
        ("pack.zip", 'p'),
        ("shader.zip", 'h'),
    ]);

    let built = manifest::build(&host, std::path::Path::new("mods"), &hasher);

    assert_eq!(
        built,
        Manifest {
            minecraft_version: "26.3".into(),
            loader: FABRIC,
            loader_version: Some("0.19.5".into()),
            mods: vec![file('a', "sodium.jar"), file('f', "lithium.jar")],
        }
    );
}

#[test]
fn the_manifest_skips_unreadable_files_unsafe_names_and_repeated_hashes() {
    let mut host = instance("host", FABRIC, "26.3");
    host.mods = vec![
        mod_entry("a.jar", ModKind::Mod, true),
        mod_entry("a-copy.jar", ModKind::Mod, true),
        mod_entry("missing.jar", ModKind::Mod, true),
        mod_entry("../escape.jar", ModKind::Mod, true),
    ];
    let hasher = mod_dir_hasher(&[("a.jar", 'a'), ("a-copy.jar", 'a'), ("escape.jar", 'e')]);

    let built = manifest::build(&host, std::path::Path::new("mods"), &hasher);

    assert_eq!(built.mods, [file('a', "a.jar")]);
}

#[test]
fn a_vanilla_manifest_is_empty_and_serialises_with_the_wire_names() {
    let built = manifest::build(
        &instance("host", VANILLA, "26.3"),
        std::path::Path::new("mods"),
        &|_| unreachable!(),
    );

    assert_eq!(
        serde_json::to_value(&built).unwrap(),
        json!({ "minecraftVersion": "26.3", "loader": "vanilla", "loaderVersion": null, "mods": [] })
    );
}

fn versions() -> VersionIndex {
    VersionIndex::new([
        ("26.3".to_owned(), "2026-09-01T10:00:00+00:00".to_owned()),
        ("1.16.5".to_owned(), MIN_MC_RELEASE_TIME.to_owned()),
        ("1.16.4".to_owned(), "2020-10-29T15:49:37+00:00".to_owned()),
        ("1.16".to_owned(), "2020-06-23T16:20:52+00:00".to_owned()),
        ("1.15.2".to_owned(), "2020-01-17T10:03:52+00:00".to_owned()),
        ("1.18.2".to_owned(), "2022-02-28T10:42:45+00:00".to_owned()),
        ("1.19.2".to_owned(), "2022-08-05T11:57:05+00:00".to_owned()),
        ("1.16.5-rc1".to_owned(), "2021-01-13T16:22:59+00:00".to_owned()),
        ("26.3-snapshot-1".to_owned(), "2026-06-23T11:57:02+00:00".to_owned()),
    ])
}

fn valid_manifest() -> Manifest {
    manifest_of(FABRIC, "26.3", vec![file('a', "a.jar")])
}

fn invalid(raw: Manifest) {
    assert!(matches!(
        manifest::validate(raw, &versions()),
        Err(ManifestError::Invalid(_))
    ));
}

#[test]
fn a_valid_manifest_passes_with_sanitised_file_names() {
    let mut raw = valid_manifest();
    raw.loader_version = Some("0.19.5+build.1".into());
    raw.mods = vec![
        file('a', "§4sodium\u{202e}.jar\n"),
        file('b', &"x".repeat(300)),
    ];

    let valid = manifest::validate(raw, &versions()).unwrap();

    assert_eq!(valid.mods[0].file_name, "4sodium.jar");
    assert_eq!(valid.mods[1].file_name.chars().count(), 128);
}

#[test]
fn the_selected_release_floor_is_inclusive_and_rejects_earlier_releases() {
    for version in ["1.16.5", "1.18.2", "1.19.2", "26.3"] {
        for loader in [FABRIC, ModLoader::Forge, ModLoader::Quilt, ModLoader::Vanilla] {
            assert!(manifest::validate(manifest_of(loader, version, vec![]), &versions()).is_ok(), "{version} {loader:?}");
        }
    }
    for version in ["1.16", "1.16.4", "1.15.2"] {
        assert_eq!(
            manifest::validate(manifest_of(FABRIC, version, vec![]), &versions()),
            Err(ManifestError::VersionUnsupported),
        );
    }
}

#[test]
fn snapshots_do_not_pass_the_release_floor_even_after_its_release_date() {
    for version in ["1.16.5-rc1", "26.3-snapshot-1"] {
        invalid(manifest_of(FABRIC, version, vec![]));
    }
}

#[test]
fn an_unknown_minecraft_version_is_invalid() {
    invalid(manifest_of(FABRIC, "99.9", vec![]));
}

#[test]
fn loader_versions_are_restricted_to_a_safe_alphabet_and_length() {
    for bad in ["", "0.19 5", "0.19;5", "ü", &"1".repeat(65)] {
        let mut raw = valid_manifest();
        raw.loader_version = Some(bad.into());
        invalid(raw);
    }
    let mut longest = valid_manifest();
    longest.loader_version = Some("1".repeat(64));
    assert!(manifest::validate(longest, &versions()).is_ok());
}

#[test]
fn at_most_500_mods_are_accepted() {
    let many = |count: usize| -> Vec<ManifestMod> {
        (0..count)
            .map(|n| ManifestMod {
                sha512: format!("{n:0>128x}"),
                file_name: format!("m{n}.jar"),
            })
            .collect()
    };

    assert!(manifest::validate(
        manifest_of(FABRIC, "26.3", many(MAX_MANIFEST_MODS)),
        &versions()
    )
    .is_ok());
    invalid(manifest_of(FABRIC, "26.3", many(MAX_MANIFEST_MODS + 1)));
}

#[test]
fn hashes_must_be_128_lowercase_hex_characters_and_unique() {
    let with = |sha512: String| {
        manifest_of(
            FABRIC,
            "26.3",
            vec![ManifestMod {
                sha512,
                file_name: "a.jar".into(),
            }],
        )
    };
    invalid(with("a".repeat(127)));
    invalid(with("a".repeat(129)));
    invalid(with("A".repeat(128)));
    invalid(with("g".repeat(128)));
    invalid(manifest_of(
        FABRIC,
        "26.3",
        vec![file('a', "one.jar"), file('a', "two.jar")],
    ));
}

#[test]
fn file_names_that_sanitise_to_nothing_are_invalid() {
    invalid(manifest_of(FABRIC, "26.3", vec![file('a', "\u{200b}§")]));
}

#[test]
fn an_unknown_loader_does_not_even_deserialise() {
    let raw = json!({ "minecraftVersion": "26.3", "loader": "cauldron", "loaderVersion": null, "mods": [] });

    assert!(serde_json::from_value::<Manifest>(raw).is_err());
}

#[test]
fn a_manifest_without_loader_version_deserialises() {
    let raw = json!({ "minecraftVersion": "26.3", "loader": "fabric", "mods": [] });

    assert_eq!(
        serde_json::from_value::<Manifest>(raw)
            .unwrap()
            .loader_version,
        None
    );
}

#[test]
fn manifest_errors_map_to_their_friends_keys() {
    let invalid_key = error_key(&AppError::from(ManifestError::Invalid("x")));
    let old = AppError::from(ManifestError::VersionUnsupported);

    assert_eq!(invalid_key, "errors.friends.manifestInvalid");
    assert_eq!(error_key(&old), "errors.friends.versionUnsupported");
    assert_eq!(serde_json::to_value(&old).unwrap()["params"]["min"], "1.16.5");
}

#[test]
fn the_version_index_reads_the_mojang_manifest() {
    let manifest: crate::services::mojang::VersionManifest = serde_json::from_value(json!({
        "latest": { "release": "26.3", "snapshot": "26.3" },
        "versions": [{ "id": "26.3", "type": "release", "url": "u", "sha1": "s",
                       "releaseTime": "2026-09-01T10:00:00+00:00" }]
    }))
    .unwrap();

    let index = VersionIndex::from_manifest(&manifest);

    assert!(manifest::validate(manifest_of(FABRIC, "26.3", vec![]), &index).is_ok());
    invalid_with(&index, manifest_of(FABRIC, "1.20", vec![]));
}

fn invalid_with(index: &VersionIndex, raw: Manifest) {
    assert!(matches!(
        manifest::validate(raw, index),
        Err(ManifestError::Invalid(_))
    ));
}

#[test]
fn sha512_of_a_file_is_the_known_digest() {
    let dir = TempDir::new();
    let path = dir.path().join("abc.jar");
    std::fs::write(&path, b"abc").unwrap();

    assert_eq!(
        manifest::sha512_file(&path).unwrap(),
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
    );
}

#[test]
fn the_hash_cache_reuses_a_hash_until_size_or_time_change() {
    let dir = TempDir::new();
    let path = dir.path().join("m.jar");
    let cache = HashCache::default();
    std::fs::write(&path, b"aaaa").unwrap();
    let before = std::fs::metadata(&path).unwrap().modified().unwrap();
    let first = cache.hash(&path).unwrap();

    std::fs::write(&path, b"bbbb").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(before)
        .unwrap();
    assert_eq!(
        cache.hash(&path).unwrap(),
        first,
        "gleiche Größe und Zeit: aus dem Merker"
    );

    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(before + Duration::from_secs(5))
        .unwrap();
    let changed = cache.hash(&path).unwrap();
    assert_ne!(changed, first);
    assert_eq!(changed, manifest::sha512_file(&path).unwrap());

    std::fs::write(&path, b"longer content").unwrap();
    assert_eq!(
        cache.hash(&path).unwrap(),
        manifest::sha512_file(&path).unwrap(),
        "andere Größe: neu gelesen"
    );
}

#[test]
fn the_hash_cache_reports_a_missing_file() {
    let dir = TempDir::new();

    assert_eq!(
        HashCache::default()
            .hash(&dir.path().join("none.jar"))
            .unwrap_err()
            .kind(),
        io::ErrorKind::NotFound
    );
}

#[test]
fn disk_hashes_read_the_mods_folder_of_the_instance() {
    let dir = TempDir::new();
    let dirs = crate::services::Dirs::new(dir.path());
    let mut guest = instance("guest", FABRIC, "26.3");
    guest.mods = vec![
        mod_entry("a.jar", ModKind::Mod, true),
        mod_entry("off.jar", ModKind::Mod, false),
    ];
    std::fs::create_dir_all(dirs.mods_dir("guest")).unwrap();
    std::fs::write(dirs.mods_dir("guest").join("a.jar"), b"abc").unwrap();
    std::fs::write(dirs.mods_dir("guest").join("off.jar"), b"abc").unwrap();
    let cache = HashCache::default();

    let mods = matching::DiskHashes {
        dirs: &dirs,
        cache: &cache,
    }
    .mods_of(&guest);

    assert_eq!(mods.len(), 1);
    assert_eq!(mods[0].file_name, "a.jar");
    assert!(mods[0].sha512.starts_with("ddaf35a1"));
}
