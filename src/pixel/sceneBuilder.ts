/**
 * Szenen-Aufbau (reines TS, Canvas).
 * Pixel-Art statt Filter: ruhige Farbbänder (4 bis 7 pro Biom), klare Silhouetten in 3 bis 4 Ebenen,
 * Dithering nur als schmale Bayer-Kante zwischen zwei Bändern (2 bis 4 Welt-Pixel), nie flächig.
 * Tiefe über Luftperspektive: hintere Ebenen liegen farblich nah am Horizont, vordere fast schwarz.
 *
 * Die Reihenfolge der Zufallsaufrufe ist Teil des Bildes: Wer sie ändert, ändert jede Szene.
 */
import { hash, rng } from "./random";
import {
  abgr, bands, createBuf, disc, oak, pine, pineAt, puffCloud, rect, ridge, ring, scatter, setPixel, spike, streak, type Buf,
} from "./raster";
import type { Biome, SunAnchor } from "./sceneConfig";

type Star = { x: number; y: number; ph: number; twinkle: number; size?: number };
type Glint = { x: number; y: number; w: number; ph: number; bright: number; dim: number; base?: boolean };
type Particle = { x: number; y: number; speed: number; ph: number; color: number; rising: boolean; top: number; bottom: number };
type Fx = {
  stars: Star[]; particles: Particle[]; glints: Glint[]; crystals: { x: number; y: number; s: number; ph: number }[];
  drift: { b: Buf; speed: number } | null; torch: { x: number; y: number; s: number } | null;
};
export type Scene = { W: number; H: number; M: number; base: Buf; layers: { b: Buf; depth: number }[]; fx: Fx };

/** Seed-Mischung (Knuth, goldener Schnitt) für die Formen und Murmur3-Konstante für die Variation. */
const SHAPE_SEED_MIX = 2654435761;
const VARIATION_SEED_MIX = 0x85ebca6b;
const VARIATION_SEED_OFFSET = 101;
/** Wahrscheinlichkeit, dass `sun: "seed"` die Lichtquelle auf die andere Seite spiegelt. */
const SUN_FLIP_CHANCE = 0.45;
const SUN_X_RANGE = { min: 0.12, max: 0.88 };
const LEFT_SUN_X = { min: 0.35, spread: 0.2 };
/** Szenenhöhe (Welt-Pixel), ab der Ränder gedithert werden (Bandkante 2 bzw. 4 Pixel) und ab der Szenen als winzig gelten. */
const TINY_HEIGHT = 26;
const DITHER_HEIGHTS = { wide: { from: 110, width: 4 }, narrow: { from: 44, width: 2 } };
const FINE_DITHER = 2;
/** Referenzhöhe, auf die die Maße der Biome (Pixel bei H = 100) bezogen sind. */
const REFERENCE_HEIGHT = 100;
const STAR_CHANCE_BRIGHT = 0.3;
const STAR_CHANCE_TWINKLE = 0.35;
const STAR_TWINKLE_PHASES = 16;
const GLINT_PHASES = 12;
const PARTICLE_PHASES = 40;

type SceneCtx = {
  W: number; H: number; M: number; sun: SunAnchor; tiny: boolean;
  /** Breite der Bayer-Kante zwischen Bändern (0 = keine) und die feinere Fassung für Wasser und Lava. */
  dither: number; fineDither: number;
  base: Buf; fx: Fx;
  /** Zufallsfolge der Formen. */
  rand: () => number;
  /** Zufallsfolge der Variation je Seed (Lage, Höhe, Anzahl), getrennt von den Formen. */
  variation: () => number;
  /** Ganzzahl in [0, n). */
  randInt: (n: number) => number;
  /** Streuung ±a aus der Variation. */
  jitter: (a: number) => number;
  /** Maß `n` (Pixel bei Höhe 100) auf diese Szenenhöhe skaliert, mindestens 1. */
  scaled: (n: number) => number;
  /** x-Anteil einer Lichtquelle; `def` ist ihre Stelle im Mockup. */
  at: (def: number) => number;
  /** Lichtquelle liegt auf der gespiegelten Seite (nur `seed`). */
  flip: boolean;
  lift: number; ampK: number; fK: number; clouds: number; cloudY: number;
  addLayer: (depth: number, draw: (b: Buf) => void) => void;
  addStars: (count: number, maxY: number, bright: string, dim: string) => void;
};

