// Reine Logik der Statuszeile „Pumpkin Bridge im Spiel“ (docs/bridge/README.md, "Support selection", kein React), damit ingameModel.check.mjs sie ohne Bundler prüft.
import type { IngameFailureKind, IngameReason, IngameStatus } from "../../lib/friends-types.ts";
import type { ModLoader } from "../../lib/types.ts";

/** Die Wörterbuchschlüssel der Statustexte; `friendsHost.ingame.reason.*` gibt es je Grund, sonst einen eigenen Schlüssel je Zustand. */
export type IngameLineKey =
  | "friendsHost.ingame.active"
  | "friendsHost.ingame.connected"
  | "friendsHost.ingame.off"
  | "friendsHost.ingame.autoOff"
  | `friendsHost.ingame.reason.${Exclude<IngameReason["type"], "instanceOff">}`;

/** Ein Statustext als Daten: der Schlüssel und das, was seine Platzhalter füllt. Die Oberfläche setzt Loader-Namen und Fehlertext ein. */
export interface IngameLine {
  key: IngameLineKey;
  loader?: ModLoader;
  minecraft?: string;
  need?: string | number;
  failure?: IngameFailureKind;
}

/** Was die Zeile zusätzlich anbietet: nach einem Startfehler „Erneut versuchen“, bei Vanilla den Wechsel auf Fabric (nur auf Klick). */
export type IngameAction = "retry" | "addFabric";

export interface IngameRow {
  line: IngameLine;
  /** Der Schalter der Instanz: `null` = keiner, weil es für die Instanz nichts einzuschalten gibt oder die Einstellung ihn überstimmt. */
  toggle: "on" | "off" | null;
  action: IngameAction | null;
  /** Der Zustand, den das Etikett farbig zeigt: das Spiel läuft mit der Mod. */
  connected: boolean;
}

type Instance = { loader: ModLoader; minecraftVersion: string };

function reasonLine(reason: IngameReason, instance: Instance): IngameLine {
  const minecraft = instance.minecraftVersion;
  switch (reason.type) {
    case "noNode":
    case "unverified":
      return { key: `friendsHost.ingame.reason.${reason.type}`, loader: instance.loader, minecraft };
    case "loaderTooOld":
      return { key: "friendsHost.ingame.reason.loaderTooOld", loader: instance.loader, need: reason.need };
    case "javaTooOld":
      return { key: "friendsHost.ingame.reason.javaTooOld", need: reason.need };
    case "breaker":
      return { key: "friendsHost.ingame.reason.breaker", failure: reason.reason };
    case "instanceOff":
      return { key: "friendsHost.ingame.off" };
    default:
      return { key: `friendsHost.ingame.reason.${reason.type}` };
  }
}

const lineOf = (status: IngameStatus, instance: Instance, fallback: IngameLineKey): IngameLine =>
  status.reason ? reasonLine(status.reason, instance) : { key: fallback };

/** Die Zeile zum Stand der Einspeisung einer Instanz: Text, Schalter und Aktion. Alles folgt allein aus dem Status des Backends. */
export function ingameRow(status: IngameStatus, instance: Instance): IngameRow {
  switch (status.state) {
    case "active":
      return {
        line: { key: "friendsHost.ingame.active", loader: status.node?.loader ?? instance.loader, minecraft: instance.minecraftVersion },
        toggle: "on", action: null, connected: false,
      };
    case "connected":
      return { line: { key: "friendsHost.ingame.connected" }, toggle: "on", action: null, connected: true };
    case "off":
      return {
        line: lineOf(status, instance, "friendsHost.ingame.off"),
        toggle: status.reason?.type === "globallyOff" ? null : "off", action: null, connected: false,
      };
    case "autoOff":
      return { line: lineOf(status, instance, "friendsHost.ingame.autoOff"), toggle: "off", action: "retry", connected: false };
    case "unavailable":
      return {
        line: lineOf(status, instance, "friendsHost.ingame.off"),
        toggle: null, action: status.reason?.type === "vanilla" ? "addFabric" : null, connected: false,
      };
  }
}

/** Der Loader, auf den „Fabric hinzufügen?“ wechselt. */
export const ADDED_LOADER: ModLoader = "fabric";

/** Die Instanz mit dem neuen Loader; die Loader-Version bleibt leer, das Backend wählt beim Installieren die neueste stabile. */
export const withAddedLoader = <I extends Instance & { loaderVersion: string | null }>(instance: I): I =>
  ({ ...instance, loader: ADDED_LOADER, loaderVersion: null });
