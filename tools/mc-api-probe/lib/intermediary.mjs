// Fabric-Intermediary (Tiny v2): Namen, unter denen ein Fabric-Mixin zur Laufzeit auf verschleierten Versionen zielt.
import { join } from "node:path";
import { ensureDownloaded } from "./download.mjs";
import { openZip } from "./zip.mjs";

const MAVEN = "https://maven.fabricmc.net/net/fabricmc/intermediary";
const TINY_ENTRY = "mappings/mappings.tiny";

/** Liest `c`/`m`/`f`-Zeilen; Schluessel sind die offiziellen (verschleierten) Namen der Jar. */
export function parseTinyV2(text) {
  const classes = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/).slice(1)) {
    const fields = line.split("\t");
    if (fields[0] === "c") {
      current = { intermediary: fields[2], members: new Map() };
      classes.set(fields[1], current);
    } else if (current && fields[0] === "" && (fields[1] === "m" || fields[1] === "f")) {
      current.members.set(`${fields[3]}${fields[2]}`, fields[4]);
    }
  }
  return classes;
}

/** Laedt die Intermediary-Mappings einer Minecraft-Version, oder null, wenn Fabric keine veroeffentlicht (ab 26.1). */
export async function loadIntermediary(versionId, cacheDir) {
  const url = `${MAVEN}/${versionId}/intermediary-${versionId}-v2.jar`;
  const probe = await fetch(url, { method: "HEAD" });
  if (probe.status === 404) return null;
  const jarPath = await ensureDownloaded(url, join(cacheDir, versionId, "intermediary-v2.jar"));
  const zip = openZip(jarPath);
  try {
    return parseTinyV2(zip.read(TINY_ENTRY).toString("utf8"));
  } finally {
    zip.close();
  }
}

/**
 * Intermediary-Name einer Klasse und eines ihrer Mitglieder. Intermediary benennt ein Mitglied nur dort, wo es
 * zuerst deklariert wurde; Ueberschreibungen erben den Namen, daher werden die Deklarationen der Reihe nach probiert.
 */
export function intermediaryNames(tiny, declarations) {
  const [owner] = declarations;
  const memberName = declarations
    .map(({ obfClass, obfName, obfDescriptor }) => tiny.get(obfClass)?.members.get(`${obfName}${obfDescriptor}`))
    .find(Boolean);
  return { className: tiny.get(owner.obfClass)?.intermediary ?? null, memberName: memberName ?? null };
}
