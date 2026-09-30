/**
 * Szenen-Engine (reines TS, Canvas).
 * Pixel-Art statt Filter: ruhige Farbbänder (4 bis 7 pro Biom), klare Silhouetten in 3 bis 4 Ebenen,
 * Dithering nur als schmale Bayer-Kante zwischen zwei Bändern (2 bis 4 Welt-Pixel), nie flächig.
 * Tiefe über Luftperspektive: hintere Ebenen liegen farblich nah am Horizont, vordere fast schwarz.
 */
import { hash, rng } from "./random";
import { PX, snap } from "./unit";

export type Biome = "forest" | "nether" | "end" | "snow" | "cave" | "sea" | "plains";
export type SceneMode = "flat" | "live" | "hero";
/**
 * Lage der Lichtquelle (Sonne, Mond, Fackel, Insel): `left` links der Mitte (35–55 %, Instanzkopf: rechts steht der Spielen-Knopf),
 * `std` wie im Mockup (Start), `seed` Seite und Lage je Seed (Poster, Miniaturen). Standard folgt dem Modus: live → left, hero → std, flat → seed.
 */
export type SunAnchor = "left" | "std" | "seed";
export const sunFor = (mode: SceneMode, sun?: SunAnchor): SunAnchor => sun ?? (mode === "live" ? "left" : mode === "hero" ? "std" : "seed");

/** Biome: Name, Akzent (Spielen-Knopf, Poster-Ring, Kopf) und Grundfarbe für Ränder. */
export const BIOMES: Record<Biome, { n: string; acc: string; bg: string }> = {
  forest: { n: "Wald am Abend", acc: "#EB85D6", bg: "#1B2140" },
  nether: { n: "Nether", acc: "#FF7447", bg: "#1A0708" },
  end: { n: "End", acc: "#DCD394", bg: "#07060D" },
  snow: { n: "Schneeberge", acc: "#F4B4A8", bg: "#2A3764" },
  cave: { n: "Höhle", acc: "#C8ABEE", bg: "#0A0E16" },
  sea: { n: "Küste", acc: "#4FD8E6", bg: "#13284A" },
  plains: { n: "Ebene", acc: "#98B0FF", bg: "#3C6FB4" },
};
export const BIOME_KEYS = Object.keys(BIOMES) as Biome[];

type Buf = { w: number; h: number; d: Uint32Array };
type Star = { x: number; y: number; ph: number; a: number; b: number; s?: number };
type Glint = { x: number; y: number; w: number; ph: number; c: number; c2: number; base?: boolean };
type Part = { x: number; y: number; v: number; ph: number; c: number; up: boolean; top: number; bot: number };
type Fx = {
  stars: Star[]; parts: Part[]; glints: Glint[]; crystals: { x: number; y: number; s: number; ph: number }[];
  drift: { b: Buf; speed: number } | null; torch: { x: number; y: number; s: number } | null;
};
type Scene = { W: number; H: number; M: number; base: Buf; layers: { b: Buf; d: number }[]; fx: Fx };

const BAY4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAY4[((y & 3) << 2) | (x & 3)];
const C32C = new Map<string, number>();
/** #RRGGBB als ABGR-Wort für ImageData (Little Endian). */
const C32 = (hex: string) => {
  let v = C32C.get(hex);
  if (v == null) {
    v = (0xff000000 | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;
    C32C.set(hex, v);
  }
  return v;
};
const mkBuf = (w: number, h: number): Buf => ({ w, h, d: new Uint32Array(Math.max(1, w * h)) });
function pset(b: Buf, x: number, y: number, c: number) {
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.d[y * b.w + x] = c;
}
function rect(b: Buf, x: number, y: number, w: number, h: number, c: number) {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(b.w, (x + w) | 0), y1 = Math.min(b.h, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) b.d.fill(c, yy * b.w + x0, yy * b.w + Math.max(x0, x1));
}

/** Himmel aus Farbbändern, zum Horizont schmaler. Nur an jeder Bandgrenze eine Bayer-Kante von D Pixeln. */
function bands(b: Buf, cols: string[], y0: number, y1: number, D: number, x0 = 0, x1 = b.w, curve = 1.45) {
  const N = cols.length, cs = cols.map(C32), bs: number[] = [];
  for (let i = 1; i < N; i++) bs.push(Math.round(y0 + (y1 - y0) * (1 - Math.pow(1 - i / N, curve))));
  const half = D / 2;
  for (let y = Math.max(0, y0); y < Math.min(b.h, y1); y++) {
    let k = 0;
    while (k < bs.length && y >= bs[k]) k++;
    let near = -1;
    for (let j = 0; j < bs.length; j++) if (Math.abs(y + 0.5 - bs[j]) < half) { near = j; break; }
    const row = y * b.w;
    if (near < 0 || D < 2) { b.d.fill(cs[k], row + x0, row + x1); continue; }
    const t = (y + 0.5 - (bs[near] - half)) / D, above = cs[near], below = cs[near + 1];
    for (let x = x0; x < x1; x++) b.d[row + x] = bay(x, y) < t ? below : above;
  }
}
function disc(b: Buf, cx: number, cy: number, r: number, c: number) {
  const R2 = r * r + r * 0.8;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= R2) pset(b, Math.round(cx + x), Math.round(cy + y), c);
}
function ring(b: Buf, cx: number, cy: number, r0: number, r1: number, c: number) {
  const A = r0 * r0 + r0 * 0.8, B = r1 * r1 + r1 * 0.8;
  for (let y = -r1; y <= r1; y++) for (let x = -r1; x <= r1; x++) {
    const d = x * x + y * y;
    if (d > A && d <= B) pset(b, Math.round(cx + x), Math.round(cy + y), c);
  }
}

