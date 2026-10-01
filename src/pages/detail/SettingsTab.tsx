import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Actions, Button, CardGrid, Disclosure, FormRow, FormSection, Hint, Menu, Progress, Radio, SceneCard, StatusPanel, TextArea, TextField } from "@/ui";
import { JavaChooser, MemoryChooser, MemoryHelp } from "@/components/common";
import { useInstallPercent, usePhase } from "@/components/game";
import { askDelete, useGroupMenu } from "@/components/instance";
import { UNGROUPED, useInstall, useUpdateInstance } from "@/hooks/useInstances";
import { LOADER_LABELS, SUPPORTED_LOADERS, type GameWindow, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BIOME_KEYS, BIOMES } from "@/pixel/scene";
import { useLook, useLookStore } from "@/store/look";
import { useSettings } from "@/store/settings";

const splitArgs = (s: string) => s.split(/\s+/).filter(Boolean);

type Size = { width: number; height: number };
/** Vorschlag, wenn zum ersten Mal „Feste Größe“ gewählt wird. */
const DEFAULT_SIZE: Size = { width: 1280, height: 720 };
const validSize = ({ width, height }: Size) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;

/** „Minecraft 1.21.4 · Fabric 0.16.10“; ohne Loader nur die Minecraft-Version. */
const versionText = (i: Instance) =>
  i.loader === "vanilla" ? `Minecraft ${i.minecraftVersion}` : `Minecraft ${i.minecraftVersion} · ${LOADER_LABELS[i.loader]}${i.loaderVersion ? ` ${i.loaderVersion}` : ""}`;

