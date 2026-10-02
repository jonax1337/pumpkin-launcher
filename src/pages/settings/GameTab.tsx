import { useState } from "react";
import { toast } from "sonner";
import { Actions, Button, Disclosure, FormRow, FormSection, Hint, Radio, Switch, TextArea } from "@/ui";
import { useCommitOnUnmount } from "@/hooks/useCommitOnUnmount";
import { JavaChooser, MemoryChooser, MemoryHelp, MinMemoryChooser } from "@/components/common";
import { useI18n, type TKey } from "@/i18n";
import { JVM_PRESETS, presetArgs, type JvmPreset } from "@/lib/jvm";
import { WindowChooser } from "@/pages/detail/settings/WindowChooser";
import { useSettings, type LauncherOnPlay } from "@/store/settings";

const JVM_PRESET_KEYS: Record<JvmPreset, { name: TKey; note: TKey }> = {
  balanced: { name: "settings.jvm.balanced", note: "settings.jvm.balancedNote" },
  lowLatency: { name: "settings.jvm.lowLatency", note: "settings.jvm.lowLatencyNote" },
  custom: { name: "settings.jvm.custom", note: "settings.jvm.customNote" },
};

const LAUNCHER_ON_PLAY: LauncherOnPlay[] = ["keep", "minimize", "close"];

const LAUNCHER_ON_PLAY_KEYS: Record<LauncherOnPlay, TKey> = {
  keep: "settings.onPlay.keep",
  minimize: "settings.onPlay.minimize",
  close: "settings.onPlay.close",
};

/** Java: automatisch (mitgelieferte Runtime) oder eigene Java-Installation. */
function JavaRow() {
  const { t } = useI18n();
  const javaPath = useSettings((s) => s.javaPath);
  const set = useSettings((s) => s.set);
  return (
    <FormRow label="Java" hint={t("pages.settings.javaHint")} group="radiogroup" aside={t("pages.settings.javaAside")}>
      <JavaChooser
        name="gjava"
        value={javaPath}
        onChange={(path) => set({ javaPath: path })}
        fallback={<>{t("components.memory.auto")} <span className="text-fg-3">{t("pages.settings.javaAutomaticNote")}</span></>}
      />
    </FormRow>
  );
}

/** Eigener JVM-Argumenttext; gespeichert wird beim Verlassen des Felds oder der Seite. */
function CustomJvmArgs() {
  const { t } = useI18n();
  const saved = useSettings((s) => s.jvmArgs);
  const set = useSettings((s) => s.set);
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null) return;
    set({ jvmArgs: draft });
    setDraft(null);
  };
  useCommitOnUnmount(save);
  return (
    <TextArea
      rows={3}
      aria-label={t("settings.jvm.label")}
      placeholder="-XX:+UseG1GC"
      value={draft ?? saved}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
    />
  );
}

/** JVM-Argumente für Instanzen ohne eigene: eine Vorgabe oder ein eigener Text; die Argumente der Vorgabe bleiben einsehbar. */
function JvmRow() {
  const { t } = useI18n();
  const preset = useSettings((s) => s.jvmPreset);
  const custom = useSettings((s) => s.jvmArgs);
  const set = useSettings((s) => s.set);
  return (
    <FormRow label={t("settings.jvm.label")} hint={t("settings.jvm.hint")} group="radiogroup" aside={t("settings.jvm.aside")}>
      {JVM_PRESETS.map((value) => (
        <Radio key={value} name="gjvm" checked={preset === value} onChange={() => set({ jvmPreset: value })}>
          {t(JVM_PRESET_KEYS[value].name)} <span className="text-fg-3">({t(JVM_PRESET_KEYS[value].note)})</span>
        </Radio>
      ))}
      {preset === "custom" ? (
        <CustomJvmArgs />
      ) : (
        <Disclosure summary={t("settings.jvm.shown")}>
          <TextArea rows={3} readOnly aria-label={t("settings.jvm.shown")} value={presetArgs(preset, custom).join(" ")} />
        </Disclosure>
      )}
    </FormRow>
  );
}