function createCtx(bio: Biome, seed: number, W: number, H: number, M: number, sun: SunAnchor) {
  const rand = rng(hash(bio) ^ Math.imul(seed, SHAPE_SEED_MIX));
  const variation = rng(hash(bio) ^ Math.imul(seed + VARIATION_SEED_OFFSET, VARIATION_SEED_MIX));
  const unit = H / REFERENCE_HEIGHT;
  const scaled = (n: number) => Math.max(1, Math.round(n * unit));
  const jitter = (a: number) => (variation() - 0.5) * 2 * a;
  const flip = sun === "seed" && variation() < SUN_FLIP_CHANCE;
  const at = (def: number) => {
    const x = sun === "left" ? LEFT_SUN_X.min + variation() * LEFT_SUN_X.spread
      : sun === "std" ? def + jitter(0.03)
        : (flip ? 1 - def : def) + jitter(0.08);
    return Math.min(SUN_X_RANGE.max, Math.max(SUN_X_RANGE.min, x));
  };
  const lift = jitter(0.05), ampK = 0.75 + variation() * 0.6, fK = 0.8 + variation() * 0.5, starK = 0.6 + variation() * 0.8;
  const clouds = 2 + Math.floor(variation() * 3), cloudY = jitter(0.06);
  const { wide, narrow } = DITHER_HEIGHTS, dither = H >= wide.from ? wide.width : H >= narrow.from ? narrow.width : 0;
  const base = createBuf(W, H), layers: Scene["layers"] = [];
  const fx: Fx = { stars: [], particles: [], glints: [], drift: null, torch: null, crystals: [] };
  const randInt = (n: number) => Math.floor(rand() * n);
  const addLayer = (depth: number, draw: (b: Buf) => void) => {
    const b = createBuf(W + 2 * M, H);
    draw(b);
    layers.push({ b, depth });
  };
  const addStars = (count: number, maxY: number, bright: string, dim: string) => {
    for (let i = 0, n = Math.round(count * starK); i < n; i++) {
      const x = randInt(W), y = randInt(maxY), isBright = rand() < STAR_CHANCE_BRIGHT;
      setPixel(base, x, y, abgr(isBright ? bright : dim));
      if (rand() < STAR_CHANCE_TWINKLE) fx.stars.push({ x, y, ph: randInt(STAR_TWINKLE_PHASES), twinkle: abgr(bright) });
    }
  };
  const ctx: SceneCtx = {
    W, H, M, sun, tiny: H < TINY_HEIGHT, dither, fineDither: dither ? FINE_DITHER : 0, base, fx,
    rand, variation, randInt, jitter, scaled, at, flip, lift, ampK, fK, clouds, cloudY, addLayer, addStars,
  };
  return { ctx, layers };
}

/** Himmel aus Bändern bis zum Horizont, darunter in der letzten Bandfarbe aufgefüllt. */
function skyAndGround({ base, W, H, dither }: SceneCtx, colors: string[], horizon: number, curve?: number) {
  bands(base, { colors, from: 0, to: horizon, dither, curve });
  rect(base, 0, horizon, W, H - horizon, abgr(colors[colors.length - 1]));
}

/** Sonne oder Mond: Hof und Kern. */
function sunDisc({ base, scaled }: SceneCtx, x: number, y: number, radius: number, haloColor: string, coreColor: string) {
  ring(base, x, y, radius, radius + scaled(2), abgr(haloColor));
  disc(base, x, y, radius, abgr(coreColor));
}

