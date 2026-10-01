import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Actions, Button, CardGrid, Disclosure, FormRow, FormSection, Hint, Menu, Progress, Radio, StatusPanel, TextArea, TextField, ThumbCard } from "@/ui";
import { JavaChooser, MemoryChooser, MemoryHelp } from "@/components/common";
import { isBusy, isGameLive, useInstallPercent, usePhase } from "@/components/game";
import { askDelete, useGroupMenu } from "@/components/instance";
import { useInstall, useUpdateInstance } from "@/hooks/useInstances";
import { blurOnEnter } from "@/lib/dom";
import { LOADER_LABELS, type GameWindow, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { BIOME_KEYS } from "@/pixel/scene";
import { useLook, useLookStore } from "@/store/look";
import { useSettings } from "@/store/settings";

const splitArgs = (s: string) => s.split(/\s+/).filter(Boolean);

/** „Minecraft 1.21.4 · Fabric 0.16.10“; ohne Loader nur die Minecraft-Version. */
const versionText = (i: Instance) =>
  i.loader === "vanilla" ? `Minecraft ${i.minecraftVersion}` : `Minecraft ${i.minecraftVersion} · ${LOADER_LABELS[i.loader]}${i.loaderVersion ? ` ${i.loaderVersion}` : ""}`;

/** Einstellungen einer Instanz. Alles speichert sofort (Textfelder beim Verlassen des Felds). */
export function SettingsTab({ instance }: { instance: Instance }) {
  const { t } = useI18n();
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
    if (next !== latest.current.name) save({ name: next }, t("detail.settings.nameSaved"));
  }

  function saveArgs(field: "jvmArgs" | "gameArgs", text: string, done: string) {
    const next = splitArgs(text);
    if (next.join(" ") !== latest.current[field].join(" ")) save({ [field]: next }, done);
  }

  function changeMemory(mb: number | null) {
    setMemory(mb);
    clearTimeout(memTimer.current);
    memTimer.current = setTimeout(() => {
      if (latest.current.memoryMb !== mb) save({ memoryMb: mb });
    }, 400);
  }

  const busy = isBusy(phase) || install.isPending;
  // Solange das Spiel läuft, lehnt das Backend jede Änderung an der Instanz ab; das Bild lebt nur lokal.
  const locked = isGameLive(phase);
  const repairing = percent != null;
  const groupText = instance.group ?? t("detail.settings.noGroup");

  return (
    <div className="max-w-[var(--page-max)] pt-2">
      {locked && <Hint className="mb-4">{t("detail.settings.lockedHint")}</Hint>}
      <FormSection title={t("detail.settings.generalSection")}>
        <FormRow label={t("common.name")} htmlFor="inst-name">
          <TextField
            id="inst-name"
            value={name}
            disabled={locked}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={blurOnEnter}
          />
        </FormRow>
        <FormRow label={t("components.instance.group")} hint={t("detail.settings.groupHint")}>
          <Actions>
            <Menu align="start" items={groupItems} trigger={<Button iconEnd="chevd" disabled={locked} aria-label={t("detail.settings.groupAria", { name: groupText })}>{groupText}</Button>} />
          </Actions>
        </FormRow>
        <FormRow label={t("detail.settings.lookLabel")} hint={t("detail.settings.lookHint")} wide>
          {/* Name sichtbar unter der Miniatur (dunkle Szenen wie die Höhle sind klein kaum zu erkennen) */}
          <CardGrid variant="thumb" role="group" aria-label={t("detail.settings.sceneAria")}>
            {BIOME_KEYS.map((b) => (
              <ThumbCard
                key={b}
                look={{ bio: b, seed: look.seed }}
                title={t(`ui.biome.${b}`)}
                pressed={look.bio === b}
                hit={{ onClick: () => useLookStore.getState().setBiome(instance.id, b) }}
              />
            ))}
          </CardGrid>
        </FormRow>
      </FormSection>

      <FormSection title={t("pages.settings.tabGame")}>
        <FormRow label={t("ui.memory.label")} hint={t("detail.settings.memoryHint")} group="radiogroup" aside={<MemoryHelp value={memory} />}>
          <MemoryChooser name="inst-mem" value={memory} onChange={changeMemory} help={false} disabled={locked} />
        </FormRow>
        <FormRow
          label={t("detail.settings.javaLabel")}
          hint={t("detail.settings.javaOnlyHint")}
          group="radiogroup"
          aside={t("detail.settings.javaAside")}
        >
          <JavaChooser
            name="inst-java"
            value={instance.javaPath ?? ""}
            onChange={(path) => save({ javaPath: path || null }, t("detail.settings.javaSaved"))}
            disabled={locked}
            fallback={<>{t("detail.settings.javaFallback")} <span className="text-fg-3">({globalJava ? t("detail.settings.javaOwnInstall") : t("detail.settings.javaAutomatic")})</span></>}
          />
        </FormRow>
        <FormRow label={t("detail.settings.windowLabel")} hint={t("detail.settings.windowHint")} group="radiogroup">
          <WindowChooser value={instance.window} onChange={(window, done) => save({ window }, done)} disabled={locked} />
        </FormRow>
        <FormRow label={t("components.newInstance.advanced")}>
          <Disclosure summary={t("detail.settings.jvmOptionsLabel")} open={instance.jvmArgs.length > 0}>
            <TextArea
              rows={3}
              aria-label={t("detail.settings.jvmOptionsLabel")}
              aria-describedby="inst-args-h"
              placeholder="-XX:+UseG1GC"
              value={jvmArgs}
              disabled={locked}
              onChange={(e) => setJvmArgs(e.target.value)}
              onBlur={() => saveArgs("jvmArgs", jvmArgs, t("detail.settings.jvmOptionsSaved"))}
            />
            <Hint id="inst-args-h" className="mt-1.5">{t("detail.settings.jvmOptionsHint")}</Hint>
          </Disclosure>
          <Disclosure summary={t("detail.settings.gameArgsLabel")} open={instance.gameArgs.length > 0}>
            <TextArea
              rows={2}
              aria-label={t("detail.settings.gameArgsLabel")}
              aria-describedby="inst-game-args-h"
              placeholder="--quickPlayMultiplayer play.example.net"
              value={gameArgs}
              disabled={locked}
              onChange={(e) => setGameArgs(e.target.value)}
              onBlur={() => saveArgs("gameArgs", gameArgs, t("detail.settings.gameArgsSaved"))}
            />
            <Hint id="inst-game-args-h" className="mt-1.5">{t("detail.settings.gameArgsHint")}</Hint>
          </Disclosure>
        </FormRow>
      </FormSection>

      <FormSection title={t("common.version")}>
        <FormRow label={t("detail.settings.gameVersionLabel")} aside={t("detail.settings.versionAside")}>
          {/* Reiner Text: auf Höhe des Labels (10 px wie dessen Innenabstand) */}
          <span className="pt-2.5">{versionText(instance)}</span>
        </FormRow>
        <FormRow label={t("detail.settings.repairLabel")} hint={t("detail.settings.repairHint")}>
          <Actions>
            <Button icon="redo" width={160} disabled={busy} onClick={() => install.mutate(instance)}>
              {repairing ? t("detail.settings.repairing") : t("detail.settings.repairLabel")}
            </Button>
            {/* Platz bleibt reserviert: der Balken erscheint, ohne dass etwas springt */}
            <Progress p={(percent ?? 0) / 100} width={180} className={cn(!repairing && "invisible")} label={t("detail.settings.repairProgress")} />
          </Actions>
        </FormRow>
      </FormSection>

      <FormSection title={t("detail.settings.dangerSection")}>
        <StatusPanel
          tone="bad"
          title={t("detail.settings.deleteInstance")}
          actions={
            <Button variant="danger" icon="trash" disabled={isBusy(phase)} onClick={() => askDelete(instance)}>
              {t("common.delete")}
            </Button>
          }
        >
          {t("detail.settings.deleteInstanceText")}
        </StatusPanel>
      </FormSection>
    </div>
  );
}

