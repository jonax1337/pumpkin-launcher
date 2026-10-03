// Mojang-Versionsmanifest: findet eine Version und legt Client-Jar und offizielle Mappings im Cache ab.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureDownloaded, fetchJson } from "./download.mjs";
import { openZip } from "./zip.mjs";

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

async function loadManifest(cacheDir) {
  const path = join(cacheDir, "version_manifest_v2.json");
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const manifest = await fetchJson(MANIFEST_URL);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, JSON.stringify(manifest));
  return manifest;
}

/** Alle Release-Ids des Manifests, neueste zuerst. */
export async function listReleaseIds(cacheDir) {
  const manifest = await loadManifest(cacheDir);
  return manifest.versions.filter((v) => v.type === "release").map((v) => v.id);
}

async function loadVersionJson(manifest, versionId, versionDir) {
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Version ${versionId} steht nicht im Mojang-Manifest`);
  const path = join(versionDir, "version.json");
  await ensureDownloaded(entry.url, path, entry.sha1);
  return { json: JSON.parse(readFileSync(path, "utf8")), type: entry.type };
}

/** Java-Hauptversion, die Mojang fuer eine Version vorschreibt (nur die Versions-JSON, kein Jar-Download). */
export async function requiredJavaMajor(versionId, cacheDir) {
  const manifest = await loadManifest(cacheDir);
  const { json } = await loadVersionJson(manifest, versionId, join(cacheDir, versionId));
  return json.javaVersion.majorVersion;
}

/**
 * Stellt sicher, dass Client-Jar und Mappings einer Version lokal liegen.
 * `mappingPath` ist null fuer unobfuskierte Versionen (ab 26.1), die keine Mappings veroeffentlichen.
 */
export async function prepareVersion(versionId, cacheDir) {
  const manifest = await loadManifest(cacheDir);
  const versionDir = join(cacheDir, versionId);
  const { json, type } = await loadVersionJson(manifest, versionId, versionDir);
  const { client, client_mappings: mappings } = json.downloads;
  const jarPath = await ensureDownloaded(client.url, join(versionDir, "client.jar"), client.sha1);
  const mappingPath = mappings
    ? await ensureDownloaded(mappings.url, join(versionDir, "client_mappings.txt"), mappings.sha1)
    : null;
  return {
    id: versionId,
    type,
    javaMajor: json.javaVersion?.majorVersion ?? null,
    jarPath,
    mappingPath,
    jarSha1: client.sha1,
    classMajor: classFileMajor(jarPath),
  };
}

const CLASS_FILE_MAJOR_OFFSET = 6;
const CLASS_SAMPLE_SIZE = 50;

/** Hoechste Class-File-Hauptversion einer Stichprobe der Klassen in der Jar (61 = Java 17, 65 = Java 21, 69 = Java 25). */
function classFileMajor(jarPath) {
  const zip = openZip(jarPath);
  try {
    const classNames = zip.names.filter((name) => name.endsWith(".class")).slice(0, CLASS_SAMPLE_SIZE);
    return Math.max(...classNames.map((name) => zip.read(name).readUInt16BE(CLASS_FILE_MAJOR_OFFSET)));
  } finally {
    zip.close();
  }
}
