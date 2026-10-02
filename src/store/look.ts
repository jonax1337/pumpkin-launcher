import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useInstanceScene } from "@/hooks/useInstances";
import type { IconChoice, Instance, InstanceScene } from "@/lib/types";
import { hash } from "@/pixel/random";
import { BIOME_KEYS, BIOMES, isBiome, type Biome } from "@/pixel/scene";

/** Szene, wie ältere Versionen sie lokal gemerkt haben. */
type LegacyLook = { bio: Biome; seed: number };

/**
 * Zugeklappte Gruppen und Gruppenreihenfolge der Bibliothek. Szene und Icon einer Instanz stehen im Instanzmodell des
 * Backends (`scene`, `icon`); `looks` und `icons` sind nur der Altbestand von Versionen, die sie lokal hielten, bis
 * `useMigrateLooks` sie übertragen hat.
 */
interface LookState {
  looks: Record<string, LegacyLook>;
  icons: Record<string, IconChoice>;
  /** Zugeklappte Abschnitte der Bibliothek; "" = Instanzen ohne Gruppe. */
  collapsed: string[];
  /** Selbst gewählte Reihenfolge der Gruppen in der Bibliothek; Gruppen ohne Eintrag folgen alphabetisch. */
  groupOrder: string[];
  /** Der Altbestand der Instanz ist übertragen (oder die Instanz gibt es nicht mehr). */
  forgetLegacy: (instanceId: string) => void;
  setCollapsed: (group: string, collapsed: boolean) => void;
  setGroupOrder: (order: string[]) => void;
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
      groupOrder: [],
      forgetLegacy: (id) =>
        set((s) => {
          const { [id]: _look, ...looks } = s.looks;
          const { [id]: _icon, ...icons } = s.icons;
          return { looks, icons };
        }),
      // <details> meldet beim Einhängen schon offen; ohne Änderung bleibt der Zustand gleich, kein Neu-Rendern.
      setCollapsed: (group, collapsed) =>
        set((s) =>
          s.collapsed.includes(group) === collapsed
            ? s
            : { collapsed: collapsed ? [...s.collapsed, group] : s.collapsed.filter((g) => g !== group) },
        ),
      setGroupOrder: (groupOrder) => set({ groupOrder }),
    }),
    { name: "launcher-look", version: 1 },
  ),
);

/** Die Szene, die eine Instanz ohne eigene Wahl zeigt: fest aus ihrer ID abgeleitet. */
function defaultScene(instanceId: string): InstanceScene {
  const h = hash(instanceId);
  return { biome: BIOME_KEYS[h % BIOME_KEYS.length], seed: (h >>> SEED_HASH_SHIFT) % SEED_COUNT };
}

/** Biom, Seed und Akzentfarbe einer Szene. */
export type Look = { bio: Biome; seed: number; acc: string };

/** Gewählte Szene der Instanz, sonst (auch bei einem unbekannten Biom, etwa aus einem Modpack) die aus der ID abgeleitete, dazu die Akzentfarbe des Bioms. */
function resolveLook(scene: InstanceScene | null | undefined, instanceId: string): Look {
  const { biome, seed } = scene && isBiome(scene.biome) ? scene : defaultScene(instanceId);
  return { bio: biome, seed, acc: BIOMES[biome].acc };
}

/** Biom, Seed und Akzentfarbe einer Instanz. */
export function useLook(instanceId: string | undefined): Look {
  return resolveLook(useInstanceScene(instanceId), instanceId ?? "");
}

/** Ohne Hook (z. B. in Listen mit vielen Einträgen, die die Instanzen schon haben). */
export const lookOf = (instance: Pick<Instance, "id" | "scene">): Look => resolveLook(instance.scene, instance.id);