/** Wolkenband, das über den Himmel treibt: `draw` setzt die Wolke Nr. i in den Wolkenpuffer. */
function driftClouds({ W, H, fx }: SceneCtx, speed: number, count: number, draw: (clouds: Buf, i: number) => void) {
  const clouds = createBuf(W, H);
  for (let i = 0; i < count; i++) draw(clouds, i);
  fx.drift = { b: clouds, speed };
}

function buildForest(ctx: SceneCtx) {
  const { W, H, M, base, rand, variation, randInt, scaled, tiny, at, lift, ampK, fK, clouds, cloudY, addLayer } = ctx;
  const FAR = "#70506F", MID = "#45355C", NEAR = "#241F3A", FRONT = "#0E0F1C", GLOW = "#F0A56C";
  const horizon = Math.round(H * 0.66);
  skyAndGround(ctx, ["#1B2140", "#29305A", "#46386A", "#7A4566", "#B45C5E", "#E08A5E", "#F5BE82"], horizon);
  if (!tiny) ctx.addStars(Math.round((W * H) / 700), horizon * 0.32, "#EDE8FF", "#8F8CB8");
  const sunX = Math.round(W * at(0.7)), sunY = Math.round(H * (0.43 + variation() * 0.08)), sunR = scaled(8), lightX = M + sunX;
  sunDisc(ctx, sunX, sunY, sunR, "#FAD39A", "#FFEBC0");
  if (!tiny) {
    rect(base, sunX - sunR - scaled(3), sunY - Math.round(sunR * 0.15), sunR * 2 + scaled(6), 1, abgr(GLOW));
    rect(base, sunX - sunR - scaled(5), sunY + Math.round(sunR * 0.4), sunR * 2 + scaled(10), scaled(0.8), abgr(GLOW));
    driftClouds(ctx, 6, clouds, (cl, i) => {
      streak(cl, randInt(W), Math.round(horizon * (0.4 + cloudY + i * 0.12)), scaled(26 + rand() * 30), "#8E4C68", "#B05A64");
    });
  }
  addLayer(1, (b) => {
    ridge(b, rand, { c: FAR, rim: "#C27678", base: 0.56 + lift, amp: 0.09 * ampK, f: 1.2 * fK, rough: 0.02, lx: lightX });
  });
  addLayer(2, (b) => {
    const tops = ridge(b, rand, { c: MID, base: 0.69, amp: 0.035, f: 2 });
    if (!tiny) scatter(tops, rand, scaled(3), (x, y) => pine(b, x, y, scaled(5 + rand() * 3), MID));
  });
  addLayer(3, (b) => {
    const tops = ridge(b, rand, { c: NEAR, base: 0.81, amp: 0.03, f: 2.6 });
    scatter(tops, rand, scaled(4.5), (x, y) => pine(b, x, y, scaled(9 + rand() * 6), NEAR));
  });
  addLayer(4, (b) => {
    const tops = ridge(b, rand, { c: FRONT, base: 0.94, amp: 0.02, f: 1.6 });
    if (tiny) return;
    pineAt(b, tops, M + scaled(6), scaled(26), FRONT);
    pineAt(b, tops, M + W - scaled(10), scaled(30), FRONT);
    pineAt(b, tops, M + W - scaled(22), scaled(20), FRONT);
  });
}

