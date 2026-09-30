import { memo } from "react";
import { hash, rng } from "./random";

/*
 * Glyphen (10×10, farbig) und Spielerkopf. Die UI-Icons (7×7/5×5) liegen in
 * icon-data.ts und werden über `Icon` aus "@/ui" gerendert (Größen-Slots s/m/l/xl).
 */
const G = {
  cube: ["....kk....", "..kkhhkk..", ".khhhhhhk.", "kkhhhhhhkk", "kaaakkbbbk", "kaaakkbbbk", "kaaakkbbbk", ".kaakkbbk.", "..kakkbk..", "....kk...."],
  spool: ["kkkkkkkkkk", "khhhhhhhbk", ".kkkkkkkk.", ".kaaaaaabk", ".kccccccbk", ".kaaaaaabk", ".kccccccbk", ".kkkkkkkk.", "khhhhhhhbk", "kkkkkkkkkk"],
  gear: ["....kk....", ".kk.hh.kk.", "kkhhhhhhkk", ".khaaaabk.", "khhakkabbk", "khaakkabbk", ".kaaaabbk.", "kkaabbbbkk", ".kk.bb.kk.", "....kk...."],
  eye: ["..........", "...kkkk...", ".kkhhhhkk.", "kwwwccwwwk", "kwwckkcwwk", "kwwckkcwwk", "kwwwccwwwk", ".kkbbbbkk.", "...kkkk...", ".........."],
  list: ["kkkkkkkkkk", "kaaaaaaaak", "kchhhhhhak", "kaaaaaaaak", "kchhhhhhak", "kaaaaaaaak", "kchhhhhhak", "kaaaaaaaak", "kbbbbbbbbk", "kkkkkkkkkk"],
  apple: [".....kc...", "....kck...", ".kkkkkkkk.", "kahhaaaaak", "kahaaaaabk", "kaaaaaaabk", "kaaaaaabbk", ".kaaaabbk.", "..kkbbkk..", "....kk...."],
  picture: ["kkkkkkkkkk", "khhhhhhhhk", "khhhhhchhk", "khhhhhhhhk", "khhhkhhhhk", "khhkaakhhk", "khkaaaakhk", "kkaaaaaakk", "kbbbbbbbbk", "kkkkkkkkkk"],
  bubble: [".kkkkkkkk.", "khhhhhhhhk", "khhhhhhhbk", "khchchchbk", "khhhhhhhbk", ".kbbbbbbk.", "..kkkkbk..", "...kkbk...", "....kk....", ".........."],
  mountain: ["..........", "......cc..", ".....kccc.", "....kk.cc.", "...khhk...", "..khhhhk..", ".kahhhabk.", "kaaahhaabk", "kaaaaaabbk", "kkkkkkkkkk"],
  sun: ["....kk....", ".k..cc..k.", "..kkhhkk..", ".khhhhhhk.", "kchhhhhhck", "kchhhhhhck", ".khhhhhhk.", "..kkhhkk..", ".k..cc..k.", "....kk...."],
  rocket: ["....kk....", "...khhk...", "..khhhhk..", "..khwwhk..", "..khwwhk..", "..kahhbk..", ".kkabbbkk.", ".kc.kk.ck.", ".k..cc..k.", "....cc...."],
  ball: ["...kkkk...", ".kkaaaakk.", ".kaahaaabk", "kaaaaaaabk", "kkkkkkkkkk", "kwwwkkwwwk", "kwwwwwwwbk", ".kwwwwwbk.", "..kkbbkk..", "....kk...."],
  star: ["....kk....", "...khhk...", "...khhk...", ".kkkhhkkk.", "khhhhhhhhk", "khhhhhhhbk", ".kkkhbkkk.", "...khbk...", "...kbbk...", "....kk...."],
  chest: [".kkkkkkkk.", "khhhhhhhbk", "kahhhhhhbk", "kkkkkkkkkk", "kaaaccaaak", "kaaakkaaak", "kaaaaaaaak", "kaaaaaaabk", "kbbbbbbbbk", "kkkkkkkkkk"],
  compass: ["...kkkk...", ".kkhhhhkk.", ".khhhhcck.", "khhhhccchk", "khhhcckhhk", "khhwwkhhhk", "khwwwhhhhk", ".kwwhhhhk.", ".kkbbbbkk.", "...kkkk..."],
  bolt: ["......kk..", ".....khk..", "....khhk..", "...khhkkk.", "..khhhhhk.", ".kkkkhhk..", "...khhk...", "..khak....", "..kak.....", "..kk......"],
  leaf: [".......kk.", ".....kkhk.", "...kkhhhk.", "..khhhhak.", ".khhhaabk.", ".khhaabk..", ".khaabk...", "..kbbk....", ".kk.......", "k........."],
  brush: [".......kk.", "......khk.", ".....khk..", "....khk...", "...kkk....", "..kaak....", ".kaabk....", ".kabk.....", "kbbk......", "kk........"],
  hammer: [".kkkkkk...", "khhhhhhk..", "kaaaaaabk.", ".kkkkkkk..", "....kk....", "....kak...", "....kak...", "....kak...", "....kbk...", "....kk...."],
} satisfies Record<string, string[]>;

