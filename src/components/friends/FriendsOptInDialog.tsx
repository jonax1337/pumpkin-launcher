import { useId, useState, type FormEvent } from "react";
import { RELAY_OPERATOR_KEYS } from "@/components/PrivacyNotice";
import { useEnableFriends, useFriendsState } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS, type FriendsState, type RelayInfo } from "@/lib/types";
import { Checkbox, Dialog, DialogActions, Field, Hint, TextField } from "@/ui";

const DIALOG_WIDTH_PX = 600;
const DIALOG_HEIGHT_PX = 780;
const CONFIRM_WIDTH_PX = 180;

const isValidDisplayName = (name: string) =>
  [...name].length >= FRIENDS_LIMITS.displayNameMin && [...name].length <= FRIENDS_LIMITS.displayNameMax;

/** Alle Relay-Server als „Host (Betreiber)“, wie der Dialog sie aufzählt. */
function RelaysText({ relays }: { relays: RelayInfo[] }) {
  const { t } = useI18n();
  return t("friendsSettings.optIn.relays", {
    relays: relays.map((relay) => `${relay.host} (${t(RELAY_OPERATOR_KEYS[relay.operator])})`).join(", "),
  });
}

/** Was „Freunde“ preisgibt, Punkt für Punkt, bevor der Nutzer zustimmt. */
function PrivacyPoints({ relays }: { relays: RelayInfo[] }) {
  const { t } = useI18n();
  return (
    <ul className="mb-4 flex list-disc flex-col gap-2 pl-5">
      <li>{t("friendsSettings.optIn.codes")}</li>
      <li>{t("friendsSettings.optIn.addresses")}</li>
      <li><RelaysText relays={relays} /></li>
      <li>{t("friendsSettings.optIn.presence")}</li>
      <li>{t("friendsSettings.optIn.noTracking")}</li>
    </ul>
  );
}

/** Zustimmung zu Relay-Servern fremder Betreiber (n0), die der Nutzer ausdrücklich geben muss. */
function ThirdPartyConsent({ relays, checked, onChange }: { relays: RelayInfo[]; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const operators = [...new Set(relays.map((relay) => t(RELAY_OPERATOR_KEYS[relay.operator])))].join(", ");
  const hosts = relays.map((relay) => relay.host).join(", ");
  return <Checkbox checked={checked} onChange={onChange}>{t("friendsSettings.optIn.thirdParty", { operator: operators, hosts })}</Checkbox>;
}

function OptInDialog({ state, onClose }: { state: FriendsState; onClose: () => void }) {
  const { t } = useI18n();
  const formId = useId();
  const enable = useEnableFriends();
  const [displayName, setDisplayName] = useState(state.settings.displayName);
  const [dirty, setDirty] = useState(false);
  const [alwaysRelay, setAlwaysRelay] = useState(false);
  const [acceptedThirdParty, setAcceptedThirdParty] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const thirdPartyRelays = state.relays.filter((relay) => relay.thirdParty);
  const name = displayName.trim();
  const nameValid = isValidDisplayName(name);
  const consentGiven = thirdPartyRelays.length === 0 || acceptedThirdParty;
  const ready = nameValid && understood && consentGiven && !enable.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    enable.mutate({ displayName: name, alwaysRelay, acceptThirdPartyRelays: acceptedThirdParty, findableByName: false }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("friendsSettings.optIn.title")}
      width={DIALOG_WIDTH_PX}
      height={DIALOG_HEIGHT_PX}
      busy={enable.isPending}
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{
            label: enable.isPending ? t("friendsSettings.optIn.pending") : t("friendsSettings.optIn.confirm"),
            width: CONFIRM_WIDTH_PX,
            form: formId,
            disabled: !ready,
          }}
        />
      }
    >
      <PrivacyPoints relays={state.relays} />
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("friendsSettings.optIn.nameLabel")}
          help={t("friendsSettings.nameHint", { min: FRIENDS_LIMITS.displayNameMin, max: FRIENDS_LIMITS.displayNameMax })}
          error={dirty && !nameValid ? t("errors.friends.displayNameInvalid", { min: FRIENDS_LIMITS.displayNameMin, max: FRIENDS_LIMITS.displayNameMax }) : undefined}
        >
          <TextField value={displayName} onChange={(e) => setDisplayName(e.target.value)} onBlur={() => setDirty(true)} />
        </Field>
        <Checkbox checked={alwaysRelay} onChange={setAlwaysRelay}>{t("friendsSettings.optIn.alwaysRelay")}</Checkbox>
        {thirdPartyRelays.length > 0 && <ThirdPartyConsent relays={thirdPartyRelays} checked={acceptedThirdParty} onChange={setAcceptedThirdParty} />}
        <Checkbox checked={understood} onChange={setUnderstood}>{t("friendsSettings.optIn.understood")}</Checkbox>
        <Hint icon="info">{t("friendsSettings.optIn.firewall")}</Hint>
      </form>
    </Dialog>
  );
}

/**
 * Opt-in für Freunde: sagt in Klartext, was Freunde und Relay-Server sehen, und schaltet erst nach „Verstanden“ ein
 * (bei Relay-Servern fremder Betreiber auch erst nach deren Zustimmung). Der Aufrufer hängt den Dialog nur ein, solange er offen ist.
 */
export function FriendsOptInDialog({ onClose }: { onClose: () => void }) {
  const state = useFriendsState().data;
  return state ? <OptInDialog state={state} onClose={onClose} /> : null;
}