function buildNether(ctx: SceneCtx) {
  const { W, H, M, fx, rand, randInt, scaled, tiny, fineDither, lift, ampK, fK, addLayer } = ctx;
  const horizon = Math.round(H * 0.78), CEILING = "#140506", FLOOR = "#0B0304", EMBER = "#FFE39A", LAVA_GLOW = "#FF9A3C";
  skyAndGround(ctx, ["#1A0708", "#2A0A0B", "#420F0E", "#651912", "#8E2716"], horizon, 1.2);
  addLayer(1, (b) => {
    const tops = ridge(b, rand, {
      c: "#3E110E", rim: "#A2381A", rimAll: true, base: 0.56 + lift, amp: 0.1 * ampK, f: 1.7 * fK, rough: 0.05,
    });
    if (tiny) return;
    scatter(tops, rand, scaled(16), (x, y) => {
      const height = scaled(8 + rand() * 10), width = scaled(2 + rand() * 2);
      rect(b, x, y - height, width, height + 1, abgr("#2A0B0A"));
      rect(b, x, y - height, 1, height, abgr("#6A1E10"));
    });
  });
  addLayer(2, (b) => {
    const tops = ridge(b, rand, { top: true, c: CEILING, rim: "#4A130E", base: 0.12, amp: 0.08, f: 2.4, rough: 0.08 });
    if (!tiny) scatter(tops, rand, scaled(7), (x, y) => spike(b, x, y, scaled(3 + rand() * 10), 3, 1, CEILING));
  });
  addLayer(3, (b) => {
    const lavaTop = Math.round(H * 0.8);
    bands(b, { colors: ["#FFD06A", LAVA_GLOW, "#E0621C", "#A83A14"], from: lavaTop, to: b.h, dither: fineDither, curve: 1.1 });
    if (tiny) return;
    for (let i = 0; i < Math.round(W / 9); i++) {
      const y = lavaTop + 1 + randInt(H - lavaTop - 1), x = randInt(b.w), w = scaled(2 + rand() * 6);
      rect(b, x, y, w, 1, abgr(rand() < 0.5 ? EMBER : "#B8441A"));
      fx.glints.push({ x: x - M, y, w, ph: randInt(GLINT_PHASES), bright: abgr(EMBER), dim: abgr(LAVA_GLOW) });
    }
  });
  addLayer(4, (b) => {
    const tops = ridge(b, rand, { c: FLOOR, base: 0.96, amp: 0.03, f: 2, rough: 0.06 });
    if (tiny) return;
    [M + scaled(8), M + W - scaled(14)].forEach((x, i) => {
      const height = scaled(30 + i * 8), width = scaled(7);
      rect(b, x, tops[x] - height, width, height + 2, abgr(FLOOR));
      rect(b, x - 1, tops[x] - height, width + 2, scaled(2), abgr(FLOOR));
    });
  });
  if (tiny) return;
  for (let i = 0; i < Math.round(W / 7); i++) {
    fx.particles.push({
      x: randInt(W), y: Math.floor(H * (0.3 + rand() * 0.6)), speed: 0.5 + rand() * 0.8, ph: randInt(PARTICLE_PHASES),
      color: abgr(rand() < 0.5 ? "#FFB347" : "#FF6A2A"), rising: true, top: H * 0.2, bottom: H * 0.82,
    });
  }
}

/** Endinsel-Säulen: [x-Anteil, y-Anteil, Breite]. */
const END_PILLARS = [[0.52, 0.22, 7], [0.63, 0.1, 8], [0.74, 0.3, 7], [0.84, 0.16, 8], [0.94, 0.36, 6]] as const;
const END_ISLAND_COLORS = ["#DCD394", "#B3AC7A", "#8A845C", "#5E5A40", "#3B3828"].map(abgr);

