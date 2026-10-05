//! Der Beispiel-Index (`mod/fixtures/mod-index.sample.json`) und das Schema (`mod/index.schema.json`) gegen die
//! Regeln des Launchers: das Beispiel wird gelesen, jede Regel lehnt eine beschädigte Kopie ab, und das Schema sagt
//! dasselbe wie der Code.
use regex::Regex;
use serde_json::{json, Value};

use super::index::{IndexError, Loader, ModIndex, Strategy};
use super::validate::{is_jar_file_name, is_plain_name, JAVA_MIN_RANGE};
use super::version::is_release_id;

const SAMPLE: &str = include_str!("../../../../../mod/fixtures/mod-index.sample.json");
const SCHEMA: &str = include_str!("../../../../../mod/index.schema.json");

fn sample() -> Value {
    serde_json::from_str(SAMPLE).unwrap()
}

fn schema() -> Value {
    serde_json::from_str(SCHEMA).unwrap()
}

fn parse_mutated(mutate: impl FnOnce(&mut Value)) -> Result<ModIndex, IndexError> {
    let mut document = sample();
    mutate(&mut document);
    ModIndex::parse(&document.to_string())
}

// --- das Beispiel ------------------------------------------------------------------------------------------

#[test]
fn the_sample_parses_into_three_nodes_and_one_of_them_is_off() {
    let index = ModIndex::parse(SAMPLE).unwrap();
    assert_eq!(index.mod_version, "2.1.0");
    let verified: Vec<(&str, bool)> = index
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node.is_verified()))
        .collect();
    assert_eq!(
        verified,
        [
            ("1.21.1-fabric", true),
            ("1.21.1-neoforge", true),
            ("1.20.1-forge", false)
        ]
    );
    assert_eq!(
        index.node("1.21.1-neoforge").unwrap().strategy,
        Strategy::FmlMavenRoot
    );
    assert_eq!(
        index.node_serving(Loader::Fabric, "1.21").unwrap().id,
        "1.21.1-fabric"
    );
    assert_eq!(index.node_serving(Loader::Fabric, "1.20.1"), None);
}

#[test]
fn a_node_without_a_verified_entry_reads_the_same_as_one_with_null() {
    let absent = parse_mutated(|document| {
        document["nodes"][2]
            .as_object_mut()
            .unwrap()
            .remove("verified");
    })
    .unwrap();
    assert!(!absent.nodes[2].is_verified());
}

// --- jede Regel lehnt eine beschädigte Kopie ab -----------------------------------------------------------------

type Mutation = Box<dyn Fn(&mut Value)>;

fn mutation(change: impl Fn(&mut Value) + 'static) -> Mutation {
    Box::new(change)
}

fn set_first_node(field: &'static str, value: Value) -> Mutation {
    Box::new(move |document| document["nodes"][0][field] = value.clone())
}

