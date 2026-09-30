import { memo } from "react";
import { cn } from "@/lib/utils";
import { hash, rng } from "./random";
import { ICON_DATA, rowsPath } from "./icon-data";

/*
 * ALTBESTAND bis Phase C: `Icon` mit den alten Namen (7×7-Namen + 5×5-Namen wie x5, check5, chevr).
 * Die Daten kommen aus icon-data.ts; neue Stellen nutzen `Icon` aus "@/ui" (Größen-Slots s/m/l/xl).
 */
type KitName = keyof typeof ICON_DATA;

/** Alte 7×7-Namen → Kit-Name (Raster g7). */
const OLD7 = {
  play: "play", stop: "stop", plus: "plus", x: "x", search: "search", check: "check", up: "up", dl: "dl", ul: "ul", trash: "trash",
  folder: "folder", copy: "copy", gear: "gear", list: "list", grid: "grid", back: "back", chev: "chev", more: "more", warn: "warn",
  info: "info", term: "term", redo: "redo", user: "user", plug: "plug", ext: "ext", file: "file", save: "save", clock: "clock",
  hour: "hour", down2: "down", power: "power", swap: "swap", box: "box", eye: "eye", tasks: "tasks",
} as const satisfies Record<string, KitName>;

/** Alte 5×5-Namen → Kit-Name (Raster g5). */
const OLD5 = {
  chevd: "chevd", chevr: "chev", x5: "x", wmin: "wmin", wmax: "wmax", check5: "check", dot5: "dot", plus5: "plus", up5: "up",
  dl5: "dl", ul5: "ul", down5: "down", trash5: "trash", folder5: "folder", copy5: "copy", redo5: "redo", play5: "play",
  stop5: "stop", user5: "user", power5: "power", ext5: "ext", save5: "save", swap5: "swap", plug5: "plug", gear5: "gear",
  back5: "back", term5: "term", warn5: "warn",
} as const satisfies Record<string, KitName>;

export type IconName = keyof typeof OLD7 | keyof typeof OLD5;

const rowsOf = (name: IconName): readonly string[] =>
  name in OLD7 ? ICON_DATA[OLD7[name as keyof typeof OLD7]].g7 : ICON_DATA[OLD5[name as keyof typeof OLD5]].g5;

/** Kleine Variante, die in kleinen Knöpfen, Menüs und Toasts statt der 7×7-Glyphe erscheint. */
const SMALL5: Partial<Record<IconName, IconName>> = {
  plus: "plus5", up: "up5", dl: "dl5", ul: "ul5", down2: "down5", trash: "trash5", folder: "folder5", copy: "copy5", redo: "redo5",
  play: "play5", stop: "stop5", user: "user5", power: "power5", ext: "ext5", save: "save5", swap: "swap5", plug: "plug5",
  check: "check5", x: "x5", chev: "chevr", gear: "gear5", back: "back5", term: "term5", warn: "warn5",
};

function Grid({ name, className }: { name: IconName; className?: string }) {
  const rows = rowsOf(name);
  const n = rows[0].length;
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className={className} aria-hidden>
      <path d={rowsPath(`old:${name}`, rows)} />
    </svg>
  );
}

/**
 * Pixel-Icon in fester Box (28 px, klein 20 px). `small` nimmt die 20-px-Box;
 * 5×5-Namen (chevd, x5 …) nur mit `small` verwenden, sonst werden sie gestreckt.
 */
export const Icon = memo(function Icon({ name, small, className }: { name: IconName; small?: boolean; className?: string }) {
  const s = SMALL5[name];
  return (
    <span className={cn("pi", small && "s", className)} aria-hidden>
      <Grid name={name} className="g7" />
      {s && !small && <Grid name={s} className="g5" />}
    </span>
  );
});

/** Nur das SVG (z. B. für die Checkbox). */
export const IconSvg = Grid;

/* Mod-/Projekt-Glyphen (10×10, farbig) */
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

/** Farbige 10×10-Glyphe in fester Box (40 px, groß 64 px). */
export function Glyph({ name, pal, big, className }: { name: GlyphName; pal: GlyphPalette; big?: boolean; className?: string }) {
  return (
    <span className={cn("mi", big && "l", className)} aria-hidden>
      <GlyphSvg name={name} pal={pal} />
    </span>
  );
}

/** Wortzeichen: ein beleuchtetes Pixel-V (Kupfer + Sand). */
export function Mark({ size = "var(--pis)" }: { size?: string }) {
  const rows = ["a.....b", "a.....b", "aa...bb", ".a...b.", ".aa.bb.", "..a.b..", "..aab.."];
  return (
    <svg viewBox="0 0 7 7" style={{ width: size, height: size }} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) =>
        [...r].map((ch, x) => (ch === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={ch === "a" ? "#E39860" : "#F6E7C8"} />)),
      )}
    </svg>
  );
}

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