type RidgeOpts = { c: string; rim?: string; cap?: string; capAbove?: number; rimW?: number; rimAll?: boolean; top?: boolean; base: number; amp: number; f?: number; rough?: number; lx?: number };
/** Grat: Höhenlinie aus Sinus-Summen, darunter gefüllt. Licht-Kante auf der Seite, die zur Lichtquelle zeigt. */
function ridge(b: Buf, R: () => number, o: RidgeOpts) {
  const W = b.w, H = b.h, tops = new Int32Array(W), p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28, f = o.f || 1.5;
  let walk = 0;
  for (let x = 0; x < W; x++) {
    const t = x / Math.max(1, W - 1);
    walk = walk * 0.8 + (R() - 0.5) * (o.rough || 0);
    const v = Math.sin(t * f * 6.283 + p1) * 0.55 + Math.sin(t * f * 2.3 * 6.283 + p2) * 0.3 + Math.sin(t * f * 5.1 * 6.283 + p3) * 0.15 + walk;
    tops[x] = Math.round(H * (o.base + v * o.amp));
  }
  const c = C32(o.c), rim = o.rim ? C32(o.rim) : 0, cap = o.cap ? C32(o.cap) : 0, rimW = o.rimW || 1;
  for (let x = 0; x < W; x++) {
    const y = tops[x];
    if (o.top) { rect(b, x, 0, 1, y, c); if (rim) pset(b, x, y - 1, rim); continue; }
    rect(b, x, y, 1, H - y, c);
    if (cap && o.capAbove && y < H * o.capAbove) rect(b, x, y, 1, Math.round((H * o.capAbove - y) * 0.5) + 1, cap);
    if (rim) {
      const lx = o.lx != null ? o.lx : W / 2;
      const lit = lx > x ? tops[Math.min(W - 1, x + 1)] <= y : tops[Math.max(0, x - 1)] <= y;
      if (lit || o.rimAll) rect(b, x, y, 1, rimW, rim);
    }
  }
  return tops;
}
function pine(b: Buf, x: number, yb: number, h: number, c: string) {
  h = Math.max(3, h);
  const cc = C32(c), tiers = h < 8 ? 2 : 3, th = Math.ceil(h / tiers) + 1;
  rect(b, x, yb - 1, 1, 2, cc);
  const top = yb - 1 - h;
  for (let k = 0; k < tiers; k++) for (let j = 0; j < th; j++) {
    const row = k * (th - 2) + j;
    if (row >= h) break;
    const w = 1 + 2 * Math.floor(j / 1.6) + 2 * k;
    rect(b, x - (w >> 1), top + row, w, 1, cc);
  }
}
function oak(b: Buf, x: number, yb: number, s: number, c: string) {
  const cc = C32(c);
  s = Math.max(1, s);
  rect(b, x - (s >> 1), yb - 3 * s, s, 3 * s + 1, cc);
  const rows = [[2, 3], [1, 5], [0, 7], [0, 7], [1, 5]], top = yb - 3 * s - rows.length * s + s;
  rows.forEach((q, i) => rect(b, x - Math.floor(3.5 * s) + q[0] * s, top + i * s, q[1] * s, s, cc));
}
function scatter(tops: Int32Array, R: () => number, gap: number, fn: (x: number, y: number) => void, x0 = 1, x1 = tops.length - 1) {
  for (let x = x0; x < x1; x += Math.max(1, Math.round(gap * (0.6 + R() * 0.8)))) fn(x, tops[x]);
}
function blockCloud(b: Buf, x: number, y: number, w: number, h: number, c: string, sh: string) {
  const cc = C32(c), ss = C32(sh);
  rect(b, x, y, w, h, cc);
  rect(b, x, y + h - 1, w, 1, ss);
  rect(b, x + Math.round(w * 0.2), y - Math.max(1, Math.round(h * 0.5)), Math.round(w * 0.45), Math.max(1, Math.round(h * 0.5)), cc);
}
function streak(b: Buf, x: number, y: number, len: number, c: string, c2?: string) {
  rect(b, x, y, len, 1, C32(c));
  if (c2) rect(b, x + Math.round(len * 0.15), y + 1, Math.round(len * 0.7), 1, C32(c2));
}

/**
 * Baut eine Szene: Grund (Himmel und unbewegte Teile), Ebenen mit Parallax-Tiefe d (1 hinten bis 4 vorn), Effekte.
 * Variation je Seed (eigene Zufallsfolge V, R bestimmt weiter die Formen): Lage der Lichtquelle, Höhe/Amplitude der hinteren
 * Silhouette, Zahl und Höhe der Wolken, Sternendichte. Bänder und Dithering bleiben unverändert.
 */
