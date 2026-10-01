import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GlyphName, GlyphPalette } from "@/pixel/icons";
import { hash } from "@/pixel/random";
import { BIOME_KEYS, BIOMES, type Biome } from "@/pixel/scene";

type StoredLook = { bio: Biome; seed: number };

/** Vom Nutzer gewähltes Icon einer Instanz: ein Pixel-Icon oder ein eigenes Bild (quadratisch, als Datenadresse). */
export type IconChoice = { type: "glyph"; glyph: GlyphName; palette: GlyphPalette } | { type: "image"; src: string };

/**
 * Bild einer Instanz (Biom der Szene, Icon) und zugeklappte Gruppen der Bibliothek. Lebt lokal, weil das Backend
 * kein Feld dafür hat; ohne Wahl ergibt sich die Szene fest aus der Instanz-ID, das Icon aus dem Modpack bzw. der ID.
 */
interface LookState {
  looks: Record<string, StoredLook>;
  /** Gewählte Icons; ohne Eintrag gilt „automatisch“. */
  icons: Record<string, IconChoice>;
  /** Zugeklappte Abschnitte der Bibliothek; "" = Instanzen ohne Gruppe. */
  collapsed: string[];
  setBiome: (instanceId: string, bio: Biome) => void;
  /** `null` stellt „automatisch“ wieder her. */
  setIcon: (instanceId: string, icon: IconChoice | null) => void;
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
      icons: {},
      collapsed: [],
      setBiome: (id, bio) => set((s) => ({ looks: { ...s.looks, [id]: { bio, seed: s.looks[id]?.seed ?? defaultLook(id).seed } } })),
      setIcon: (id, icon) =>
        set((s) => {
          const { [id]: _replaced, ...others } = s.icons;
          return { icons: icon ? { ...others, [id]: icon } : others };
        }),
      // <details> meldet beim Einhängen schon offen; ohne Änderung bleibt der Zustand gleich, kein Neu-Rendern.
      setCollapsed: (group, collapsed) =>
        set((s) =>
          s.collapsed.includes(group) === collapsed
            ? s
            : { collapsed: collapsed ? [...s.collapsed, group] : s.collapsed.filter((g) => g !== group) },
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
