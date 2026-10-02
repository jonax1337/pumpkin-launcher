// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import type { OpenDialogOptions, SaveDialogOptions } from "@tauri-apps/plugin-dialog";

/** Ordner, den der Mock statt eines Systemdialogs „wählt“: der Browser kennt keine Ordnerpfade. */
export const MOCK_FOLDER = "C:\\Pumpkin Launcher\\Export";

/**
 * Dateiauswahl des Browsers statt des Systemdialogs. Der „Pfad“ einer Datei ist ihre Blob-Adresse mit dem Namen
 * als Anker (`blob:…#Skin.png`): so kann der Mock sie wie das Backend einen Pfad lesen (`readPicked`).
 */
export function pickPaths(options: OpenDialogOptions): Promise<string[]> {
  if (options.directory) return Promise.resolve([MOCK_FOLDER]);
  const accept = options.filters?.flatMap((filter) => filter.extensions.map((extension) => `.${extension}`)).join(",");
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple: !!options.multiple, accept });
    input.onchange = () => resolve([...(input.files ?? [])].map((file) => `${URL.createObjectURL(file)}#${encodeURIComponent(file.name)}`));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Speicherort statt des Systemdialogs: der Vorschlagsname im Mock-Ordner. */
export const pickSavePath = (options: SaveDialogOptions): Promise<string | null> =>
  Promise.resolve(options.defaultPath ? `${MOCK_FOLDER}\\${options.defaultPath}` : null);

/** Name der gewählten Datei ohne Endung. */
export const pickedName = (path: string) => decodeURIComponent(path.split("#")[1] ?? "").replace(/\.[^.]*$/, "");

/** Inhalt der gewählten Datei als Blob. */
export const readPicked = (path: string): Promise<Blob> => fetch(path).then((response) => response.blob());