function buildScene(bio: Biome, seed: number, W: number, H: number, M: number, sun: SunAnchor = "seed"): Scene {
  const R = rng(hash(bio) ^ Math.imul(seed, 2654435761)), u = H / 100, Rn = (n: number) => Math.max(1, Math.round(n * u));
  const V = rng(hash(bio) ^ Math.imul(seed + 101, 0x85ebca6b)), vj = (a: number) => (V() - 0.5) * 2 * a;
  // Seed-Variante: Lichtquelle auf die andere Seite gespiegelt (nur Poster/Miniaturen)
  const flip = sun === "seed" && V() < 0.45;
  /** x-Anteil einer Lichtquelle; `def` ist ihre Stelle im Mockup. */
  const at = (def: number) => Math.min(0.88, Math.max(0.12, sun === "left" ? 0.35 + V() * 0.2 : sun === "std" ? def + vj(0.03) : (flip ? 1 - def : def) + vj(0.08)));
  const lift = vj(0.05), ampK = 0.75 + V() * 0.6, fK = 0.8 + V() * 0.5, starK = 0.6 + V() * 0.8, clouds = 2 + Math.floor(V() * 3), cloudY = vj(0.06);
  const tiny = H < 26, D = H >= 110 ? 4 : H >= 44 ? 2 : 0, LW = W + 2 * M;
  const base = mkBuf(W, H), layers: Scene["layers"] = [];
  const fx: Fx = { stars: [], parts: [], glints: [], drift: null, torch: null, crystals: [] };
  const L = (d: number, fn: (b: Buf) => void) => { const b = mkBuf(LW, H); fn(b); layers.push({ b, d }); };
  const stars = (n: number, ymax: number, cHi: string, cLo: string) => {
    n = Math.round(n * starK);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(R() * W), y = Math.floor(R() * ymax), hi = R() < 0.3;
      pset(base, x, y, C32(hi ? cHi : cLo));
      if (R() < 0.35) fx.stars.push({ x, y, ph: Math.floor(R() * 16), a: C32(cHi), b: C32(cLo) });
    }
  };
  if (bio === "forest") {
    const hz = Math.round(H * 0.66);
    bands(base, ["#1B2140", "#29305A", "#46386A", "#7A4566", "#B45C5E", "#E08A5E", "#F5BE82"], 0, hz, D);
    rect(base, 0, hz, W, H - hz, C32("#F5BE82"));
    if (!tiny) stars(Math.round((W * H) / 700), hz * 0.32, "#EDE8FF", "#8F8CB8");
    const sx = Math.round(W * at(0.7)), sy = Math.round(H * (0.43 + V() * 0.08)), sr = Rn(8), lx = M + sx;
    ring(base, sx, sy, sr, sr + Rn(2), C32("#FAD39A"));
    disc(base, sx, sy, sr, C32("#FFEBC0"));
    if (!tiny) {
      rect(base, sx - sr - Rn(3), sy - Math.round(sr * 0.15), sr * 2 + Rn(6), 1, C32("#F0A56C"));
      rect(base, sx - sr - Rn(5), sy + Math.round(sr * 0.4), sr * 2 + Rn(10), Math.max(1, Rn(0.8)), C32("#F0A56C"));
      const cl = mkBuf(W, H);
      for (let i = 0; i < clouds; i++) streak(cl, Math.floor(R() * W), Math.round(hz * (0.4 + cloudY + i * 0.12)), Rn(26 + R() * 30), "#8E4C68", "#B05A64");
      fx.drift = { b: cl, speed: 6 };
    }
    L(1, (b) => void ridge(b, R, { c: "#70506F", rim: "#C27678", base: 0.56 + lift, amp: 0.09 * ampK, f: 1.2 * fK, rough: 0.02, lx }));
    L(2, (b) => { const t = ridge(b, R, { c: "#45355C", base: 0.69, amp: 0.035, f: 2 }); if (!tiny) scatter(t, R, Rn(3), (x, y) => pine(b, x, y + 1, Rn(5 + R() * 3), "#45355C")); });
    L(3, (b) => { const t = ridge(b, R, { c: "#241F3A", base: 0.81, amp: 0.03, f: 2.6 }); scatter(t, R, Rn(4.5), (x, y) => pine(b, x, y + 1, Rn(9 + R() * 6), "#241F3A")); });
    L(4, (b) => {
      const t = ridge(b, R, { c: "#0E0F1C", base: 0.94, amp: 0.02, f: 1.6 });
      if (!tiny) {
        pine(b, M + Rn(6), t[M + Rn(6)] + 1, Rn(26), "#0E0F1C");
        pine(b, M + W - Rn(10), t[M + W - Rn(10)] + 1, Rn(30), "#0E0F1C");
        pine(b, M + W - Rn(22), t[M + W - Rn(22)] + 1, Rn(20), "#0E0F1C");
      }
    });
  } else if (bio === "nether") {
    bands(base, ["#1A0708", "#2A0A0B", "#420F0E", "#651912", "#8E2716"], 0, Math.round(H * 0.78), D, 0, W, 1.2);
    rect(base, 0, Math.round(H * 0.78), W, H, C32("#8E2716"));
    L(1, (b) => {
      const t = ridge(b, R, { c: "#3E110E", rim: "#A2381A", rimAll: true, base: 0.56 + lift, amp: 0.1 * ampK, f: 1.7 * fK, rough: 0.05 });
      if (!tiny) scatter(t, R, Rn(16), (x, y) => { const h = Rn(8 + R() * 10), w = Rn(2 + R() * 2); rect(b, x, y - h, w, h + 1, C32("#2A0B0A")); rect(b, x, y - h, 1, h, C32("#6A1E10")); });
    });
    L(2, (b) => {
      const t = ridge(b, R, { top: true, c: "#140506", rim: "#4A130E", base: 0.12, amp: 0.08, f: 2.4, rough: 0.08 });
      if (!tiny) scatter(t, R, Rn(7), (x, y) => { const len = Rn(3 + R() * 10); for (let i = 0; i < len; i++) { const w = Math.max(1, Math.round((len - i) / 3)); rect(b, x - (w >> 1), y + i, w, 1, C32("#140506")); } });
    });
    L(3, (b) => {
      const y0 = Math.round(H * 0.8);
      bands(b, ["#FFD06A", "#FF9A3C", "#E0621C", "#A83A14"], y0, b.h, D ? 2 : 0, 0, b.w, 1.1);
      if (!tiny) for (let i = 0; i < Math.round(W / 9); i++) {
        const y = y0 + 1 + Math.floor(R() * (H - y0 - 1)), x = Math.floor(R() * b.w), w = Rn(2 + R() * 6);
        rect(b, x, y, w, 1, C32(R() < 0.5 ? "#FFE39A" : "#B8441A"));
        fx.glints.push({ x: x - M, y, w, ph: Math.floor(R() * 12), c: C32("#FFE39A"), c2: C32("#FF9A3C") });
      }
    });
    L(4, (b) => {
      const t = ridge(b, R, { c: "#0B0304", base: 0.96, amp: 0.03, f: 2, rough: 0.06 });
      if (!tiny) [M + Rn(8), M + W - Rn(14)].forEach((x, i) => { const h = Rn(30 + i * 8), w = Rn(7); rect(b, x, t[x] - h, w, h + 2, C32("#0B0304")); rect(b, x - 1, t[x] - h, w + 2, Rn(2), C32("#0B0304")); });
    });
    if (!tiny) for (let i = 0; i < Math.round(W / 7); i++) fx.parts.push({ x: Math.floor(R() * W), y: Math.floor(H * (0.3 + R() * 0.6)), v: 0.5 + R() * 0.8, ph: Math.floor(R() * 40), c: C32(R() < 0.5 ? "#FFB347" : "#FF6A2A"), up: true, top: H * 0.2, bot: H * 0.82 });
  } else if (bio === "end") {
    bands(base, ["#07060D", "#0C0A17", "#141029", "#1F1838", "#2C2250"], 0, Math.round(H * 0.74), D, 0, W, 1.25);
    rect(base, 0, Math.round(H * 0.74), W, H, C32("#2C2250"));
    if (!tiny) stars(Math.round((W * H) / 260), H * 0.75, "#EDE6C9", "#6E6A58");
    // Links verankert oder Seed-Spiegelung: Säulen links, helle Insel links der Mitte
    const fl = sun === "left" || flip, mx = (p: number, w = 0) => (fl ? 1 - p - w : p);
    L(1, (b) => {
      const cx = M + W * mx(0.3), hw = W * 0.3, top = Math.round(H * (0.62 + lift * 0.5));
      for (let x = Math.floor(cx - hw); x < cx + hw; x++) {
        const k = 1 - Math.pow((x - cx) / hw, 2);
        if (k <= 0) continue;
        rect(b, x, top - Math.round(k * H * 0.025), 1, Math.round(k * H * 0.1), C32("#3A3160"));
        rect(b, x, top - Math.round(k * H * 0.025), 1, 1, C32("#6E6594"));
      }
    });
    L(2, (b) => {
      const floor = Math.round(H * 0.7);
      ([[0.52, 0.22, 7], [0.63, 0.1, 8], [0.74, 0.3, 7], [0.84, 0.16, 8], [0.94, 0.36, 6]] as const).forEach(([px, py, w], i) => {
        const x = Math.round(M + W * mx(px, 0.06)), top = Math.round(H * (py + lift)), pw = Rn(w);
        rect(b, x, top, pw, floor - top + 2, C32("#08060F"));
        rect(b, x + pw - Math.max(1, Rn(1.2)), top, Math.max(1, Rn(1.2)), floor - top, C32("#241C3E"));
        const cr = Math.max(1, Rn(1.5));
        rect(b, x + (pw >> 1) - (cr >> 1), top - cr - 1, cr, cr, C32("#C79BFF"));
        fx.crystals.push({ x: x + (pw >> 1) - (cr >> 1) - M, y: top - cr - 1, s: cr, ph: i * 3 });
      });
    });
    L(3, (b) => {
      const cx = M + W * (sun === "left" ? 0.45 : mx(0.62)), hw = W * 0.6, top = Math.round(H * 0.68), cols = ["#DCD394", "#B3AC7A", "#8A845C", "#5E5A40", "#3B3828"].map(C32);
      for (let x = Math.floor(cx - hw); x < cx + hw; x++) {
        const k = 1 - Math.pow((x - cx) / hw, 2);
        if (k <= 0) continue;
        const depth = Math.round(k * H * 0.3) + 1, t0 = top + Math.round((1 - k) * H * 0.02);
        for (let y = 0; y < depth; y++) pset(b, x, t0 + y, cols[Math.min(4, Math.floor(y / Math.max(1, Rn(2.2))))]);
      }
    });
    L(4, (b) => void ridge(b, R, { c: "#050407", base: 0.985, amp: 0.03, f: 1.3 }));
    if (!tiny) for (let i = 0; i < Math.round(W / 16); i++) fx.parts.push({ x: Math.floor(R() * W), y: Math.floor(R() * H), v: 0.25 + R() * 0.3, ph: Math.floor(R() * 40), c: C32(R() < 0.5 ? "#8A5CD0" : "#C79BFF"), up: true, top: 0, bot: H });
  } else if (bio === "snow") {
    const hz = Math.round(H * 0.62);
    bands(base, ["#2A3764", "#44568C", "#7C7DB0", "#B994AE", "#E8B4A6", "#F9D8BE"], 0, hz, D);
    rect(base, 0, hz, W, H - hz, C32("#F9D8BE"));
    if (!tiny) stars(Math.round((W * H) / 1400), hz * 0.25, "#FFFFFF", "#8E9BC8");
    const sx = Math.round(W * at(0.3)), sy = hz - Rn(3 + V() * 12), sr = Rn(6);
    ring(base, sx, sy, sr, sr + Rn(2), C32("#FFE6D2"));
    disc(base, sx, sy, sr, C32("#FFF6E6"));
    L(1, (b) => void ridge(b, R, { c: "#8A96C2", rim: "#F6D6CC", rimW: Math.max(1, Rn(0.8)), cap: "#EEF2FA", capAbove: 0.5, base: 0.52 + lift, amp: 0.15 * ampK, f: 1.05 * fK, rough: 0.03, lx: M + sx }));
    L(2, (b) => { const t = ridge(b, R, { c: "#C3CDE5", base: 0.67, amp: 0.04, f: 2 }); if (!tiny) scatter(t, R, Rn(5), (x, y) => pine(b, x, y + 1, Rn(4 + R() * 3), "#6B7CA6")); });
    L(3, (b) => { const t = ridge(b, R, { c: "#E1E9F5", base: 0.8, amp: 0.03, f: 2.4 }); scatter(t, R, Rn(7), (x, y) => pine(b, x, y + 1, Rn(8 + R() * 6), "#34466E")); });
    L(4, (b) => {
      const t = ridge(b, R, { c: "#F6F9FF", base: 0.94, amp: 0.02, f: 1.5 });
      if (!tiny) { pine(b, M + W - Rn(10), t[M + W - Rn(10)] + 1, Rn(30), "#18223E"); pine(b, M + W - Rn(24), t[M + W - Rn(24)] + 1, Rn(20), "#18223E"); }
    });
    if (!tiny) for (let i = 0; i < Math.round((W * H) / 500); i++) fx.parts.push({ x: Math.floor(R() * W), y: Math.floor(R() * H), v: 0.4 + R() * 0.7, ph: Math.floor(R() * 40), c: C32(R() < 0.6 ? "#FFFFFF" : "#D6E0F4"), up: false, top: 0, bot: H });
  } else if (bio === "cave") {
    bands(base, ["#0B1019", "#111826", "#172133", "#1D2940"], 0, H, D, 0, W, 1);
    const sx0 = W * (0.56 + vj(0.1)), sw = W * 0.12;
    for (let y = 0; y < H * 0.9; y++) {
      const x0 = Math.round(sx0 - y * 0.35), w = Math.round(sw + y * 0.08);
      rect(base, x0, y, w, 1, C32("#22314A"));
      rect(base, x0 + Math.round(w * 0.3), y, Math.round(w * 0.4), 1, C32("#2B3D5A"));
    }
    const tx = Math.round(W * at(0.3)), ty = Math.round(H * 0.78);
    if (!tiny) ([[Rn(24), "#1E2126"], [Rn(17), "#2A2622"], [Rn(10), "#3A2C1E"]] as const).forEach(([r, c]) => disc(base, tx, ty - Rn(4), r, C32(c)));
    L(1, (b) => {
      ridge(b, R, { c: "#0F1622", base: 0.84 + lift * 0.5, amp: 0.05 * ampK, f: 1.8 * fK });
      if (!tiny) for (let i = 0; i < Math.round(W / 10); i++) {
        const x = Math.floor(R() * b.w), y = Math.floor(H * (0.25 + R() * 0.45)), c = R() < 0.5 ? "#7FDFE8" : "#E0B25A", s = Math.max(1, Rn(1));
        rect(b, x, y, s, s, C32(c));
        fx.stars.push({ x: x - M, y, ph: Math.floor(R() * 16), a: C32("#FFFFFF"), b: C32(c), s });
      }
    });
    L(2, (b) => {
      const t = ridge(b, R, { top: true, c: "#0B1019", rim: "#243249", base: 0.16, amp: 0.09, f: 2.2, rough: 0.08 });
      if (!tiny) scatter(t, R, Rn(6), (x, y) => { const len = Rn(3 + R() * 9); for (let i = 0; i < len; i++) { const w = Math.max(1, Math.round((len - i) / 2.5)); rect(b, x - (w >> 1), y + i, w, 1, C32("#0B1019")); } });
    });
    L(3, (b) => {
      const t = ridge(b, R, { c: "#0A0F17", rim: "#1E2A3D", rimAll: true, base: 0.82, amp: 0.05, f: 2.4, rough: 0.05 });
      if (!tiny) {
        scatter(t, R, Rn(12), (x, y) => { const len = Rn(3 + R() * 7); for (let i = 0; i < len; i++) { const w = Math.max(1, Math.round((len - i) / 2.5)); rect(b, x - (w >> 1), y - i, w, 1, C32("#0A0F17")); } });
        const X = tx + M, s = Math.max(1, Rn(1.2));
        rect(b, X, ty - Rn(7), s, Rn(8), C32("#5A3D26"));
        fx.torch = { x: tx, y: ty - Rn(7), s };
      }
    });
    L(4, (b) => { ridge(b, R, { c: "#06090E", base: 0.95, amp: 0.04, f: 1.7, rough: 0.06 }); ridge(b, R, { top: true, c: "#06090E", base: 0.03, amp: 0.04, f: 2.8 }); });
  } else if (bio === "sea") {
    const hz = Math.round(H * 0.6);
    bands(base, ["#13284A", "#223F68", "#3A6488", "#7F8298", "#C98F7E", "#F2C69A"], 0, hz, D);
    if (!tiny) stars(Math.round((W * H) / 1600), hz * 0.25, "#FFFFFF", "#7C8DB0");
    const sx = Math.round(W * at(0.64)), sr = Rn(8), left = sx < W / 2;
    ring(base, sx, hz, sr, sr + Rn(2), C32("#FFD8A0"));
    disc(base, sx, hz, sr, C32("#FFEBC2"));
    bands(base, ["#6B8398", "#2F6A84", "#1F5470", "#143E55", "#0B2A3C"], hz, H, D ? 2 : 0, 0, W, 1.3);
    rect(base, 0, hz, W, 1, C32("#F2C69A"));
    if (!tiny) for (let y = hz + 2; y < H; y += Math.max(2, Rn(2.2))) {
      const t = (y - hz) / (H - hz), hw = Math.round(sr * (1.4 - t * 0.6) + R() * Rn(3));
      for (let s = 0; s < 2; s++) {
        const w = Math.max(1, Math.round(hw * (0.3 + R() * 0.5))), x = sx + Math.round((R() - 0.5) * hw * 2);
        rect(base, x, y, w, 1, C32(t < 0.4 ? "#FFDCA0" : "#E7A77A"));
        fx.glints.push({ x, y, w, ph: Math.floor(R() * 12), c: C32("#FFF0C8"), c2: C32(t < 0.4 ? "#FFDCA0" : "#E7A77A"), base: true });
      }
    }
    if (!tiny) {
      const cl = mkBuf(W, H);
      for (let i = 0; i < clouds; i++) streak(cl, Math.floor(R() * W), Math.round(hz * (0.33 + cloudY + i * 0.14)), Rn(24 + R() * 26), "#6F7894", "#D39C84");
      fx.drift = { b: cl, speed: 7 };
    }
    L(2, (b) => {
      // Insel und Klippe auf der Seite gegenüber der Sonne
      const ix = Math.round(M + W * (left ? 0.84 : 0.16)), iw = Rn(34);
      for (let k = 0; k < Rn(6); k++) rect(b, ix - (iw >> 1) + k * 2, hz - k - 1, iw - k * 4, 1, C32("#173247"));
      if (!tiny) {
        rect(b, ix + Rn(4), hz - Rn(14), Rn(2), Rn(10), C32("#173247"));
        rect(b, ix + Rn(3.5), hz - Rn(15), Rn(3), Rn(1.4), C32("#173247"));
        rect(b, ix + Rn(4), hz - Rn(13), Rn(2), Math.max(1, Rn(1)), C32("#F4D68A"));
      }
    });
    L(4, (b) => {
      const w0 = Math.round(W * 0.34);
      let y = H;
      for (let k = 0; k < 7; k++) {
        const w = Math.round(w0 * (1 - k * 0.12)) + M, h = Rn(4 + k * 0.5);
        y -= h;
        rect(b, left ? b.w - w : 0, y, w, H - y, C32("#06141C"));
        rect(b, left ? b.w - w : w - Rn(1.5), y, Rn(1.5), 1, C32("#16303C"));
      }
    });
  } else {
    const hz = Math.round(H * 0.64);
    bands(base, ["#3C6FB4", "#5486C8", "#77A3DC", "#A4C4E8", "#D2E3F0"], 0, hz, D);
    rect(base, 0, hz, W, H - hz, C32("#D2E3F0"));
    const s = Rn(7), sx = Math.round(W * at(0.74)), sy = Math.round(hz * (0.14 + V() * 0.2));
    rect(base, sx - 1, sy - 1, s + 2, s + 2, C32("#FFF0B8"));
    rect(base, sx, sy, s, s, C32("#FFFBEA"));
    if (!tiny) {
      const cl = mkBuf(W, H);
      for (let i = 0; i <= clouds; i++) blockCloud(cl, Math.floor(R() * W), Math.round(hz * (0.16 + cloudY + i * 0.15)), Rn(16 + R() * 18), Math.max(2, Rn(3)), "#F4F8FF", "#C9D8EA");
      fx.drift = { b: cl, speed: 5 };
    }
    L(1, (b) => void ridge(b, R, { c: "#9BB5C9", rim: "#C6D8E6", base: 0.62 + lift * 0.6, amp: 0.05 * ampK, f: 1.4 * fK, lx: M + sx }));
    L(2, (b) => { const t = ridge(b, R, { c: "#6E9481", base: 0.71, amp: 0.045, f: 2 }); if (!tiny) scatter(t, R, Rn(18), (x, y) => oak(b, x, y + 1, Math.max(1, Rn(0.9)), "#587B6A")); });
    L(3, (b) => { const t = ridge(b, R, { c: "#4A735F", base: 0.81, amp: 0.035, f: 2.3 }); if (!tiny) scatter(t, R, Rn(22), (x, y) => oak(b, x, y + 1, Math.max(1, Rn(1.4)), "#3A5E4C")); });
    L(4, (b) => { const t = ridge(b, R, { c: "#22392F", base: 0.94, amp: 0.02, f: 1.5 }); if (!tiny) oak(b, M + W - Rn(16), t[M + W - Rn(16)] + 1, Math.max(1, Rn(3)), "#1B2E25"); });
  }
  return { W, H, M, base, layers, fx };
}

