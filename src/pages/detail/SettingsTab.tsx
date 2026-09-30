import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn, Progress, TextArea, TextField } from "@/components/px";
import { MemoryChooser, MemoryHelp } from "@/components/common";
import { useInstallPercent, usePhase } from "@/components/game";
import { askDelete } from "@/components/instance";
import { useInstall, useUpdateInstance } from "@/hooks/useInstances";
import { LOADER_LABELS, SUPPORTED_LOADERS, type Instance } from "@/lib/types";
import { Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { BIOME_KEYS, BIOMES } from "@/pixel/scene";
import { useLook, useLookStore } from "@/store/look";

const splitArgs = (s: string) => s.split(/\s+/).filter(Boolean);

/** „Minecraft 1.21.4 · Fabric 0.16.10“; ohne Loader nur die Minecraft-Version. */
const versionText = (i: Instance) =>
  i.loader === "vanilla" ? `Minecraft ${i.minecraftVersion}` : `Minecraft ${i.minecraftVersion} · ${LOADER_LABELS[i.loader]}${i.loaderVersion ? ` ${i.loaderVersion}` : ""}`;

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
        <h2>Allgemein</h2>
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
          <div className="fc wide">
            {/* Name sichtbar unter der Miniatur (dunkle Szenen wie die Höhle sind klein kaum zu erkennen) */}
            <div className="biopick" role="group" aria-label="Szene wählen">
              {BIOME_KEYS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className="bio fx"
                  data-bio={b}
                  aria-pressed={look.bio === b}
                  onClick={() => useLookStore.getState().setBiome(instance.id, b)}
                >
                  <span className="bth"><PixelScene bio={b} seed={look.seed} /></span>
                  <span className="bn">{BIOMES[b].n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="fsec">
        <h2>Spiel</h2>
        <div className="frow">
          <div className="fl"><span id="inst-mem-l">Arbeitsspeicher</span><small id="inst-mem-h">Automatisch nimmt den Standard aus den Einstellungen.</small></div>
          <div className="fc" role="radiogroup" aria-labelledby="inst-mem-l" aria-describedby="inst-mem-h">
            <MemoryChooser name="inst-mem" value={memory} onChange={changeMemory} help={false} />
          </div>
          <div className="fh"><MemoryHelp value={memory} /></div>
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
        <h2>Version</h2>
        <div className="frow">
          <div className="fl">Spielversion</div>
          <div className="fc" style={{ paddingTop: 10 }}>
            <span>{versionText(instance)}</span>
          </div>
          <div className="fh">Version und Loader lassen sich nachträglich nicht ändern. Für eine andere Version leg eine neue Instanz an.</div>
        </div>
        {SUPPORTED_LOADERS.includes(instance.loader) && (
          <div className="frow">
            <div className="fl">Reparieren<small>Lädt fehlende oder beschädigte Dateien neu. Welten und Mods bleiben.</small></div>
            <div className="fc">
              <div className="row">
                <Btn icon="redo" full style={{ width: 160 }} disabled={busy} onClick={() => install.mutate(instance)}>
                  {repairing ? "Wird repariert" : "Reparieren"}
                </Btn>
                <Progress p={(percent ?? 0) / 100} style={{ width: 180, visibility: repairing ? "visible" : "hidden" }} label="Fortschritt" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="fsec">
        <h2>Gefahrenzone</h2>
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
