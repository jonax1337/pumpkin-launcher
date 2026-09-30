import { create } from "zustand";
import { persist } from "zustand/middleware";
import { hash } from "@/pixel/random";
import { BIOME_KEYS, BIOMES, type Biome } from "@/pixel/scene";

/**
 * Bild einer Instanz (Biom der Szene). Lebt lokal, weil das Backend kein Feld dafür hat;
 * ohne Wahl ergibt es sich fest aus der Instanz-ID.
 */
interface LookState {
  looks: Record<string, { bio: Biome; seed: number }>;
  setBiome: (instanceId: string, bio: Biome) => void;
}

export const useLookStore = create<LookState>()(
  persist(
    (set) => ({
      looks: {},
      setBiome: (id, bio) => set((s) => ({ looks: { ...s.looks, [id]: { bio, seed: s.looks[id]?.seed ?? defaultLook(id).seed } } })),
    }),
    { name: "launcher-look", version: 1 },
  ),
);

export function defaultLook(id: string) {
  const h = hash(id);
  return { bio: BIOME_KEYS[h % BIOME_KEYS.length], seed: (h >>> 7) % 60 };
}

export type Look = { bio: Biome; seed: number; acc: string };

/** Biom, Seed und Akzentfarbe einer Instanz. */
export function useLook(instanceId: string | undefined): Look {
  const stored = useLookStore((s) => (instanceId ? s.looks[instanceId] : undefined));
  const look = stored ?? defaultLook(instanceId ?? "");
  return { ...look, acc: BIOMES[look.bio].acc };
}

/** Ohne Hook (z. B. in Listen mit vielen Einträgen, die den Store schon lesen). */
export function lookOf(looks: LookState["looks"], instanceId: string): Look {
  const look = looks[instanceId] ?? defaultLook(instanceId);
  return { ...look, acc: BIOMES[look.bio].acc };
}