/** Bild zusammensetzen: Grund, Wolkenband, Ebenen mit ganzzahligem Versatz, Effekte. k = Takt (12 pro Sekunde). */
function compose(sc: Scene, out: Buf, k: number, ox: number) {
  const { W, H, M, fx } = sc, o = out.d;
  o.set(sc.base.d);
  if (fx.drift) {
    const cb = fx.drift.b.d, off = Math.floor(k / fx.drift.speed) % W;
    for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W; x++) { const v = cb[r + ((x + off) % W)]; if (v) o[r + x] = v; } }
  }
  for (const g of fx.glints) if (g.base) rect(out, g.x, g.y, g.w, 1, (k + g.ph) % 12 < 3 ? g.c : g.c2);
  for (const l of sc.layers) {
    const lb = l.b.d, LW = l.b.w, dx = M - Math.round(ox * l.d);
    for (let y = 0; y < H; y++) { const r = y * LW + dx, orow = y * W; for (let x = 0; x < W; x++) { const v = lb[r + x]; if (v) o[orow + x] = v; } }
  }
  for (const s of fx.stars) if ((k + s.ph) % 16 < 2) rect(out, s.x, s.y, s.s || 1, s.s || 1, s.a);
  for (const g of fx.glints) if (!g.base && (k + g.ph) % 12 < 3) rect(out, g.x, g.y, g.w, 1, g.c);
  for (const c of fx.crystals) rect(out, c.x, c.y, c.s, c.s, C32((k + c.ph) % 18 < 9 ? "#E2C8FF" : "#C79BFF"));
  if (fx.torch) {
    const t = fx.torch, fl = (k >> 1) % 3, s = t.s;
    rect(out, t.x - s, t.y - 3 * s - (fl === 1 ? s : 0), s * 3, s * 3 + (fl === 1 ? s : 0), C32("#FFB454"));
    rect(out, t.x, t.y - 2 * s, s, s * 2, C32("#FFF2C2"));
  }
  for (const p of fx.parts) {
    const span = Math.max(1, p.bot - p.top);
    const y = p.up ? p.bot - ((p.bot - p.y + Math.floor(k * p.v)) % span) : p.top + ((p.y - p.top + Math.floor(k * p.v)) % span);
    const x = (p.x + Math.round(Math.sin((k + p.ph) * 0.15) * 2) + W) % W;
    rect(out, x, Math.round(y), 1, 1, p.c);
  }
}

