// Adressen und Query-Parameter der Seiten an einer Stelle: Absender (Menüs, Toasts, Tastenkürzel, Weiterleitungen)
// und Empfänger (Bibliothek, Entdecken, Instanz) können so nicht auseinanderlaufen.
import type { CatalogType, Source } from "./content-types";

// ---------- Bibliothek: Dialog „Neue Instanz“ ----------

/** Womit der Dialog „Neue Instanz“ startet: leer, mit anderem Launcher oder mit einer .mrpack-Datei. */
export type NewInstanceStart = { type: "blank" } | { type: "import" } | { type: "file"; path: string };

/** Query-Parameter der Bibliothek, die den Dialog öffnen (`neu=1`, `neu=import`, `neu=1&datei=<Pfad>`). */
export function newInstanceParams(start: NewInstanceStart = { type: "blank" }): Record<string, string> {
  switch (start.type) {
    case "import":
      return { neu: "import" };
    case "file":
      return { neu: "1", datei: start.path };
    case "blank":
      return { neu: "1" };
  }
}

export const newInstanceUrl = (start?: NewInstanceStart) => `/instances?${new URLSearchParams(newInstanceParams(start)).toString()}`;

/** Der Start, den die Adresse verlangt; null = kein Dialog. */
export function readNewInstanceStart(params: URLSearchParams): NewInstanceStart | null {
  if (!params.has("neu")) return null;
  const path = params.get("datei");
  if (path) return { type: "file", path };
  return { type: params.get("neu") === "import" ? "import" : "blank" };
}

// ---------- Entdecken ----------

/** Was „Entdecken“ zeigt; Modrinth ist die Standardquelle und steht nicht in der Adresse. */
export type DiscoverTarget = { tab?: CatalogType; source?: Source; project?: string };

export function discoverParams({ tab, source, project }: DiscoverTarget = {}): Record<string, string> {
  const params: Record<string, string> = {};
  if (tab) params.tab = tab;
  if (source && source !== "modrinth") params.quelle = source;
  if (project) params.projekt = project;
  return params;
}

export function discoverUrl(target?: DiscoverTarget) {
  const query = new URLSearchParams(discoverParams(target)).toString();
  return query ? `/discover?${query}` : "/discover";
}

/** Rohwerte der Adresse; ob sie gültig sind, prüft die Seite gegen ihre Quellen und Kategorien. */
export const readDiscoverParams = (params: URLSearchParams) => ({
  tab: params.get("tab"),
  source: params.get("quelle"),
  project: params.get("projekt"),
});

// ---------- Instanz ----------

export type InstanceTab = "content" | "worlds" | "screenshots" | "console" | "settings";
const INSTANCE_TABS: InstanceTab[] = ["content", "worlds", "screenshots", "console", "settings"];

export const instanceUrl = (id: string, tab?: InstanceTab) => (tab ? `/instances/${id}?tab=${tab}` : `/instances/${id}`);

export const instanceTabParams = (tab: InstanceTab) => ({ tab });

/** Der Tab der Adresse; unbekannt oder fehlend = Inhalte. */
export const readInstanceTab = (params: URLSearchParams): InstanceTab =>
  INSTANCE_TABS.find((tab) => tab === params.get("tab")) ?? "content";
