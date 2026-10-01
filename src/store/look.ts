import { create } from "zustand";
import { persist } from "zustand/middleware";
import { hash } from "@/pixel/random";
import { BIOME_KEYS, BIOMES, type Biome } from "@/pixel/scene";

type StoredLook = { bio: Biome; seed: number };

/**
 * Bild einer Instanz (Biom der Szene) und zugeklappte Gruppen der Bibliothek. Lebt lokal, weil das Backend
 * kein Feld dafür hat; ohne Wahl ergibt sich das Bild fest aus der Instanz-ID.
 */
interface LookState {
  looks: Record<string, StoredLook>;
  /** Zugeklappte Abschnitte der Bibliothek; "" = Instanzen ohne Gruppe. */
  collapsed: string[];
  setBiome: (instanceId: string, bio: Biome) => void;
  setCollapsed: (group: string, collapsed: boolean) => void;
}

/** So viele Szenenvarianten (Seeds) gibt es je Biom. */
const SEED_COUNT = 60;
/** Die Bits ab hier wählen den Seed; die unteren wählen das Biom, so bleiben beide unabhängig. */
const SEED_HASH_SHIFT = 7;

export const useLookStore = create<LookState>()(
  persist(
    (set) => ({
      looks: {},
      collapsed: [],
      setBiome: (id, bio) => set((s) => ({ looks: { ...s.looks, [id]: { bio, seed: s.looks[id]?.seed ?? defaultLook(id).seed } } })),
      // <details> meldet beim Einhängen schon offen; ohne Änderung bleibt der Zustand gleich, kein Neu-Rendern.
      setCollapsed: (group, collapsed) =>
        set((s) =>
          s.collapsed.includes(group) === collapsed ? s : { collapsed: collapsed ? [...s.collapsed, group] : s.collapsed.filter((g) => g !== group) },
        ),
    }),
    { name: "launcher-look", version: 1 },
  ),
);

function defaultLook(id: string): StoredLook {
  const h = hash(id);
  return { bio: BIOME_KEYS[h % BIOME_KEYS.length], seed: (h >>> SEED_HASH_SHIFT) % SEED_COUNT };
}

export type Look = StoredLook & { acc: string };

/** Gewähltes Bild der Instanz, sonst das aus der ID abgeleitete, dazu die Akzentfarbe des Bioms. */
function resolveLook(stored: StoredLook | undefined, instanceId: string): Look {
  const look = stored ?? defaultLook(instanceId);
  return { ...look, acc: BIOMES[look.bio].acc };
}

/** Biom, Seed und Akzentfarbe einer Instanz. */
export function useLook(instanceId: string | undefined): Look {
  const stored = useLookStore((s) => (instanceId ? s.looks[instanceId] : undefined));
  return resolveLook(stored, instanceId ?? "");
}

/** Ohne Hook (z. B. in Listen mit vielen Einträgen, die den Store schon lesen). */
export const lookOf = (looks: LookState["looks"], instanceId: string): Look => resolveLook(looks[instanceId], instanceId);
