/**
 * Szenen-Laufzeit: Canvas in Boxen, ganzzahlig skaliert, zentriert, unten verankert, mit gemeinsamem Takt für belebte Szenen.
 * Aufbau und Bild der Szenen liegen in sceneBuilder.ts und compose.ts.
 */
import { prefersReducedMotion } from "@/hooks/useMediaQuery";
import { bayer, type Buf } from "./raster";
import { compose, FRAMES_PER_SECOND } from "./compose";
import { buildScene, type Scene } from "./sceneBuilder";
import { BIOMES, sunFor, type Biome, type SceneMode, type SunAnchor } from "./sceneConfig";
import { PX, snap } from "./unit";

export { BIOMES, BIOME_KEYS, isBiome, sunFor, type Biome, type SceneMode, type SunAnchor } from "./sceneConfig";

/** Parallax folgt dem Zeiger je Takt um diesen Anteil des Abstands. */
const POINTER_EASE = 0.35;
/** Ebenen der Hero-Szene sind je Seite so viele Pixel breiter: Spielraum für den Parallax-Versatz. */
const HERO_MARGIN = 4;
/** Ein Szenenwechsel löst sich per Bayer-Muster in so vielen Schritten auf. */
const TRANSITION_STEPS = 8;
const STATIC_CACHE_LIMIT = 160;

type SceneGate = { motion: boolean; game: boolean };

/** Gemeinsamer Takt aller belebten Szenen samt Pausenbedingungen und Zeigerposition. */
class SceneTicker {
  private readonly hosts = new Set<SceneHost>();
  private readonly gate: SceneGate = { motion: true, game: false };
  private pointer = { target: 0, smoothed: 0 };
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private listening = false;

  get currentFrame() {
    return this.frame;
  }

  /** Pausen: Spiel startet/läuft, „Bewegte Szenen“ aus. Fenster verborgen und reduzierte Bewegung prüft `paused`. */
  setGate(patch: Partial<SceneGate>) {
    Object.assign(this.gate, patch);
  }

  motionOff() {
    return prefersReducedMotion() || !this.gate.motion;
  }

  paused() {
    return document.hidden || this.motionOff() || this.gate.game;
  }

  /** Gleitender Zeiger-Versatz (-1 bis 1): folgt dem Zeiger je `followPointer` einen Schritt. */
  get pointerOffset() {
    return this.pointer.smoothed;
  }

  followPointer() {
    this.pointer.smoothed += (this.pointer.target - this.pointer.smoothed) * POINTER_EASE;
  }

  register(host: SceneHost) {
    this.hosts.add(host);
    this.listenToPointer();
    this.ensureRunning();
  }

  unregister(host: SceneHost) {
    this.hosts.delete(host);
  }

  private listenToPointer() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("pointermove", (e) => {
      this.pointer.target = Math.max(-1, Math.min(1, (e.clientX / innerWidth - 0.5) * 2));
    }, { passive: true });
  }

  private ensureRunning() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / FRAMES_PER_SECOND);
  }

  private step() {
    if (!this.hosts.size) {
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    this.frame++;
    for (const host of this.hosts) host.tick(this.frame);
  }
}

const ticker = new SceneTicker();

/** Pausen: Spiel startet/läuft, Fenster verborgen, „Bewegte Szenen“ aus, reduzierte Bewegung. */
export const setSceneGate = (patch: Partial<SceneGate>) => ticker.setGate(patch);
export const motionOff = () => ticker.motionOff();

type Transition = { old: Uint32Array; step: number };
type View = { w: number; h: number; W: number; H: number; sun: SunAnchor; key: string };

/** Szenen, die nur einmal gerendert werden, gecacht nach Biom, Seed, Größe und Lichtlage. */
const STATIC_IMAGES = new Map<string, ImageData>();

function staticImage(bio: Biome, seed: number, W: number, H: number, sun: SunAnchor) {
  const key = [bio, seed, W, H, sun].join("|");
  let image = STATIC_IMAGES.get(key);
  if (!image) {
    image = new ImageData(W, H);
    compose(buildScene(bio, seed, W, H, 0, sun), { w: W, h: H, d: new Uint32Array(image.data.buffer) }, 0, 0);
    if (STATIC_IMAGES.size > STATIC_CACHE_LIMIT) STATIC_IMAGES.clear();
    STATIC_IMAGES.set(key, image);
  }
  return image;
}