// ---------- Laufzeit: Canvas in Boxen, ganzzahlig skaliert, zentriert, unten verankert ----------

const RM = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const gate = { motion: true, game: false };

/** Pausen: Spiel startet/läuft, Fenster verborgen, „Bewegte Szenen“ aus, reduzierte Bewegung. */
export function setSceneGate(patch: Partial<typeof gate>) {
  Object.assign(gate, patch);
}
export const motionOff = () => !!RM?.matches || !gate.motion;
const paused = () => document.hidden || motionOff() || gate.game;

const STATIC_CACHE = new Map<string, ImageData>();
const LIVE = new Set<SceneHost>();
const PTR = { x: 0, cx: 0 };
let TICK = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function ensureTicker() {
  if (timer || !LIVE.size) return;
  timer = setInterval(() => {
    if (!LIVE.size) { clearInterval(timer); timer = undefined; return; }
    TICK++;
    for (const host of LIVE) {
      if (host.trans) { host.draw(host.k); continue; }
      if (paused()) continue;
      if (host.hero) PTR.cx += (PTR.x - PTR.cx) * 0.35;
      host.draw(TICK);
    }
  }, 1000 / 12);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => { PTR.x = Math.max(-1, Math.min(1, (e.clientX / innerWidth - 0.5) * 2)); }, { passive: true });
}

