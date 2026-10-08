// Adressen und Query-Parameter der Seiten an einer Stelle: Absender (Menüs, Toasts, Tastenkürzel, Weiterleitungen)
// und Empfänger (Bibliothek, Entdecken, Instanz) können so nicht auseinanderlaufen.
import { ALL_SOURCES, type CatalogType, type Source, type SourceChoice } from "./content-types.ts";

// ---------- Bibliothek: Dialog „Neue Instanz“ ----------

/** Womit der Dialog „Neue Instanz“ startet: leer, mit anderem Launcher oder mit einer .mrpack-Datei (leerer Pfad: noch keine gewählt). */
export type NewInstanceStart = { type: "blank" } | { type: "import" } | { type: "file"; path: string };

/** Query-Parameter der Bibliothek, die den Dialog öffnen (`neu=1`, `neu=import`, `neu=file`, `neu=1&datei=<Pfad>`). */
export function newInstanceParams(start: NewInstanceStart = { type: "blank" }): Record<string, string> {
  switch (start.type) {
    case "import":
      return { neu: "import" };
    case "file":
      return start.path ? { neu: "1", datei: start.path } : { neu: "file" };
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
  const kind = params.get("neu");
  if (kind === "file") return { type: "file", path: "" };
  return { type: kind === "import" ? "import" : "blank" };
}

// ---------- Entdecken ----------

/**
 * Was „Entdecken“ zeigt. `source` ist die Quelle der Liste; „alle“ ist der Standard und steht nicht in der Adresse.
 * Ein geöffnetes Projekt nennt seine eigene Quelle in `projectSource`; fehlt sie, ist es ein Modrinth-Projekt.
 * `query` füllt das Suchfeld der Liste vor (z. B. aus der Befehlspalette).
 */
export type DiscoverTarget = { tab?: CatalogType; source?: SourceChoice; project?: string; projectSource?: Source; query?: string };

export function discoverParams({ tab, source, project, projectSource, query }: DiscoverTarget = {}): Record<string, string> {
  const params: Record<string, string> = {};
  if (tab) params.tab = tab;
  if (source && source !== ALL_SOURCES) params.quelle = source;
  if (project) params.projekt = project;
  if (project && projectSource) params.anbieter = projectSource;
  if (query) params.suche = query;
  return params;
}

export function discoverUrl(target?: DiscoverTarget) {
  const search = new URLSearchParams(discoverParams(target)).toString();
  return search ? `/discover?${search}` : "/discover";
}

/** Rohwerte der Adresse; ob sie gültig sind, prüft die Seite gegen ihre Quellen und Kategorien. */
export const readDiscoverParams = (params: URLSearchParams) => ({
  tab: params.get("tab"),
  source: params.get("quelle"),
  project: params.get("projekt"),
  projectSource: params.get("anbieter"),
  query: params.get("suche"),
});

// ---------- Instanz ----------

export type InstanceTab = "content" | "worlds" | "screenshots" | "console" | "settings";
const INSTANCE_TABS: InstanceTab[] = ["content", "worlds", "screenshots", "console", "settings"];

export const instanceUrl = (id: string, tab?: InstanceTab) => (tab ? `/instances/${id}?tab=${tab}` : `/instances/${id}`);

export const instanceTabParams = (tab: InstanceTab) => ({ tab });

/** Der Tab der Adresse; unbekannt oder fehlend = Inhalte. */
export const readInstanceTab = (params: URLSearchParams): InstanceTab =>
  INSTANCE_TABS.find((tab) => tab === params.get("tab")) ?? "content";
