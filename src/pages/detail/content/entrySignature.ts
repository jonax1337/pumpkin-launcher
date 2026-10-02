import type { ContentModel } from "./ContentModel";
import type { Entry } from "./types";

/**
 * Alles, was eine Zeile, Kachel oder ein Platzhalter vom Modell liest, als Liste einfacher Werte. Ändert sich keiner,
 * sieht die Zeile gleich aus und rendert nicht neu: bei Hunderten Inhalten ändert so ein Tastendruck in der Suche
 * oder ein Haken nur die betroffenen Zeilen. Liest eine Zeile etwas Neues vom Modell, gehört es hierher.
 * Funktionen des Modells stehen nicht darin: sie müssen eine feste Identität haben und den aktuellen Stand lesen
 * (`useStableFn`), denn eine nicht neu gerenderte Zeile behält sie.
 */
export function entrySignature(model: ContentModel, entry: Entry): unknown[] {
  const { mod } = entry;
  if (entry.type === "ghost") return [entry, model.mode, model.iconOf(mod)];
  const updating = model.isUpdating(mod);
  const pack = mod.kind === "resourcepack" ? [model.packs.available, model.packs.blocked, model.packs.isActive(mod), model.packs.isIncompatible(mod)] : [];
  const warns = model.warnsOf(mod).map((w) => `${w.text}|${w.detail}|${w.actionLabel}`);
  return [
    mod, entry.owners.join("\n"), model.mode, model.grouped, model.sort, model.hasWarnings, model.locked,
    model.picked.has(mod.id), model.updateFor.get(mod.id), updating, updating ? model.updateShare : null,
    model.titleOf(mod), model.iconOf(mod), model.descriptionOf(mod), model.factsOf(mod), ...warns, ...pack,
  ];
}

/** Gleiche Werte an gleicher Stelle? */
export const sameSignature = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