function buildEnd(ctx: SceneCtx) {
  const { W, H, M, fx, rand, randInt, scaled, tiny, sun, flip, lift, addLayer } = ctx;
  const horizon = Math.round(H * 0.74);
  skyAndGround(ctx, ["#07060D", "#0C0A17", "#141029", "#1F1838", "#2C2250"], horizon, 1.25);
  if (!tiny) ctx.addStars(Math.round((W * H) / 260), H * 0.75, "#EDE6C9", "#6E6A58");
  // Links verankert oder Seed-Spiegelung: Säulen links, helle Insel links der Mitte
  const mirrored = sun === "left" || flip, mx = (p: number, w = 0) => (mirrored ? 1 - p - w : p);
  addLayer(1, (b) => {
    const cx = M + W * mx(0.3), halfW = W * 0.3, top = Math.round(H * (0.62 + lift * 0.5));
    for (let x = Math.floor(cx - halfW); x < cx + halfW; x++) {
      const k = 1 - Math.pow((x - cx) / halfW, 2);
      if (k <= 0) continue;
      rect(b, x, top - Math.round(k * H * 0.025), 1, Math.round(k * H * 0.1), abgr("#3A3160"));
      rect(b, x, top - Math.round(k * H * 0.025), 1, 1, abgr("#6E6594"));
    }
  });
  addLayer(2, (b) => {
    const floor = Math.round(H * 0.7);
    END_PILLARS.forEach(([px, py, w], i) => {
      const x = Math.round(M + W * mx(px, 0.06)), top = Math.round(H * (py + lift)), width = scaled(w), edge = scaled(1.2);
      const crystal = scaled(1.5), crystalX = x + (width >> 1) - (crystal >> 1), crystalY = top - crystal - 1;
      rect(b, x, top, width, floor - top + 2, abgr("#08060F"));
      rect(b, x + width - edge, top, edge, floor - top, abgr("#241C3E"));
      rect(b, crystalX, crystalY, crystal, crystal, abgr("#C79BFF"));
      fx.crystals.push({ x: crystalX - M, y: crystalY, s: crystal, ph: i * 3 });
    });
  });
  addLayer(3, (b) => {
    const cx = M + W * (sun === "left" ? 0.45 : mx(0.62)), halfW = W * 0.6, top = Math.round(H * 0.68);
    for (let x = Math.floor(cx - halfW); x < cx + halfW; x++) {
      const k = 1 - Math.pow((x - cx) / halfW, 2);
      if (k <= 0) continue;
      const depth = Math.round(k * H * 0.3) + 1, startY = top + Math.round((1 - k) * H * 0.02);
      for (let y = 0; y < depth; y++) {
        const shade = Math.min(END_ISLAND_COLORS.length - 1, Math.floor(y / scaled(2.2)));
        setPixel(b, x, startY + y, END_ISLAND_COLORS[shade]);
      }
    }
  });
  addLayer(4, (b) => {
    ridge(b, rand, { c: "#050407", base: 0.985, amp: 0.03, f: 1.3 });
  });
  if (tiny) return;
  for (let i = 0; i < Math.round(W / 16); i++) {
    fx.particles.push({
      x: randInt(W), y: randInt(H), speed: 0.25 + rand() * 0.3, ph: randInt(PARTICLE_PHASES),
      color: abgr(rand() < 0.5 ? "#8A5CD0" : "#C79BFF"), rising: true, top: 0, bottom: H,
    });
  }
}

