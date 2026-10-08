import { memo } from "react";
import { hash, rng } from "./random";
import { rowRuns } from "./rows";

/*
 * Glyphen (10×10, farbig) und Spielerkopf. Die UI-Icons (7×7/5×5) liegen in
 * icon-data.ts und werden über `Icon` aus "@/ui" gerendert (Größen-Slots s/m/l/xl).
 */
const GLYPHS = {
  cube: [
    "....kk....",
    "..kkhhkk..",
    ".khhhhhhk.",
    "kkhhhhhhkk",
    "kaaakkbbbk",
    "kaaakkbbbk",
    "kaaakkbbbk",
    ".kaakkbbk.",
    "..kakkbk..",
    "....kk....",
  ],
  spool: [
    "kkkkkkkkkk",
    "khhhhhhhbk",
    ".kkkkkkkk.",
    ".kaaaaaabk",
    ".kccccccbk",
    ".kaaaaaabk",
    ".kccccccbk",
    ".kkkkkkkk.",
    "khhhhhhhbk",
    "kkkkkkkkkk",
  ],
  gear: [
    "....kk....",
    ".kk.hh.kk.",
    "kkhhhhhhkk",
    ".khaaaabk.",
    "khhakkabbk",
    "khaakkabbk",
    ".kaaaabbk.",
    "kkaabbbbkk",
    ".kk.bb.kk.",
    "....kk....",
  ],
  eye: [
    "..........",
    "...kkkk...",
    ".kkhhhhkk.",
    "kwwwccwwwk",
    "kwwckkcwwk",
    "kwwckkcwwk",
    "kwwwccwwwk",
    ".kkbbbbkk.",
    "...kkkk...",
    "..........",
  ],
  list: [
    "kkkkkkkkkk",
    "kaaaaaaaak",
    "kchhhhhhak",
    "kaaaaaaaak",
    "kchhhhhhak",
    "kaaaaaaaak",
    "kchhhhhhak",
    "kaaaaaaaak",
    "kbbbbbbbbk",
    "kkkkkkkkkk",
  ],
  apple: [
    ".....kc...",
    "....kck...",
    ".kkkkkkkk.",
    "kahhaaaaak",
    "kahaaaaabk",
    "kaaaaaaabk",
    "kaaaaaabbk",
    ".kaaaabbk.",
    "..kkbbkk..",
    "....kk....",
  ],
  picture: [
    "kkkkkkkkkk",
    "khhhhhhhhk",
    "khhhhhchhk",
    "khhhhhhhhk",
    "khhhkhhhhk",
    "khhkaakhhk",
    "khkaaaakhk",
    "kkaaaaaakk",
    "kbbbbbbbbk",
    "kkkkkkkkkk",
  ],
  bubble: [
    ".kkkkkkkk.",
    "khhhhhhhhk",
    "khhhhhhhbk",
    "khchchchbk",
    "khhhhhhhbk",
    ".kbbbbbbk.",
    "..kkkkbk..",
    "...kkbk...",
    "....kk....",
    "..........",
  ],
  mountain: [
    "..........",
    "......cc..",
    ".....kccc.",
    "....kk.cc.",
    "...khhk...",
    "..khhhhk..",
    ".kahhhabk.",
    "kaaahhaabk",
    "kaaaaaabbk",
    "kkkkkkkkkk",
  ],
  sun: [
    "....kk....",
    ".k..cc..k.",
    "..kkhhkk..",
    ".khhhhhhk.",
    "kchhhhhhck",
    "kchhhhhhck",
    ".khhhhhhk.",
    "..kkhhkk..",
    ".k..cc..k.",
    "....kk....",
  ],
  rocket: [
    "....kk....",
    "...khhk...",
    "..khhhhk..",
    "..khwwhk..",
    "..khwwhk..",
    "..kahhbk..",
    ".kkabbbkk.",
    ".kc.kk.ck.",
    ".k..cc..k.",
    "....cc....",
  ],
  ball: [
    "...kkkk...",
    ".kkaaaakk.",
    ".kaahaaabk",
    "kaaaaaaabk",
    "kkkkkkkkkk",
    "kwwwkkwwwk",
    "kwwwwwwwbk",
    ".kwwwwwbk.",
    "..kkbbkk..",
    "....kk....",
  ],
  star: [
    "....kk....",
    "...khhk...",
    "...khhk...",
    ".kkkhhkkk.",
    "khhhhhhhhk",
    "khhhhhhhbk",
    ".kkkhbkkk.",
    "...khbk...",
    "...kbbk...",
    "....kk....",
  ],
  chest: [
    ".kkkkkkkk.",
    "khhhhhhhbk",
    "kahhhhhhbk",
    "kkkkkkkkkk",
    "kaaaccaaak",
    "kaaakkaaak",
    "kaaaaaaaak",
    "kaaaaaaabk",
    "kbbbbbbbbk",
    "kkkkkkkkkk",
  ],
  compass: [
    "...kkkk...",
    ".kkhhhhkk.",
    ".khhhhcck.",
    "khhhhccchk",
    "khhhcckhhk",
    "khhwwkhhhk",
    "khwwwhhhhk",
    ".kwwhhhhk.",
    ".kkbbbbkk.",
    "...kkkk...",
  ],
  bolt: [
    "......kk..",
    ".....khk..",
    "....khhk..",
    "...khhkkk.",
    "..khhhhhk.",
    ".kkkkhhk..",
    "...khhk...",
    "..khak....",
    "..kak.....",
    "..kk......",
  ],
  leaf: [
    ".......kk.",
    ".....kkhk.",
    "...kkhhhk.",
    "..khhhhak.",
    ".khhhaabk.",
    ".khhaabk..",
    ".khaabk...",
    "..kbbk....",
    ".kk.......",
    "k.........",
  ],
  brush: [
    ".......kk.",
    "......khk.",
    ".....khk..",
    "....khk...",
    "...kkk....",
    "..kaak....",
    ".kaabk....",
    ".kabk.....",
    "kbbk......",
    "kk........",
  ],
  hammer: [
    ".kkkkkk...",
    "khhhhhhk..",
    "kaaaaaabk.",
    ".kkkkkkk..",
    "....kk....",
    "....kak...",
    "....kak...",
    "....kak...",
    "....kbk...",
    "....kk....",
  ],
} satisfies Record<string, string[]>;

