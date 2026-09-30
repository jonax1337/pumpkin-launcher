import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn, Progress, TextArea, TextField, Tip } from "@/components/px";
import { loaderLine, MemoryChooser } from "@/components/common";
import { useInstallPercent, usePhase } from "@/components/game";
import { askDelete } from "@/components/instance";
import { useInstall, useUpdateInstance } from "@/hooks/useInstances";
import { LOADER_LABELS, SUPPORTED_LOADERS, type Instance } from "@/lib/types";
import { Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { BIOME_KEYS, BIOMES } from "@/pixel/scene";
import { useLook, useLookStore } from "@/store/look";

const splitArgs = (s: string) => s.split(/\s+/).filter(Boolean);

/** Einstellungen einer Instanz. Alles speichert sofort (Name und Startoptionen beim Verlassen des Felds). */
export function SettingsTab({ instance }: { instance: Instance }) {
  const update = useUpdateInstance();
  const install = useInstall();
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  const look = useLook(instance.id);
  const [name, setName] = useState(instance.name);
  const [args, setArgs] = useState(instance.jvmArgs.join(" "));
  const [memory, setMemory] = useState(instance.memoryMb);
  // Immer mit dem neuesten Stand speichern (der Regler meldet viele Werte kurz hintereinander).
  const latest = useRef(instance);
  latest.current = instance;
  const memTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(memTimer.current), []);

  function saveName() {
    const next = name.trim();
    if (!next) return setName(latest.current.name);
    if (next === latest.current.name) return;
    update.mutate({ ...latest.current, name: next }, { onSuccess: () => toast.success("Name gespeichert") });
  }

  function saveArgs() {
    const next = splitArgs(args);
    if (next.join(" ") === latest.current.jvmArgs.join(" ")) return;
    update.mutate({ ...latest.current, jvmArgs: next }, { onSuccess: () => toast.success("Startoptionen gespeichert") });
  }

  function changeMemory(mb: number | null) {
    setMemory(mb);
    clearTimeout(memTimer.current);
    memTimer.current = setTimeout(() => {
      if (latest.current.memoryMb !== mb) update.mutate({ ...latest.current, memoryMb: mb });
    }, 400);
  }

  const busy = phase === "preparing" || phase === "starting" || phase === "running" || install.isPending;
  const repairing = percent != null;

  return (
    <div className="form">
      <div className="fsec">
        <h3>Allgemein</h3>
        <div className="frow">
          <label htmlFor="inst-name">Name</label>
          <div className="fc">
            <TextField
              id="inst-name"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </div>
        </div>
        <div className="frow">
          <div className="fl">Bild<small>Erscheint auf Start, Poster und Kopf.</small></div>
          <div className="fc">
            <div className="biopick" role="group" aria-label="Szene wählen">
              {BIOME_KEYS.map((b) => (
                <Tip key={b} label={BIOMES[b].n}>
                  <button
                    type="button"
                    className="bio fx"
                    aria-pressed={look.bio === b}
                    aria-label={BIOMES[b].n}
                    onClick={() => useLookStore.getState().setBiome(instance.id, b)}
                  >
                    <PixelScene bio={b} seed={look.seed} />
                  </button>
                </Tip>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="fsec">
        <h3>Spiel</h3>
        <div className="frow">
          <div className="fl">Arbeitsspeicher<small>Automatisch nimmt den Standard aus den Einstellungen.</small></div>
          <div className="fc">
            <MemoryChooser name="inst-mem" value={memory} onChange={changeMemory} />
          </div>
        </div>
        <div className="frow">
          <div className="fl">Erweitert</div>
          <div className="fc">
            <details className="adv" open={instance.jvmArgs.length > 0 || undefined}>
              <summary><Icon name="chevr" small />Java-Startoptionen</summary>
              <div style={{ paddingTop: 8 }}>
                <TextArea
                  rows={3}
                  aria-label="Java-Startoptionen"
                  placeholder="-XX:+UseG1GC"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  onBlur={saveArgs}
                />
                <p className="help" style={{ marginTop: 6 }}>Nur ändern, wenn eine Mod-Anleitung es verlangt.</p>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="fsec">
        <h3>Version</h3>
        <div className="frow">
          <div className="fl">
            Minecraft
            <small>{loaderLine(instance)}{instance.loaderVersion ? `, ${LOADER_LABELS[instance.loader]} ${instance.loaderVersion}` : ""}</small>
          </div>
          <div className="fc">
            <span className="help" style={{ paddingTop: 10 }}>Version und Loader stehen fest. Für eine andere Version leg eine neue Instanz an.</span>
          </div>
        </div>
        {SUPPORTED_LOADERS.includes(instance.loader) && (
          <div className="frow">
            <div className="fl">Reparieren<small>Lädt fehlende oder beschädigte Dateien neu. Welten und Mods bleiben.</small></div>
            <div className="fc">
              <div className="row">
                <Btn icon="redo" full style={{ width: 160 }} disabled={busy} onClick={() => install.mutate(instance)}>
                  {repairing ? "Läuft" : "Reparieren"}
                </Btn>
                <Progress p={(percent ?? 0) / 100} style={{ width: 180, visibility: repairing ? "visible" : "hidden" }} label="Fortschritt" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="fsec">
        <h3>Gefahrenzone</h3>
        <div className="danger">
          <div className="t">
            <b>Instanz löschen</b>
            <span>Entfernt Mods, Einstellungen und Welten dieser Instanz.</span>
          </div>
          <Btn variant="d" icon="trash" disabled={phase === "running" || phase === "preparing" || phase === "starting"} onClick={() => askDelete(instance)}>Löschen</Btn>
        </div>
      </div>
    </div>
  );
}