function buildSnow(ctx: SceneCtx) {
  const { W, H, M, fx, rand, variation, randInt, scaled, tiny, at, lift, ampK, fK, addLayer } = ctx;
  const horizon = Math.round(H * 0.62), PINE_FAR = "#6B7CA6", PINE_NEAR = "#34466E", PINE_FRONT = "#18223E";
  skyAndGround(ctx, ["#2A3764", "#44568C", "#7C7DB0", "#B994AE", "#E8B4A6", "#F9D8BE"], horizon);
  if (!tiny) ctx.addStars(Math.round((W * H) / 1400), horizon * 0.25, "#FFFFFF", "#8E9BC8");
  const sunX = Math.round(W * at(0.3)), sunY = horizon - scaled(3 + variation() * 12), sunR = scaled(6);
  sunDisc(ctx, sunX, sunY, sunR, "#FFE6D2", "#FFF6E6");
  addLayer(1, (b) => {
    ridge(b, rand, {
      c: "#8A96C2", rim: "#F6D6CC", rimW: scaled(0.8), cap: "#EEF2FA", capAbove: 0.5,
      base: 0.52 + lift, amp: 0.15 * ampK, f: 1.05 * fK, rough: 0.03, lx: M + sunX,
    });
  });
  addLayer(2, (b) => {
    const tops = ridge(b, rand, { c: "#C3CDE5", base: 0.67, amp: 0.04, f: 2 });
    if (!tiny) scatter(tops, rand, scaled(5), (x, y) => pine(b, x, y, scaled(4 + rand() * 3), PINE_FAR));
  });
  addLayer(3, (b) => {
    const tops = ridge(b, rand, { c: "#E1E9F5", base: 0.8, amp: 0.03, f: 2.4 });
    scatter(tops, rand, scaled(7), (x, y) => pine(b, x, y, scaled(8 + rand() * 6), PINE_NEAR));
  });
  addLayer(4, (b) => {
    const tops = ridge(b, rand, { c: "#F6F9FF", base: 0.94, amp: 0.02, f: 1.5 });
    if (tiny) return;
    pineAt(b, tops, M + W - scaled(10), scaled(30), PINE_FRONT);
    pineAt(b, tops, M + W - scaled(24), scaled(20), PINE_FRONT);
  });
  if (tiny) return;
  for (let i = 0; i < Math.round((W * H) / 500); i++) {
    fx.particles.push({
      x: randInt(W), y: randInt(H), speed: 0.4 + rand() * 0.7, ph: randInt(PARTICLE_PHASES),
      color: abgr(rand() < 0.6 ? "#FFFFFF" : "#D6E0F4"), rising: false, top: 0, bottom: H,
    });
  }
}

function buildCave(ctx: SceneCtx) {
  const { W, H, M, base, fx, rand, randInt, jitter, scaled, tiny, at, lift, ampK, fK, addLayer } = ctx;
  bands(base, { colors: ["#0B1019", "#111826", "#172133", "#1D2940"], from: 0, to: H, dither: ctx.dither, curve: 1 });
  const shaftX = W * (0.56 + jitter(0.1)), shaftW = W * 0.12;
  for (let y = 0; y < H * 0.9; y++) {
    const x0 = Math.round(shaftX - y * 0.35), w = Math.round(shaftW + y * 0.08);
    rect(base, x0, y, w, 1, abgr("#22314A"));
    rect(base, x0 + Math.round(w * 0.3), y, Math.round(w * 0.4), 1, abgr("#2B3D5A"));
  }
  const torchX = Math.round(W * at(0.3)), torchY = Math.round(H * 0.78);
  if (!tiny) {
    ([[scaled(24), "#1E2126"], [scaled(17), "#2A2622"], [scaled(10), "#3A2C1E"]] as const)
      .forEach(([r, color]) => disc(base, torchX, torchY - scaled(4), r, abgr(color)));
  }
  addLayer(1, (b) => {
    ridge(b, rand, { c: "#0F1622", base: 0.84 + lift * 0.5, amp: 0.05 * ampK, f: 1.8 * fK });
    if (tiny) return;
    for (let i = 0; i < Math.round(W / 10); i++) {
      const x = randInt(b.w), y = Math.floor(H * (0.25 + rand() * 0.45));
      const color = rand() < 0.5 ? "#7FDFE8" : "#E0B25A", size = scaled(1);
      rect(b, x, y, size, size, abgr(color));
      fx.stars.push({ x: x - M, y, ph: randInt(STAR_TWINKLE_PHASES), twinkle: abgr("#FFFFFF"), size });
    }
  });
  addLayer(2, (b) => {
    const tops = ridge(b, rand, { top: true, c: "#0B1019", rim: "#243249", base: 0.16, amp: 0.09, f: 2.2, rough: 0.08 });
    if (!tiny) scatter(tops, rand, scaled(6), (x, y) => spike(b, x, y, scaled(3 + rand() * 9), 2.5, 1, "#0B1019"));
  });
  addLayer(3, (b) => {
    const tops = ridge(b, rand, { c: "#0A0F17", rim: "#1E2A3D", rimAll: true, base: 0.82, amp: 0.05, f: 2.4, rough: 0.05 });
    if (tiny) return;
    scatter(tops, rand, scaled(12), (x, y) => spike(b, x, y, scaled(3 + rand() * 7), 2.5, -1, "#0A0F17"));
    const size = scaled(1.2);
    rect(b, torchX + M, torchY - scaled(7), size, scaled(8), abgr("#5A3D26"));
    fx.torch = { x: torchX, y: torchY - scaled(7), s: size };
  });
  addLayer(4, (b) => {
    ridge(b, rand, { c: "#06090E", base: 0.95, amp: 0.04, f: 1.7, rough: 0.06 });
    ridge(b, rand, { top: true, c: "#06090E", base: 0.03, amp: 0.04, f: 2.8 });
  });
}

