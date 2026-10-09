import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { clamp, cssVars, flag } from "./util";

/** Anzahl der Segmente; muss zu `grid-cols-[repeat(16,1fr)]` und `* 16` in der Breite passen. */
const SEGMENTS = 16;

const STEP_UP_KEYS = ["ArrowRight", "ArrowUp", "PageUp"];
const STEP_KEYS = [...STEP_UP_KEYS, "ArrowLeft", "ArrowDown", "PageDown", "Home", "End"];

/** Breite ~400 px, auf ganze Zellen gerundet (16 Zellen + 17 Fugen); überschreibbar per `className` (z. B. `w-full`). */
const WIDTH = "[--sseg:round(nearest,calc((400px_-_var(--px)_*_17)_/_16),var(--px))] w-[calc(var(--sseg)_*_16_+_var(--px)_*_17)]";

/**
 * Wert von 1 bis 16 als 16 Zellen (XP-Leiste im Slot) mit Steingriff. Pfeile, Bild auf/ab, Pos1, Ende.
 * Segmente über `max` sind gesperrt. `label` ist der Name; `unit` hängt an den vorgelesenen Wert („6 GB“).
 * Bahn so hoch wie die Box (--lk-box), der Griff überragt sie um 1 Einheit je Seite.
 */
export function SegSlider({ value, onChange, disabled, max = SEGMENTS, label, unit, id, className }: {
  value: number; onChange: (v: number) => void; disabled?: boolean; max?: number; label: string; unit?: string; id?: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = clamp(Math.floor(max), 1, SEGMENTS);
  const v = clamp(Math.round(value), 1, top);
  const set = (n: number) => onChange(clamp(Math.round(n), 1, top));
  const fromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    set(1 + ((clientX - r.left) / r.width) * SEGMENTS - 0.5);
  };
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromX(e.clientX);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !STEP_KEYS.includes(e.key)) return;
    e.preventDefault();
    set(e.key === "Home" ? 1 : e.key === "End" ? top : v + (STEP_UP_KEYS.includes(e.key) ? 1 : -1));
  }
  return (
    <div
      ref={ref}
      id={id}
      className={cn("lk-slider relative h-ctl-s max-w-full flex-none", WIDTH, className)}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={top}
      aria-valuenow={v}
      aria-valuetext={unit ? `${v} ${unit}` : undefined}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromX(e.clientX)}
      onKeyDown={onKey}
    >
      <div className="lk-sl-trk lk-slot absolute inset-x-0 inset-y-[calc((100%_-_var(--lk-box))_/_2)] grid grid-cols-[repeat(16,1fr)] gap-u1 py-u1">
        {Array.from({ length: SEGMENTS }, (_, k) => (
          <i key={k} data-on={flag(k < v)} data-x={flag(k >= top)} />
        ))}
      </div>
      <div
        className="lk-sl-th absolute top-[calc((100%_-_var(--lk-box))_/_2_-_var(--px))] left-(--v) -ml-[calc(var(--px)_*_2)] h-[calc(var(--lk-box)_+_var(--px)_*_2)] w-[calc(var(--px)_*_4)]"
        style={cssVars({ "--v": `${((v - 0.5) / SEGMENTS) * 100}%` })}
      />
    </div>
  );
}