export type GlyphName = keyof typeof GLYPHS;

export const GLYPH_PALETTES = {
  copper: { a: "#D98A54", b: "#9B5A30", h: "#F3BD8B", c: "#F6E6C8" },
  steel: { a: "#7F96B8", b: "#4F6382", h: "#B9C9E0", c: "#E0955F" },
  sand: { a: "#CDB892", b: "#8F7C56", h: "#EADFC4", c: "#6D8CB0" },
  violet: { a: "#9088BB", b: "#5F5888", h: "#C0BADE", c: "#E5B85F" },
  teal: { a: "#5C9DB3", b: "#376A7C", h: "#9CCBDB", c: "#E0955F" },
  coral: { a: "#CC655C", b: "#8F3D38", h: "#EBA59E", c: "#ECD7A5" },
  ice: { a: "#8FB0D0", b: "#587594", h: "#CFE2F3", c: "#E0955F" },
  gold: { a: "#E0B25A", b: "#9A7432", h: "#F6DA98", c: "#7F96B8" },
  rose: { a: "#D97C95", b: "#94475E", h: "#F2B5C4", c: "#F6E6C8" },
};

export type GlyphPalette = keyof typeof GLYPH_PALETTES;

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];
export const PALETTE_NAMES = Object.keys(GLYPH_PALETTES) as GlyphPalette[];

/** Feste Glyphe und Palette aus einer ID (für Inhalte ohne eigenes Bild). */
export function glyphFor(seed: string): [GlyphName, GlyphPalette] {
  const h = hash(seed);
  return [GLYPH_NAMES[h % GLYPH_NAMES.length], PALETTE_NAMES[(h >>> 8) % PALETTE_NAMES.length]];
}

const GLYPH_OUTLINE = "#080C12";
const GLYPH_WHITE = "#EEF2F7";

