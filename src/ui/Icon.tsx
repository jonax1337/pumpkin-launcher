import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { ICON_CELLS, iconShape } from "@/pixel/icon-data";
import { Face, glyphFor, GlyphSvg, type GlyphName, type GlyphPalette } from "@/pixel/icons";
import { SkinHead } from "@/pixel/SkinHead";
import type { IconName, IconSize, Tone } from "./types";
import { cssVars } from "./util";

/**
 * Pixel-Icon in fester Box: ein 8×8-Raster, 1 Icon-Pixel = 1 ganze Zelle (nie gebrochen skaliert, unabhängig von der Pixelstufe --px).
 * Zelle je Slot (Gerätepixel-genau, unit.ts): s Box 16 (2 px) · m Box 24 (3 px) · l Box 32 (4 px) · xl Box 48 (6 px).
 * Farbe: currentColor (zweiter Ton 50 %), außer `tone`.
 */
export const Icon = memo(function Icon({ name, size = "m", tone, edge, className }: {
  name: IconName;
  size?: IconSize;
  tone?: Tone | "muted";
  /** Steht das Icon am Ende eines Knopfes, schneidet es die Luft der Box und die leeren Rasterspalten rechts ab: der sichtbare Rand liegt dann am Innenabstand. */
  edge?: "end";
  className?: string;
}) {
  const { solid, dim, blankEnd } = iconShape(name);
  return (
    <span
      className={cn("vx-ico", className)}
      data-size={size}
      data-tone={tone}
      data-edge={edge}
      style={edge && cssVars({ "--e": blankEnd })}
      aria-hidden
    >
      <svg viewBox={`0 0 ${ICON_CELLS} ${ICON_CELLS}`}>
        <path d={solid} />
        {dim && <path d={dim} data-dim="" />}
      </svg>
    </span>
  );
});

/** Feste Box für 10×10-Glyphen und Projektbilder (px). */
export type GlyphBox = 40 | 52 | 64 | 72 | 104;

/**
 * Farbige 10×10-Glyphe (Mods, Projekte, Illustration) in fester Box. Kantenlänge `--gl-<box>` = ganzzahlige Zellen
 * (k Einheiten je Glyphen-Pixel, k = max(1, floor(box / 10·px)); unit.ts), nie gebrochen skaliert.
 */
export const Glyph = memo(function Glyph({ name, pal, box = 40, className }: { name: GlyphName; pal: GlyphPalette; box?: GlyphBox; className?: string }) {
  return (
    <span className={cn("vx-gl", className)} data-box={box} aria-hidden>
      <GlyphSvg name={name} pal={pal} />
    </span>
  );
});

/** Projektbild in Pixelrahmen (Box wie Glyph); ohne Bild oder bei Ladefehler eine feste Glyphe aus `seed`. */
export function ProjectIcon({ url, seed, box = 40, className }: { url?: string | null; seed: string; box?: GlyphBox; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!url || broken === url) {
    const [g, p] = glyphFor(seed);
    return <Glyph name={g} pal={p} box={box} className={className} />;
  }
  return (
    <span className={cn("vx-gl", className)} data-box={box} data-img="" aria-hidden>
      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(url)} />
    </span>
  );
}

/**
 * Spielerkopf (8×8) in fester Box 28 oder 32; Kantenlänge ganzzahlige Zellen (--avs bzw. --av-32). Mit `skin` (Adresse der
 * Skin-Textur) der echte Kopf, solange sie lädt oder wenn sie fehlt ein Pixelgesicht, fest aus dem Namen abgeleitet.
 */
export function Avatar({ name, skin, box = 32, className }: { name: string; skin?: string | null; box?: 28 | 32; className?: string }) {
  const size = box === 32 ? "var(--av-32, calc(var(--iu, 3px) * 8))" : "var(--avs, calc(var(--iu, 3px) * 8))";
  const face = <Face name={name} size={size} />;
  return (
    <span className={cn("vx-av", className)} data-box={box} aria-hidden>
      {skin ? <SkinHead src={skin} size={size} fallback={face} /> : face}
    </span>
  );
}
