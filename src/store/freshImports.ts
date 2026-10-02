import { create } from "zustand";

/** So lange (ms) hebt die Bibliothek frisch importierte Instanzen hervor. */
const HIGHLIGHT_MS = 60_000;

interface FreshImportsState {
  /** Die zuletzt importierten Instanzen, in der Reihenfolge des Imports. */
  ids: string[];
  mark: (ids: string[]) => void;
}

let expiry: ReturnType<typeof setTimeout> | undefined;

/** Instanzen, die gerade aus einem anderen Launcher kamen: Die Bibliothek zeigt sie als „neu“, damit sie nicht untergehen. */
export const useFreshImports = create<FreshImportsState>()((set) => ({
  ids: [],
  mark: (ids) => {
    clearTimeout(expiry);
    set({ ids });
    expiry = setTimeout(() => set({ ids: [] }), HIGHLIGHT_MS);
  },
}));
