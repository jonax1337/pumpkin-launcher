//! Zentrale Grenzen für Downloads, Archive und Kataloge. Sie schützen den Rechner vor Servern und Archiven, denen
//! der Launcher nicht traut; wer sie ändert, ändert eine Sicherheitsgrenze.

pub(crate) const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

/// Größte einzelne Datei, die geladen, entpackt oder importiert wird (Mod-JAR, Pack-Datei, `.mrpack`).
pub(crate) const FILE_LIMIT: u64 = 256 * MIB;
/// Größte Antwort der Modrinth-API.
pub(crate) const API_JSON_LIMIT: u64 = 8 * MIB;
/// Größte Antwort der Anbieter-APIs (FTB, Technic, CurseForge-Proxy).
pub(crate) const PROVIDER_JSON_LIMIT: u64 = 16 * MIB;
/// Größte JSON-Datei in einem Pack-Zip: Index und Zusatzdatei des `.mrpack`, `bin/version.json` bei Technic.
pub(crate) const ZIP_JSON_LIMIT: u64 = 8 * MIB;
/// Größte `manifest.json` eines CurseForge-Packs.
pub(crate) const MANIFEST_LIMIT: u64 = 16 * MIB;

/// Größtes Pack-Zip eines Anbieters, das geladen wird.
pub(crate) const ZIP_LIMIT: u64 = 2 * GIB;
/// Entpackte Gesamtgröße eines Anbieter-Zips.
pub(crate) const PROVIDER_ZIP_EXPANDED_LIMIT: u64 = 8 * GIB;
pub(crate) const PROVIDER_ZIP_ENTRIES: usize = 20_000;

/// Entpackte Gesamtgröße eines `.mrpack` samt der Dateien, die es herunterlädt.
pub(crate) const MRPACK_EXPANDED_LIMIT: u64 = GIB;
pub(crate) const MRPACK_ENTRIES: usize = 4096;
/// Dateien im Index eines `.mrpack`.
pub(crate) const MRPACK_INDEX_FILES: usize = 2048;
/// Dateien, die ein Export schreibt: unter [`MRPACK_ENTRIES`], damit der eigene Import ihn wieder annimmt.
pub(crate) const MRPACK_EXPORT_ENTRIES: usize = 4000;
const _: () = assert!(MRPACK_EXPORT_ENTRIES < MRPACK_ENTRIES);

/// Dateien eines Anbieter-Packs, die geladen werden.
pub(crate) const PLAN_FILES: usize = 6000;
/// Summe aller Mod-Dateien eines Anbieter-Packs; fette Packs (All the Mods & Co.) haben mehrere GiB.
pub(crate) const PLAN_LIMIT: u64 = 32 * GIB;

pub(crate) const DOWNLOAD_CONCURRENCY: usize = 6;
/// Gleichzeitige Anfragen beim Aufbau eines Anbieter-Katalogs.
pub(crate) const CATALOG_CONCURRENCY: usize = 8;

/// Treffer je Seite der Suche, bei jedem Anbieter gleich, damit die Oberfläche einheitlich blättert.
pub(crate) const PAGE_SIZE: u32 = 20;
pub(crate) const QUERY_MAX: usize = 512;
/// Zeichen einer Katalog-Beschreibung; mit `…` gekürzt.
pub(crate) const SUMMARY_MAX: usize = 220;
