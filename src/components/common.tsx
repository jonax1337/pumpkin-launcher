import { useMemory } from "@/hooks/useInstances";
import { formatMemory, memoryTooHigh } from "@/lib/format";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { Radio, SegSlider } from "@/components/px";

/** „Fabric 1.21.4“ bzw. „Vanilla 1.21.4“. */
export const loaderLine = (i: Pick<Instance, "loader" | "minecraftVersion">) => `${LOADER_LABELS[i.loader]} ${i.minecraftVersion}`;

/**
 * Arbeitsspeicher: „Automatisch“ oder eigener Wert als 16 Segmente (1 bis 16 GB).
 * `value` null = automatisch; sonst MB. Segmente über dem, was der PC übrig hat, sind gesperrt.
 */
export function MemoryChooser({ name, value, onChange, autoText }: { name: string; value: number | null; onChange: (mb: number | null) => void; autoText?: string }) {
  const { auto, total, max } = useMemory();
  const isAuto = value == null;
  const gb = Math.max(1, Math.round((value ?? auto) / 1024));
  return (
    <>
      <Radio name={name} checked={isAuto} onChange={() => onChange(null)}>
        Automatisch <span className="faint">({autoText ?? `zurzeit ${formatMemory(auto)}`})</span>
      </Radio>
      <Radio name={name} checked={!isAuto} onChange={() => onChange(gb * 1024)}>
        Eigener Wert
      </Radio>
      <div className="row" style={{ gap: 14 }}>
        <SegSlider value={gb} max={Math.floor(max / 1024)} disabled={isAuto} onChange={(v) => onChange(v * 1024)} />
        <span className="num" style={{ fontSize: 24, width: 64, color: isAuto ? "var(--fg-3)" : undefined }}>{gb} GB</span>
      </div>
      {!isAuto && total != null && memoryTooHigh(gb * 1024, total) ? (
        <span className="help text-warn">Das ist mehr als drei Viertel deines Arbeitsspeichers ({formatMemory(total)}). Windows und andere Programme können dann stocken.</span>
      ) : (
        <span className="help">{total != null ? `Der Rechner hat ${formatMemory(total)}. ` : ""}Mehr als 8 GB bringt selten etwas.</span>
      )}
    </>
  );
}
