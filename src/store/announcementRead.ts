import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AnnouncementReadState {
  readIds: string[];
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: (ids: string[]) => void;
}

function persistedReadIds(persisted: unknown): string[] {
  if (!persisted || typeof persisted !== "object" || !("readIds" in persisted)) return [];
  if (!Array.isArray(persisted.readIds)) return [];
  return [...new Set(persisted.readIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

export const useAnnouncementReadStore = create<AnnouncementReadState>()(
  persist(
    (set) => ({
      readIds: [],
      markRead: (id) => set((state) => (state.readIds.includes(id) ? state : { readIds: [...state.readIds, id] })),
      markUnread: (id) =>
        set((state) => (state.readIds.includes(id) ? { readIds: state.readIds.filter((readId) => readId !== id) } : state)),
      markAllRead: (ids) =>
        set((state) => {
          const readIds = new Set(state.readIds);
          for (const id of ids) readIds.add(id);
          return readIds.size === state.readIds.length ? state : { readIds: [...readIds] };
        }),
    }),
    {
      name: "launcher-announcement-read",
      version: 1,
      partialize: (state) => ({ readIds: state.readIds }),
      merge: (persisted, current) => ({ ...current, readIds: persistedReadIds(persisted) }),
    },
  ),
);
