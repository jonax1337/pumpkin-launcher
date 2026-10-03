#!/usr/bin/env node
// mc-api-probe: gibt exakte Deskriptoren (Mojang-Namen) von Minecraft-Klassen aus. Siehe README.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listReleaseIds, prepareVersion, requiredJavaMajor } from "./lib/versions.mjs";
import { openApiModel, parseMemberSpec, probeMembers } from "./lib/probe.mjs";
import { describeMember, formatCompactJson, formatProbeJson, formatProbeText, unpackStored } from "./lib/format.mjs";
import { intermediaryNames, loadIntermediary } from "./lib/intermediary.mjs";
import { buildGroupTables, renderGroupTables, renderVersions } from "./lib/report.mjs";
import { renderBreakpoints } from "./lib/breakpoints.mjs";
import { fabricApiFloors, forgeEvidence, neoForgeEvidence } from "./lib/loader-evidence.mjs";
import { checkNodes, renderNodes } from "./lib/nodes.mjs";
import { replaceRegion } from "./lib/doc-region.mjs";

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MEMBERS = join(TOOL_DIRECTORY, "members", "ingame.txt");
const RESULTS_DIRECTORY = join(TOOL_DIRECTORY, "results");
const NODES_FILE = join(TOOL_DIRECTORY, "nodes.json");

const USAGE = `Aufruf:
  node cli.mjs releases                              alle Release-Ids des Mojang-Manifests
  node cli.mjs fetch  <id>...                        Client-Jar und Mappings in den Cache laden
  node cli.mjs probe  --version <id> (--members <datei> | <Klasse#mitglied>...) [--format text|json] [--out <datei>]
  node cli.mjs collect [--members <datei>] [--out <ordner>] <id>...   Ergebnisse je Version nach results/ schreiben
  node cli.mjs report [--out <ordner>] [--doc <markdown>]            Tabellen, Brueche und Knotenliste aus results/ und nodes.json (ersetzt die Bereiche im Dokument)
  node cli.mjs check-nodes [--nodes <datei>]                         jede Minecraft-Id der Knotenliste gegen das Mojang-Manifest pruefen
  node cli.mjs intermediary [--spec Klasse#mitglied] <id>...         Fabric-Intermediary-Namen eines Mitglieds je Version
  node cli.mjs list   --version <id> <Klasse>        alle in der Klasse deklarierten Mitglieder
  node cli.mjs code   --version <id> <Klasse#methode> [--grep <regex>] [--all]   Aufrufe im Rumpf einer Methode (auch lambda$..., * als Platzhalter; --all: auch Anweisungen ohne Verweis)
  node cli.mjs find   --version <id> <regex>         Klassen, deren Mojang-Name passt
  node cli.mjs neoforge-hooks <neoforge-version>...  ScreenEvent.Init.Post, Event-Bus und @Mod(dist) je NeoForge-Build
  node cli.mjs forge-hooks <forge-version>...        ScreenEvent.Init.Post, Event-Bus, displayTest und clientSideOnly (z. B. 1.20.1-47.4.26)
  node cli.mjs fabric-floor <minecraft-id>...        Loader-Untergrenze laut erstem und letztem Fabric-API-Build
Optionen: --cache <ordner> (Env MC_API_PROBE_CACHE), --java-home <jdk> (Env MC_API_PROBE_JAVA_HOME, sonst JAVA_HOME)`;

const OPTIONS = {
  version: { type: "string" },
  members: { type: "string" },
  format: { type: "string", default: "text" },
  out: { type: "string" },
  doc: { type: "string" },
  spec: { type: "string" },
  nodes: { type: "string" },
  grep: { type: "string" },
  all: { type: "boolean", default: false },
  cache: { type: "string" },
  "java-home": { type: "string" },
};

function cacheDirectory(values) {
  return values.cache ?? process.env.MC_API_PROBE_CACHE ?? join(tmpdir(), "mc-api-probe-cache");
}

function javaHome(values) {
  return values["java-home"] ?? process.env.MC_API_PROBE_JAVA_HOME ?? process.env.JAVA_HOME ?? null;
}

function requireVersion(values) {
  if (!values.version) throw new Error(`--version fehlt\n${USAGE}`);
  return values.version;
}

async function openModel(values) {
  const version = await prepareVersion(requireVersion(values), cacheDirectory(values));
  return { version, model: openApiModel(version, javaHome(values)) };
}

function emit(text, values) {
  if (values.out) writeFileSync(values.out, `${text}\n`);
  else console.log(text);
}

async function runProbe(values, positionals) {
  const specText = values.members ? readFileSync(values.members, "utf8") : positionals.join("\n");
  const { version, model } = await openModel(values);
  const results = probeMembers(model, parseMemberSpec(specText));
  emit(values.format === "json" ? formatProbeJson(version, results) : formatProbeText(version, results), values);
}

async function runList(values, [classReference]) {
  const { version, model } = await openModel(values);
  const className = model.resolveClass(classReference);
  if (!className) throw new Error(`${classReference} existiert in ${version.id} nicht`);
  model.loadWithAncestors([className]);
  const lines = model.declaredMembers(className).map((m) => `${describeMember(m, { simple: true })}    ${m.descriptor}`);
  emit([`# ${version.id} ${className}`, ...lines].join("\n"), values);
}

