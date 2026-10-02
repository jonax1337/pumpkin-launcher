// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import type { ContentProject, ContentSearch, ContentVersion, ModUpdate } from "./content-types";
import { PROJECT_IDS } from "./mock-data";
import { clone, findInstance, modrinthFetch, wait, type MockContext } from "./mock-util";
import type { ContentPhase } from "./progress";
import type { Instance, ModKind } from "./types";

/** Treffer je Seite der Katalogsuche. */
const SEARCH_PAGE_SIZE = 20;

/** Gleiche Form wie die Backend-Commands: Katalog echt von Modrinth, Installieren und Updates nur simuliert (keine Dateien). */
export function createContentMock({ db, emit }: MockContext) {
  // Diese Einträge gelten als veraltet, bis sie aktualisiert werden.
  const outdated = new Set([PROJECT_IDS.lithium, PROJECT_IDS.appleskin, PROJECT_IDS.modmenu]);
  const save = (inst: Instance) => {
    db.instances = db.instances.map((i) => (i.id === inst.id ? inst : i));
    return clone(inst);
  };
  const versions = (projectId: string, mc: string | null, loader: string | null) =>
    modrinthFetch<ContentVersion[]>(`/project/${projectId}/version`, {
      ...(mc && { game_versions: JSON.stringify([mc]) }),
      ...(loader && { loaders: JSON.stringify([loader]) }),
    });
  const bump = (v: string) => v.replace(/(\d+)(?!.*\d)/, (n) => String(Number(n) + 1));
  const progressFor = (operationId: string) => (phase: ContentPhase, done: number, total: number) =>
    emit("content-progress", { operationId, phase, done, total });

  return {
    async modrinthSearch({ query, type, mc, loader, category, offset, index }): Promise<ContentSearch> {
      const facets = [
        [`project_type:${type}`],
        ...(mc ? [[`versions:${mc}`]] : []),
        ...(loader ? [[`categories:${loader}`]] : []),
        ...(category ? [[`categories:${category}`]] : []),
      ];
      const r = await modrinthFetch<ContentSearch>("/search", {
        query,
        facets: JSON.stringify(facets),
        offset: String(offset),
        limit: String(SEARCH_PAGE_SIZE),
        index,
      });
      return { hits: r.hits, total_hits: r.total_hits, offset: r.offset, limit: r.limit };
    },
    modrinthProject: (id) => modrinthFetch<ContentProject>(`/project/${id}`),
    modrinthProjects: (ids) =>
      ids.length ? modrinthFetch<ContentProject[]>("/projects", { ids: JSON.stringify(ids) }) : Promise.resolve([]),
    modrinthVersions: versions,
    async modrinthInstallMod(instanceId, versionId, operationId) {
      const progress = progressFor(operationId);
      progress("resolve", 0, 1);
      const inst = clone(findInstance(db, instanceId));
      const root = await modrinthFetch<ContentVersion>(`/version/${versionId}`);
      const project = await modrinthFetch<ContentProject>(`/project/${root.project_id}`);
      const kind = project.project_type as ModKind;
      const have = new Set(inst.mods.map((m) => m.id));
      // Wie das Backend: nur neu mitgebrachte Pflicht-Abhängigkeiten bekommen requiredBy.
      const fresh = [root];
      for (const d of kind === "mod" ? root.dependencies : []) {
        if (d.dependency_type !== "required" || !d.project_id || have.has(d.project_id)) continue;
        const v = (await versions(d.project_id, inst.minecraftVersion, inst.loader))[0];
        if (!v) throw new Error(t("mock.content.requiredModMissing"));
        fresh.push(v);
      }
      const todo = fresh.filter((v) => !have.has(v.project_id));
      for (let i = 0; i < todo.length; i++) {
        progress("download", i, todo.length);
        await wait(500);
      }
      for (const v of todo) {
        inst.mods.push({
          id: v.project_id, name: v.name, version: v.version_number, kind: v === root ? kind : "mod",
          requiredBy: v === root ? [] : [root.project_id],
          source: { type: "modrinth", projectId: v.project_id, versionId: v.id },
          fileName: v.files[0]?.filename ?? `${v.project_id}.jar`, sha1: null, enabled: true, pinned: false, packManaged: false,
        });
      }
      // Direkt hinzugefügt macht eine vorhandene Abhängigkeit zu einem direkten Eintrag.
      const existing = inst.mods.find((m) => m.id === root.project_id);
      if (existing) existing.requiredBy = [];
      progress("complete", todo.length, todo.length);
      return save(inst);
    },
    async modrinthCheckUpdates(instanceId): Promise<ModUpdate[]> {
      await wait(600);
      return findInstance(db, instanceId).mods
        .filter((m) => outdated.has(m.id) && !m.pinned)
        .map((m) => ({ modId: m.id, currentVersion: m.version, versionId: `mock-${m.id}`, versionNumber: bump(m.version) }));
    },
    async modrinthUpdateMods(instanceId, modIds, operationId) {
      const progress = progressFor(operationId);
      progress("resolve", 0, 1);
      await wait(300);
      for (let i = 0; i < modIds.length; i++) {
        progress("download", i, modIds.length);
        await wait(400);
      }
      const inst = clone(findInstance(db, instanceId));
      for (const m of inst.mods) if (modIds.includes(m.id) && outdated.delete(m.id)) m.version = bump(m.version);
      progress("complete", modIds.length, modIds.length);
      return save(inst);
    },
    async modrinthSwitchVersion(instanceId, modId, versionId, operationId) {
      const progress = progressFor(operationId);
      progress("resolve", 0, 1);
      const version = await modrinthFetch<ContentVersion>(`/version/${versionId}`);
      progress("download", 0, 1);
      await wait(400);
      const inst = clone(findInstance(db, instanceId));
      const target = inst.mods.find((m) => m.id === modId);
      if (!target) throw new Error(t("hooks.api.instanceNotFound", { id: modId }));
      target.version = version.version_number;
      target.fileName = version.files[0]?.filename ?? target.fileName;
      if (target.source.type === "modrinth") target.source = { ...target.source, versionId: version.id };
      outdated.delete(modId);
      progress("complete", 1, 1);
      return save(inst);
    },
    /** Im Browser kennt Modrinth keine Datei: die Einträge bleiben lokal. */
    async modrinthIdentify(instanceId) {
      await wait(600);
      return clone(findInstance(db, instanceId));
    },
  } satisfies Partial<Backend>;
}
