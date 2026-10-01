/** Zeichenwerkzeuge für Szenen: Pixelpuffer, Farbbänder, Scheiben, Grate und Bäume. Alles in Welt-Pixeln. */

export type Buf = { w: number; h: number; d: Uint32Array };

const BAYER_SIZE = 4;
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** Bayer-Schwelle (0 bis 1) für das Pixel an (x, y). */
export const bayer = (x: number, y: number) => BAYER_4X4[((y % BAYER_SIZE) * BAYER_SIZE) + (x % BAYER_SIZE)];

/** Weniger Rundung bei kleinen Radien: Scheiben und Ringe wirken so voller. */
const EDGE_BIAS = 0.8;
/** Zwei verschiedene Näherungen von 2π, bewusst nicht vereinheitlicht: Jede Änderung verschiebt die Grate aller Szenen. */
const WAVE_TAU = 6.283;
const PHASE_SPAN = 6.28;

const abgrCache = new Map<string, number>();
/** #RRGGBB als ABGR-Wort für ImageData (Little Endian). */
export const abgr = (hex: string) => {
  let word = abgrCache.get(hex);
  if (word == null) {
    const channel = (from: number) => parseInt(hex.slice(from, from + 2), 16);
    word = (0xff000000 | (channel(5) << 16) | (channel(3) << 8) | channel(1)) >>> 0;
    abgrCache.set(hex, word);
  }
  return word;
};

export const createBuf = (w: number, h: number): Buf => ({ w, h, d: new Uint32Array(Math.max(1, w * h)) });

export function setPixel(b: Buf, x: number, y: number, color: number) {
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.d[y * b.w + x] = color;
}

export function rect(b: Buf, x: number, y: number, w: number, h: number, color: number) {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(b.w, (x + w) | 0), y1 = Math.min(b.h, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) b.d.fill(color, yy * b.w + x0, yy * b.w + Math.max(x0, x1));
}

type BandsOpts = { colors: string[]; from: number; to: number; dither: number; curve?: number };

/** y-Grenzen der Bänder: je Band schmaler zum Horizont (`curve` bestimmt, wie stark). */
function bandEdges(colorCount: number, from: number, to: number, curve: number) {
  const edges: number[] = [];
  for (let i = 1; i < colorCount; i++) edges.push(Math.round(from + (to - from) * (1 - Math.pow(1 - i / colorCount, curve))));
  return edges;
}

/** Himmel aus Farbbändern, zum Horizont schmaler. Nur an jeder Bandgrenze eine Bayer-Kante von `dither` Pixeln. */
export function bands(b: Buf, { colors, from, to, dither, curve = 1.45 }: BandsOpts) {
  const palette = colors.map(abgr), edges = bandEdges(colors.length, from, to, curve), half = dither / 2;
  for (let y = Math.max(0, from); y < Math.min(b.h, to); y++) {
    const band = edges.filter((edge) => y >= edge).length;
    const nearEdge = edges.findIndex((edge) => Math.abs(y + 0.5 - edge) < half);
    const row = y * b.w;
    if (nearEdge < 0 || dither < 2) { b.d.fill(palette[band], row, row + b.w); continue; }
    const t = (y + 0.5 - (edges[nearEdge] - half)) / dither, above = palette[nearEdge], below = palette[nearEdge + 1];
    for (let x = 0; x < b.w; x++) b.d[row + x] = bayer(x, y) < t ? below : above;
  }
}

export function disc(b: Buf, cx: number, cy: number, r: number, color: number) {
  const limit = r * r + r * EDGE_BIAS;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y <= limit) setPixel(b, Math.round(cx + x), Math.round(cy + y), color);
  }
}

export function ring(b: Buf, cx: number, cy: number, innerR: number, outerR: number, color: number) {
  const inner = innerR * innerR + innerR * EDGE_BIAS, outer = outerR * outerR + outerR * EDGE_BIAS;
  for (let y = -outerR; y <= outerR; y++) for (let x = -outerR; x <= outerR; x++) {
    const dist = x * x + y * y;
    if (dist > inner && dist <= outer) setPixel(b, Math.round(cx + x), Math.round(cy + y), color);
  }
}

type RidgeOpts = {
  c: string; rim?: string; cap?: string; capAbove?: number; rimW?: number; rimAll?: boolean; top?: boolean;
  base: number; amp: number; f?: number; rough?: number; lx?: number;
};

/** Teilwellen eines Grats: Frequenzfaktor und Gewicht (Summe 1). */
const RIDGE_WAVES = [{ freq: 1, weight: 0.55 }, { freq: 2.3, weight: 0.3 }, { freq: 5.1, weight: 0.15 }];
const RIDGE_WALK_DECAY = 0.8;

