// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import type { ContentVersion } from "./content-types";
import { cancelledError } from "./errors";
import { MOCK_VERSIONS } from "./mock-data";
import { clone, findInstance, modrinthFetch, newId, wait, type MockContext } from "./mock-util";
import type { ContentPhase } from "./progress";
import type { Instance, MigrationBlock, MigrationCheck, MigrationTarget, Mod, ModChange, PackChanges } from "./types";

/** Pause je vorgetäuschtem Schritt. */
const STEP_MS = 120;

/** Was der Lebenszyklus-Mock von den Welten braucht: Liste und Sicherung, wie im Backend vor jedem Umbau. */
type WorldAccess = Pick<Backend, "worldList" | "worldBackup">;

const gameChanges = (inst: Instance, target: MigrationTarget) =>
  inst.minecraftVersion !== target.minecraftVersion || inst.loader !== target.loader;

/** Mojangs Liste ist neueste zuerst: weiter hinten heißt älter. */
const isDowngrade = (from: string, to: string) => {
  const at = (id: string) => MOCK_VERSIONS.findIndex((v) => v.id === id);
  return at(from) >= 0 && at(to) > at(from);
};

/** Wie das Backend: Modrinth-Mods bekommen eine passende Version, alle anderen Mods gehen aus; ohne Loader alle. */
function changeOf(m: Mod, target: MigrationTarget): ModChange | null {
  if (!m.enabled || m.kind !== "mod") return null;
  const liftable = m.source.type === "modrinth" && target.loader !== "vanilla";
  const version = liftable ? `${m.version.split("+")[0]}+${target.minecraftVersion}` : null;
  return { modId: m.id, name: m.name, outcome: liftable ? "update" : "disable", version };
}

function applyMigration(inst: Instance, target: MigrationTarget, changes: ModChange[]) {
  const byId = new Map(changes.map((c) => [c.modId, c]));
  inst.mods = inst.mods.map((m) => {
    const change = byId.get(m.id);
    if (change?.outcome === "disable") return { ...m, enabled: false };
    return change?.version ? { ...m, version: change.version } : m;
  });
  if (gameChanges(inst, target)) inst.modpack = null;
  Object.assign(inst, target);
}

/** Pack-Updates und der Wechsel von Version und Loader: Fortschritt und Ergebnis wie im Backend, ohne Dateien. */
export function createLifecycleMock({ db, emit }: MockContext, worlds: WorldAccess) {
  /** Fortschritt Phase für Phase; abbrechbar zwischen zwei Schritten wie das Backend vor dem Dateiwechsel. */
  async function steps(operationId: string, phases: [ContentPhase, number][]) {
    for (const [phase, total] of phases) {
      for (let done = 0; done <= total; done++) {
        if (db.cancelled.delete(operationId)) throw cancelledError();
        emit("content-progress", { operationId, phase, done, total });
        await wait(STEP_MS);
      }
    }
  }

  /** Sichert alle Welten der Instanz; liefert ihre Zahl. */
  async function backupWorlds(instanceId: string, operationId: string) {
    const list = await worlds.worldList(instanceId);
    for (const w of list) await worlds.worldBackup(instanceId, w.id, operationId);
    return list.length;
  }

  async function migrateCheck(instanceId: string, target: MigrationTarget): Promise<MigrationCheck> {
    await wait(400);
    const inst = findInstance(db, instanceId);
    const changes = gameChanges(inst, target) ? inst.mods.flatMap((m) => changeOf(m, target) ?? []) : [];
    const downgrade = isDowngrade(inst.minecraftVersion, target.minecraftVersion);
    const worldCount = (await worlds.worldList(instanceId)).length;
    const blocked: MigrationBlock | null = !gameChanges(inst, target)
      ? null
      : inst.modpack
        ? "packInstance"
        : downgrade && worldCount > 0
          ? "downgradeWithWorlds"
          : null;
    return { changes, downgrade, worlds: worldCount, blocked };
  }

  return {
    async packChangelog(instanceId, versionId) {
      const origin = findInstance(db, instanceId).modpack;
      if (origin?.type !== "modrinth") return null;
      const version = await modrinthFetch<{ changelog: string | null }>(`/version/${versionId}`);
      return version.changelog?.trim() || null;
    },
    async packUpdate(instanceId, target, operationId) {
      const inst = findInstance(db, instanceId);
      if (inst.modpack?.type !== "modrinth" || target.type !== "version") throw new Error(t("hooks.api.modpacksNeedApp"));
      await steps(operationId, [["resolve", 1]]);
      const version = await modrinthFetch<ContentVersion>(`/version/${target.versionId}`);
      if (version.project_id !== inst.modpack.projectId) throw new Error(t("mock.pack.otherProject"));
      const worldBackups = await backupWorlds(instanceId, operationId);
      const updated = inst.mods.filter((m) => m.enabled && m.source.type === "modrinth").map((m) => `mods/${m.fileName}`);
      await steps(operationId, [["download", updated.length], ["copy", updated.length + 2]]);
      inst.modpack = { ...inst.modpack, versionId: version.id };
      inst.minecraftVersion = version.game_versions[0] ?? inst.minecraftVersion;
      db.installed.delete(instanceId);
      const changes: PackChanges = { added: ["config/pack-defaults.toml"], updated, removed: [], kept: ["options.txt"] };
      return { instance: clone(inst), changes, worldBackups };
    },
    migrateCheck,
    async migrateInstance(instanceId, target, operationId) {
      const check = await migrateCheck(instanceId, target);
      if (check.blocked) throw new Error(t(`errors.game.migrate.${check.blocked}`));
      await steps(operationId, [["resolve", 1]]);
      const inst = findInstance(db, instanceId);
      const worldBackups = gameChanges(inst, target) ? await backupWorlds(instanceId, operationId) : 0;
      await steps(operationId, [["download", check.changes.length]]);
      applyMigration(inst, target, check.changes);
      db.installed.delete(instanceId);
      return { instance: clone(inst), changes: check.changes, worldBackups };
    },
    async duplicateMigrate(instanceId, target, operationId) {
      const source = findInstance(db, instanceId);
      const changes = gameChanges(source, target) ? source.mods.flatMap((m) => changeOf(m, target) ?? []) : [];
      await steps(operationId, [["resolve", 1], ["copy", 8], ["download", changes.length]]);
      const copy: Instance = {
        ...clone(source),
        id: newId("inst"),
        name: t("hooks.api.duplicateName", { name: source.name }),
        createdAt: Date.now(),
        lastPlayedAt: null,
        playtimeSecs: 0,
      };
      applyMigration(copy, target, changes);
      db.instances.push(copy);
      return { instance: clone(copy), changes, worldBackups: 0 };
    },
  } satisfies Partial<Backend>;
}
