// Fasst die Probe-Ergebnisse mehrerer Versionen zu Tabellen je Gruppe mit einer Spalte je Ära zusammen.
import { splitMethodDescriptor, descriptorToJavaType } from "./descriptors.mjs";

const ABSENT_MEMBER = "–";
const SAME_AS_PREVIOUS = "=";
const ABSENT_CLASS = "class absent";
const ACCESS_ABBREVIATIONS = { public: "", protected: "protected ", private: "private " };

function accessPrefix(modifiers) {
  const access = modifiers.find((m) => m in ACCESS_ABBREVIATIONS);
  const staticPart = modifiers.includes("static") ? "static " : "";
  const abstractPart = modifiers.includes("abstract") ? "abstract " : "";
  return `${ACCESS_ABBREVIATIONS[access] ?? "package "}${staticPart}${abstractPart}`;
}

function renderParameters(descriptor) {
  const { parameters, returnType } = splitMethodDescriptor(descriptor);
  const rendered = parameters.map((p) => descriptorToJavaType(p, { simple: true })).join(", ");
  return `(${rendered}) → ${descriptorToJavaType(returnType, { simple: true })}`;
}

function simpleClassName(internalName) {
  return internalName.slice(internalName.lastIndexOf("/") + 1).replaceAll("$", ".");
}

/** Signatur eines Mitglieds, wie ein Aufrufer sie sieht (Zugriff, Parameter, Rueckgabe), ohne die deklarierende Klasse. */
export function signatureKey(member) {
  const body = member.kind === "field"
    ? `field ${descriptorToJavaType(member.descriptor, { simple: true })}`
    : renderParameters(member.descriptor);
  return `${accessPrefix(member.modifiers)}${body}`;
}

/** Eine Tabellenzelle fuer ein aufgeloestes Mitglied; vererbte Mitglieder nennen die deklarierende Klasse. */
export function renderMember(member, ownerInternalName) {
  const inherited = member.declaredIn === ownerInternalName ? "" : ` ← ${simpleClassName(member.declaredIn)}`;
  return `${signatureKey(member)}${inherited}`;
}

/** Fuer Aufrufer sichtbare (nicht private) Mitglieder eines Eintrags; leer, wenn Klasse oder Mitglied fehlen. */
export function visibleMembers(entry) {
  return entry.classFound ? entry.members.filter((m) => !m.modifiers.includes("private")) : [];
}

function renderEntry(entry) {
  if (!entry.classFound) return ABSENT_CLASS;
  const visible = visibleMembers(entry);
  if (visible.length === 0) return ABSENT_MEMBER;
  return visible.map((m) => renderMember(m, entry.className)).sort().join("; ");
}

function groupSpecsInOrder(results) {
  const groups = new Map();
  for (const entry of results.entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry.spec);
  }
  return groups;
}

export function entriesBySpec(resultsByVersion, versions) {
  return indexEntriesBySpec(resultsByVersion, versions, (entry) => entry);
}

export function cellsBySpec(resultsByVersion, versions) {
  return indexEntriesBySpec(resultsByVersion, versions, renderEntry);
}

function indexEntriesBySpec(resultsByVersion, versions, valueOfEntry) {
  const indexed = new Map();
  for (const version of versions) {
    for (const entry of resultsByVersion.get(version).entries) {
      if (!indexed.has(entry.spec)) indexed.set(entry.spec, new Map());
      indexed.get(entry.spec).set(version, valueOfEntry(entry));
    }
  }
  return indexed;
}

function splitIntoEras(versions, specs, cells) {
  const eras = [];
  for (const version of versions) {
    const last = eras.at(-1);
    const sameAsLast = last && specs.every((spec) => cells.get(spec).get(version) === cells.get(spec).get(last.versions.at(-1)));
    if (sameAsLast) last.versions.push(version);
    else eras.push({ versions: [version] });
  }
  return eras;
}

const eraLabel = (era) => (era.versions.length === 1 ? era.versions[0] : `${era.versions[0]} – ${era.versions.at(-1)}`);

/** Ersetzt eine Zelle, die der vorigen Ära gleicht, durch ein Gleichheitszeichen (spart Platz, zeigt die Brüche). */
function collapseRepeats(cells) {
  return cells.map((cell, index) => (index > 0 && cell === cells[index - 1] ? SAME_AS_PREVIOUS : cell));
}

/** Liefert je Gruppe { group, eras, rows: [{spec, cells[]}], neverPresent[] }. */
export function buildGroupTables(versions, resultsByVersion) {
  const cells = cellsBySpec(resultsByVersion, versions);
  const groups = groupSpecsInOrder(resultsByVersion.get(versions[0]));
  return [...groups].map(([group, allSpecs]) => {
    const neverPresent = allSpecs.filter((spec) => versions.every((v) => [ABSENT_MEMBER, ABSENT_CLASS].includes(cells.get(spec).get(v))));
    const specs = allSpecs.filter((spec) => !neverPresent.includes(spec));
    const eras = splitIntoEras(versions, specs, cells);
    const rows = specs.map((spec) => ({ spec, cells: collapseRepeats(eras.map((era) => cells.get(spec).get(era.versions[0]))) }));
    return { group, eras: eras.map(eraLabel), rows, neverPresent };
  });
}

export const escapeCell = (text) => text.replaceAll("|", "\\|");

function renderTable({ group, eras, rows, neverPresent }) {
  const header = `| Member | ${eras.join(" | ")} |`;
  const separator = `|---|${eras.map(() => "---").join("|")}|`;
  const body = rows.map((row) => `| \`${row.spec}\` | ${row.cells.map(escapeCell).join(" | ")} |`);
  const never = neverPresent.length > 0 ? [`\nIn none of the probed versions: ${neverPresent.map((s) => `\`${s}\``).join(", ")}`] : [];
  return [`#### ${group}\n`, header, separator, ...body, ...never].join("\n");
}

export function renderGroupTables(tables) {
  return tables.map(renderTable).join("\n\n");
}

/** Eine Zeile je probierter Version: Java laut Mojang, Class-File-Version, Mappings, SHA-1 der Client-Jar. */
export function renderVersions(versions, resultsByVersion) {
  const rows = versions.map((id) => {
    const { javaMajor, classMajor, obfuscated, jarSha1 } = resultsByVersion.get(id);
    return `| ${id} | ${javaMajor} | ${classMajor} | ${obfuscated ? "official Mojang mappings" : "none (unobfuscated)"} | \`${jarSha1}\` |`;
  });
  return ["| Version | Java (Mojang) | Class file major | Names in the jar | client.jar SHA-1 |", "|---|---|---|---|---|", ...rows].join("\n");
}
