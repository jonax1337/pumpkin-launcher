// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Emit } from "./backend";
import type { Account, Instance, Template } from "./types";

/** Zustand des Browser-Mocks, den die Teil-Mocks (Instanzen, Spiel, Konten, Welten, Pack) gemeinsam lesen und ändern. */
export interface MockDb {
  instances: Instance[];
  templates: { template: Template; instance: Instance }[];
  installed: Set<string>;
  running: Map<string, number>;
  /** Abgebrochene Installationen (Instanz-IDs) und Content-Vorgänge (Operation-IDs). */
  cancelled: Set<string>;
  accounts: Account[];
}

/** Was ein Teil-Mock von der Welt braucht: den gemeinsamen Zustand und den Weg, Events zu senden. */
export interface MockContext {
  db: MockDb;
  emit: Emit;
}

/** Antwortzeit eines Backend-Aufrufs, damit Ladezustände in der Oberfläche sichtbar werden. */
const DEFAULT_DELAY_MS = 160;

export const wait = (ms = DEFAULT_DELAY_MS) => new Promise((resolve) => setTimeout(resolve, ms));

export const clone = <T>(value: T): T => structuredClone(value);

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/** Die Instanz selbst (nicht kopiert), damit der Mock sie wie das Backend ändern kann. */
export function findInstance(db: Pick<MockDb, "instances">, id: string): Instance {
  const inst = db.instances.find((i) => i.id === id);
  if (!inst) throw new Error(t("hooks.api.instanceNotFound", { id }));
  return inst;
}

export function canvas2d(width: number, height: number): [CanvasRenderingContext2D, HTMLCanvasElement] {
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  return [canvas.getContext("2d")!, canvas];
}

const MODRINTH_API = "https://api.modrinth.com/v2";

/** Echte Antwort der Modrinth-API (nur lesend), damit Katalog und Icons im Browser stimmen. */
export async function modrinthFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${MODRINTH_API}${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(t("mock.modrinth.unreachable", { status: res.status }));
  return res.json();
}