export type GlyphName = keyof typeof G;

const GPAL = {
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

export type GlyphPalette = keyof typeof GPAL;

const GLYPH_NAMES = Object.keys(G) as GlyphName[];
const PALETTES = Object.keys(GPAL) as GlyphPalette[];

/** Feste Glyphe und Palette aus einer ID (für Inhalte ohne eigenes Bild). */
export function glyphFor(seed: string): [GlyphName, GlyphPalette] {
  const h = hash(seed);
  return [GLYPH_NAMES[h % GLYPH_NAMES.length], PALETTES[(h >>> 8) % PALETTES.length]];
}

/** Nur das SVG der Glyphe (Kit: `Glyph` in @/ui). */
export const GlyphSvg = memo(function GlyphSvg({ name, pal }: { name: GlyphName; pal: GlyphPalette }) {
  const p = GPAL[pal];
  const col: Record<string, string> = { k: "#080C12", w: "#EEF2F7", a: p.a, b: p.b, h: p.h, c: p.c };
  const rects: React.ReactElement[] = [];
  G[name].forEach((r, y) => {
    let x = 0;
    while (x < 10) {
      const ch = r[x];
      if (ch === ".") { x++; continue; }
      let e = x;
      while (e < 10 && r[e] === ch) e++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={e - x} height={1} fill={col[ch]} />);
      x = e;
    }
  });
  return (
    <svg viewBox="0 0 10 10" className="gl" aria-hidden>
      {rects}
    </svg>
  );
});

/** Wortzeichen: ein beleuchtetes Pixel-V (Kupfer + Sand). 7×7, größtmögliche ganze Einheiten in 28 px. */
/** Spielerkopf als Pixelgesicht (8×8), fest aus dem Namen abgeleitet. */
export const Face = memo(function Face({ name, size = "var(--avs)" }: { name: string; size?: string }) {
  const h = hash(name || "?");
  const r = rng(h);
  const hairs = ["#3B2A1E", "#5A3A22", "#1E1A18", "#B8763A", "#8C3A22", "#D8C080"];
  const skins = ["#E0A882", "#C98E6A", "#A06A4A", "#F2C4A0"];
  const eyes = ["#3E5A9A", "#4A3A2A", "#2E6A7A", "#6A4A8A"];
  const S = skins[(h >>> 3) % skins.length];
  const N = "#" + [0, 2, 4].map((i) => Math.round(parseInt(S.slice(1 + i, 3 + i), 16) * 0.82).toString(16).padStart(2, "0")).join("");
  const col: Record<string, string> = { H: hairs[h % hairs.length], S, E: eyes[(h >>> 6) % eyes.length], N, M: "#6A3A2A", W: "#F2F2F2" };
  const map = ["HHHHHHHH", "HHHHHHHH", r() < 0.5 ? "HSSSSSSH" : "HHSSSSHH", "SSSSSSSS", "SWESSEWS", "SSSNNSSS", "SSMMMMSS", "SSSSSSSS"];
  const rects: React.ReactElement[] = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < 8) {
      const ch = row[x];
      let e = x;
      while (e < 8 && row[e] === ch) e++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={e - x} height={1} fill={col[ch]} />);
      x = e;
    }
  });
  return (
    <svg viewBox="0 0 8 8" style={{ width: size, height: size }} shapeRendering="crispEdges" aria-hidden>
      {rects}
    </svg>
  );
});
