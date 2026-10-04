// Empfohlene Knotenliste (nodes.json): Pruefung gegen das Mojang-Manifest und Darstellung fuer das Dokument.

const LOADERS = new Set(["fabric", "neoforge", "forge"]);
const STRATEGIES = new Set(["fabricAddMods", "fmlMavenRoot", "fmlModFolders"]);
const NODE_ID = /^[0-9][0-9A-Za-z.]*-(fabric|neoforge|forge)$/;

function structuralProblems(node) {
  const problems = [];
  if (!NODE_ID.test(node.id) || !node.id.endsWith(`-${node.loader}`)) problems.push(`${node.id}: id passt nicht zu <minecraft>-<loader>`);
  if (!LOADERS.has(node.loader)) problems.push(`${node.id}: unbekannter Loader ${node.loader}`);
  if (!STRATEGIES.has(node.strategy)) problems.push(`${node.id}: unbekannte Strategie ${node.strategy}`);
  if (!Number.isInteger(node.javaMin)) problems.push(`${node.id}: javaMin muss eine ganze Zahl sein`);
  if (!node.loaderMin) problems.push(`${node.id}: loaderMin fehlt`);
  if (!Array.isArray(node.minecraft) || node.minecraft.length === 0) problems.push(`${node.id}: minecraft ist leer`);
  return problems;
}

function manifestProblems(node, releaseIds) {
  const positions = node.minecraft.map((id) => releaseIds.indexOf(id));
  const unknown = node.minecraft.filter((_, index) => positions[index] < 0);
  if (unknown.length > 0) return [`${node.id}: keine Release-Ids im Mojang-Manifest: ${unknown.join(", ")}`];
  const sorted = [...positions].sort((a, b) => a - b);
  const contiguous = sorted.every((position, index) => index === 0 || position === sorted[index - 1] + 1);
  return contiguous ? [] : [`${node.id}: minecraft ist nicht lueckenlos (Release-Reihenfolge laut Manifest)`];
}

async function javaProblems(node, requiredJavaMajor) {
  const required = await Promise.all(node.minecraft.map((id) => requiredJavaMajor(id)));
  const lowest = Math.min(...required);
  return node.javaMin > lowest ? [`${node.id}: javaMin ${node.javaMin} liegt ueber dem Minimum von ${lowest}, das Mojang fuer ${node.minecraft.join(", ")} verlangt`] : [];
}

/** Jede Knoten-Id und jedes Paar (Loader, Minecraft-Id) darf nur in einem Knoten vorkommen. */
function duplicateProblems(nodes) {
  const owners = new Map();
  const problems = [];
  for (const node of nodes) {
    for (const key of [`id ${node.id}`, ...(node.minecraft ?? []).map((id) => `${node.loader} ${id}`)]) {
      if (owners.has(key)) problems.push(`${node.id}: ${key} gehoert schon zu ${owners.get(key)}`);
      else owners.set(key, node.id);
    }
  }
  return problems;
}

async function nodeProblems(node, { releaseIds, requiredJavaMajor }) {
  const structural = structuralProblems(node);
  if (structural.length > 0) return structural;
  const manifest = manifestProblems(node, releaseIds);
  return manifest.length > 0 ? manifest : javaProblems(node, requiredJavaMajor);
}

/**
 * Liefert alle Verstoesse; leere Liste heisst: die Liste ist in sich stimmig und deckt sich mit dem Manifest.
 * `manifest` = { releaseIds: string[] (neueste zuerst), requiredJavaMajor: (id) => Promise<number> }.
 */
export async function checkNodes(document, manifest) {
  const perNode = await Promise.all(document.nodes.map((node) => nodeProblems(node, manifest)));
  return [...perNode.flat(), ...duplicateProblems(document.nodes)];
}

const range = (ids) => (ids.length === 1 ? ids[0] : `${ids[0]} – ${ids.at(-1)}`);

/** Gefensterter JSON-Block (maschinenlesbar) und eine Uebersichtstabelle. */
export function renderNodes(document) {
  const rows = document.nodes.map((n) => `| \`${n.id}\` | ${range(n.minecraft)} | ${n.loaderMin} | ${n.javaMin} | \`${n.strategy}\` |`);
  return [
    "```json",
    JSON.stringify(document, null, 2),
    "```",
    "",
    "| Node | Minecraft | Loader min | Java min | Strategy |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