export class SceneHost {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private bio: Biome;
  private seed: number;
  private mode: SceneMode;
  private sun: SunAnchor | undefined;
  private key = "";
  private frame = 0;
  private transition: Transition | null = null;
  private scene: Scene | null = null;
  private image: ImageData | null = null;
  private output: Buf | null = null;

  constructor(container: HTMLElement, bio: Biome, seed: number, mode: SceneMode, sun?: SunAnchor) {
    this.container = container;
    this.bio = bio;
    this.seed = seed;
    this.mode = mode;
    this.sun = sun;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  private get animated() {
    return this.mode !== "flat";
  }

  private get hero() {
    return this.mode === "hero";
  }

  /** Zeichnet neu, aber nur, wenn sich Größe, Szene oder Pixelstufe geändert haben. */
  refresh() {
    const view = this.measure();
    if (view && view.key !== this.key) this.paintView(view);
  }

  /** Zeichnet in jedem Fall neu. */
  repaint() {
    const view = this.measure();
    if (view) this.paintView(view);
  }

  /** Ein Takt des gemeinsamen Ticks: laufende Übergänge zeichnen sich auch bei Pause zu Ende. */
  tick(frame: number) {
    if (this.transition) {
      this.draw(this.frame);
      return;
    }
    if (ticker.paused()) return;
    if (this.hero) ticker.followPointer();
    this.draw(frame);
  }

  /** Neues Biom oder Seed. Belebte Szenen wechseln per Bayer-Auflösung in 8 Schritten. */
  set(bio: Biome, seed: number, mode: SceneMode, sun?: SunAnchor) {
    if (bio === this.bio && seed === this.seed && mode === this.mode && sun === this.sun) return;
    const old = this.animated && this.output && !ticker.motionOff() && mode === this.mode ? new Uint32Array(this.output.d) : null;
    this.bio = bio;
    this.seed = seed;
    this.sun = sun;
    if (mode !== this.mode) { ticker.unregister(this); this.scene = null; }
    this.mode = mode;
    this.repaint();
    if (old && this.output && this.output.d.length === old.length) {
      this.transition = { old, step: 0 };
      this.draw(this.frame);
    }
  }

  dispose() {
    ticker.unregister(this);
    this.canvas.remove();
  }

  private measure(): View | null {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return null;
    const W = Math.ceil(w / PX.css), H = Math.ceil(h / PX.css), sun = sunFor(this.mode, this.sun);
    return { w, h, W, H, sun, key: [this.bio, this.seed, W, H, this.mode, sun, PX.css].join("|") };
  }

  private paintView(view: View) {
    this.key = view.key;
    this.container.style.setProperty("--scene-bg", BIOMES[this.bio].bg);
    this.sizeCanvas(view);
    if (this.animated) this.startLive(view);
    else this.ctx.putImageData(staticImage(this.bio, this.seed, view.W, view.H, view.sun), 0, 0);
  }

  /** Canvas in Welt-Pixeln, per CSS ganzzahlig vergrößert, mittig und unten verankert. */
  private sizeCanvas({ w, h, W, H }: View) {
    const cv = this.canvas, cssW = W * PX.css, cssH = H * PX.css;
    cv.width = W;
    cv.height = H;
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;
    cv.style.left = `${snap((w - cssW) / 2)}px`;
    cv.style.top = `${snap(h - cssH)}px`;
  }

  private startLive({ W, H, sun }: View) {
    this.scene = buildScene(this.bio, this.seed, W, H, this.hero ? HERO_MARGIN : 0, sun);
    this.image = this.ctx.createImageData(W, H);
    this.output = { w: W, h: H, d: new Uint32Array(this.image.data.buffer) };
    ticker.register(this);
    this.draw(ticker.currentFrame);
  }

  private draw(frame: number) {
    if (!this.scene || !this.output || !this.image) return;
    this.frame = frame;
    compose(this.scene, this.output, frame, this.hero ? Math.round(ticker.pointerOffset) : 0);
    if (this.transition) this.dissolveToOld(this.transition, this.output);
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Ein Schritt des Bayer-Übergangs: Pixel, deren Schwelle noch nicht erreicht ist, zeigen weiter das alte Bild. */
  private dissolveToOld(transition: Transition, output: Buf) {
    const threshold = (transition.step + 1) / TRANSITION_STEPS, { w, h, d } = output;
    if (transition.old.length === d.length) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bayer(x, y) >= threshold) d[y * w + x] = transition.old[y * w + x];
    }
    transition.step++;
    if (transition.step >= TRANSITION_STEPS) this.transition = null;
  }
}
