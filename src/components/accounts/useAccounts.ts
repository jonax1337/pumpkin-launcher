import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n";
import { accountKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import { MINUTE } from "@/lib/time";
import { refreshOfflineAllowed, useOfflineAllowed } from "@/store/offline";
import { useSettings, type ActiveAccount } from "@/store/settings";

/** Konten ändern sich nur durch Anmelden und Abmelden hier; der Abgleich mit Microsoft eilt nicht. */
const ACCOUNTS_STALE_MS = 5 * MINUTE;

function useMsAccounts() {
  const query = useQuery({ queryKey: accountKeys.microsoft, queryFn: api.msAccounts, staleTime: ACCOUNTS_STALE_MS, retry: false });
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

/** Alle Konten in einer Liste: Microsoft zuerst, dann Offline-Namen; `query` ist die Abfrage der Microsoft-Konten. */
export function useAllAccounts() {
  const offline = useSettings((s) => s.offlineAccounts);
  const allowed = useOfflineAllowed((s) => s.allowed);
  const query = useMsAccounts();
  const accounts: ActiveAccount[] = [
    ...(query.data ?? []).map((a): ActiveAccount => ({ kind: "microsoft", id: a.id, username: a.username })),
    ...(allowed ? offline : []).map((name): ActiveAccount => ({ kind: "offline", name })),
  ];
  return { accounts, query };
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

/** Eindeutiger Schlüssel eines Kontos (Art und Kennung): zwei Konten sind genau dann dasselbe, wenn ihre Schlüssel es sind. */
export const keyOf = (a: ActiveAccount) => (a.kind === "microsoft" ? `ms:${a.id}` : `off:${a.name}`);

/** Ist `account` das aktive Konto (`null` = keins)? */
export const isActiveAccount = (active: ActiveAccount | null, account: ActiveAccount) => !!active && keyOf(active) === keyOf(account);

export const kindLabel = (a: ActiveAccount) =>
  t(a.kind === "microsoft" ? "components.account.kindMicrosoft" : "components.account.kindOffline");
