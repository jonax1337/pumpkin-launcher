// Fuehrt eine Mitgliederliste (members/*.txt) gegen eine Minecraft-Version aus.
import { readFileSync } from "node:fs";
import { Mappings } from "./mappings.mjs";
import { ApiModel } from "./api-model.mjs";
import { openZip } from "./zip.mjs";
import { readClassModels } from "./javap.mjs";
import { readMethodBodies } from "./code.mjs";

const CLASS_ENTRY = /^(.+)\.class$/;

function listJarClasses(jarPath) {
  const zip = openZip(jarPath);
  try {
    return zip.names.map((name) => CLASS_ENTRY.exec(name)?.[1]).filter(Boolean);
  } finally {
    zip.close();
  }
}

/** Baut das Klassenmodell fuer eine vorbereitete Version (siehe versions.mjs). */
export function openApiModel(version, javaHome) {
  const jarClasses = listJarClasses(version.jarPath);
  const mappings = version.mappingPath
    ? Mappings.fromProguard(readFileSync(version.mappingPath, "utf8"))
    : Mappings.identity(jarClasses);
  return new ApiModel(
    mappings,
    new Set(jarClasses),
    (names) => readClassModels(javaHome, version.jarPath, names),
    (obfName) => readMethodBodies(javaHome, version.jarPath, obfName),
  );
}

const USED_MARKER = /\s+@used$/;

/**
 * Liest eine Mitgliederliste. Format je Zeile: `Klasse#mitglied [@used]` (Klasse voll qualifiziert oder als Namensende),
 * `<init>` fuer Konstruktoren, `@used` markiert Mitglieder, die der Mod aufruft oder ueberschreibt,
 * `@group Name` startet eine Gruppe, `#` am Zeilenanfang ist ein Kommentar.
 */
export function parseMemberSpec(text) {
  const entries = [];
  let group = "ungrouped";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("@group ")) {
      group = line.slice("@group ".length).trim();
      continue;
    }
    const spec = line.replace(USED_MARKER, "");
    const separator = spec.lastIndexOf("#");
    if (separator <= 0) throw new Error(`Zeile ohne Klasse#Mitglied: ${line}`);
    entries.push({
      group,
      spec,
      used: USED_MARKER.test(line),
      classRef: spec.slice(0, separator),
      memberName: spec.slice(separator + 1),
    });
  }
  return entries;
}

/** Loest jeden Eintrag gegen das Modell auf. `classFound=false` heisst: Klasse existiert in dieser Version nicht. */
export function probeMembers(model, entries) {
  const resolved = entries.map((entry) => ({ ...entry, className: model.resolveClass(entry.classRef) }));
  model.loadWithAncestors([...new Set(resolved.map((entry) => entry.className).filter(Boolean))]);
  return resolved.map(({ classRef, ...entry }) => ({
    ...entry,
    classFound: entry.className !== null,
    members: entry.className ? model.findMembers(entry.className, entry.memberName) : [],
  }));
}