/** Höhenlinie eines Grats in Pixeln je Spalte: Sinus-Summe plus optional ein verrauschter Zufallsgang. */
function ridgeHeights(w: number, h: number, rand: () => number, o: RidgeOpts) {
  const phases = RIDGE_WAVES.map(() => rand() * PHASE_SPAN), f = o.f || 1.5, tops = new Int32Array(w);
  let walk = 0;
  for (let x = 0; x < w; x++) {
    const t = x / Math.max(1, w - 1);
    walk = walk * RIDGE_WALK_DECAY + (rand() - 0.5) * (o.rough || 0);
    let v = 0;
    RIDGE_WAVES.forEach(({ freq, weight }, i) => { v += Math.sin(t * f * freq * WAVE_TAU + phases[i]) * weight; });
    tops[x] = Math.round(h * (o.base + (v + walk) * o.amp));
  }
  return tops;
}

/** Grat: Höhenlinie aus Sinus-Summen, darunter gefüllt. Licht-Kante auf der Seite, die zur Lichtquelle zeigt. */
export function ridge(b: Buf, rand: () => number, o: RidgeOpts) {
  const W = b.w, H = b.h, tops = ridgeHeights(W, H, rand, o);
  const c = abgr(o.c), rim = o.rim ? abgr(o.rim) : 0, cap = o.cap ? abgr(o.cap) : 0, rimW = o.rimW || 1;
  for (let x = 0; x < W; x++) {
    const y = tops[x];
    if (o.top) { rect(b, x, 0, 1, y, c); if (rim) setPixel(b, x, y - 1, rim); continue; }
    rect(b, x, y, 1, H - y, c);
    if (cap && o.capAbove && y < H * o.capAbove) rect(b, x, y, 1, Math.round((H * o.capAbove - y) * 0.5) + 1, cap);
    if (rim) {
      const lightX = o.lx != null ? o.lx : W / 2;
      const lit = lightX > x ? tops[Math.min(W - 1, x + 1)] <= y : tops[Math.max(0, x - 1)] <= y;
      if (lit || o.rimAll) rect(b, x, y, 1, rimW, rim);
    }
  }
  return tops;
}

/** Kiefer: Stamm und 2 bis 3 Stufen. Der Fuß sitzt ein Pixel im Boden (`ground` = Oberkante des Bodens). */
export function pine(b: Buf, x: number, ground: number, height: number, color: string) {
  const h = Math.max(3, height), c = abgr(color), tiers = h < 8 ? 2 : 3, tierH = Math.ceil(h / tiers) + 1, footY = ground + 1;
  rect(b, x, footY - 1, 1, 2, c);
  const top = footY - 1 - h;
  for (let k = 0; k < tiers; k++) for (let j = 0; j < tierH; j++) {
    const row = k * (tierH - 2) + j;
    if (row >= h) break;
    const w = 1 + 2 * Math.floor(j / 1.6) + 2 * k;
    rect(b, x - (w >> 1), top + row, w, 1, c);
  }
}

/** Kiefer auf dem Grat `tops` an der Spalte `x`. */
export const pineAt = (b: Buf, tops: Int32Array, x: number, height: number, color: string) => pine(b, x, tops[x], height, color);

/** Kronenzeilen der Eiche: [Einzug, Breite] in Einheiten von `s`. */
const OAK_CROWN = [[2, 3], [1, 5], [0, 7], [0, 7], [1, 5]];

export function oak(b: Buf, x: number, ground: number, size: number, color: string) {
  const c = abgr(color), s = Math.max(1, size), footY = ground + 1;
  rect(b, x - (s >> 1), footY - 3 * s, s, 3 * s + 1, c);
  const top = footY - 3 * s - OAK_CROWN.length * s + s;
  OAK_CROWN.forEach(([inset, width], i) => rect(b, x - Math.floor(3.5 * s) + inset * s, top + i * s, width * s, s, c));
}

/** Ruft `fn` in zufälligen Abständen (um `gap` herum) entlang des Grats auf. */
export function scatter(tops: Int32Array, rand: () => number, gap: number, fn: (x: number, y: number) => void) {
  for (let x = 1; x < tops.length - 1; x += Math.max(1, Math.round(gap * (0.6 + rand() * 0.8)))) fn(x, tops[x]);
}

/** Zacke (Stalaktit nach unten mit `dir` 1, Stalagmit nach oben mit -1): Zeile für Zeile schmaler, `taper` Zeilen je Pixel Breite. */
export function spike(b: Buf, x: number, y: number, len: number, taper: number, dir: 1 | -1, color: string) {
  const c = abgr(color);
  for (let i = 0; i < len; i++) {
    const w = Math.max(1, Math.round((len - i) / taper));
    rect(b, x - (w >> 1), y + dir * i, w, 1, c);
  }
}

export function blockCloud(b: Buf, x: number, y: number, w: number, h: number, color: string, shade: string) {
  const c = abgr(color), s = abgr(shade), bumpH = Math.max(1, Math.round(h * 0.5));
  rect(b, x, y, w, h, c);
  rect(b, x, y + h - 1, w, 1, s);
  rect(b, x + Math.round(w * 0.2), y - bumpH, Math.round(w * 0.45), bumpH, c);
}

export function streak(b: Buf, x: number, y: number, len: number, color: string, underColor: string) {
  rect(b, x, y, len, 1, abgr(color));
  rect(b, x + Math.round(len * 0.15), y + 1, Math.round(len * 0.7), 1, abgr(underColor));
}