fn rejected_cases() -> Vec<(&'static str, Mutation, &'static str)> {
    vec![
        (
            "unknown field at the top",
            mutation(|d| d["extra"] = json!(1)),
            "Malformed",
        ),
        (
            "unknown field in a node",
            set_first_node("extra", json!(1)),
            "Malformed",
        ),
        (
            "missing sha256",
            mutation(|d| drop(d["nodes"][0].as_object_mut().unwrap().remove("sha256"))),
            "Malformed",
        ),
        (
            "missing nodes",
            mutation(|d| drop(d.as_object_mut().unwrap().remove("nodes"))),
            "Malformed",
        ),
        (
            "javaMin as text",
            set_first_node("javaMin", json!("21")),
            "Malformed",
        ),
        (
            "unknown strategy id",
            set_first_node("strategy", json!("teleport")),
            "Malformed",
        ),
        (
            "unknown loader",
            set_first_node("loader", json!("quilt")),
            "Malformed",
        ),
        (
            "unknown field in verified",
            mutation(|d| d["nodes"][0]["verified"]["extra"] = json!(1)),
            "Malformed",
        ),
        (
            "mod version as a path",
            mutation(|d| d["modVersion"] = json!("../2.1.0")),
            "ModVersionInvalid",
        ),
        (
            "empty mod version",
            mutation(|d| d["modVersion"] = json!("")),
            "ModVersionInvalid",
        ),
        (
            "duplicate node id",
            mutation(|d| d["nodes"][1]["id"] = json!("1.21.1-fabric")),
            "NodeIdDuplicate",
        ),
        (
            "node id as a path",
            set_first_node("id", json!("../x")),
            "NodeIdInvalid",
        ),
        (
            "empty node id",
            set_first_node("id", json!("")),
            "NodeIdInvalid",
        ),
        (
            "loaderMin without a number",
            set_first_node("loaderMin", json!("latest")),
            "LoaderMinInvalid",
        ),
        (
            "empty minecraft list",
            set_first_node("minecraft", json!([])),
            "MinecraftListInvalid",
        ),
        (
            "repeated minecraft id",
            set_first_node("minecraft", json!(["1.21", "1.21"])),
            "MinecraftListInvalid",
        ),
        (
            "minecraft range",
            set_first_node("minecraft", json!(["1.21-1.21.1"])),
            "MinecraftIdInvalid",
        ),
        (
            "minecraft wildcard",
            set_first_node("minecraft", json!(["1.21.x"])),
            "MinecraftIdInvalid",
        ),
        (
            "minecraft tilde range",
            set_first_node("minecraft", json!(["~1.21"])),
            "MinecraftIdInvalid",
        ),
        (
            "minecraft snapshot",
            set_first_node("minecraft", json!(["24w14a"])),
            "MinecraftIdInvalid",
        ),
        (
            "minecraft pre-release",
            set_first_node("minecraft", json!(["1.21", "1.21.1-pre1"])),
            "MinecraftIdInvalid",
        ),
        (
            "minecraft release candidate",
            set_first_node("minecraft", json!(["1.21.1-rc1"])),
            "MinecraftIdInvalid",
        ),
        (
            "minecraft new style snapshot",
            set_first_node("minecraft", json!(["26.1-snapshot-1"])),
            "MinecraftIdInvalid",
        ),
        (
            "two nodes serve one cell",
            mutation(
                |d| d["nodes"][1] = json!({ "loader": "fabric", "strategy": "fabricAddMods", "file": "other.jar", "id": "other", "loaderMin": "0.16.0", "minecraft": ["1.21.1"], "javaMin": 21, "sha256": "ab".repeat(32) }),
            ),
            "MinecraftIdClaimedTwice",
        ),
        (
            "javaMin below the range",
            set_first_node("javaMin", json!(7)),
            "JavaMinInvalid",
        ),
        (
            "javaMin zero",
            set_first_node("javaMin", json!(0)),
            "JavaMinInvalid",
        ),
        (
            "javaMin above the range",
            set_first_node("javaMin", json!(65)),
            "JavaMinInvalid",
        ),
        (
            "fabric strategy on neoforge",
            mutation(|d| d["nodes"][1]["strategy"] = json!("fabricAddMods")),
            "StrategyMismatch",
        ),
        (
            "fml strategy on fabric",
            set_first_node("strategy", json!("fmlMavenRoot")),
            "StrategyMismatch",
        ),
        (
            "file name with a folder",
            set_first_node("file", json!("dir/x.jar")),
            "FileNameInvalid",
        ),
        (
            "file name with a parent",
            set_first_node("file", json!("../x.jar")),
            "FileNameInvalid",
        ),
        (
            "file name with a backslash",
            set_first_node("file", json!("dir\\x.jar")),
            "FileNameInvalid",
        ),
        (
            "file name not a jar",
            set_first_node("file", json!("x.zip")),
            "FileNameInvalid",
        ),
        (
            "file name hidden",
            set_first_node("file", json!(".x.jar")),
            "FileNameInvalid",
        ),
        (
            "file name with a space",
            set_first_node("file", json!("my mod.jar")),
            "FileNameInvalid",
        ),
        (
            "duplicate file name",
            mutation(|d| d["nodes"][1]["file"] = json!("pumpkin_friends-2.1.0+1.21.1-fabric.jar")),
            "FileNameDuplicate",
        ),
        (
            "sha256 in capitals",
            set_first_node("sha256", json!("AB".repeat(32))),
            "Sha256Invalid",
        ),
        (
            "sha256 too short",
            set_first_node("sha256", json!("ab".repeat(31))),
            "Sha256Invalid",
        ),
        (
            "sha256 not hex",
            set_first_node("sha256", json!("zz".repeat(32))),
            "Sha256Invalid",
        ),
        (
            "smoke date not a date",
            mutation(|d| d["nodes"][0]["verified"]["smoke"] = json!("yesterday")),
            "VerifiedDateInvalid",
        ),
        (
            "owner date not a date",
            mutation(|d| d["nodes"][1]["verified"]["owner"] = json!("2026-13-40")),
            "VerifiedDateInvalid",
        ),
    ]
}

