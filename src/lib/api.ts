import { invoke, isTauri } from "@tauri-apps/api/core";
import { initialInstances, initialPresets } from "@/lib/mock";
import type { Instance, NewInstance, NewPreset, Preset } from "@/lib/types";

/**
 * Tauri-invoke-Wrapper. Außerhalb von Tauri (reiner `pnpm dev` im Browser)
 * wird auf einen In-Memory-Mock zurückgefallen, damit die UI vorführbar bleibt.
 * Das Backend wirft Fehler als string; hier werden sie zu `Error` normalisiert.
 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw new Error(typeof err === "string" ? err : String(err));
  }
}

// ---------- In-Memory-Mock ----------

const db = {
  instances: initialInstances(),
  presets: initialPresets(),
};

const clone = <T>(v: T): T => structuredClone(v);
const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms));
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function findInstance(id: string): Instance {
  const inst = db.instances.find((i) => i.id === id);
  if (!inst) throw new Error(`Instanz "${id}" nicht gefunden`);
  return inst;
}

function findPreset(id: string): Preset {
  const preset = db.presets.find((p) => p.id === id);
  if (!preset) throw new Error(`Preset "${id}" nicht gefunden`);
  return preset;
}

/** Spiegel von `Preset::resolve` im Backend: Kind gewinnt, `excludeMods` filtert Geerbtes. */
function resolvePreset(preset: Preset, seen = new Set<string>()): Preset {
  if (!preset.inheritsFrom) return preset;
  if (seen.has(preset.id)) throw new Error(`Preset-Vererbung ist zyklisch bei '${preset.id}'`);
  const parent = resolvePreset(findPreset(preset.inheritsFrom), seen.add(preset.id));
  const own = new Set(preset.mods.map((m) => m.id));
  return {
    ...preset,
    mods: [
      ...parent.mods.filter((m) => !own.has(m.id) && !preset.excludeMods.includes(m.id)),
      ...preset.mods,
    ],
    gameSettings: { ...parent.gameSettings, ...preset.gameSettings },
    jvmArgs: preset.jvmArgs.length ? preset.jvmArgs : parent.jvmArgs,
    memoryMb: preset.memoryMb ?? parent.memoryMb,
  };
}

const mock = {
  async listInstances() {
    await delay();
    return clone(db.instances);
  },
  async getInstance(id: string) {
    await delay();
    return clone(findInstance(id));
  },
  async createInstance(input: NewInstance) {
    await delay();
    const inst: Instance = {
      ...input,
      id: newId("inst"),
      presetId: null,
      modpack: null,
      memoryMb: null,
      jvmArgs: [],
      mods: [],
      createdAt: Date.now(),
      lastPlayedAt: null,
    };
    db.instances.push(inst);
    return clone(inst);
  },
  async updateInstance(instance: Instance) {
    await delay();
    findInstance(instance.id);
    db.instances = db.instances.map((i) => (i.id === instance.id ? clone(instance) : i));
    return clone(instance);
  },
  async deleteInstance(id: string) {
    await delay();
    findInstance(id);
    db.instances = db.instances.filter((i) => i.id !== id);
  },
  async listPresets() {
    await delay();
    return clone(db.presets);
  },
  async createPreset(input: NewPreset) {
    await delay();
    const preset: Preset = { ...clone(input), id: newId("preset"), createdAt: Date.now() };
    resolvePreset(preset);
    db.presets.push(preset);
    return clone(preset);
  },
  async updatePreset(preset: Preset) {
    await delay();
    findPreset(preset.id);
    resolvePreset(preset);
    db.presets = db.presets.map((p) => (p.id === preset.id ? clone(preset) : p));
    return clone(preset);
  },
  async deletePreset(id: string) {
    await delay();
    findPreset(id);
    const child = db.presets.find((p) => p.inheritsFrom === id);
    if (child) throw new Error(`Preset '${child.name}' erbt noch davon`);
    db.presets = db.presets.filter((p) => p.id !== id);
  },
  async applyPreset(instanceId: string, presetId: string) {
    await delay();
    const inst = findInstance(instanceId);
    const preset = resolvePreset(findPreset(presetId));
    const known = new Set(inst.mods.map((m) => m.id));
    const updated: Instance = {
      ...inst,
      presetId,
      memoryMb: preset.memoryMb ?? inst.memoryMb,
      jvmArgs: preset.jvmArgs,
      mods: [...inst.mods, ...clone(preset.mods).filter((m) => !known.has(m.id))],
    };
    db.instances = db.instances.map((i) => (i.id === instanceId ? updated : i));
    return clone(updated);
  },
};

// ---------- Öffentliche API ----------

const tauri = isTauri();

export const api = {
  isMock: !tauri,

  listInstances: (): Promise<Instance[]> =>
    tauri ? call("list_instances") : mock.listInstances(),
  getInstance: (id: string): Promise<Instance> =>
    tauri ? call("get_instance", { id }) : mock.getInstance(id),
  createInstance: (input: NewInstance): Promise<Instance> =>
    tauri ? call("create_instance", { input }) : mock.createInstance(input),
  updateInstance: (instance: Instance): Promise<Instance> =>
    tauri ? call("update_instance", { instance }) : mock.updateInstance(instance),
  deleteInstance: (id: string): Promise<void> =>
    tauri ? call("delete_instance", { id }) : mock.deleteInstance(id),

  listPresets: (): Promise<Preset[]> => (tauri ? call("list_presets") : mock.listPresets()),
  createPreset: (input: NewPreset): Promise<Preset> =>
    tauri ? call("create_preset", { input }) : mock.createPreset(input),
  updatePreset: (preset: Preset): Promise<Preset> =>
    tauri ? call("update_preset", { preset }) : mock.updatePreset(preset),
  deletePreset: (id: string): Promise<void> =>
    tauri ? call("delete_preset", { id }) : mock.deletePreset(id),

  applyPreset: (instanceId: string, presetId: string): Promise<Instance> =>
    tauri
      ? call("apply_preset", { instanceId, presetId })
      : mock.applyPreset(instanceId, presetId),
};
