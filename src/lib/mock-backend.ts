// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { TKey } from "@/i18n/core";
import { allCapabilities, eventSubscriptions, type Backend, type BackendEvents, type Emit, type Subscribe } from "./backend";
import { createAccountMock } from "./mock-accounts";
import { createContentMock } from "./mock-content";
import { createContentFilesMock } from "./mock-content-files";
import { crowdedInstance, initialInstances } from "./mock-data";
import { pickPaths, pickSavePath } from "./mock-files";
import { createGameMock } from "./mock-game";
import { createInstanceMock } from "./mock-instances";
import { createLifecycleMock } from "./mock-lifecycle";
import { createPackMock } from "./mock-pack";
import { createScreenshotMock } from "./mock-screenshots";
import { createSettingsMock } from "./mock-settings";
import { createSkinMock } from "./mock-skins";
import type { MockDb } from "./mock-util";
import { createWorldMock } from "./mock-worlds";

/** `?mock=leer` startet ohne Instanzen (Onboarding und Leerzustand vorführen). */
const startsEmpty = () => location.search.includes("mock=leer");

/** `?mock=viele` fügt eine Instanz mit 400 Inhalten hinzu (lange Listen vorführen). */
const startsCrowded = () => location.search.includes("mock=viele");

const createDb = (): MockDb => ({
  instances: startsEmpty() ? [] : [...initialInstances(), ...(startsCrowded() ? [crowdedInstance()] : [])],
  templates: [],
  installed: new Set(),
  running: new Map(),
  cancelled: new Set(),
  accounts: [],
});

/** Events im Browser-Modus: gleiches Format wie die Tauri-Events. */
function createEventBus(): { emit: Emit; on: Subscribe } {
  const bus = new EventTarget();
  return {
    emit: (event, payload) => void bus.dispatchEvent(new CustomEvent(event, { detail: payload })),
    on: <E extends keyof BackendEvents>(event: E, cb: (payload: BackendEvents[E]) => void) => {
      const handler = (e: Event) => cb((e as CustomEvent<BackendEvents[E]>).detail);
      bus.addEventListener(event, handler);
      return Promise.resolve(() => bus.removeEventListener(event, handler));
    },
  };
}

/** Was der Browser-Mock nicht kann, sagt er beim Aufruf mit einer Fehlermeldung ab (keine Datei, kein Download, kein Systemdialog). */
const unavailable = (message: () => string) => (): Promise<never> => Promise.reject(new Error(message()));

/** Meldung für Dinge, die nur die App kann; `whatKey` ist der Wörterbuchschlüssel eines Infinitiv-Satzteils („Ordner öffnen“). */
const onlyInApp = (whatKey: TKey) => unavailable(() => t("hooks.api.onlyInApp", { what: t(whatKey) }));

/** Modpacks und Anbieter ohne Schlüssel brauchen echte Dateien und Downloads. */
const modpacksNeedApp = unavailable(() => t("hooks.api.modpacksNeedApp"));

/** In-Memory-Backend für den reinen `pnpm dev` im Browser: Katalog echt von Modrinth, der Rest simuliert. */
export function createMockBackend(): Backend {
  const { emit, on } = createEventBus();
  const context = { db: createDb(), emit };
  const worlds = createWorldMock(context);

  return {
    capabilities: allCapabilities(false),
    ...eventSubscriptions(on),
    ...createInstanceMock(context),
    ...createGameMock(context),
    ...createAccountMock(context),
    ...createContentMock(context),
    ...createContentFilesMock(context),
    ...createPackMock(context),
    ...createLifecycleMock(context, worlds),
    ...createSkinMock(),
    ...worlds,
    ...createScreenshotMock(),
    ...createSettingsMock(context),

    checkLocalFiles: onlyInApp("hooks.api.addLocalFiles"),
    addLocalFiles: onlyInApp("hooks.api.addLocalFiles"),
    modrinthImportPack: modpacksNeedApp,
    curseforgeImportPack: modpacksNeedApp,
    providerSearch: modpacksNeedApp,
    providerProject: modpacksNeedApp,
    providerVersions: modpacksNeedApp,
    providerInstallPack: modpacksNeedApp,
    providerInstallMod: modpacksNeedApp,
    curseforgeAdoptDownload: modpacksNeedApp,
    openExternal: (url) => Promise.resolve(void window.open(url, "_blank", "noopener,noreferrer")),
    exportInstance: onlyInApp("hooks.api.export"),
    templateExport: onlyInApp("hooks.api.export"),
    templateImport: onlyInApp("hooks.api.pickFiles"),
    takeOpenedPack: () => Promise.resolve(null),
    pickPaths,
    pickSavePath,
    revealPath: onlyInApp("hooks.api.openFolder"),
    instanceDir: onlyInApp("hooks.api.openFolder"),
    storageOpenDir: onlyInApp("hooks.api.openFolder"),
    shareLog: onlyInApp("hooks.api.shareLogs"),
    datapackAdd: onlyInApp("hooks.api.addLocalFiles"),
    screenshotSrc: (shot) => shot.path,
    openPath: onlyInApp("hooks.api.openFiles"),
    checkAppUpdate: () => Promise.resolve(null),
    restartApp: onlyInApp("hooks.api.restart"),
  };
}
