import { usePackSelection } from "@/hooks/usePackSelection";
import { useStableFn } from "@/hooks/useStableFn";
import { activate, activePacks, deactivate, move, packId, type MoveDirection } from "@/lib/packs";
import type { Instance, Mod } from "@/lib/types";
import type { PackControls } from "./ContentModel";

/**
 * Auswahl der Ressourcenpakete und Shader im Spiel für die Inhaltsliste: `controls` für die Zeilen, der Rest für die
 * Paneele (Reihenfolge, Shader). `busy` ist der Sperrgrund (Spiel läuft, Vorgang läuft); dann ändert sich nichts.
 */
export function usePackControls(instance: Instance, busy: string | null) {
  const { selection, failed, setResourcePacks, setShaderPack } = usePackSelection(instance.id, busy);
  const resourcePacks = instance.mods.filter((m) => m.kind === "resourcepack");
  const tracked = new Set(resourcePacks.map(packId));
  const chosen = selection?.resourcePacks ?? [];
  // Zeilen rendern nur bei geänderter Signatur neu (siehe entrySignature): `setActive` muss die aktuelle Auswahl sehen, sonst gehen Pakete verloren.
  const setActive = useStableFn((mod: Mod, active: boolean) =>
    setResourcePacks(active ? activate(chosen, packId(mod)) : deactivate(chosen, packId(mod))),
  );

  const controls: PackControls = {
    available: !!selection,
    blocked: busy,
    isActive: (mod) => chosen.includes(packId(mod)),
    isIncompatible: (mod) => selection?.incompatible.includes(packId(mod)) ?? false,
    setActive,
  };

  return {
    controls,
    failed,
    /** Die gewählten Ressourcenpakete, das wichtigste zuerst. */
    activeOrder: activePacks(chosen, resourcePacks),
    /** Verschiebt ein gewähltes Paket um eine Stelle; liefert seinen neuen Platz (1 = wichtigstes). */
    movePack: (mod: Mod, direction: MoveDirection) => {
      const next = move(chosen, packId(mod), direction, (id) => tracked.has(id));
      setResourcePacks(next);
      return activePacks(next, resourcePacks).findIndex((m) => m.id === mod.id) + 1;
    },
    shaderFile: selection?.shaderPack ?? null,
    setShaderFile: setShaderPack,
  };
}

export type PackPanelState = ReturnType<typeof usePackControls>;