/** Ein <rect> je Lauf gleicher Zeichen; `colors` ordnet jedem Zeichen eine Füllfarbe zu, "." bleibt leer. */
function rowsToRects(rows: readonly string[], colors: Record<string, string>) {
  return rowRuns(rows).map(({ x, y, length, cell }) => (
    <rect key={`${x}-${y}`} x={x} y={y} width={length} height={1} fill={colors[cell]} />
  ));
}

/** Ein Modpack bringt beliebige Namen mit (`pumpkin.json`); unbekannte zeigen die erste Glyphe bzw. Palette statt abzustürzen. */
const isGlyphName = (name: string): name is GlyphName => Object.hasOwn(GLYPHS, name);
const isGlyphPalette = (pal: string): pal is GlyphPalette => Object.hasOwn(GLYPH_PALETTES, pal);

/** Die Rechtecke einer Glyphe im 10×10-Raster, je ein Lauf gleicher Farbe; SVG und Canvas zeichnen dasselbe Bild. */
export function glyphRects(name: GlyphName, pal: GlyphPalette) {
  const p = GLYPH_PALETTES[isGlyphPalette(pal) ? pal : PALETTE_NAMES[0]];
  const colors: Record<string, string> = { k: GLYPH_OUTLINE, w: GLYPH_WHITE, a: p.a, b: p.b, h: p.h, c: p.c };
  return rowRuns(GLYPHS[isGlyphName(name) ? name : GLYPH_NAMES[0]]).map(({ x, y, length, cell }) => ({ x, y, length, fill: colors[cell] }));
}

/** Nur das SVG der Glyphe (Kit: `Glyph` in @/ui). */
export const GlyphSvg = memo(function GlyphSvg({ name, pal }: { name: GlyphName; pal: GlyphPalette }) {
  return (
    <svg viewBox="0 0 10 10" className="gl" aria-hidden>
      {glyphRects(name, pal).map(({ x, y, length, fill }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={length} height={1} fill={fill} />
      ))}
    </svg>
  );
});

const FACE_HAIRS = ["#3B2A1E", "#5A3A22", "#1E1A18", "#B8763A", "#8C3A22", "#D8C080"];
const FACE_SKINS = ["#E0A882", "#C98E6A", "#A06A4A", "#F2C4A0"];
const FACE_EYES = ["#3E5A9A", "#4A3A2A", "#2E6A7A", "#6A4A8A"];
const FACE_MOUTH = "#6A3A2A";
const FACE_WHITE = "#F2F2F2";
const NOSE_SHADE = 0.82;
const FACE_ROWS_ABOVE = ["HHHHHHHH", "HHHHHHHH"];
const FACE_ROWS_BELOW = ["SSSSSSSS", "SWESSEWS", "SSSNNSSS", "SSMMMMSS", "SSSSSSSS"];

/** Farbe `hex` um `factor` abgedunkelt (je Kanal multipliziert). */
const darken = (hex: string, factor: number) =>
  "#" + [1, 3, 5].map((from) => Math.round(parseInt(hex.slice(from, from + 2), 16) * factor).toString(16).padStart(2, "0")).join("");

/** Spielerkopf als Pixelgesicht (8×8), fest aus dem Namen abgeleitet. */
export const Face = memo(function Face({ name, size = "var(--avs)" }: { name: string; size?: string }) {
  const h = hash(name || "?");
  const rand = rng(h);
  const skin = FACE_SKINS[(h >>> 3) % FACE_SKINS.length];
  const hair = FACE_HAIRS[h % FACE_HAIRS.length], eyes = FACE_EYES[(h >>> 6) % FACE_EYES.length];
  const colors = { H: hair, S: skin, E: eyes, N: darken(skin, NOSE_SHADE), M: FACE_MOUTH, W: FACE_WHITE };
  const hairline = rand() < 0.5 ? "HSSSSSSH" : "HHSSSSHH";
  return (
    <svg viewBox="0 0 8 8" style={{ width: size, height: size }} shapeRendering="crispEdges" aria-hidden>
      {rowsToRects([...FACE_ROWS_ABOVE, hairline, ...FACE_ROWS_BELOW], colors)}
    </svg>
  );
});
