// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { blankInstanceFields, MOCK_FOREIGN } from "./mock-data";
import { clone, findInstance, newId, wait, type MockContext } from "./mock-util";
import { cancelledError } from "./errors";
import type { Instance, Template } from "./types";

/** Einträge, die ein Export aus dem Spielordner mitnehmen kann. */
const EXPORTABLE_ENTRIES = ["config", "mods", "options.txt", "resourcepacks", "saves", "screenshots"];

/** Kopierschritte und Dauer des vorgetäuschten Imports. */
const IMPORT_TOTAL = 120;
const IMPORT_STEP = 8;
const IMPORT_STEP_MS = 100;

/** Instanzen, Vorlagen und Import: alles nur im Speicher. */
export function createInstanceMock({ db, emit }: MockContext) {
  const throwIfCancelled = (operationId: string) => {
    if (db.cancelled.delete(operationId)) throw cancelledError();
  };
  /** Neue Instanz aus einer vorhandenen: eigene ID, nie gespielt, mit `overrides`. */
  const derived = (source: Instance, overrides: Partial<Instance>): Instance => ({
    ...clone(source),
    id: newId("inst"),
    createdAt: Date.now(),
    lastPlayedAt: null,
    playtimeSecs: 0,
    ...overrides,
  });

  return {
    async listInstances() {
      await wait();
      return clone(db.instances);
    },
    async getInstance(id) {
      await wait();
      return clone(findInstance(db, id));
    },
    async createInstance(input) {
      await wait();
      const inst: Instance = { ...blankInstanceFields(), ...input, id: newId("inst"), mods: [], createdAt: Date.now() };
      db.instances.push(inst);
      return clone(inst);
    },
    async updateInstance(instance) {
      await wait();
      findInstance(db, instance.id);
      db.instances = db.instances.map((i) => (i.id === instance.id ? clone(instance) : i));
      return clone(instance);
    },
    async setInstanceGroup(instanceId, group) {
      await wait();
      const inst = findInstance(db, instanceId);
      inst.group = group?.trim() || null;
      return clone(inst);
    },
    async deleteInstance(id) {
      await wait();
      findInstance(db, id);
      db.instances = db.instances.filter((i) => i.id !== id);
    },
    async duplicateInstance(instanceId, operationId) {
      await wait(800);
      throwIfCancelled(operationId);
      const source = findInstance(db, instanceId);
      const inst = derived(source, { name: t("hooks.api.duplicateName", { name: source.name }) });
      db.instances.push(inst);
      return clone(inst);
    },
    exportEntries: () => Promise.resolve([...EXPORTABLE_ENTRIES]),
    async importDetect() {
      await wait(500);
      return MOCK_FOREIGN.map((f) => ({ ...f, imported: db.instances.some((i) => i.importedFrom === f.path) }));
    },
    /** Wie `instance_import`: Kopierfortschritt, abbrechbar, danach eine Instanz ohne Inhalte. */
    async importInstance(source, operationId) {
      for (let done = 0; done <= IMPORT_TOTAL; done += IMPORT_STEP) {
        throwIfCancelled(operationId);
        emit("content-progress", { operationId, phase: "copy", done, total: IMPORT_TOTAL });
        await wait(IMPORT_STEP_MS);
      }
      const { name, minecraftVersion, loader, loaderVersion, memoryMb, jvmArgs, path } = source;
      const inst: Instance = {
        ...blankInstanceFields(),
        id: newId("inst"),
        name,
        minecraftVersion,
        loader,
        loaderVersion,
        memoryMb,
        jvmArgs,
        importedFrom: path,
        mods: [],
        createdAt: Date.now(),
      };
      db.instances.push(inst);
      return clone(inst);
    },
    packInstallCancel: (operationId) => Promise.resolve(void db.cancelled.add(operationId)),
    async templateSave(instanceId, name) {
      await wait(600);
      const instance = clone(findInstance(db, instanceId));
      const template: Template = {
        id: newId("tpl"),
        name,
        minecraftVersion: instance.minecraftVersion,
        loader: instance.loader,
        modCount: instance.mods.filter((m) => m.enabled).length,
        createdAt: Date.now(),
      };
      db.templates.push({ template, instance });
      return clone(template);
    },
    async templateList() {
      await wait();
      return db.templates.map((saved) => clone(saved.template));
    },
    async templateDelete(id) {
      await wait();
      db.templates = db.templates.filter((saved) => saved.template.id !== id);
    },
    async templateCreateInstance(templateId, name) {
      await wait(800);
      const found = db.templates.find((saved) => saved.template.id === templateId);
      if (!found) throw new Error(t("hooks.api.templateGone"));
      const inst = derived(found.instance, { name });
      db.instances.push(inst);
      return clone(inst);
    },
  } satisfies Partial<Backend>;
}
