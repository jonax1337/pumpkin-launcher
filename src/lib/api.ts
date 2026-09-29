import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ExitPayload,
  Instance,
  InstallProgress,
  InstallStep,
  InstanceStatus,
  LoaderVersion,
  LogPayload,
  ModLoader,
  NewInstance,
  NewPreset,
  Preset,
  VersionEntry,
} from "@/lib/types";

import type { ContentSearch, ContentProject, ContentVersion, ContentProgress } from "@/lib/modrinth";

// Mock nur im Dev-Server: im Release-Build ist das konstant true, Vite wirft Mock und mock.ts heraus.
const tauri = !import.meta.env.DEV || isTauri();
function contentCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!tauri) return Promise.reject(new Error("Modrinth benötigt die Tauri-App. Im Browser werden keine Inhalte installiert."));
  return call<T>(cmd, args);
}

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

// Dynamisch und nur ohne Tauri: im Release-Build fällt der Import samt mock.ts weg.
const mockData = tauri ? null : await import("@/lib/mock");

const db = {
  instances: mockData?.initialInstances() ?? [],
  presets: mockData?.initialPresets() ?? [],
  installed: new Set<string>(),
  running: new Map<string, number>(),
};

// Events im Browser-Modus: gleiches Format wie die Tauri-Events.
const bus = new EventTarget();
const emit = <T>(event: string, payload: T) => bus.dispatchEvent(new CustomEvent(event, { detail: payload }));

function on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (tauri) return listen<T>(event, (e) => cb(e.payload));
  const handler = (e: Event) => cb((e as CustomEvent<T>).detail);
  bus.addEventListener(event, handler);
  return Promise.resolve(() => bus.removeEventListener(event, handler));
}

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

const mockGame = {
  async versionsList() {
    await delay(400);
    return clone(mockData!.MOCK_VERSIONS);
  },
  async loaderVersions(loader: ModLoader): Promise<LoaderVersion[]> {
    await delay(300);
    if (loader === "vanilla") return [];
    if (loader !== "fabric") throw new Error("Noch nicht implementiert");
    return [{ version: "0.17.3", stable: true }, { version: "0.17.2", stable: true }, { version: "0.16.14", stable: true }];
  },
  async install(instanceId: string) {
    const inst = findInstance(instanceId);
    const steps: [InstallStep, number][] = [["java", 60], ["client", 2], ["libraries", 40], ["natives", 4], ["assets", 120]];
    if (inst.loader === "fabric") {
      steps.unshift(["loader", 1]);
      steps.push(["mods", 1]);
      inst.loaderVersion ??= "0.17.3";
    }
    for (const [step, total] of steps) {
      for (let done = 0; done <= total; done += Math.ceil(total / 12)) {
        emit<InstallProgress>("install-progress", { instanceId, step, done: Math.min(done, total), total });
        await delay(70);
      }
    }
    db.installed.add(instanceId);
  },
  async launch(instanceId: string, username: string) {
    await delay(300);
    if (!db.installed.has(instanceId)) throw new Error(`Version ${findInstance(instanceId).minecraftVersion} ist nicht installiert`);
    if (db.running.has(instanceId)) throw new Error("Ungültige Eingabe: Instanz läuft bereits");
    let n = 0;
    const log = (line: string, stream: LogPayload["stream"] = "stdout") =>
      emit<LogPayload>("instance-log", { instanceId, stream, line: `[${new Date().toLocaleTimeString("de")}] ${line}` });
    log(`[main/INFO]: Setting user: ${username}`);
    db.running.set(instanceId, window.setInterval(() => log(`[Render thread/INFO]: Demo-Logzeile ${++n}`, n % 7 ? "stdout" : "stderr"), 400));
    findInstance(instanceId).lastPlayedAt = Date.now();
    return 4242;
  },
  async kill(instanceId: string) {
    const timer = db.running.get(instanceId);
    if (timer == null) throw new Error(`Laufendes Spiel '${instanceId}' nicht gefunden`);
    clearInterval(timer);
    db.running.delete(instanceId);
    emit<ExitPayload>("instance-exit", { instanceId, code: null });
  },
  async status(instanceId: string): Promise<InstanceStatus> {
    await delay();
    return { installed: db.installed.has(instanceId), running: db.running.has(instanceId) };
  },
};

// ---------- Öffentliche API ----------

export const api = {
  isMock: !tauri,
  modrinthSearch: (query: string, projectType: "mod" | "modpack", minecraftVersion: string | null, loader: string | null): Promise<ContentSearch> =>
    contentCall("modrinth_search", { query, projectType, minecraftVersion, loader, offset: 0 }),
  modrinthProject: (projectId: string): Promise<ContentProject> => contentCall("modrinth_project", { projectId }),
  modrinthVersions: (projectId: string, minecraftVersion: string | null, loader: string | null): Promise<ContentVersion[]> =>
    contentCall("modrinth_versions", { projectId, minecraftVersion, loader }),
  modrinthInstallMod: (instanceId: string, versionId: string, operationId: string): Promise<Instance> =>
    contentCall("modrinth_install_mod", { instanceId, versionId, operationId }),
  modrinthInstallPack: (versionId: string, name: string, operationId: string): Promise<Instance> =>
    contentCall("modrinth_install_pack", { versionId, name, operationId }),
  modrinthImportPack: (path: string, name: string, operationId: string): Promise<Instance> =>
    contentCall("modrinth_import_pack", { path, name, operationId }),
  onContentProgress: (cb: (p: ContentProgress) => void) => on("content-progress", cb),

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

  versionsList: (): Promise<VersionEntry[]> => (tauri ? call("versions_list") : mockGame.versionsList()),
  loaderVersions: (loader: ModLoader, mcVersion: string): Promise<LoaderVersion[]> =>
    tauri ? call("loader_versions", { loader, mcVersion }) : mockGame.loaderVersions(loader),
  instanceStatus: (instanceId: string): Promise<InstanceStatus> =>
    tauri ? call("instance_status", { instanceId }) : mockGame.status(instanceId),
  installInstance: (instanceId: string): Promise<void> =>
    tauri ? call("instance_install", { instanceId }) : mockGame.install(instanceId),
  /** Startet das Spiel; liefert die Prozess-ID. Leerer `javaPath` = mitgelieferte Runtime. */
  launchInstance: (instanceId: string, username: string, javaPath: string, defaultMemoryMb: number): Promise<number> =>
    tauri
      ? call("instance_launch", { instanceId, username, javaPath: javaPath || null, defaultMemoryMb })
      : mockGame.launch(instanceId, username),
  killInstance: (instanceId: string): Promise<void> =>
    tauri ? call("instance_kill", { instanceId }) : mockGame.kill(instanceId),

  onInstallProgress: (cb: (p: InstallProgress) => void) => on("install-progress", cb),
  onLog: (cb: (p: LogPayload) => void) => on("instance-log", cb),
  onExit: (cb: (p: ExitPayload) => void) => on("instance-exit", cb),
};
