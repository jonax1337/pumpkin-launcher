import { ownerKey } from "@/lib/mods";
import type { Mod } from "@/lib/types";

/** Ein Inhalt mit den vorhandenen Inhalten, die ihn brauchen. */
export type Ordered = { mod: Mod; owners: Mod[] };

/** Direkt Hinzugefügtes zuerst, jede Abhängigkeit eingerückt unter ihrem ersten vorhandenen Nutzer. */
export function orderByDependency(mods: Mod[]): Ordered[] {
  const byProject = new Map(mods.flatMap((mod) => { const key = ownerKey(mod); return key ? [[key, mod] as const] : []; }));
  const ownersOf = (mod: Mod) => mod.requiredBy.flatMap((project) => byProject.get(project) ?? []);
  const ordered: Ordered[] = [];
  const placed = new Set<Mod>();
  const place = (mod: Mod) => {
    ordered.push({ mod, owners: ownersOf(mod) });
    placed.add(mod);
  };
  for (const mod of mods.filter((m) => ownersOf(m).length === 0)) {
    place(mod);
    mods.filter((dependency) => ownersOf(dependency)[0] === mod).forEach(place);
  }
  mods.filter((mod) => !placed.has(mod)).forEach(place);
  return ordered;
}
