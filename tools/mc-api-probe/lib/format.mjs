// Textausgabe der Probe-Ergebnisse.
import { methodToJava, descriptorToJavaType } from "./descriptors.mjs";

const dotted = (internalName) => internalName.replaceAll("/", ".");

/** `protected void init()` bzw. `private int x` fuer ein aufgeloestes Mitglied. */
export function describeMember(member, options = {}) {
  const modifiers = member.modifiers.length > 0 ? `${member.modifiers.join(" ")} ` : "";
  return `${modifiers}${memberBody(member, options)}`;
}

function memberBody(member, options) {
  if (member.kind === "field") return `${descriptorToJavaType(member.descriptor, options)} ${member.name}`;
  if (member.name !== "<init>") return methodToJava(member.name, member.descriptor, options);
  const constructorName = member.declaredIn.slice(member.declaredIn.lastIndexOf("/") + 1).replaceAll("$", ".");
  return methodToJava(constructorName, member.descriptor, options).replace(/^void /, "");
}

function formatEntry(entry) {
  if (!entry.classFound) return [`${entry.spec}\n    <Klasse existiert nicht>`];
  const header = `${entry.spec}  (${dotted(entry.className)})`;
  if (entry.members.length === 0) return [`${header}\n    <Mitglied existiert nicht>`];
  const lines = entry.members.map(
    (m) => `    ${describeMember(m)}\n        descriptor ${m.descriptor}  declaredIn ${dotted(m.declaredIn)}`,
  );
  return [header, ...lines];
}

export function formatProbeText(version, results) {
  const header = `# ${version.id} (Java ${version.javaMajor ?? "?"}, ${version.mappingPath ? "Mojang-Mappings" : "unobfuskiert"})`;
  return [header, ...results.flatMap(formatEntry)].join("\n");
}

export function formatProbeJson(version, results) {
  return JSON.stringify({ version: version.id, javaMajor: version.javaMajor, jarSha1: version.jarSha1, results }, null, 2);
}

function packMember(member, ownerName) {
  const packed = { m: member.modifiers.join(" "), d: member.descriptor };
  if (member.declaredIn !== ownerName) packed.in = member.declaredIn;
  if (member.kind === "field") packed.f = 1;
  return packed;
}

/** Kompaktes JSON fuer results/<version>.json (weniger Platz im Repo); Gegenstueck: unpackStored. */
export function formatCompactJson(version, results) {
  const entries = results.map(({ group, spec, used, className, members }) => ({
    g: group, s: spec, ...(used ? { u: 1 } : {}), c: className, m: members.map((member) => packMember(member, className)),
  }));
  return JSON.stringify({
    version: version.id,
    javaMajor: version.javaMajor,
    classMajor: version.classMajor,
    obfuscated: version.mappingPath !== null,
    jarSha1: version.jarSha1,
    entries,
  });
}

/** Liest results/<version>.json zurueck in die Form der Probe-Ergebnisse. */
export function unpackStored(stored) {
  const entries = stored.entries.map(({ g, s, u, c, m }) => {
    const memberName = s.slice(s.lastIndexOf("#") + 1);
    return {
      group: g, spec: s, used: u === 1, className: c, classFound: c !== null,
      members: m.map((p) => ({
        kind: p.f ? "field" : "method", name: memberName, modifiers: p.m === "" ? [] : p.m.split(" "), descriptor: p.d, declaredIn: p.in ?? c,
      })),
    };
  });
  return { ...stored, entries };
}
