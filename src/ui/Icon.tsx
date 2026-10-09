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
      className={cn("lk-ico", className)}
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
    <span className={cn("lk-gl", className)} data-box={box} aria-hidden>
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
    <span className={cn("lk-gl", className)} data-box={box} data-img="" aria-hidden>
      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(url)} />
    </span>
  );
}

const AVATAR_SIZE = {
  28: "var(--avs, calc(var(--iu, 3px) * 8))",
  32: "var(--av-32, calc(var(--iu, 3px) * 8))",
  48: "48px",
} as const;
export type AvatarBox = keyof typeof AVATAR_SIZE;

/**
 * Spielerkopf (8×8) in fester Box 28, 32 oder 48; Kantenlänge ganzzahlige Zellen (--avs bzw. --av-32; 48 = 6 px je Zelle). Mit `skin`
 * (Adresse der Skin-Textur) der echte Kopf, solange sie lädt oder wenn sie fehlt ein Pixelgesicht, fest aus dem Namen abgeleitet.
 * `className` platziert den Kopf in der Umgebung (z. B. `justify-self-center` in einer breiteren Rasterspalte).
 */
export function Avatar({ name, skin, box = 32, className }: { name: string; skin?: string | null; box?: AvatarBox; className?: string }) {
  const size = AVATAR_SIZE[box];
  const face = <Face name={name} size={size} />;
  return (
    <span className={cn("lk-av", className)} data-box={box} aria-hidden>
      {skin ? <SkinHead src={skin} size={size} fallback={face} /> : face}
    </span>
  );
}

/**
 * Statusquadrat (6 Einheiten, Rand in Plattenfarbe) an der unteren rechten Ecke des nächsten positionierten Elternelements,
 * z. B. eines `relative`-Wrappers um einen `Avatar`. `tone="run"`: online/aktiv (grün), sonst gedämpft. Nur Zierde: die Zeile nennt den
 * Zustand zusätzlich im Text (nie nur Farbe).
 */
export function StatusDot({ tone, className }: { tone?: "run"; className?: string }) {
  return <span className={cn("lk-dot absolute right-[calc(var(--px)*-2)] bottom-[calc(var(--px)*-2)] size-[calc(var(--px)*6)]", className)} data-tone={tone} aria-hidden />;
}
