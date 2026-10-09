import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n, type TKey } from "@/i18n";
import { useReducedMotion } from "@/hooks/useMediaQuery";
import type { SkinVariant } from "@/lib/types";
import { TurnedSkin } from "@/pixel/SkinFigure";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { IconButton, Surface } from "@/ui";

/**
 * Bühne: Slot mit der Figur unten in der Mitte auf einem gestuften Podest (drei harte Bänder, oben um eine Stufe eingezogen);
 * der Knopf zum Umdrehen sitzt oben rechts.
 */
const STAGE = [
  "relative isolate grid items-end justify-items-center self-stretch overflow-hidden p-(--u4)",
  "before:pointer-events-none before:absolute before:bottom-(--u4) before:left-1/2 before:z-0 before:h-[calc(var(--u4)*3)] before:w-[min(calc(var(--u4)*21),86%)] before:-translate-x-1/2",
  "before:bg-[linear-gradient(var(--ctl-hi)_0_var(--u4),var(--ctl)_var(--u4)_calc(var(--u4)*2),var(--line)_calc(var(--u4)*2)_100%)]",
  "before:[clip-path:polygon(var(--u4)_0,calc(100%_-_var(--u4))_0,calc(100%_-_var(--u4))_var(--u4),100%_var(--u4),100%_100%,0_100%,0_var(--u4),var(--u4)_var(--u4))]",
].join(" ");

/** Schritt einer Pfeiltaste in Grad. */
const KEY_STEP_DEG = 15;
/** Grad je Pixel, den der Zeiger beim Ziehen wandert. */
const DRAG_DEG_PER_PX = 2;
/** Neigung nach vorn (0 = waagerechter Blick): Grundstellung, Grenzen, Pfeiltaste in Grad und Grad je Pixel beim Ziehen. */
const REST_TILT_DEG = 10;
const MIN_TILT_DEG = 0;
const MAX_TILT_DEG = 40;
const KEY_TILT_STEP_DEG = 5;
const DRAG_TILT_DEG_PER_PX = 0.5;
/** Grundstellung der Drehung: leicht von der Seite, damit man die Figur schon vor dem ersten Ziehen als räumlich sieht. */
const REST_TURN_DEG = 28;
/** Umdrehung von vorn nach hinten: Dauer und Zahl der Stufen (Bewegungen im Kit springen in ganzen Stufen). */
const FLIP_MS = 320;
const FLIP_STEPS = 8;
const FULL_TURN = 360;
const HALF_TURN = 180;

const clampTilt = (deg: number) => Math.min(MAX_TILT_DEG, Math.max(MIN_TILT_DEG, deg));

const normalized = (deg: number) => ((deg % FULL_TURN) + FULL_TURN) % FULL_TURN;

/** Der kürzeste Weg von `from` nach `to` in Grad, positiv oder negativ. */
const shortestWay = (from: number, to: number) => normalized(to - from + HALF_TURN) - HALF_TURN;

const VIEW_NAMES: [from: number, key: TKey][] = [
  [315, "pages.skins.view.front"],
  [225, "pages.skins.view.right"],
  [135, "pages.skins.view.back"],
  [45, "pages.skins.view.left"],
  [0, "pages.skins.view.front"],
];

/** Was man bei diesem Winkel sieht, für Vorleser. */
const viewName = (turn: number): TKey => VIEW_NAMES.find(([from]) => turn >= from)![1];

/**
 * Winkel der Drehung (0 = von vorn). `flip` dreht mit Zwischenschritten auf die andere Seite, solange `animate`;
 * sonst springt es.
 */
function useTurn(animate: boolean) {
  const [turn, setTurnState] = useState(REST_TURN_DEG);
  const current = useRef(REST_TURN_DEG);
  const frame = useRef(0);
  const set = (deg: number) => {
    current.current = normalized(deg);
    setTurnState(current.current);
  };
  const stop = () => cancelAnimationFrame(frame.current);
  useEffect(() => stop, []);

  /** Zeigt die andere Seite: war es näher an vorn, die Rückseite, sonst die Vorderseite. */
  function flip() {
    stop();
    const from = current.current;
    const delta = shortestWay(from, from < HALF_TURN / 2 || from > FULL_TURN - HALF_TURN / 2 ? HALF_TURN : 0);
    if (!animate) return set(from + delta);
    const start = performance.now();
    const tick = (now: number) => {
      const done = Math.min(1, (now - start) / FLIP_MS);
      set(from + (delta * Math.ceil(done * FLIP_STEPS)) / FLIP_STEPS);
      if (done < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  /** Dreht um `delta` Grad (negativ = nach rechts); eine laufende Umdrehung hört auf. */
  function rotate(delta: number) {
    stop();
    set(current.current + delta);
  }
  return { turn, flip, rotate };
}

/**
 * Spielerfigur zum Drehen und Neigen: Ziehen mit der Maus, ← → in 15°-Schritten (↑ ↓ neigen), Pos1/Ende für vorn/hinten. Der Knopf daneben
 * wechselt zwischen Vorder- und Rückseite, beim Umhang die Seite, auf der er hängt. Reduzierte Bewegung: kein Auslaufen.
 */
export function SkinViewer({ src, variant, capeSrc, zoom, label, className }: { src: string | undefined; variant: SkinVariant; capeSrc?: string; zoom?: number; label: string; className?: string }) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const sceneMotion = useSettings((s) => s.motion);
  const { turn, flip, rotate } = useTurn(sceneMotion && !reducedMotion);
  const [tilt, setTilt] = useState(REST_TILT_DEG);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const tiltBy = (delta: number) => setTilt((deg) => clampTilt(deg + delta));

  function onKeyDown(e: KeyboardEvent) {
    const steps: Record<string, () => void> = {
      ArrowLeft: () => rotate(KEY_STEP_DEG),
      ArrowRight: () => rotate(-KEY_STEP_DEG),
      ArrowUp: () => tiltBy(-KEY_TILT_STEP_DEG),
      ArrowDown: () => tiltBy(KEY_TILT_STEP_DEG),
      Home: () => rotate(-turn),
      End: () => rotate(HALF_TURN - turn),
    };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    step();
  }

  function onPointerMove(e: PointerEvent) {
    if (dragFrom.current == null) return;
    rotate(-(e.clientX - dragFrom.current.x) * DRAG_DEG_PER_PX);
    tiltBy((e.clientY - dragFrom.current.y) * DRAG_TILT_DEG_PER_PX);
    dragFrom.current = { x: e.clientX, y: e.clientY };
  }

  return (
    <Surface kind="slot" className={cn(STAGE, className)}>
      <div
        className="fx relative isolate z-1 block cursor-grab touch-none active:cursor-grabbing"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={FULL_TURN - 1}
        aria-valuenow={Math.round(turn)}
        aria-valuetext={t(viewName(turn))}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragFrom.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragFrom.current = null)}
        onPointerCancel={() => (dragFrom.current = null)}
      >
        <TurnedSkin src={src} variant={variant} capeSrc={capeSrc} turn={turn} tilt={tilt} zoom={zoom} />
      </div>
      <IconButton className="absolute top-(--u2) right-(--u2) z-2" icon="refresh" size="s" label={t("pages.skins.turnAround")} onClick={flip} />
    </Surface>
  );
}
