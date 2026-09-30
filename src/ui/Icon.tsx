import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { ICON_DATA, rowsPath } from "@/pixel/icon-data";
import { Face, glyphFor, GlyphSvg, type GlyphName, type GlyphPalette } from "@/pixel/icons";
import type { IconName, IconSize, Tone } from "./types";

function Raster({ name, g }: { name: IconName; g: 7 | 5 }) {
  const rows = g === 7 ? ICON_DATA[name].g7 : ICON_DATA[name].g5;
  return (
    <svg viewBox={`0 0 ${g} ${g}`} data-g={g} aria-hidden>
      <path d={rowsPath(`${name}:${g}`, rows)} />
    </svg>
  );
}

/**
 * Pixel-Icon in fester Box. Regel: 1 Icon-Pixel = 1 Icon-Einheit (--iu, unabhängig von der Pixelstufe --px), nie gebrochen skaliert (xl: fest 2 Einheiten).
 * s: Box 20, 5×5 · m: Box 24, 7×7 (5×5 nur, wenn 7 Einheiten nicht passen; unit.ts setzt data-ico-m) · l: Box 28, 7×7 · xl: Box 56, 7×7 × 2.
 * Farbe: currentColor, außer `tone`.
 */
export const Icon = memo(function Icon({ name, size = "m", tone, flip, className }: {
  name: IconName;
  size?: IconSize;
  tone?: Tone | "muted";
  flip?: "x" | "y";
  className?: string;
}) {
  return (
    <span className={cn("vx-ico", className)} data-size={size} data-tone={tone} data-flip={flip} aria-hidden>
      {size !== "s" && <Raster name={name} g={7} />}
      {(size === "s" || size === "m") && <Raster name={name} g={5} />}
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

/** Spielerkopf (8×8) in fester Box 28 oder 32; Kantenlänge ganzzahlige Zellen (--avs bzw. --av-32). */
export function Avatar({ name, box = 32, className }: { name: string; box?: 28 | 32; className?: string }) {
  return (
    <span className={cn("vx-av", className)} data-box={box} aria-hidden>
      <Face name={name} size={box === 32 ? "var(--av-32, calc(var(--iu, 3px) * 8))" : "var(--avs, calc(var(--iu, 3px) * 8))"} />
    </span>
  );
}
