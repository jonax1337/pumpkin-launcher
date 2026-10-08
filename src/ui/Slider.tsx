import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { clamp, cssVars, flag } from "./util";

/** Anzahl der Segmente; muss zu `repeat(16, 1fr)` und `* 16` in toggle.css passen. */
const SEGMENTS = 16;

const STEP_UP_KEYS = ["ArrowRight", "ArrowUp", "PageUp"];
const STEP_KEYS = [...STEP_UP_KEYS, "ArrowLeft", "ArrowDown", "PageDown", "Home", "End"];

/**
 * Wert von 1 bis 16 als 16 Zellen (XP-Leiste im Slot) mit Steingriff. Pfeile, Bild auf/ab, Pos1, Ende.
 * Segmente über `max` sind gesperrt. `label` ist der Name; `unit` hängt an den vorgelesenen Wert („6 GB“).
 */
export function SegSlider({ value, onChange, disabled, max = SEGMENTS, label, unit, id }: {
  value: number; onChange: (v: number) => void; disabled?: boolean; max?: number; label: string; unit?: string; id?: string;
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
      className="vx-slider"
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
      <div className="vx-sl-trk vx-slot">
        {Array.from({ length: SEGMENTS }, (_, k) => (
          <i key={k} data-on={flag(k < v)} data-x={flag(k >= top)} />
        ))}
      </div>
      <div className="vx-sl-th" style={cssVars({ "--v": `${((v - 0.5) / SEGMENTS) * 100}%` })} />
    </div>
  );
}