function buildSea(ctx: SceneCtx) {
  const { W, H, M, base, fx, rand, randInt, scaled, tiny, at, dither, fineDither, clouds, cloudY, addLayer } = ctx;
  const horizon = Math.round(H * 0.6), ISLAND = "#173247";
  bands(base, { colors: ["#13284A", "#223F68", "#3A6488", "#7F8298", "#C98F7E", "#F2C69A"], from: 0, to: horizon, dither });
  if (!tiny) ctx.addStars(Math.round((W * H) / 1600), horizon * 0.25, "#FFFFFF", "#7C8DB0");
  const sunX = Math.round(W * at(0.64)), sunR = scaled(8), sunOnLeft = sunX < W / 2;
  sunDisc(ctx, sunX, horizon, sunR, "#FFD8A0", "#FFEBC2");
  bands(base, { colors: ["#6B8398", "#2F6A84", "#1F5470", "#143E55", "#0B2A3C"], from: horizon, to: H, dither: fineDither, curve: 1.3 });
  rect(base, 0, horizon, W, 1, abgr("#F2C69A"));
  if (!tiny) {
    for (let y = horizon + 2; y < H; y += Math.max(2, scaled(2.2))) {
      const t = (y - horizon) / (H - horizon), halfW = Math.round(sunR * (1.4 - t * 0.6) + rand() * scaled(3));
      const shade = t < 0.4 ? "#FFDCA0" : "#E7A77A";
      for (let i = 0; i < 2; i++) {
        const w = Math.max(1, Math.round(halfW * (0.3 + rand() * 0.5))), x = sunX + Math.round((rand() - 0.5) * halfW * 2);
        rect(base, x, y, w, 1, abgr(shade));
        fx.glints.push({ x, y, w, ph: randInt(GLINT_PHASES), bright: abgr("#FFF0C8"), dim: abgr(shade), base: true });
      }
    }
    driftClouds(ctx, 7, clouds, (cl, i) => {
      streak(cl, randInt(W), Math.round(horizon * (0.33 + cloudY + i * 0.14)), scaled(24 + rand() * 26), "#6F7894", "#D39C84");
    });
  }
  addLayer(2, (b) => {
    // Insel und Klippe auf der Seite gegenüber der Sonne
    const islandX = Math.round(M + W * (sunOnLeft ? 0.84 : 0.16)), islandW = scaled(34);
    for (let k = 0; k < scaled(6); k++) rect(b, islandX - (islandW >> 1) + k * 2, horizon - k - 1, islandW - k * 4, 1, abgr(ISLAND));
    if (tiny) return;
    rect(b, islandX + scaled(4), horizon - scaled(14), scaled(2), scaled(10), abgr(ISLAND));
    rect(b, islandX + scaled(3.5), horizon - scaled(15), scaled(3), scaled(1.4), abgr(ISLAND));
    rect(b, islandX + scaled(4), horizon - scaled(13), scaled(2), scaled(1), abgr("#F4D68A"));
  });
  addLayer(4, (b) => {
    const baseW = Math.round(W * 0.34);
    let y = H;
    for (let k = 0; k < 7; k++) {
      const w = Math.round(baseW * (1 - k * 0.12)) + M, h = scaled(4 + k * 0.5);
      y -= h;
      rect(b, sunOnLeft ? b.w - w : 0, y, w, H - y, abgr("#06141C"));
      rect(b, sunOnLeft ? b.w - w : w - scaled(1.5), y, scaled(1.5), 1, abgr("#16303C"));
    }
  });
}