#[test]
fn every_rule_rejects_a_damaged_copy_of_the_sample() {
    for (name, mutation, expected_error) in rejected_cases() {
        match parse_mutated(mutation) {
            Ok(_) => panic!("{name}: wurde angenommen"),
            Err(error) => assert!(
                format!("{error:?}").starts_with(expected_error),
                "{name}: falscher Fehler {error:?}"
            ),
        }
    }
}

#[test]
fn text_that_is_no_json_is_rejected() {
    for text in [
        "",
        "nodes",
        "[]",
        "null",
        "{\"modVersion\": \"2.1.0\"",
        "{\"modVersion\": \"2.1.0\"}",
    ] {
        assert!(
            matches!(ModIndex::parse(text), Err(IndexError::Malformed(_))),
            "{text:?}"
        );
    }
}

#[test]
fn an_index_without_nodes_is_valid() {
    assert_eq!(
        ModIndex::parse(r#"{"modVersion":"2.1.0","nodes":[]}"#)
            .unwrap()
            .nodes
            .len(),
        0
    );
}

// --- das Schema sagt dasselbe wie der Code -----------------------------------------------------------------

fn definition(name: &str) -> Value {
    schema()["$defs"][name].clone()
}

fn pattern_of(definition: &Value) -> Regex {
    Regex::new(definition["pattern"].as_str().unwrap()).unwrap()
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn the_schema_lists_the_loaders_and_strategies_of_the_code() {
    let node = definition("node");
    assert_eq!(
        strings(&node["properties"]["strategy"]["enum"]),
        Strategy::IDS
    );
    assert_eq!(
        strings(&node["properties"]["loader"]["enum"]),
        ["fabric", "neoforge", "forge"]
    );
    for loader in [Loader::Fabric, Loader::Neoforge, Loader::Forge] {
        let name = serde_json::to_value(loader).unwrap();
        assert!(node["properties"]["loader"]["enum"]
            .as_array()
            .unwrap()
            .contains(&name));
    }
}

#[test]
fn the_schema_has_the_fields_of_the_node_type_and_requires_all_but_verified() {
    let node = definition("node");
    let index = ModIndex::parse(SAMPLE).unwrap();
    let mut fields: Vec<String> = serde_json::to_value(&index.nodes[0])
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    let mut declared: Vec<String> = node["properties"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    let mut required = strings(&node["required"]);
    fields.sort();
    declared.sort();
    required.sort();
    assert_eq!(declared, fields);
    fields.retain(|field| field != "verified");
    assert_eq!(required, fields);
    assert_eq!(node["additionalProperties"], json!(false));
    assert_eq!(schema()["additionalProperties"], json!(false));
}

#[test]
fn the_schema_javamin_range_is_the_one_of_the_code() {
    let java = &definition("node")["properties"]["javaMin"];
    assert_eq!(
        java["minimum"].as_u64().unwrap() as u32,
        *JAVA_MIN_RANGE.start()
    );
    assert_eq!(
        java["maximum"].as_u64().unwrap() as u32,
        *JAVA_MIN_RANGE.end()
    );
}

#[test]
fn the_schema_patterns_agree_with_the_code_on_names_files_and_release_ids() {
    let name = pattern_of(&definition("plainName"));
    let file = pattern_of(&definition("node")["properties"]["file"]);
    let release = pattern_of(&definition("releaseId"));
    let long_name = "x".repeat(129);
    let samples = [
        "2.1.0",
        "1.21.1-neoforge",
        "a",
        "",
        ".hidden",
        "-x",
        "a/b",
        "a\\b",
        "..",
        "a b",
        "ä",
        "a:b",
        "x.jar",
        "x.JAR",
        "x.zip",
        ".x.jar",
        "a.jar.jar",
        "pumpkin_friends-2.1.0+1.21.1-neoforge.jar",
        "a..jar",
        "1.21.1",
        "26.3",
        "1.21",
        "1",
        "1.21.1.1",
        "24w14a",
        "1.21-pre1",
        "1.021",
        "1.21.12345",
        "1.0",
        "~1.21",
        "1.21.x",
        long_name.as_str(),
    ];
    for sample in samples {
        assert_eq!(
            name.is_match(sample),
            is_plain_name(sample),
            "plainName {sample:?}"
        );
        assert_eq!(
            file.is_match(sample),
            is_jar_file_name(sample),
            "file {sample:?}"
        );
        assert_eq!(
            release.is_match(sample),
            is_release_id(sample),
            "releaseId {sample:?}"
        );
    }
    let long_file = format!("{}.jar", "x".repeat(128));
    assert_eq!(file.is_match(&long_file), is_jar_file_name(&long_file));
    let too_long_file = format!("{}.jar", "x".repeat(129));
    assert_eq!(
        file.is_match(&too_long_file),
        is_jar_file_name(&too_long_file)
    );
}

#[test]
fn the_schema_sha256_and_date_patterns_agree_with_the_code() {
    let sha = pattern_of(&definition("node")["properties"]["sha256"]);
    let date = pattern_of(&definition("date"));
    for (text, valid) in [
        (&"ab".repeat(32), true),
        (&"AB".repeat(32), false),
        (&"ab".repeat(31), false),
        (&"zz".repeat(32), false),
    ] {
        assert_eq!(sha.is_match(text), valid, "{text}");
        assert_eq!(
            ModIndex::parse(&sample_with_sha(text)).is_ok(),
            valid,
            "{text}"
        );
    }
    for (text, valid) in [
        ("2026-10-03", true),
        ("2026-13-01", false),
        ("2026-10-32", false),
        ("2026-1-3", false),
        ("yesterday", false),
        ("2026-10-03T10", false),
    ] {
        assert_eq!(date.is_match(text), valid, "{text}");
        assert_eq!(
            parse_mutated(|d| d["nodes"][0]["verified"]["smoke"] = json!(text)).is_ok(),
            valid,
            "{text}"
        );
    }
}

fn sample_with_sha(sha: &str) -> String {
    let mut document = sample();
    document["nodes"][0]["sha256"] = json!(sha);
    document.to_string()
}

#[test]
fn every_node_of_the_sample_matches_the_schema_patterns() {
    let index = ModIndex::parse(SAMPLE).unwrap();
    let node = definition("node");
    let (file, sha) = (
        pattern_of(&node["properties"]["file"]),
        pattern_of(&node["properties"]["sha256"]),
    );
    let (name, release) = (
        pattern_of(&definition("plainName")),
        pattern_of(&definition("releaseId")),
    );
    let loader_min = pattern_of(&node["properties"]["loaderMin"]);
    assert!(name.is_match(&index.mod_version));
    for node in &index.nodes {
        assert!(
            name.is_match(&node.id)
                && file.is_match(&node.file)
                && sha.is_match(&node.sha256)
                && loader_min.is_match(&node.loader_min),
            "{}",
            node.id
        );
        assert!(
            node.minecraft.iter().all(|id| release.is_match(id)),
            "{}",
            node.id
        );
    }
}
