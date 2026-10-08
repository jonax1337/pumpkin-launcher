import { useEffect, useState, type ReactNode } from "react";
import { useI18n, t } from "@/i18n";
import { useCommitOnUnmount } from "@/hooks/useCommitOnUnmount";
import { useJavaInstalls } from "@/hooks/useJavaInstalls";
import { useMemory } from "@/hooks/useMemory";
import { api } from "@/lib/api";
import { blurOnEnter } from "@/lib/dom";
import { formatMemory, formatPlaytime, MB_PER_GB, memoryAdvice, memoryTooHigh, relativeTime } from "@/lib/format";
import { platform } from "@/lib/platform";
import { toastError } from "@/lib/toast";
import { LOADER_LABELS, type Instance, type JavaInstall } from "@/lib/types";
import { Actions, Button, Hint, Radio, SegSlider, Select, TextField } from "@/ui";
import { cssVars } from "@/ui/util";

/** „Fabric 1.21.4“ bzw. „Vanilla 1.21.4“. */
export const loaderLine = (i: Pick<Instance, "loader" | "minecraftVersion">) => `${LOADER_LABELS[i.loader]} ${i.minecraftVersion}`;

/** „37 Std. gespielt“; ohne Spielzeit leer. Reine Funktion, deshalb Modul-`t` ohne Hook. */
export const playtimeLine = (i: Pick<Instance, "playtimeSecs">) =>
  i.playtimeSecs > 0 ? t("components.playtime.played", { time: formatPlaytime(i.playtimeSecs) }) : "";

/** „Zuletzt gespielt vor 2 Stunden“ bzw. „Noch nie gespielt“. Reine Funktion, deshalb Modul-`t`. */
export const lastPlayedLine = (i: Pick<Instance, "lastPlayedAt">) =>
  i.lastPlayedAt != null ? t("components.game.lastPlayed", { time: relativeTime(i.lastPlayedAt) }) : t("format.neverPlayed");

/** Segmente des Reglers: 1 bis 16 GB. */
const MEMORY_SEGMENTS = 16;

/** Ganze GB, die der Regler zeigt: der Wert, sonst der automatische Standard; mindestens 1. */
const toGb = (value: number | null, auto: number) => Math.max(1, Math.round((value ?? auto) / MB_PER_GB));

/**
 * Hinweis zum Arbeitsspeicher. Zu viel für den PC: Warnung mit Symbol (nie nur Farbe) an derselben Stelle.
 * `value` wie bei MemoryChooser (null = automatisch); `modCount` (Mods der Instanz) macht daraus eine Einordnung,
 * ohne ihn (Standard für alle Instanzen) bleibt es beim Hinweis auf den PC.
 */
export function MemoryHelp({ value, modCount }: { value: number | null; modCount?: number }) {
  const { t } = useI18n();
  const { auto, total } = useMemory();
  const gb = toGb(value, auto);
  if (value != null && total != null && memoryTooHigh(gb * MB_PER_GB, total))
    return (
      <Hint tone="warn" live>
        {t("components.memory.tooHigh", { ram: formatMemory(total) })}
      </Hint>
    );
  const totalText = total != null ? t("components.memory.hasTotal", { ram: formatMemory(total) }) : "";
  const advice = memoryAdvice(gb, modCount);
  return <Hint>{[totalText, advice && t(`settings.memory.${advice}`, { n: modCount ?? 0 })].filter(Boolean).join(" ")}</Hint>;
}

/** Wählbare Startgrößen des Heaps (MB). */
const MIN_MEMORY_OPTIONS_MB = [512, 1024, 2048, 4096];
const AUTO_MIN_MEMORY = "auto";

/**
 * Minimaler Arbeitsspeicher (`-Xms`): Der Heap startet mit dieser Größe, statt erst zu wachsen. `value` null = `autoLabel`
 * (bei Instanzen „wie in den Einstellungen“, dort „Automatisch“); über dem Maximum begrenzt der Start auf das Maximum.
 */
export function MinMemoryChooser({ id, value, onChange, autoLabel, disabled }: {
  id?: string; value: number | null; onChange: (mb: number | null) => void; autoLabel: string; disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Select
      id={id}
      ariaLabel={t("settings.memory.minLabel")}
      disabled={disabled}
      value={value == null ? AUTO_MIN_MEMORY : String(value)}
      options={[
        { value: AUTO_MIN_MEMORY, label: autoLabel },
        ...MIN_MEMORY_OPTIONS_MB.map((mb) => ({ value: String(mb), label: formatMemory(mb) })),
      ]}
      onChange={(choice) => onChange(choice === AUTO_MIN_MEMORY ? null : Number(choice))}
    />
  );
}

/**
 * Arbeitsspeicher: „Automatisch“ oder eigener Wert als Segmente (1 bis 16 GB).
 * `value` null = automatisch; sonst MB. Segmente über dem, was der PC übrig hat, sind gesperrt (flach, dunkel)
 * und die Grenze steht darunter. `help={false}`: Hinweis steht woanders (rechte Formularspalte, `MemoryHelp`).
 */