type Size = { width: number; height: number };
/** Vorschlag, wenn zum ersten Mal „Feste Größe“ gewählt wird. */
const DEFAULT_SIZE: Size = { width: 1280, height: 720 };
const validSize = ({ width, height }: Size) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;

/**
 * Fenster beim Start: wie Minecraft es öffnet, feste Größe oder Vollbild. Die Felder für die Größe bleiben stehen
 * und sind nur gesperrt (wie der Pfad bei Java); sie speichern beim Verlassen, Ungültiges springt zurück.
 */
function WindowChooser({ value, onChange, disabled }: { value: GameWindow; onChange: (window: GameWindow, done?: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const sized = value.type === "size";
  const saved = sized ? value : DEFAULT_SIZE;
  const [width, setWidth] = useState(String(saved.width));
  const [height, setHeight] = useState(String(saved.height));
  const draft = { type: "size" as const, width: Number(width), height: Number(height) };

  function commitSize() {
    if (!validSize(draft)) {
      setWidth(String(saved.width));
      setHeight(String(saved.height));
    } else if (draft.width !== saved.width || draft.height !== saved.height) {
      onChange(draft, t("detail.settings.windowSizeSaved"));
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
      onKeyDown={blurOnEnter}
    />
  );

  return (
    <>
      <Radio name="inst-window" checked={value.type === "default"} disabled={disabled} onChange={() => onChange({ type: "default" })}>
        {t("format.memoryDefault")} <span className="text-fg-3">({t("detail.settings.windowAsMinecraft")})</span>
      </Radio>
      <Radio name="inst-window" checked={sized} disabled={disabled} onChange={() => onChange(draft)}>{t("detail.settings.windowFixedSize")}</Radio>
      <Actions>
        {sizeField(t("detail.settings.windowWidthAria"), width, setWidth)}
        <span className="text-fg-3" aria-hidden>×</span>
        {sizeField(t("detail.settings.windowHeightAria"), height, setHeight)}
      </Actions>
      <Radio name="inst-window" checked={value.type === "fullscreen"} disabled={disabled} onChange={() => onChange({ type: "fullscreen" })}>{t("detail.settings.windowFullscreen")}</Radio>
    </>
  );
}