/** Einstellungen einer Instanz. Alles speichert sofort (Textfelder beim Verlassen des Felds). */
export function SettingsTab({ instance }: { instance: Instance }) {
  const update = useUpdateInstance();
  const install = useInstall();
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  const look = useLook(instance.id);
  const groupItems = useGroupMenu(instance);
  const globalJava = useSettings((s) => s.javaPath);
  const [name, setName] = useState(instance.name);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs.join(" "));
  const [gameArgs, setGameArgs] = useState(instance.gameArgs.join(" "));
  const [memory, setMemory] = useState(instance.memoryMb);
  // Immer mit dem neuesten Stand speichern (der Regler meldet viele Werte kurz hintereinander).
  const latest = useRef(instance);
  latest.current = instance;
  const memTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(memTimer.current), []);

  /** Änderung auf den neuesten Stand der Instanz anwenden; `done` wird nach dem Speichern gemeldet. */
  function save(patch: Partial<Instance>, done?: string) {
    update.mutate({ ...latest.current, ...patch }, { onSuccess: () => done && toast.success(done) });
  }

  function saveName() {
    const next = name.trim();
    if (!next) return setName(latest.current.name);
    if (next !== latest.current.name) save({ name: next }, "Name gespeichert");
  }

  function saveArgs(field: "jvmArgs" | "gameArgs", text: string) {
    const next = splitArgs(text);
    if (next.join(" ") !== latest.current[field].join(" ")) save({ [field]: next }, "Startoptionen gespeichert");
  }

  function changeMemory(mb: number | null) {
    setMemory(mb);
    clearTimeout(memTimer.current);
    memTimer.current = setTimeout(() => {
      if (latest.current.memoryMb !== mb) save({ memoryMb: mb });
    }, 400);
  }

  const busy = phase === "preparing" || phase === "starting" || phase === "running" || install.isPending;
  // Solange das Spiel läuft, lehnt das Backend jede Änderung an der Instanz ab; das Bild lebt nur lokal.
  const locked = phase === "starting" || phase === "running";
  const repairing = percent != null;
  const groupText = instance.group ?? UNGROUPED;

  return (
    <div className="max-w-[var(--page-max)] pt-2">
      {locked && <Hint className="mb-4">Während das Spiel läuft, nicht änderbar: Name, Gruppe und alles unter „Spiel“.</Hint>}
      <FormSection title="Allgemein">
        <FormRow label="Name" htmlFor="inst-name">
          <TextField
            id="inst-name"
            value={name}
            disabled={locked}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </FormRow>
        <FormRow label="Gruppe" hint="Abschnitt in der Bibliothek">
          <Actions>
            <Menu align="start" items={groupItems} trigger={<Button iconEnd="chevd" disabled={locked} aria-label={`Gruppe: ${groupText}`}>{groupText}</Button>} />
          </Actions>
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
          <MemoryChooser name="inst-mem" value={memory} onChange={changeMemory} help={false} disabled={locked} />
        </FormRow>
        <FormRow
          label="Java"
          hint="Nur für diese Instanz"
          group="radiogroup"
          aside="Meist passt die Einstellung des Launchers. Eine eigene Java-Installation brauchst du nur, wenn ein Modpack es verlangt."
        >
          <JavaChooser
            name="inst-java"
            value={instance.javaPath ?? ""}
            onChange={(path) => save({ javaPath: path || null }, "Java gespeichert")}
            disabled={locked}
            fallback={<>Wie in den Einstellungen <span className="text-fg-3">({globalJava ? "eigene Installation" : "automatisch"})</span></>}
          />
        </FormRow>
        <FormRow label="Fenster" hint="Beim Start des Spiels" group="radiogroup">
          <WindowChooser value={instance.window} onChange={(window, done) => save({ window }, done)} disabled={locked} />
        </FormRow>
        <FormRow label="Erweitert">
          <Disclosure summary="Java-Startoptionen" open={instance.jvmArgs.length > 0}>
            <TextArea
              rows={3}
              aria-label="Java-Startoptionen"
              aria-describedby="inst-args-h"
              placeholder="-XX:+UseG1GC"
              value={jvmArgs}
              disabled={locked}
              onChange={(e) => setJvmArgs(e.target.value)}
              onBlur={() => saveArgs("jvmArgs", jvmArgs)}
            />
            <Hint id="inst-args-h" className="mt-1.5">Nur ändern, wenn eine Mod-Anleitung es verlangt.</Hint>
          </Disclosure>
          <Disclosure summary="Spielargumente" open={instance.gameArgs.length > 0}>
            <TextArea
              rows={2}
              aria-label="Spielargumente"
              aria-describedby="inst-game-args-h"
              placeholder="--quickPlayMultiplayer play.example.net"
              value={gameArgs}
              disabled={locked}
              onChange={(e) => setGameArgs(e.target.value)}
              onBlur={() => saveArgs("gameArgs", gameArgs)}
            />
            <Hint id="inst-game-args-h" className="mt-1.5">Gehen an Minecraft selbst, z. B. um direkt einem Server beizutreten. Leerzeichen trennen. Die Fenstergröße stellst du unter „Fenster“ ein.</Hint>
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

/**
 * Fenster beim Start: wie Minecraft es öffnet, feste Größe oder Vollbild. Die Felder für die Größe bleiben stehen
 * und sind nur gesperrt (wie der Pfad bei Java); sie speichern beim Verlassen, Ungültiges springt zurück.
 */
function WindowChooser({ value, onChange, disabled }: { value: GameWindow; onChange: (window: GameWindow, done?: string) => void; disabled?: boolean }) {
  const saved = value.type === "size" ? value : DEFAULT_SIZE;
  const [width, setWidth] = useState(String(saved.width));
  const [height, setHeight] = useState(String(saved.height));
  const sized = value.type === "size";
  const draft = { type: "size" as const, width: Number(width), height: Number(height) };

  function commitSize() {
    if (!validSize(draft)) {
      setWidth(String(saved.width));
      setHeight(String(saved.height));
    } else if (draft.width !== saved.width || draft.height !== saved.height) {
      onChange(draft, "Fenstergröße gespeichert");
    }
  }

  const sizeField = (label: string, text: string, setText: (v: string) => void) => (
    <TextField
      width={96}
      inputMode="numeric"
      maxLength={5}
      aria-label={label}
      disabled={disabled || !sized}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commitSize}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );

  return (
    <>
      <Radio name="inst-window" checked={value.type === "default"} disabled={disabled} onChange={() => onChange({ type: "default" })}>
        Standard <span className="text-fg-3">(wie Minecraft es öffnet)</span>
      </Radio>
      <Radio name="inst-window" checked={sized} disabled={disabled} onChange={() => onChange(draft)}>Feste Größe</Radio>
      <Actions>
        {sizeField("Fensterbreite in Pixeln", width, setWidth)}
        <span className="text-fg-3" aria-hidden>×</span>
        {sizeField("Fensterhöhe in Pixeln", height, setHeight)}
      </Actions>
      <Radio name="inst-window" checked={value.type === "fullscreen"} disabled={disabled} onChange={() => onChange({ type: "fullscreen" })}>Vollbild</Radio>
    </>
  );
}
