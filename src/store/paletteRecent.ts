import { create } from "zustand";
import { persist } from "zustand/middleware";

/** So viele zuletzt ausgeführte Befehle zeigt die Palette bei leerem Suchfeld. */
export const RECENT_LIMIT = 5;

interface PaletteRecentState {
  /** Ausgeführte Befehle der Befehlspalette, neueste zuerst. */
  recentIds: string[];
  remember: (id: string) => void;
}

function persistedRecentIds(persisted: unknown): string[] {
  if (!persisted || typeof persisted !== "object" || !("recentIds" in persisted)) return [];
  if (!Array.isArray(persisted.recentIds)) return [];
  const ids = persisted.recentIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].slice(0, RECENT_LIMIT);
}

export const usePaletteRecent = create<PaletteRecentState>()(
  persist(
    (set) => ({
      recentIds: [],
      remember: (id) => set((state) => ({ recentIds: [id, ...state.recentIds.filter((known) => known !== id)].slice(0, RECENT_LIMIT) })),
    }),
    {
      name: "launcher-palette-recent",
      version: 1,
      partialize: (state) => ({ recentIds: state.recentIds }),
      merge: (persisted, current) => ({ ...current, recentIds: persistedRecentIds(persisted) }),
    },
  ),
);
