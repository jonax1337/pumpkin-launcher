import { useFriendsState } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { useUsableAccount } from "@/store/offline";
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
  const account = useUsableAccount();
  const gate = state.data ? friendsGate(state.data, account?.kind === "microsoft") : null;

  if (state.data && !gate) return <FriendsContent state={state.data} />;
  return (
    <>
      <PageHeader title={t("ui.nav.friends")} />
      {gate ? (
        <FriendsGate gate={gate} />
      ) : state.error ? (
        <ErrorBox className="mt-4" title={t("friends.loadFailed")} error={state.error} onRetry={() => void state.refetch()} />
      ) : (
        <Skel className="mt-4" h={120} />
      )}
    </>
  );
}
