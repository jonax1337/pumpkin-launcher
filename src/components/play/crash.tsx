import type { ComponentProps } from "react";
import { t, useI18n } from "@/i18n";
import { Button, IconButton } from "@/ui";
import { askShareLog } from "@/components/support";
import { openLocalPath } from "@/lib/links";
import type { ExitPayload, Instance } from "@/lib/types";

/** „Minecraft ist abgestürzt (Code 1)“; ohne Exit-Code nur der erste Teil. Reine Funktion, deshalb Modul-`t`. */
export const crashHeadline = (crash: ExitPayload) =>
  t("components.game.mcCrashed") + (crash.code != null ? t("components.game.exitCode", { code: crash.code }) : "");

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
