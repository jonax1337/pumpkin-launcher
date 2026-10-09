import { glyphFor } from "@/pixel/icons";
import type { IconChoice, Instance } from "./types";

/**
 * Das Icon einer Instanz: ihre Wahl, sonst das Icon des Modpacks (`packIconSrc`), sonst ein Pixel-Icon, das fest aus der ID
 * folgt. `standard` ist das Pixel-Icon, auf das ein Bild zurückfällt, das nicht lädt.
 */
export function chooseIcon(instance: Instance, packIconSrc?: string): { icon: IconChoice; standard: IconChoice } {
  const [glyph, palette] = glyphFor(instance.id);
  const standard: IconChoice = { type: "glyph", glyph, palette };
  const icon = instance.icon ?? (packIconSrc ? { type: "image" as const, src: packIconSrc } : standard);
  return { icon, standard };
}
