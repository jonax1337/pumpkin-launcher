import { Select } from "@/ui";
import { keyOf, useAllAccounts } from "@/components/accounts/useAccounts";
import { useI18n } from "@/i18n";
import { accountName, type ActiveAccount } from "@/store/settings";

/** Wert der Auswahl für „kein eigenes Konto“: Die Instanz startet mit dem aktiven Konto. */
const ACTIVE_ACCOUNT = "active";

/**
 * Konto, mit dem diese Instanz startet: das aktive Konto oder ein festes. Ein festes Konto, das es nicht mehr gibt,
 * zeigt wieder „Aktives Konto“, denn der Start nimmt dann auch dieses.
 */
export function AccountField({ id, value, onChange, disabled }: {
  id: string; value: string | null; onChange: (accountKey: string | null) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const { accounts } = useAllAccounts();
  const kindName = (account: ActiveAccount) => t(account.kind === "microsoft" ? "settings.account.microsoft" : "settings.account.offline");
  const options = [
    { value: ACTIVE_ACCOUNT, label: t("settings.account.active") },
    ...accounts.map((account) => ({ value: keyOf(account), label: `${accountName(account)} · ${kindName(account)}` })),
  ];
  const known = accounts.some((account) => keyOf(account) === value);
  return (
    <Select
      id={id}
      disabled={disabled}
      value={value && known ? value : ACTIVE_ACCOUNT}
      options={options}
      onChange={(choice) => onChange(choice === ACTIVE_ACCOUNT ? null : choice)}
    />
  );
}
