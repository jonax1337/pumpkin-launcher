import { useState } from "react";
import { usePackIconUrl } from "@/hooks/usePackIconUrl";
import { chooseIcon } from "@/lib/instanceIcon";
import type { IconChoice, Instance } from "@/lib/types";
import { GlyphSvg } from "@/pixel/icons";
import { BIOMES, type Biome } from "@/pixel/scene";
import { ArtGlyph, ArtImage } from "@/ui";

/** Kleine Bilder (Pixel-Art von Modpacks) zeigen schon bei jeder Vergrößerung harte Pixel, größere erst ab dieser Vergrößerung; sonst glättet der Browser. */
const SMALL_SOURCE_WIDTH = 128;
const CRISP_FROM_SCALE = 2;

const isEnlarged = ({ naturalWidth, clientWidth }: HTMLImageElement) =>
  clientWidth >= naturalWidth * (naturalWidth <= SMALL_SOURCE_WIDTH ? 1 : CRISP_FROM_SCALE);

/**
 * Ein Icon, es füllt seine Fläche: Bild in voller Auflösung oder Pixel-Icon auf dem Grund des Bioms.
 * Größe der Glyphe und Zuschnitt legt der Rahmen fest (`ArtFrame`, `[--icon-k:2]`). Ein Bild, das nicht lädt, zeigt `fallback`.
 */
export function IconView({ icon, bio, fallback }: { icon: IconChoice; bio: Biome; fallback: IconChoice }) {
  const [broken, setBroken] = useState<string | null>(null);
  const [crisp, setCrisp] = useState(false);
  const shown = icon.type === "image" && broken === icon.src ? fallback : icon;
  if (shown.type === "image")
    return (
      <ArtImage
        crisp={crisp}
        src={shown.src}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={(e) => setCrisp(isEnlarged(e.currentTarget))}
        onError={() => setBroken(shown.src)}
      />
    );
  return (
    <ArtGlyph tile={BIOMES[bio].bg} tileHi={BIOMES[bio].acc}>
      <GlyphSvg name={shown.glyph} pal={shown.palette} />
    </ArtGlyph>
  );
}

/** Das Icon der Instanz: ihre Wahl, sonst das Icon des Modpacks, sonst ein Pixel-Icon, das fest aus der ID folgt. */
export function InstanceIcon({ instance, bio }: { instance: Instance; bio: Biome }) {
  const packIconUrl = usePackIconUrl(instance);
  const { icon, standard } = chooseIcon(instance, packIconUrl);
  return <IconView icon={icon} bio={bio} fallback={standard} />;
}