export function MemoryChooser({ name, value, onChange, autoText, help = true, disabled }: {
  name: string; value: number | null; onChange: (mb: number | null) => void; autoText?: string; help?: boolean; disabled?: boolean;
}) {
  const { t } = useI18n();
  const { auto, max } = useMemory();
  const isAuto = value == null;
  const gb = toGb(value, auto);
  const top = Math.max(1, Math.min(MEMORY_SEGMENTS, Math.floor(max / MB_PER_GB)));
  return (
    <>
      <Radio name={name} checked={isAuto} disabled={disabled} onChange={() => onChange(null)}>
        {t("components.memory.auto")}{" "}
        <span className="faint">({autoText ?? t("components.memory.currently", { ram: formatMemory(auto) })})</span>
      </Radio>
      <Radio name={name} checked={!isAuto} disabled={disabled} onChange={() => onChange(gb * MB_PER_GB)}>
        {t("components.memory.ownValue")}
      </Radio>
      <div className="memrow">
        <div className="memsl" style={cssVars({ "--free": `${((MEMORY_SEGMENTS - top) / MEMORY_SEGMENTS) * 100}%` })}>
          <SegSlider
            value={gb}
            max={top}
            disabled={disabled || isAuto}
            label={t("ui.memory.label")}
            unit="GB"
            onChange={(v) => onChange(v * MB_PER_GB)}
          />
          {/* Grenze unter dem letzten freien Segment; bei 16 unter dem Ende */}
          <span className="cap" aria-hidden>{t("components.memory.maxGb", { n: top })}</span>
        </div>
        <output className="mem-val" data-off={disabled || isAuto ? "" : undefined}>{gb} GB</output>
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

/** „Java 21.0.4 · Eclipse Adoptium“ */
const javaLabel = ({ version, vendor }: JavaInstall) => [`Java ${version}`, vendor].filter(Boolean).join(" · ");

/**
 * Java: ohne eigenen Pfad (`value` leer; was dann gilt, beschreibt `fallback`) oder eigene Java-Programmdatei.
 * Gemeldet wird erst beim Verlassen des Felds oder der Seite, mit Enter oder nach „Durchsuchen“, nicht je Tastendruck.
 */
export function JavaChooser({ name, value, onChange, fallback, disabled }: {
  name: string; value: string; onChange: (path: string) => void; fallback: ReactNode; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [own, setOwn] = useState(value !== "");
  const [draft, setDraft] = useState(value);
  const installs = useJavaInstalls().data ?? [];
  // Ändert sich der Pfad von außen (z. B. „Auf Standard zurücksetzen“), zieht die Anzeige mit.
  useEffect(() => {
    setDraft(value);
    setOwn(value !== "");
  }, [value]);
  function commit(path: string) {
    setDraft(path);
    if (path.trim() !== value) onChange(path.trim());
  }
  useCommitOnUnmount(() => commit(draft));
  async function browse() {
    const { extensions } = JAVA_PROGRAM;
    const [picked] = await api.pickPaths({ filters: extensions ? [{ name: "Java", extensions }] : undefined });
    if (picked) commit(picked);
  }
  function chooseDefault() {
    setOwn(false);
    commit("");
  }
  return (
    <>
      <Radio name={name} checked={!own} disabled={disabled} onChange={chooseDefault}>{fallback}</Radio>
      <Radio name={name} checked={own} disabled={disabled} onChange={() => setOwn(true)}>{t("components.java.own")}</Radio>
      {/* Bleibt stehen und ist nur gesperrt, wie der Regler bei „Automatisch“: kein Sprung, keine Lücke.
          Gesperrt ohne Beispielpfad, sonst wirkt es, als wäre schon ein Pfad gesetzt. */}
      {installs.length > 0 && (
        <Select
          ariaLabel={t("settings.java.detected")}
          placeholder={t("settings.java.pickDetected")}
          disabled={disabled || !own}
          value={installs.some((install) => install.path === draft) ? draft : ""}
          options={installs.map((install) => ({ value: install.path, label: javaLabel(install) }))}
          onChange={commit}
        />
      )}
      <Actions>
        <TextField
          width="full"
          disabled={disabled || !own}
          aria-label={t("components.java.pathTo", { file: JAVA_PROGRAM.file })}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={blurOnEnter}
          placeholder={
            own
              ? t("components.java.examplePath", { path: JAVA_PROGRAM.example })
              : t("components.java.pathTo", { file: JAVA_PROGRAM.file })
          }
        />
        {api.capabilities.pickPaths && (
          <Button disabled={disabled || !own} onClick={() => void browse().catch(toastError)}>{t("components.java.browse")}</Button>
        )}
      </Actions>
    </>
  );
}
