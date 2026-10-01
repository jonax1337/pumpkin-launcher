import { useState, type CSSProperties, type ReactNode } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useMemory } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { formatMemory, formatPlaytime, memoryTooHigh } from "@/lib/format";
import { platform } from "@/lib/platform";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { Actions, Button, Hint, Radio, SegSlider, TextField } from "@/ui";

/** „Fabric 1.21.4“ bzw. „Vanilla 1.21.4“. */
export const loaderLine = (i: Pick<Instance, "loader" | "minecraftVersion">) => `${LOADER_LABELS[i.loader]} ${i.minecraftVersion}`;

/** „37 Std. gespielt“; ohne Spielzeit leer. */
export const playtimeLine = (i: Pick<Instance, "playtimeSecs">) => (i.playtimeSecs > 0 ? `${formatPlaytime(i.playtimeSecs)} gespielt` : "");

/**
 * Hinweis zum Arbeitsspeicher. Zu viel für den PC: Warnung mit Symbol (nie nur Farbe) an derselben Stelle.
 * `value` wie bei MemoryChooser (null = automatisch).
 */
export function MemoryHelp({ value }: { value: number | null }) {
  const { auto, total } = useMemory();
  const gb = Math.max(1, Math.round((value ?? auto) / 1024));
  if (value != null && total != null && memoryTooHigh(gb * 1024, total))
    return (
      <Hint tone="warn" live>
        Das ist mehr als drei Viertel deines Arbeitsspeichers ({formatMemory(total)}). Das System und andere Programme können dann stocken.
      </Hint>
    );
  return <Hint>{total != null ? `Der Rechner hat ${formatMemory(total)}. ` : ""}Mehr als 8 GB bringt selten etwas.</Hint>;
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

/** Java-Programmdatei dieses Systems mit Beispielpfad; nur unter Windows hat sie eine Endung für den Dateifilter. */
const JAVA_PROGRAM = {
  windows: { file: "javaw.exe", example: "C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe", extensions: ["exe"] },
  macos: { file: "java", example: "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java", extensions: null },
  linux: { file: "java", example: "/usr/lib/jvm/java-21-openjdk/bin/java", extensions: null },
}[platform];

/**
 * Java: ohne eigenen Pfad (`value` leer; was dann gilt, beschreibt `fallback`) oder eigene Java-Programmdatei.
 * Gemeldet wird erst beim Verlassen des Felds, mit Enter oder nach „Durchsuchen“, nicht je Tastendruck.
 */
export function JavaChooser({ name, value, onChange, fallback }: { name: string; value: string; onChange: (path: string) => void; fallback: ReactNode }) {
  const [own, setOwn] = useState(value !== "");
  const [draft, setDraft] = useState(value);
  function commit(path: string) {
    setDraft(path);
    if (path.trim() !== value) onChange(path.trim());
  }
  async function browse() {
    const { extensions } = JAVA_PROGRAM;
    const picked = await openFile({ multiple: false, directory: false, filters: extensions ? [{ name: "Java", extensions }] : undefined });
    if (typeof picked === "string") commit(picked);
  }
  return (
    <>
      <Radio name={name} checked={!own} onChange={() => (setOwn(false), commit(""))}>{fallback}</Radio>
      <Radio name={name} checked={own} onChange={() => setOwn(true)}>Eigene Java-Installation</Radio>
      {/* Bleibt stehen und ist nur gesperrt, wie der Regler bei „Automatisch“: kein Sprung, keine Lücke.
          Gesperrt ohne Beispielpfad, sonst wirkt es, als wäre schon ein Pfad gesetzt. */}
      <Actions>
        <TextField
          width="full"
          disabled={!own}
          aria-label={`Pfad zu ${JAVA_PROGRAM.file}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder={own ? `z. B. ${JAVA_PROGRAM.example}` : `Pfad zu ${JAVA_PROGRAM.file}`}
        />
        {!api.isMock && <Button disabled={!own} onClick={() => void browse().catch((e: Error) => toast.error(e.message))}>Durchsuchen</Button>}
      </Actions>
    </>
  );
}
