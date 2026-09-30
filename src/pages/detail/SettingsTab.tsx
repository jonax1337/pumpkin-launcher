import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Actions, Button, CardGrid, Disclosure, FormRow, FormSection, Hint, Progress, SceneCard, StatusPanel, TextArea, TextField } from "@/ui";
import { MemoryChooser, MemoryHelp } from "@/components/common";
import { useInstallPercent, usePhase } from "@/components/game";
import { askDelete } from "@/components/instance";
import { useInstall, useUpdateInstance } from "@/hooks/useInstances";
import { LOADER_LABELS, SUPPORTED_LOADERS, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
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
    <div className="max-w-[var(--page-max)] pt-2">
      <FormSection title="Allgemein">
        <FormRow label="Name" htmlFor="inst-name">
          <TextField
            id="inst-name"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </FormRow>
        <FormRow label="Bild" hint="Erscheint auf Start, Poster und Kopf." wide>
          {/* Name sichtbar unter der Miniatur (dunkle Szenen wie die Höhle sind klein kaum zu erkennen) */}
          <CardGrid variant="thumb" role="group" aria-label="Szene wählen">
            {BIOME_KEYS.map((b) => (
              <SceneCard
                key={b}
                variant="thumb"
                look={{ bio: b, seed: look.seed }}
                title={BIOMES[b].n}
                pressed={look.bio === b}
                hit={{ onClick: () => useLookStore.getState().setBiome(instance.id, b) }}
              />
            ))}
          </CardGrid>
        </FormRow>
      </FormSection>

      <FormSection title="Spiel">
        <FormRow label="Arbeitsspeicher" hint="Automatisch nimmt den Standard aus den Einstellungen." group="radiogroup" aside={<MemoryHelp value={memory} />}>
          <MemoryChooser name="inst-mem" value={memory} onChange={changeMemory} help={false} />
        </FormRow>
        <FormRow label="Erweitert">
          <Disclosure summary="Java-Startoptionen" open={instance.jvmArgs.length > 0}>
            <TextArea
              rows={3}
              aria-label="Java-Startoptionen"
              aria-describedby="inst-args-h"
              placeholder="-XX:+UseG1GC"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              onBlur={saveArgs}
            />
            <Hint id="inst-args-h" className="mt-1.5">Nur ändern, wenn eine Mod-Anleitung es verlangt.</Hint>
          </Disclosure>
        </FormRow>
      </FormSection>

      <FormSection title="Version">
        <FormRow label="Spielversion" aside="Version und Loader lassen sich nachträglich nicht ändern. Für eine andere Version leg eine neue Instanz an.">
          {/* Reiner Text: auf Höhe des Labels (10 px wie dessen Innenabstand) */}
          <span className="pt-2.5">{versionText(instance)}</span>
        </FormRow>
        {SUPPORTED_LOADERS.includes(instance.loader) && (
          <FormRow label="Reparieren" hint="Lädt fehlende oder beschädigte Dateien neu. Welten und Mods bleiben.">
            <Actions>
              <Button icon="redo" width={160} disabled={busy} onClick={() => install.mutate(instance)}>
                {repairing ? "Wird repariert" : "Reparieren"}
              </Button>
              {/* Platz bleibt reserviert: der Balken erscheint, ohne dass etwas springt */}
              <Progress p={(percent ?? 0) / 100} width={180} className={cn(!repairing && "invisible")} label="Reparatur" />
            </Actions>
          </FormRow>
        )}
      </FormSection>

      <FormSection title="Gefahrenzone">
        <StatusPanel
          tone="bad"
          title="Instanz löschen"
          actions={
            <Button variant="danger" icon="trash" disabled={phase === "running" || phase === "preparing" || phase === "starting"} onClick={() => askDelete(instance)}>
              Löschen
            </Button>
          }
        >
          Entfernt Mods, Einstellungen und Welten dieser Instanz.
        </StatusPanel>
      </FormSection>
    </div>
  );
}