export class SceneHost {
  el: HTMLElement;
  cv: HTMLCanvasElement;
  bio: Biome;
  seed: number;
  mode: SceneMode;
  sun: SunAnchor | undefined;
  key = "";
  k = 0;
  hero = false;
  trans: { old: Uint32Array; step: number } | null = null;
  private sc: Scene | null = null;
  private img: ImageData | null = null;
  private out: Buf | null = null;
  private g: CanvasRenderingContext2D;

  constructor(el: HTMLElement, bio: Biome, seed: number, mode: SceneMode, sun?: SunAnchor) {
    this.el = el;
    this.bio = bio;
    this.seed = seed;
    this.mode = mode;
    this.sun = sun;
    this.cv = document.createElement("canvas");
    this.cv.setAttribute("aria-hidden", "true");
    el.appendChild(this.cv);
    this.g = this.cv.getContext("2d")!;
  }

  get anim() {
    return this.mode !== "flat";
  }

  paint(force = false) {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    const W = Math.ceil(w / PX.css), H = Math.ceil(h / PX.css);
    const sun = sunFor(this.mode, this.sun);
    const key = [this.bio, this.seed, W, H, this.mode, sun, PX.css].join("|");
    if (!force && key === this.key) return;
    this.key = key;
    this.el.style.setProperty("--scene-bg", BIOMES[this.bio].bg);
    const cv = this.cv;
    cv.width = W;
    cv.height = H;
    const cw = W * PX.css, ch = H * PX.css;
    cv.style.width = `${cw}px`;
    cv.style.height = `${ch}px`;
    cv.style.left = `${snap((w - cw) / 2)}px`;
    cv.style.top = `${snap(h - ch)}px`;
    this.hero = this.mode === "hero";
    if (this.anim) {
      this.sc = buildScene(this.bio, this.seed, W, H, this.hero ? 4 : 0, sun);
      this.img = this.g.createImageData(W, H);
      this.out = { w: W, h: H, d: new Uint32Array(this.img.data.buffer) };
      LIVE.add(this);
      ensureTicker();
      this.draw(TICK);
    } else {
      const ck = [this.bio, this.seed, W, H, sun].join("|");
      let src = STATIC_CACHE.get(ck);
      if (!src) {
        const s2 = buildScene(this.bio, this.seed, W, H, 0, sun);
        src = new ImageData(W, H);
        compose(s2, { w: W, h: H, d: new Uint32Array(src.data.buffer) }, 0, 0);
        if (STATIC_CACHE.size > 160) STATIC_CACHE.clear();
        STATIC_CACHE.set(ck, src);
      }
      this.g.putImageData(src, 0, 0);
    }
  }

