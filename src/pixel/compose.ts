import { abgr, rect, type Buf } from "./raster";
import type { Scene } from "./sceneBuilder";

/** Bildrate der belebten Szenen; ein Takt `k` ist ein Bild. */
export const FRAMES_PER_SECOND = 12;

const STAR_PERIOD = 16;
const STAR_ON = 2;
const GLINT_PERIOD = 12;
const GLINT_ON = 3;
const CRYSTAL_PERIOD = 18;
const CRYSTAL_COLORS = { bright: abgr("#E2C8FF"), dim: abgr("#C79BFF") };
const TORCH_COLORS = { flame: abgr("#FFB454"), core: abgr("#FFF2C2") };
const TORCH_FLICKER_STEPS = 3;
const PARTICLE_SWAY = { speed: 0.15, amplitude: 2 };

type Fx = Scene["fx"];

/** Wolkenband: ein Puffer von Bildbreite, pro Takt ein Stück weiter nach links geschoben (wickelt um). */
function drawDrift(o: Uint32Array, { W, H }: Scene, drift: NonNullable<Fx["drift"]>, k: number) {
  const clouds = drift.b.d, offset = Math.floor(k / drift.speed) % W;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const v = clouds[row + ((x + offset) % W)];
      if (v) o[row + x] = v;
    }
  }
}

/** Ebenen mit ganzzahligem Parallax-Versatz; Pixel 0 ist durchsichtig. */
function drawLayers(o: Uint32Array, { W, H, M, layers }: Scene, pointerOffset: number) {
  for (const layer of layers) {
    const src = layer.b.d, layerW = layer.b.w, shift = M - Math.round(pointerOffset * layer.depth);
    for (let y = 0; y < H; y++) {
      const srcRow = y * layerW + shift, outRow = y * W;
      for (let x = 0; x < W; x++) {
        const v = src[srcRow + x];
        if (v) o[outRow + x] = v;
      }
    }
  }
}

function drawTorch(out: Buf, torch: NonNullable<Fx["torch"]>, k: number) {
  const flicker = (k >> 1) % TORCH_FLICKER_STEPS === 1 ? torch.s : 0, s = torch.s;
  rect(out, torch.x - s, torch.y - 3 * s - flicker, s * 3, s * 3 + flicker, TORCH_COLORS.flame);
  rect(out, torch.x, torch.y - 2 * s, s, s * 2, TORCH_COLORS.core);
}

function drawParticles(out: Buf, particles: Fx["particles"], k: number) {
  for (const p of particles) {
    const span = Math.max(1, p.bottom - p.top), travelled = Math.floor(k * p.speed);
    const y = p.rising ? p.bottom - ((p.bottom - p.y + travelled) % span) : p.top + ((p.y - p.top + travelled) % span);
    const x = (p.x + Math.round(Math.sin((k + p.ph) * PARTICLE_SWAY.speed) * PARTICLE_SWAY.amplitude) + out.w) % out.w;
    rect(out, x, Math.round(y), 1, 1, p.color);
  }
}

/**
 * Bild zusammensetzen: Grund, Wolkenband, Spiegelungen, Ebenen mit ganzzahligem Versatz, Effekte.
 * `k` ist der Takt (`FRAMES_PER_SECOND` pro Sekunde), `pointerOffset` der Parallax-Versatz in Pixeln.
 */
export function compose(scene: Scene, out: Buf, k: number, pointerOffset: number) {
  const { fx } = scene;
  out.d.set(scene.base.d);
  if (fx.drift) drawDrift(out.d, scene, fx.drift, k);
  for (const g of fx.glints) if (g.base) rect(out, g.x, g.y, g.w, 1, (k + g.ph) % GLINT_PERIOD < GLINT_ON ? g.bright : g.dim);
  drawLayers(out.d, scene, pointerOffset);
  for (const s of fx.stars) if ((k + s.ph) % STAR_PERIOD < STAR_ON) rect(out, s.x, s.y, s.size || 1, s.size || 1, s.twinkle);
  for (const g of fx.glints) if (!g.base && (k + g.ph) % GLINT_PERIOD < GLINT_ON) rect(out, g.x, g.y, g.w, 1, g.bright);
  for (const c of fx.crystals) {
    const bright = (k + c.ph) % CRYSTAL_PERIOD < CRYSTAL_PERIOD / 2;
    rect(out, c.x, c.y, c.s, c.s, bright ? CRYSTAL_COLORS.bright : CRYSTAL_COLORS.dim);
  }
  if (fx.torch) drawTorch(out, fx.torch, k);
  drawParticles(out, fx.particles, k);
}
