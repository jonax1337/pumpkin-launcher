import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n";
import { accountKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { MINUTE } from "@/lib/time";
import type { Account, Instance } from "@/lib/types";
import { useInstance } from "@/hooks/useInstances";
import { currentUsableAccount, refreshOfflineAllowed, useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { useSettings, type ActiveAccount } from "@/store/settings";
import { keyOf, pickLaunchAccount } from "./accountModel";

export { keyOf };

/** Konten ändern sich nur durch Anmelden und Abmelden hier; der Abgleich mit Microsoft eilt nicht. */
const ACCOUNTS_STALE_MS = 5 * MINUTE;

const msAccountsQuery = { queryKey: accountKeys.microsoft, queryFn: api.msAccounts, staleTime: ACCOUNTS_STALE_MS, retry: false };

function useMsAccounts() {
  const query = useQuery(msAccountsQuery);
  const syncMicrosoft = useSettings((s) => s.syncMicrosoft);
  // Ob Spielernamen erlaubt sind, hängt an den Microsoft-Konten: bei jeder Änderung der Anzahl neu fragen.
  const count = query.data?.length;
  useEffect(() => void refreshOfflineAllowed(), [count]);
  // Nur mit frischen Daten abgleichen: ein veralteter Cache nach einer Anmeldung kennt das neue Konto noch nicht.
  const fresh = query.isSuccess && !query.isFetching;
  useEffect(() => {
    if (fresh && query.data) syncMicrosoft(query.data.map((a) => a.id));
  }, [fresh, query.data, syncMicrosoft]);
  return query;
}

/** Alle Konten in einer Liste: Microsoft zuerst, dann Offline-Namen (nur, wenn Offline erlaubt ist). */
function listAccounts(microsoft: Account[] | undefined, offline: string[], offlineAllowed: boolean): ActiveAccount[] {
  return [
    ...(microsoft ?? []).map((a): ActiveAccount => ({ kind: "microsoft", id: a.id, username: a.username })),
    ...(offlineAllowed ? offline : []).map((name): ActiveAccount => ({ kind: "offline", name })),
  ];
}

/** Alle Konten in einer Liste: Microsoft zuerst, dann Offline-Namen; `query` ist die Abfrage der Microsoft-Konten. */
export function useAllAccounts() {
  const offline = useSettings((s) => s.offlineAccounts);
  const allowed = useOfflineAllowed((s) => s.allowed);
  const query = useMsAccounts();
  return { accounts: listAccounts(query.data, offline, allowed), query };
}

/**
 * Das Konto, mit dem eine Instanz startet: ihr eigenes, solange es noch existiert und starten darf, sonst das aktive.
 * Außerhalb React gelesen (Start): die Microsoft-Konten aus dem Cache der Abfrage, beim frühen Start erst geladen;
 * schlägt das fehl, gelten nur die Offline-Konten als bekannt.
 */
export async function launchAccountFor(instance: Pick<Instance, "defaultAccount">): Promise<ActiveAccount | null> {
  const { offlineAccounts } = useSettings.getState();
  const microsoft = await queryClient.ensureQueryData(msAccountsQuery).catch(() => undefined);
  const known = listAccounts(microsoft, offlineAccounts, useOfflineAllowed.getState().allowed);
  return pickLaunchAccount(known, instance.defaultAccount, currentUsableAccount());
}

/** Wie `launchAccountFor`, aber reaktiv für die Anzeige: das Konto, mit dem die Instanz `instanceId` jetzt starten würde. */
export function useLaunchAccount(instanceId: string | undefined): ActiveAccount | null {
  const { accounts } = useAllAccounts();
  const usable = useUsableAccount();
  const defaultAccount = useInstance(instanceId).data?.defaultAccount ?? null;
  return pickLaunchAccount(accounts, defaultAccount, usable);
}

export function useRemoveAccount() {
  const removeAccount = useSettings((s) => s.removeAccount);
  const forgetMicrosoft = useSettings((s) => s.forgetMicrosoft);
  const qc = useQueryClient();
  const removeMs = useMutation({
    mutationFn: (id: string) => api.msAccountRemove(id),
    onSuccess: (_, id) => {
      forgetMicrosoft(id);
      return qc.invalidateQueries({ queryKey: accountKeys.microsoft });
    },
  });
  const remove = (a: ActiveAccount) => (a.kind === "offline" ? removeAccount(a.name) : removeMs.mutate(a.id));
  return { remove, pending: removeMs.isPending };
}

/** Ist `account` das aktive Konto (`null` = keins)? */
export const isActiveAccount = (active: ActiveAccount | null, account: ActiveAccount) => !!active && keyOf(active) === keyOf(account);

export const kindLabel = (a: ActiveAccount) =>
  t(a.kind === "microsoft" ? "components.account.kindMicrosoft" : "components.account.kindOffline");