  draw(k: number) {
    if (!this.sc || !this.out || !this.img) return;
    this.k = k;
    compose(this.sc, this.out, k, this.hero ? Math.round(PTR.cx) : 0);
    if (this.trans) {
      const t = this.trans, thr = (t.step + 1) / 8, W = this.out.w, d = this.out.d, o = t.old;
      if (o.length === d.length) for (let y = 0; y < this.out.h; y++) for (let x = 0; x < W; x++) if (bay(x, y) >= thr) d[y * W + x] = o[y * W + x];
      t.step++;
      if (t.step >= 8) this.trans = null;
    }
    this.g.putImageData(this.img, 0, 0);
  }

  /** Neues Biom oder Seed. Belebte Szenen wechseln per Bayer-Auflösung in 8 Schritten. */
  set(bio: Biome, seed: number, mode: SceneMode, sun?: SunAnchor) {
    if (bio === this.bio && seed === this.seed && mode === this.mode && sun === this.sun) return;
    const old = this.anim && this.out && !motionOff() && mode === this.mode ? new Uint32Array(this.out.d) : null;
    this.bio = bio;
    this.seed = seed;
    this.sun = sun;
    if (mode !== this.mode) { LIVE.delete(this); this.sc = null; }
    this.mode = mode;
    this.paint(true);
    if (old && this.out && this.out.d.length === old.length) {
      this.trans = { old, step: 0 };
      this.draw(this.k);
    }
  }

  dispose() {
    LIVE.delete(this);
    this.cv.remove();
  }
}
