import { useFriendsState } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { useAllAccounts } from "@/components/accounts/useAccounts";
import { ErrorBox, PageHeader, Skel } from "@/ui";
import { FriendsContent } from "./friends/FriendsContent";
import { FriendsGate } from "./friends/FriendsGate";
import { friendsGate } from "./friends/friendsModel";

/** Freunde: Anfragen und Liste. Ist die Funktion nicht nutzbar, steht an ihrer Stelle der Grund mit dem nächsten Schritt. */
export function FriendsPage() {
  return (
    <section className="page">
      <FriendsBody />
    </section>
  );
}

function FriendsBody() {
  const { t } = useI18n();
  const state = useFriendsState();
  const { accounts, query } = useAllAccounts();
  const hasMicrosoftAccount = accounts.some((account) => account.kind === "microsoft");
  const gate = state.data ? friendsGate(state.data, hasMicrosoftAccount) : null;
  const needsAccount = state.data?.enabled && state.data.availability === "available";
  const accountPending = needsAccount && query.isPending;
  const accountError = needsAccount && query.error;

  if (state.data && !gate && !accountError && !accountPending) return <FriendsContent state={state.data} />;
  return (
    <>
      <PageHeader title={t("ui.nav.friends")} />
      {accountError ? (
        <ErrorBox className="mt-4" title={t("components.account.msLoadFailed")} error={accountError} onRetry={() => void query.refetch()} />
      ) : accountPending ? (
        <Skel className="mt-4" h={120} />
      ) : gate ? (
        <FriendsGate gate={gate} />
      ) : state.error ? (
        <ErrorBox className="mt-4" title={t("friends.loadFailed")} error={state.error} onRetry={() => void state.refetch()} />
      ) : (
        <Skel className="mt-4" h={120} />
      )}
    </>
  );
}
