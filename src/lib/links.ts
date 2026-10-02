import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import type { ModSource } from "@/lib/types";

/** Quellcode und Fehlermeldungen des Launchers. */
export const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";

/** Seite im Browser öffnen; scheitert das, sagt es ein Toast. */
export const openPage = (url: string) => void api.openExternal(url).catch(toastError);

/** Datei oder Ordner mit dem Standardprogramm öffnen; scheitert das, sagt es ein Toast. */
export const openLocalPath = (path: string) => void api.openPath(path).catch(toastError);

/** Datei im Dateimanager zeigen; scheitert das, sagt es ein Toast. */
export const revealLocalPath = (path: string) => void api.revealPath(path).catch(toastError);

/** Projektseite des Anbieters, bei dem ein Inhalt herkommt; eigene Dateien und URLs haben keine. */
export function projectUrl(source: ModSource): string | null {
  switch (source.type) {
    case "modrinth":
      return `https://modrinth.com/project/${source.projectId}`;
    case "curseforge":
      return `https://www.curseforge.com/projects/${source.projectId}`;
    default:
      return null;
  }
}
