import type { CSSProperties } from "react";
import { useMemory } from "@/hooks/useInstances";
import { formatMemory, memoryTooHigh } from "@/lib/format";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { Radio, SegSlider } from "@/components/px";
import { Icon } from "@/pixel/icons";

/** „Fabric 1.21.4“ bzw. „Vanilla 1.21.4“. */
export const loaderLine = (i: Pick<Instance, "loader" | "minecraftVersion">) => `${LOADER_LABELS[i.loader]} ${i.minecraftVersion}`;

/**
 * Hinweis zum Arbeitsspeicher. Zu viel für den PC: Warnung mit Symbol (nie nur Farbe) an derselben Stelle.
 * `value` wie bei MemoryChooser (null = automatisch).
 */
export function MemoryHelp({ value }: { value: number | null }) {
  const { auto, total } = useMemory();
  const gb = Math.max(1, Math.round((value ?? auto) / 1024));
  if (value != null && total != null && memoryTooHigh(gb * 1024, total))
    return (
      <span className="help memwarn" role="status">
        <Icon name="warn" small />
        <span>Das ist mehr als drei Viertel deines Arbeitsspeichers ({formatMemory(total)}). Windows und andere Programme können dann stocken.</span>
      </span>
    );
  return <span className="help">{total != null ? `Der Rechner hat ${formatMemory(total)}. ` : ""}Mehr als 8 GB bringt selten etwas.</span>;
}

/**
 * Arbeitsspeicher: „Automatisch“ oder eigener Wert als 16 Segmente (1 bis 16 GB).
 * `value` null = automatisch; sonst MB. Segmente über dem, was der PC übrig hat, sind gesperrt (flach, dunkel)
 * und die Grenze steht darunter. `help={false}`: Hinweis steht woanders (rechte Formularspalte, `MemoryHelp`).
 */
export function MemoryChooser({ name, value, onChange, autoText, help = true }: {
  name: string; value: number | null; onChange: (mb: number | null) => void; autoText?: string; help?: boolean;
}) {
  const { auto, max } = useMemory();
  const isAuto = value == null;
  const gb = Math.max(1, Math.round((value ?? auto) / 1024));
  const top = Math.max(1, Math.min(16, Math.floor(max / 1024)));
  return (
    <>
      <Radio name={name} checked={isAuto} onChange={() => onChange(null)}>
        Automatisch <span className="faint">({autoText ?? `zurzeit ${formatMemory(auto)}`})</span>
      </Radio>
      <Radio name={name} checked={!isAuto} onChange={() => onChange(gb * 1024)}>
        Eigener Wert
      </Radio>
      <div className="memrow">
        <div className="memsl" style={{ "--free": `${((16 - top) / 16) * 100}%` } as CSSProperties}>
          <SegSlider value={gb} max={top} disabled={isAuto} onChange={(v) => onChange(v * 1024)} />
          {/* Grenze unter dem letzten freien Segment; bei 16 unter dem Ende */}
          <span className="cap" aria-hidden>max. {top} GB</span>
        </div>
        <span className="num" style={{ color: isAuto ? "var(--fg-3)" : undefined }}>{gb} GB</span>
      </div>
      {help && <MemoryHelp value={value} />}
    </>
  );
}