function buildPlains(ctx: SceneCtx) {
  const { W, H, M, base, rand, variation, randInt, scaled, tiny, at, lift, ampK, fK, clouds, cloudY, addLayer } = ctx;
  const horizon = Math.round(H * 0.64);
  skyAndGround(ctx, ["#3C6FB4", "#5486C8", "#77A3DC", "#A4C4E8", "#D2E3F0"], horizon);
  const sunSize = scaled(7), sunX = Math.round(W * at(0.74)), sunY = Math.round(horizon * (0.14 + variation() * 0.2));
  rect(base, sunX - 1, sunY - 1, sunSize + 2, sunSize + 2, abgr("#FFF0B8"));
  rect(base, sunX, sunY, sunSize, sunSize, abgr("#FFFBEA"));
  if (!tiny) {
    driftClouds(ctx, 5, clouds + 1, (cl, i) => {
      const x = randInt(W), baseY = Math.round(horizon * (0.2 + cloudY + i * 0.15)), width = scaled(16 + rand() * 18);
      puffCloud(cl, x, baseY, width, Math.max(3, scaled(5)), "#F4F8FF", "#C9D8EA");
    });
  }
  addLayer(1, (b) => {
    ridge(b, rand, { c: "#9BB5C9", rim: "#C6D8E6", base: 0.62 + lift * 0.6, amp: 0.05 * ampK, f: 1.4 * fK, lx: M + sunX });
  });
  addLayer(2, (b) => {
    const tops = ridge(b, rand, { c: "#6E9481", base: 0.71, amp: 0.045, f: 2 });
    if (!tiny) scatter(tops, rand, scaled(18), (x, y) => oak(b, x, y, scaled(0.9), "#587B6A"));
  });
  addLayer(3, (b) => {
    const tops = ridge(b, rand, { c: "#4A735F", base: 0.81, amp: 0.035, f: 2.3 });
    if (!tiny) scatter(tops, rand, scaled(22), (x, y) => oak(b, x, y, scaled(1.4), "#3A5E4C"));
  });
  addLayer(4, (b) => {
    const tops = ridge(b, rand, { c: "#22392F", base: 0.94, amp: 0.02, f: 1.5 });
    const x = M + W - scaled(16);
    if (!tiny) oak(b, x, tops[x], scaled(3), "#1B2E25");
  });
}

const BIOME_BUILDERS: Record<Biome, (ctx: SceneCtx) => void> = {
  forest: buildForest, nether: buildNether, end: buildEnd, snow: buildSnow, cave: buildCave, sea: buildSea, plains: buildPlains,
};

/**
 * Baut eine Szene: Grund (Himmel und unbewegte Teile), Ebenen mit Parallax-Tiefe (1 hinten bis 4 vorn), Effekte.
 * Variation je Seed (eigene Zufallsfolge, `rand` bestimmt weiter die Formen): Lage der Lichtquelle, Höhe/Amplitude der hinteren
 * Silhouette, Zahl und Höhe der Wolken, Sternendichte. Bänder und Dithering bleiben unverändert.
 */
export function buildScene(bio: Biome, seed: number, W: number, H: number, M: number, sun: SunAnchor = "seed"): Scene {
  const { ctx, layers } = createCtx(bio, seed, W, H, M, sun);
  BIOME_BUILDERS[bio](ctx);
  return { W, H, M, base: ctx.base, layers, fx: ctx.fx };
}
