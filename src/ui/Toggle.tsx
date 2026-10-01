import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Count } from "./Chip";
import { Tabs, type TabsProps } from "./Tabs";

/**
 * Schalter 40×22: Bahn eingelassen, Knauf als Block; an = Kupferbahn, Knauf rechts (Stufen).
 * `label` ist der Name; `visibleLabel` zeigt ihn rechts daneben (klickbar). `stateText` = [an, aus] als leiser Text
 * daneben (feste Breite, nur sichtbar; der Zustand selbst wird vom Schalter angesagt).
 */
export function Switch({ checked, onChange, label, stateText, visibleLabel, disabled, id }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; stateText?: [on: string, off: string]; visibleLabel?: boolean; disabled?: boolean; id?: string;
}) {
  return (
    <label className="vx-switch" data-disabled={disabled ? "" : undefined}>
      <span className="vx-sw">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={visibleLabel ? undefined : label} onChange={(e) => onChange(e.target.checked)} />
        <span className="vx-sw-tr" />
        <span className="vx-sw-kn" />
        <span className="vx-fring" />
      </span>
      {visibleLabel && <span className="vx-tl">{label}</span>}
      {stateText && (
        <span className="vx-sw-st" aria-hidden>
          <span data-on={checked ? "" : undefined}>{stateText[0]}</span>
          <span data-on={checked ? undefined : ""}>{stateText[1]}</span>
        </span>
      )}
    </label>
  );
}

/**
 * Checkbox 20×20, eingelassen; an = Kupferblock + 5×5-Haken (Icon s: bei Pixelstufe groß füllt er die Fläche), teilweise = Strich.
 * Mit `children` steht die Beschriftung sichtbar daneben und ist der Name (ersetzt .ni-check); ohne ist `label` der Name.
 */
export function Checkbox({ checked, indeterminate, onChange, label, disabled, id, children }: {
  checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string;
} & ({ label: string; children?: never } | { label?: string; children: ReactNode })) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const box = (
    <span className="vx-cb">
      <input ref={ref} id={id} type="checkbox" checked={checked} disabled={disabled} aria-label={children ? undefined : label} onChange={(e) => onChange(e.target.checked)} />
      <span className="vx-cb-box" />
      <Icon name="check" size="s" />
      <span className="vx-cb-dash" />
      <span className="vx-fring" />
    </span>
  );
  if (!children) return <label className="vx-check" data-bare="" data-disabled={disabled ? "" : undefined}>{box}</label>;
  return (
    <label className="vx-check" data-disabled={disabled ? "" : undefined}>
      {box}
      <span className="vx-tl">{children}</span>
    </label>
  );
}

/** Radio 20×20, zweistufig gekerbt; an = Kupferrahmen + 2×2-Kern. Beschriftung = children. Pfeiltasten regelt der Browser (gleicher name). */
export function Radio({ name, checked, onChange, disabled, value, id, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; value?: string; id?: string; children: ReactNode }) {
  return (
    <label className="vx-radio" data-disabled={disabled ? "" : undefined}>
      <input type="radio" id={id} name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="vx-rb"><span className="vx-fring" /></span>
      <span className="vx-tl">{children}</span>
    </label>
  );
}

export type RadioOption<V extends string> = { value: V; label: ReactNode; disabled?: boolean };

/**
 * Radios untereinander (Abstand 0, jede Zeile mindestens 32 px). Mit `label`/`labelledBy` ein eigenes role=radiogroup;
 * ohne (z. B. in FormRow group="radiogroup") nur die Liste.
 */
export function RadioGroup<V extends string>({ name, value, onChange, options, label, labelledBy, describedBy, className }: {
  name: string; value: V; onChange: (v: V) => void; options: RadioOption<V>[]; label?: string; labelledBy?: string; describedBy?: string; className?: string;
}) {
  const group = label != null || labelledBy != null;
  return (
    <div className={cn("vx-radios", className)} role={group ? "radiogroup" : undefined} aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}>
      {options.map((o) => (
        <Radio key={o.value} name={name} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)}>
          {o.label}
        </Radio>
      ))}
    </div>
  );
}

/** Segment-Umschalter für einen Wert (Poster/Liste, Pixelgröße …) = Tabs variant="segment" mit role=radiogroup. */
export function Segmented<V extends string>(props: Omit<TabsProps<V>, "variant" | "role" | "idBase" | "sticky">) {
  return <Tabs {...props} variant="segment" role="radiogroup" />;
}

/**
 * Arbeitsspeicher als 16 Segmente (1 bis 16 GB) mit Griffblock. Pfeile, Bild auf/ab, Pos1, Ende.
 * Segmente über `max` sind gesperrt (mehr hat der PC nicht übrig).
 * `showMax`: Grenze „max. N GB“ unter dem letzten freien Segment · `showValue`: Wert als Pixelzahl rechts (feste Breite, aus = grau).
 */
export function SegSlider({ value, onChange, disabled, max = 16, label, id, showMax, showValue }: {
  value: number; onChange: (gb: number) => void; disabled?: boolean; max?: number; label?: string; id?: string; showMax?: boolean; showValue?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const name = label ?? t("ui.memory.label");
  const top = Math.max(1, Math.min(16, Math.floor(max)));
  const v = Math.max(1, Math.min(top, Math.round(value)));
  const set = (n: number) => onChange(Math.max(1, Math.min(top, Math.round(n))));
  const fromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    set(1 + ((clientX - r.left) / r.width) * 16 - 0.5);
  };
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromX(e.clientX);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const k = e.key;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(k)) return;
    e.preventDefault();
    set(k === "Home" ? 1 : k === "End" ? top : v + (["ArrowRight", "ArrowUp", "PageUp"].includes(k) ? 1 : -1));
  }
  const slider = (
    <div
      ref={ref}
      id={id}
      className="vx-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={name}
      aria-valuemin={1}
      aria-valuemax={top}
      aria-valuenow={v}
      aria-valuetext={`${v} GB`}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromX(e.clientX)}
      onKeyDown={onKey}
    >
      <div className="vx-sl-trk">
        {Array.from({ length: 16 }, (_, k) => (
          <i key={k} data-on={k < v ? "" : undefined} data-x={k >= top ? "" : undefined} />
        ))}
      </div>
      <div className="vx-sl-th" style={{ left: `${((v - 0.5) / 16) * 100}%` }} />
    </div>
  );
  if (!showMax && !showValue) return slider;
  return (
    <div className="vx-slw">
      <div className="vx-slw-c" style={{ "--free": `${((16 - top) / 16) * 100}%` } as CSSProperties}>
        {slider}
        {/* Grenze unter dem letzten freien Segment; bei 16 unter dem Ende */}
        {showMax && <span className="vx-slw-cap" aria-hidden>{t("components.memory.maxGb", { n: top })}</span>}
      </div>
      {showValue && <Count value={`${v} GB`} size={26} muted={disabled} />}
    </div>
  );
}
