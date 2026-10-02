// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { clone, findInstance, wait, type MockContext } from "./mock-util";
import { DAY } from "./time";
import type { ContentIssue, Instance, Mod, PackSelection } from "./types";

const KIB = 1024;
const SIZE_SPREAD_KIB = 9000;
const AGE_SPREAD_DAYS = 90;

/** Beständiger Zahlenwert je Eintrag, damit Größe und Datum zwischen den Aufrufen gleich bleiben. */
const hashOf = (text: string) => [...text].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Hinweise, die der Mock vorführt: eine Mod ohne ihre Pflicht-Abhängigkeit. */
const issuesOf = (m: Mod): ContentIssue[] =>
  m.id === "custom-hud" ? [{ modId: m.id, kind: "missingDependency", subject: "cloth-config" }] : [];

const defaultSelection = (instance: Instance): PackSelection => ({
  resourcePacks: ["vanilla", ...instance.mods.filter((m) => m.kind === "resourcepack").map((m) => `file/${m.fileName}`)],
  incompatible: [],
  shaderPack: null,
});

/** Dateiangaben, Hinweise und die Auswahl von Ressourcenpaketen und Shadern, nur im Speicher. */
export function createContentFilesMock({ db }: MockContext) {
  const selections = new Map<string, PackSelection>();
  const selectionOf = (instanceId: string) => {
    const known = selections.get(instanceId);
    if (known) return known;
    const fresh = defaultSelection(findInstance(db, instanceId));
    selections.set(instanceId, fresh);
    return fresh;
  };
  /** Wie das Backend: läuft das Spiel, würde es `options.txt` beim Beenden überschreiben. */
  const changeSelection = async (instanceId: string, change: (selection: PackSelection) => PackSelection) => {
    await wait();
    if (db.running.has(instanceId)) throw new Error(t("detail.busy.gameRunning"));
    selections.set(instanceId, change(selectionOf(instanceId)));
    return clone(selectionOf(instanceId));
  };

  return {
    async contentAnalysis(instanceId) {
      await wait(300);
      const { mods } = findInstance(db, instanceId);
      return {
        files: mods.map((m) => {
          const seed = hashOf(m.id);
          return { modId: m.id, sizeBytes: (40 + (seed % SIZE_SPREAD_KIB)) * KIB, modifiedMs: Date.now() - (seed % AGE_SPREAD_DAYS) * DAY };
        }),
        issues: mods.flatMap(issuesOf),
      };
    },
    async packSelection(instanceId) {
      await wait();
      return clone(selectionOf(instanceId));
    },
    setResourcePacks: (instanceId, packs) =>
      changeSelection(instanceId, (selection) => ({
        ...selection,
        resourcePacks: packs,
        incompatible: selection.incompatible.filter((id) => packs.includes(id)),
      })),
    setShaderPack: (instanceId, pack) => changeSelection(instanceId, (selection) => ({ ...selection, shaderPack: pack })),
  } satisfies Partial<Backend>;
}
