import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ADDED_LOADER, ingameRow, withAddedLoader, type IngameLine, type IngameRow } from "@/components/friends/ingameModel";
import { friendKeys } from "@/hooks/queryKeys";
import { useUpdateInstance } from "@/hooks/useInstances";
import { useIngameStatus, useRetryIngame, useSetIngameEnabled } from "@/hooks/useFriends";
import { t, useI18n } from "@/i18n";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { Actions, Button, StatusPanel, Switch } from "@/ui";
import { GuardedButton } from "./guards";

/**
 * Die Zeile zum Freunde-Menü im Spiel (docs/bridge/README.md, "Support selection"): der Stand, bei Bedarf der Grund, der Schalter der Instanz und, wo es hilft,
 * „Erneut versuchen“ oder „Fabric hinzufügen?“. Nichts davon installiert etwas; der Wechsel des Loaders geschieht nur auf Klick.
 */
export function FriendsModRow({ instance, busy = null }: { instance: Instance; busy?: string | null }) {
  useI18n();
  const status = useIngameStatus(instance.id).data;
  if (!status) return null;
  const row = ingameRow(status, instance);
  return (
    <StatusPanel
      size="s"
      icon="mod"
      role="status"
      tone={row.connected ? "run" : row.action === "retry" ? "warn" : "neutral"}
      title={t("friendsHost.ingame.name")}
      actions={<RowControls row={row} instance={instance} busy={busy} />}
    >
      {lineText(row.line)}
    </StatusPanel>
  );
}

function lineText({ key, loader, minecraft, need, failure }: IngameLine): string {
  return t(key, {
    loader: loader ? LOADER_LABELS[loader] : "",
    minecraft: minecraft ?? "",
    need: need ?? "",
    failure: failure ? t(`friendsHost.ingame.failure.${failure}`) : "",
  });
}

function RowControls({ row, instance, busy }: { row: IngameRow; instance: Instance; busy: string | null }) {
  return (
    <Actions>
      {row.action === "addFabric" && <AddLoaderButton instance={instance} blocked={busy} />}
      {row.action === "retry" && <RetryButton instanceId={instance.id} />}
      {row.toggle && <IngameSwitch instanceId={instance.id} on={row.toggle === "on"} />}
    </Actions>
  );
}

function IngameSwitch({ instanceId, on }: { instanceId: string; on: boolean }) {
  const setEnabled = useSetIngameEnabled(instanceId);
  return (
    <Switch
      label={t("friendsHost.ingame.switch")}
      checked={on}
      disabled={setEnabled.isPending}
      onChange={(enabled) => setEnabled.mutate(enabled)}
      stateText={[t("ui.switch.on"), t("ui.switch.off")]}
    />
  );
}

function RetryButton({ instanceId }: { instanceId: string }) {
  const retry = useRetryIngame(instanceId);
  return <Button size="s" icon="refresh" disabled={retry.isPending} onClick={() => retry.mutate()}>{t("friendsHost.ingame.retry")}</Button>;
}

/** Vanilla hat keinen Loader, in den die Mod sich einhängen könnte: der Klick trägt Fabric ein, das nächste Spielen installiert es. */
function AddLoaderButton({ instance, blocked }: { instance: Instance; blocked: string | null }) {
  const qc = useQueryClient();
  const update = useUpdateInstance();
  const loader = LOADER_LABELS[ADDED_LOADER];
  const add = () =>
    update.mutate(withAddedLoader(instance), {
      onSuccess: () => {
        toast.success(t("friendsHost.ingame.addLoaderDone", { loader }));
        void qc.invalidateQueries({ queryKey: friendKeys.modStatus(instance.id) });
      },
    });
  return (
    <GuardedButton size="s" icon="plus" blocked={blocked} disabled={update.isPending} onClick={add}>
      {t("friendsHost.ingame.addLoader", { loader })}
    </GuardedButton>
  );
}
