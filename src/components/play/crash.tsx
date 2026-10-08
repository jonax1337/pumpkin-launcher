import type { ComponentProps } from "react";
import { t, useI18n, type TKey } from "@/i18n";
import { Button, IconButton } from "@/ui";
import { askShareLog } from "@/components/support";
import { openLocalPath } from "@/lib/links";
import type { ExitPayload, Instance } from "@/lib/types";

/** „Minecraft ist abgestürzt (Code 1)“; ohne Exit-Code nur der erste Teil. Reine Funktion, deshalb Modul-`t`. */
export const crashHeadline = (crash: ExitPayload) =>
  t("components.game.mcCrashed") + (crash.code != null ? t("components.game.exitCode", { code: crash.code }) : "");

/** Exit-Codes, die Alltagssprache verdienen (Windows meldet sie vorzeichenbehaftet, Linux und macOS als 128 + Signal). */
const EXIT_CODE_TEXTS: Record<number, TKey> = {
  1: "settings.crash.exit.error",
  [-1]: "settings.crash.exit.abrupt",
  255: "settings.crash.exit.abrupt",
  [-1073741819]: "settings.crash.exit.access",
  139: "settings.crash.exit.access",
  [-1073740791]: "settings.crash.exit.native",
  [-1073740940]: "settings.crash.exit.native",
  134: "settings.crash.exit.native",
  137: "settings.crash.exit.memory",
  143: "settings.crash.exit.killed",
};

/** Was der Exit-Code in Alltagssprache heißt; für Codes ohne bekannte Bedeutung leer. */
export const exitCodeMeaning = (code: number | null) => {
  const key = code == null ? undefined : EXIT_CODE_TEXTS[code];
  return key ? t(key) : "";
};

/** „Wahrscheinlich: Sodium, Iris.“ aus dem Absturzbericht, dazu der Exit-Code in Alltagssprache; leer, wenn beides fehlt. */
export const crashCause = (crash: ExitPayload) =>
  [crash.suspectedMods.length ? t("settings.crash.probably", { mods: crash.suspectedMods.join(", ") }) : "", exitCodeMeaning(crash.code)]
    .filter(Boolean)
    .join(" ");

type ButtonLook = Omit<ComponentProps<typeof Button>, "onClick" | "children">;

/** „Absturzbericht öffnen“ für den Bericht unter `path`. */
export function OpenCrashReportButton({ path, ...look }: { path: string } & ButtonLook) {
  const { t } = useI18n();
  return <Button {...look} onClick={() => openLocalPath(path)}>{t("components.game.openCrashReport")}</Button>;
}

/** Wege aus einem Absturz in der Statuszeile: Bericht (falls vorhanden), Protokoll, Log teilen. */
export function CrashActions({ crash, instance, onScene, onViewLog }: {
  crash: ExitPayload; instance: Instance; onScene?: boolean; onViewLog: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {crash.crashReport && <OpenCrashReportButton path={crash.crashReport} variant="ghost" size="s" tone="bad" onScene={onScene} />}
      <Button variant="ghost" size="s" onScene={onScene} onClick={onViewLog}>{t("components.game.viewLog")}</Button>
      {/* Nur als Symbol: Ausgeschrieben ließe die schmale Zeile keinen Platz für die Meldung. */}
      <IconButton
        icon="ul"
        size="s"
        label={t("components.game.shareLog")}
        onScene={onScene}
        onClick={() => askShareLog(instance.id, crash)}
      />
    </>
  );
}