async function runCode(values, [memberReference]) {
  const { version, model } = await openModel(values);
  const [classReference, methodName] = memberReference.split("#");
  const className = model.resolveClass(classReference);
  if (!className) throw new Error(`${classReference} existiert in ${version.id} nicht`);
  model.loadWithAncestors([className]);
  const keep = values.grep ? new RegExp(values.grep) : /./;
  const lines = model.methodBodies(className, methodName, { all: values.all }).flatMap((body) => {
    const kept = body.instructions.filter((instruction) => keep.test(instruction));
    return kept.length > 0 ? [`# ${body.name}${body.descriptor}`, ...kept] : [];
  });
  emit([`# ${version.id} ${className}`, ...lines].join("\n"), values);
}

async function runFind(values, [pattern]) {
  const { model } = await openModel(values);
  const matcher = new RegExp(pattern);
  emit(model.classNames().filter((name) => matcher.test(name.replaceAll("/", "."))).map((n) => n.replaceAll("/", ".")).join("\n"), values);
}

async function runReleases(values) {
  console.log((await listReleaseIds(cacheDirectory(values))).join("\n"));
}

async function runFetch(values, versionIds) {
  for (const id of versionIds) {
    const version = await prepareVersion(id, cacheDirectory(values));
    console.log(`${id}: Java ${version.javaMajor}, ${version.mappingPath ? "Mojang-Mappings" : "unobfuskiert"}`);
  }
}

async function runIntermediary(values, versionIds) {
  const spec = parseMemberSpec(values.spec ?? "PauseScreen#init");
  console.log("| Version | Mojang class | Intermediary class | Member | Intermediary member | Descriptor (Mojang names) |");
  console.log("|---|---|---|---|---|---|");
  for (const id of versionIds) {
    const version = await prepareVersion(id, cacheDirectory(values));
    const tiny = await loadIntermediary(id, cacheDirectory(values));
    const model = openApiModel(version, javaHome(values));
    const [result] = probeMembers(model, spec);
    for (const member of result.members.filter((m) => m.declaredIn === result.className)) {
      const names = tiny ? intermediaryNames(tiny, model.obfDeclarations(result.className, member.name, member.descriptor)) : { className: "(no intermediary)", memberName: "(no intermediary)" };
      console.log(`| ${id} | ${result.className.replaceAll("/", ".")} | ${names.className} | ${member.name} | ${names.memberName} | ${member.descriptor} |`);
    }
  }
}

async function runCollect(values, versionIds) {
  const outDirectory = values.out ?? RESULTS_DIRECTORY;
  mkdirSync(outDirectory, { recursive: true });
  const entries = parseMemberSpec(readFileSync(values.members ?? DEFAULT_MEMBERS, "utf8"));
  for (const id of versionIds) {
    const version = await prepareVersion(id, cacheDirectory(values));
    const results = probeMembers(openApiModel(version, javaHome(values)), entries);
    writeFileSync(join(outDirectory, `${id}.json`), formatCompactJson(version, results));
    console.log(`${id}: ${results.length} Eintraege`);
  }
}

async function runReport(values) {
  const directory = values.out ?? RESULTS_DIRECTORY;
  const stored = new Map(readdirSync(directory).filter((f) => f.endsWith(".json")).map((f) => {
    const parsed = unpackStored(JSON.parse(readFileSync(join(directory, f), "utf8")));
    return [parsed.version, parsed];
  }));
  const chronological = (await listReleaseIds(cacheDirectory(values))).reverse().filter((id) => stored.has(id));
  const regions = {
    versions: renderVersions(chronological, stored),
    "probe-tables": renderGroupTables(buildGroupTables(chronological, stored)),
    breakpoints: renderBreakpoints(chronological, stored),
    nodes: renderNodes(JSON.parse(readFileSync(NODES_FILE, "utf8"))),
  };
  if (!values.doc) return console.log(Object.values(regions).join("\n\n"));
  const updated = Object.entries(regions).reduce((text, [name, content]) => replaceRegion(text, name, content), readFileSync(values.doc, "utf8"));
  writeFileSync(values.doc, updated);
}

async function runCheckNodes(values) {
  const nodes = JSON.parse(readFileSync(values.nodes ?? NODES_FILE, "utf8"));
  const cache = cacheDirectory(values);
  const manifest = { releaseIds: await listReleaseIds(cache), requiredJavaMajor: (id) => requiredJavaMajor(id, cache) };
  const problems = await checkNodes(nodes, manifest);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  console.log(`${nodes.nodes.length} Knoten geprueft: alle Minecraft-Ids sind Release-Ids des Mojang-Manifests`);
}

async function runNeoForgeHooks(values, versions) {
  for (const version of versions) console.log(JSON.stringify(await neoForgeEvidence(version, cacheDirectory(values))));
}

async function runForgeHooks(values, versions) {
  for (const version of versions) console.log(JSON.stringify(await forgeEvidence(version, cacheDirectory(values))));
}

async function runFabricFloor(values, minecraftIds) {
  for (const id of minecraftIds) console.log(JSON.stringify(await fabricApiFloors(id, cacheDirectory(values))));
}

const COMMANDS = {
  probe: runProbe,
  list: runList,
  code: runCode,
  find: runFind,
  releases: runReleases,
  fetch: runFetch,
  collect: runCollect,
  intermediary: runIntermediary,
  report: runReport,
  "check-nodes": runCheckNodes,
  "neoforge-hooks": runNeoForgeHooks,
  "forge-hooks": runForgeHooks,
  "fabric-floor": runFabricFloor,
};

async function main() {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [commandName, ...arguments_] = positionals;
  const command = COMMANDS[commandName];
  if (!command) throw new Error(USAGE);
  await command(values, arguments_);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