/** Was der Launcher beim Spielstart mit seinem Fenster tut. */
function LauncherOnPlayRow() {
  const { t } = useI18n();
  const mode = useSettings((s) => s.launcherOnPlay);
  const set = useSettings((s) => s.set);
  return (
    <FormRow label={t("settings.onPlay.label")} hint={t("settings.onPlay.hint")} group="radiogroup">
      {LAUNCHER_ON_PLAY.map((value) => (
        <Radio key={value} name="gonplay" checked={mode === value} onChange={() => set({ launcherOnPlay: value })}>
          {t(LAUNCHER_ON_PLAY_KEYS[value])}
        </Radio>
      ))}
      {mode === "close" && <Hint tone="warn" live>{t("settings.onPlay.closeWarning")}</Hint>}
    </FormRow>
  );
}

/** Das laufende Spiel in Discord zeigen; wirkt ab dem nächsten Start. */
function DiscordRow() {
  const { t } = useI18n();
  const enabled = useSettings((s) => s.discordPresence);
  const set = useSettings((s) => s.set);
  return (
    <FormRow label={t("settings.discord.label")} hint={t("settings.discord.hint")} aside={t("settings.discord.aside")}>
      <Switch label={t("settings.discord.label")} checked={enabled} onChange={(on) => set({ discordPresence: on })} stateText={[t("ui.switch.on"), t("ui.switch.off")]} />
    </FormRow>
  );
}

/** Alle Spieleinstellungen auf Anfang; Konten und Darstellung bleiben. */
function ResetRow() {
  const { t } = useI18n();
  const reset = useSettings((s) => s.reset);
  return (
    <FormRow label={t("pages.settings.resetLabel")} hint={t("pages.settings.resetHint")}>
      <Actions>
        <Button
          icon="redo"
          onClick={() => {
            reset();
            toast.success(t("pages.settings.resetDoneToast"));
          }}
        >
          {t("pages.settings.resetButton")}
        </Button>
      </Actions>
    </FormRow>
  );
}

/** Einstellungen › Java & Start: Arbeitsspeicher, Java, JVM-Argumente und Fenster für alle Instanzen ohne eigene Angabe. */
export function GameTab() {
  const { t } = useI18n();
  const memoryMb = useSettings((s) => s.memoryMb);
  const minMemoryMb = useSettings((s) => s.minMemoryMb);
  const gameWindow = useSettings((s) => s.window);
  const set = useSettings((s) => s.set);
  return (
    <>
      <FormSection title={t("settings.sectionJava")} level={3}>
        <FormRow
          label={t("ui.memory.label")}
          hint={t("pages.settings.memoryHint")}
          group="radiogroup"
          aside={<MemoryHelp value={memoryMb} />}
        >
          <MemoryChooser name="gram" value={memoryMb} onChange={(mb) => set({ memoryMb: mb })} help={false} />
        </FormRow>
        <FormRow label={t("settings.memory.minLabel")} htmlFor="gminram" hint={t("settings.memory.minHint")} aside={t("settings.memory.minAside")}>
          <MinMemoryChooser id="gminram" value={minMemoryMb} onChange={(mb) => set({ minMemoryMb: mb })} autoLabel={t("components.memory.auto")} />
        </FormRow>
        <JavaRow />
        <JvmRow />
      </FormSection>
      <FormSection title={t("settings.sectionStart")} level={3}>
        <FormRow label={t("detail.settings.windowLabel")} hint={t("settings.windowHint")} group="radiogroup">
          <WindowChooser name="gwindow" value={gameWindow} onChange={(next) => set({ window: next })} />
        </FormRow>
        <LauncherOnPlayRow />
      </FormSection>
      <FormSection title={t("settings.sectionInGame")} level={3}>
        <DiscordRow />
      </FormSection>
      <FormSection title={t("settings.sectionReset")} level={3}>
        <ResetRow />
      </FormSection>
    </>
  );
}
