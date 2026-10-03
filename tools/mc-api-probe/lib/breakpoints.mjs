// Brueche zwischen Minecraft-Versionen in den Mitgliedern, die der Mod nutzt (@used in members/*.txt).
//
// Hart (Bruch): eine Signatur der Vorversion fehlt oder hat sich geaendert, oder das Mitglied taucht erst auf.
//   Ein Knoten kann so eine Grenze nicht ueberspannen, weil ein Aufruf mit alter Beschreibung zur Laufzeit
//   NoSuchMethodError wirft (auch Rueckgabetypen zaehlen: int -> void ist binaer inkompatibel).
// Weich: nur zusaetzliche Ueberladungen; die alten Signaturen bestehen weiter.
import { entriesBySpec, escapeCell, signatureKey, visibleMembers } from "./report.mjs";

function usedSpecsOf(results) {
  return results.entries.filter((entry) => entry.used).map((entry) => entry.spec);
}

const keysOf = (entry) => visibleMembers(entry).map(signatureKey);

function compareEntries(before, after) {
  const beforeKeys = keysOf(before);
  const afterKeys = keysOf(after);
  const removed = beforeKeys.filter((key) => !afterKeys.includes(key));
  const added = afterKeys.filter((key) => !beforeKeys.includes(key));
  const appeared = beforeKeys.length === 0 && added.length > 0;
  return { removed, added, hard: removed.length > 0 || appeared, soft: removed.length === 0 && !appeared && added.length > 0 };
}

/** Fuer jedes aufeinanderfolgende Versionspaar die genutzten Mitglieder mit harter oder weicher Aenderung. */
export function findBreakpoints(versions, resultsByVersion) {
  const entries = entriesBySpec(resultsByVersion, versions);
  const usedSpecs = usedSpecsOf(resultsByVersion.get(versions[0]));
  return versions.slice(1).map((to, index) => {
    const from = versions[index];
    const changes = usedSpecs
      .map((spec) => ({ spec, ...compareEntries(entries.get(spec).get(from), entries.get(spec).get(to)) }))
      .filter((change) => change.hard || change.soft);
    return { from, to, hard: changes.filter((c) => c.hard), soft: changes.filter((c) => c.soft) };
  });
}

/** Laeufe aufeinanderfolgender Versionen ohne harten Bruch in den genutzten Mitgliedern. */
export function compatibleRuns(versions, breakpoints) {
  const runs = [[versions[0]]];
  for (const { to, hard } of breakpoints) {
    if (hard.length > 0) runs.push([to]);
    else runs.at(-1).push(to);
  }
  return runs;
}

const runLabel = (run) => (run.length === 1 ? run[0] : `${run[0]} – ${run.at(-1)}`);
const list = (keys) => (keys.length === 0 ? "–" : escapeCell(keys.join("; ")));

function describeHard({ spec, removed, added }) {
  return `\`${spec}\`: ${list(removed)} → ${list(added)}`;
}

export function renderBreakpoints(versions, resultsByVersion) {
  const breakpoints = findBreakpoints(versions, resultsByVersion);
  const hardRows = breakpoints
    .filter(({ hard }) => hard.length > 0)
    .map(({ from, to, hard }) => `| ${from} → ${to} | ${hard.map(describeHard).join("<br>")} |`);
  const softRows = breakpoints
    .filter(({ soft }) => soft.length > 0)
    .map(({ from, to, soft }) => `| ${from} → ${to} | ${soft.map(({ spec, added }) => `\`${spec}\`: + ${list(added)}`).join("<br>")} |`);
  const runs = compatibleRuns(versions, breakpoints).map(runLabel).join(" · ");
  return [
    `Runs without a breaking change in any member the mod uses: ${runs}\n`,
    "Breaking changes (a signature that existed before is gone or different, or the member appears for the first time):\n",
    "| Transition | Member: removed or changed → new |",
    "|---|---|",
    ...hardRows,
    "\nAdditions only (new overloads, old signatures still exist; not a break):\n",
    "| Transition | Added |",
    "|---|---|",
    ...softRows,
  ].join("\n");
}
