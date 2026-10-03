import { useQueryClient } from "@tanstack/react-query";
import { friendKeys } from "@/hooks/queryKeys";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { useFriendsModStatus } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { progressShare } from "@/lib/progress";
import type { Instance } from "@/lib/types";
import { useContentState } from "@/store/contentState";
import { Chip, JobProgress, StatusPanel } from "@/ui";
import { GuardedButton } from "./guards";

const INSTALL_PROGRESS_WIDTH = 120;

const installTarget = (instanceId: string) => `friends-mod:${instanceId}`;

/** Legt die Mod aus Modrinth in die Instanz; als Vorgang im Aufgaben-Menü, danach gilt der neue Stand der Mod. */
function useInstallFriendsMod(instance: Instance) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { run } = useBackgroundTask();
  return () =>
    run({
      key: installTarget(instance.id),
      label: t("friendsHost.mod.task"),
      doneLabel: t("friendsHost.mod.taskDone"),
      // Ein Vorgang liefert die Instanz (Verlauf, Zwischenspeicher); die Installation selbst liefert nichts, also frisch gelesen.
      task: async (operationId) => {
        await api.friendsModInstall(instance.id, operationId);
        void qc.invalidateQueries({ queryKey: friendKeys.modStatus(instance.id) });
        return api.getInstance(instance.id);
      },
    });
}

/** Die Zeile zur Mod: ein Angebot, solange sie fehlt, sonst ihr Verbindungsstand; ohne Angebot für die Instanz (Backend: `unavailable`) nichts. */
export function FriendsModRow({ instance, busy }: { instance: Instance; busy: string | null }) {
  const status = useFriendsModStatus(instance.id).data;
  switch (status?.state) {
    case "notInstalled":
      return <InstallOffer instance={instance} busy={busy} />;
    case "installed":
      return <ModConnection connected={false} />;
    case "connected":
      return <ModConnection connected />;
    default:
      return null;
  }
}

function InstallOffer({ instance, busy }: { instance: Instance; busy: string | null }) {
  const { t } = useI18n();
  const install = useInstallFriendsMod(instance);
  const installing = useContentState((s) => s.target === installTarget(instance.id));
  const progress = useContentState((s) => s.progress);
  return (
    <StatusPanel
      icon="box"
      title={t("friendsHost.mod.title")}
      actions={
        installing ? (
          <JobProgress label={t("friendsHost.mod.adding")} p={progressShare(progress)} width={INSTALL_PROGRESS_WIDTH} />
        ) : (
          <GuardedButton size="s" icon="plus" blocked={busy} onClick={install}>{t("friendsHost.mod.add")}</GuardedButton>
        )
      }
    >
      {t("friendsHost.mod.source")}
    </StatusPanel>
  );
}

function ModConnection({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      size="s"
      icon="box"
      title={t("friendsHost.mod.name")}
      actions={<Chip dot tone={connected ? "run" : undefined}>{t(connected ? "friendsHost.mod.connected" : "friendsHost.mod.installed")}</Chip>}
    />
  );
}
