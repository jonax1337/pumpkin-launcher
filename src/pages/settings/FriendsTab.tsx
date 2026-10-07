import { useState } from "react";
import { type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAllAccounts } from "@/components/accounts/useAccounts";
import { FriendsOptInDialog } from "@/components/friends/FriendsOptInDialog";
import { QueryList } from "@/components/QueryList";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import {
  useBlockedPeers, useDisableFriends, useFriendsState, useHostSessions, useInvites, useResetFriends, useRotateFriendsIdentity,
  useUnblockPeer, useUpdateFriendsSettings,
} from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { copyWithToast } from "@/lib/clipboard";
import { formatDate } from "@/lib/format";
import { type DirectoryStatus, type FriendsSettings, type FriendsState, type IngameActions, type Me, type NetworkStatus } from "@/lib/types";
import { useFriendsUi } from "@/store/friendsUi";
import { Actions, Button, ConfirmDialog, Count, ErrorBox, FormRow, FormSection, Hint, List, ListRow, RowTitle, Segmented, Skel, StatusPanel, Switch, type IconName } from "@/ui";

const SECOND_MS = 1000;
const ROW_SKELETON_HEIGHT_PX = 60;

/** Schaltet Freunde ein (öffnet das Opt-in) oder aus; Ausschalten behält die Daten. */
function EnableRow({ enabled, onEnable }: { enabled: boolean; onEnable: () => void }) {
  const { t } = useI18n();
  const disable = useDisableFriends();
  return (
    <FormRow label={t("friendsSettings.enableLabel")} hint={t("friendsSettings.enableHint")} aside={t("friendsSettings.enableAside")}>
      <Switch
        label={t("friendsSettings.enableLabel")}
        checked={enabled}
        disabled={disable.isPending}
        onChange={(on) => (on ? onEnable() : disable.mutate())}
        stateText={[t("ui.switch.on"), t("ui.switch.off")]}
      />
    </FormRow>
  );
}

function MinecraftNameRow() {
  const { t } = useI18n();
  const { query } = useAllAccounts();
  return (
    <FormRow label={t("friendsSettings.nameLabel")} hint={t("friendsSettings.nameHint")}>
      <QueryList query={query} error={t("components.account.msLoadFailed")} empty={<p>{t("friendsSettings.nameUnavailable")}</p>}>
        {(accounts) => <p aria-live="polite">{accounts[0].username}</p>}
      </QueryList>
    </FormRow>
  );
}

/** Wie es um die Eintragung im Verzeichnis steht; bei „aus“ und „nicht eingebunden“ gibt es nichts zu melden. */
function FindableStatus({ directory, name }: { directory: DirectoryStatus; name: string | undefined }) {
  const { t } = useI18n();
  switch (directory.state) {
    case "active":
      return name ? <Hint tone="ok">{t("friendsSettings.findable.active", { name })}</Hint> : null;
    case "unreachable":
      return <Hint tone="warn" live>{t("friendsSettings.findable.unreachable")}</Hint>;
    case "notAllowed":
      return <Hint tone="warn" live>{t("friendsSettings.findable.notAllowed")}</Hint>;
    default:
      return null;
  }
}

/** „Per Minecraft-Namen auffindbar“: trägt die Minecraft-UUID im Verzeichnis ein oder löscht sie dort. Der Stand folgt asynchron (`friends-changed`). */
function FindableRow({ settings, directory }: { settings: FriendsSettings; directory: DirectoryStatus }) {
  const { t } = useI18n();
  const update = useUpdateFriendsSettings();
  const minecraftName = useAllAccounts().accounts.find((account) => account.kind === "microsoft")?.username;
  return (
    <FormRow label={t("friendsSettings.findable.label")} hint={t("friendsSettings.findable.hint")} aside={t("friendsSettings.findable.aside")}>
      <Switch
        label={t("friendsSettings.findable.label")}
        checked={settings.findableByName}
        disabled={update.isPending}
        onChange={(findableByName) => update.mutate({ ...settings, findableByName })}
        stateText={[t("ui.switch.on"), t("ui.switch.off")]}
      />
      {settings.findableByName && <FindableStatus directory={directory} name={minecraftName} />}
    </FormRow>
  );
}

/** Pumpkin Bridge bleibt unabhängig von der Friends-Freigabe einschaltbar. */
function IngameMenuRow({ settings }: { settings: FriendsSettings }) {
  const { t } = useI18n();
  const update = useUpdateFriendsSettings();
  return (
    <FormRow label={t("friendsSettings.ingameMenu.label")} hint={t("friendsSettings.ingameMenu.hint")}>
      <Switch
        label={t("friendsSettings.ingameMenu.label")}
        checked={settings.ingameMenu}
        disabled={update.isPending}
        onChange={(ingameMenu) => update.mutate({ ...settings, ingameMenu })}
        stateText={[t("ui.switch.on"), t("ui.switch.off")]}
      />
    </FormRow>
  );
}

/** „Aktionen im Spiel“: ob der Launcher bei jedem Spielstart einmal fragt oder die Aktionen aus dem Spiel gleich erlaubt (docs/bridge/README.md, "Operations and consent"). */
function IngameActionsRow({ settings }: { settings: FriendsSettings }) {
  const { t } = useI18n();
  const update = useUpdateFriendsSettings();
  return (
    <FormRow label={t("friendsSettings.ingameActions.label")} hint={t("friendsSettings.ingameActions.hint")} group="radiogroup">
      <Segmented<IngameActions>
        label={t("friendsSettings.ingameActions.label")}
        value={settings.ingameActions}
        onChange={(ingameActions) => update.mutate({ ...settings, ingameActions })}
        items={[
          { value: "ask", label: t("friendsSettings.ingameActions.ask") },
          { value: "allow", label: t("friendsSettings.ingameActions.allow") },
        ]}
      />
    </FormRow>
  );
}

/** Was ein Neuaufbau der Verbindung beendet: die geteilte Welt und der Beitritt, dieser mit dem Namen des Gastgebers. */
function useRebindConsequences(): string[] {
  const { t } = useI18n();
  const sharing = (useHostSessions().data?.length ?? 0) > 0;
  const joinedInviteId = useFriendsUi((state) => state.joinSession?.inviteId);
  const host = useInvites().data?.find((invite) => invite.id === joinedInviteId)?.fromName;
  return [
    ...(sharing ? [t("friendsSettings.relayConfirmHosting")] : []),
    ...(joinedInviteId === undefined ? [] : [host ? t("friendsSettings.relayConfirmJoin", { name: host }) : t("friendsSettings.relayConfirmJoinUnnamed")]),
  ];
}

/** „Immer über Relay“; während eine Welt geteilt wird oder ein Beitritt läuft, ist das Umschalten erst nach einer Rückfrage möglich, weil es beides beendet. */
function AlwaysRelayRow({ settings }: { settings: FriendsSettings }) {
  const { t } = useI18n();
  const update = useUpdateFriendsSettings();
  const consequences = useRebindConsequences();
  const confirm = useConfirmTarget<boolean>();
  const apply = (alwaysRelay: boolean, onDone?: () => void) => update.mutate({ ...settings, alwaysRelay }, { onSuccess: onDone });
  return (
    <FormRow label={t("friendsSettings.relayLabel")} hint={t("friendsSettings.relayHint")} aside={t("friendsSettings.relayAside")}>
      <Switch
        label={t("friendsSettings.relayLabel")}
        checked={settings.alwaysRelay}
        disabled={update.isPending}
        onChange={(on) => (consequences.length > 0 ? confirm.ask(on) : apply(on))}
        stateText={[t("ui.switch.on"), t("ui.switch.off")]}
      />
      <ConfirmDialog
        {...confirm.dialogProps({
          title: () => t("friendsSettings.relayConfirmTitle"),
          text: () => [t("friendsSettings.relayConfirmText"), ...consequences].join(" "),
          confirmLabel: t("friendsSettings.relayConfirmButton"),
          pending: update.isPending,
          onConfirm: apply,
        })}
      />
    </FormRow>
  );
}

/** Der Fingerabdruck, und daneben die ganze ID: eine Meldung an den Relay-Betreiber braucht sie, der Fingerabdruck reicht dafür nicht. */
function FingerprintRow({ me }: { me: Me }) {
  const { t } = useI18n();
  return (
    <FormRow label={t("friendsSettings.fingerprintLabel")} hint={t("friendsSettings.fingerprintHint")} aside={t("friendsSettings.fingerprintAside")}>
      <Actions gap={12}>
        <Count value={me.fingerprint} size={20} className="select-text" />
        <Button size="s" icon="copy" onClick={() => copyWithToast(me.peerId, t("friendsSettings.peerIdCopied"))}>{t("friendsSettings.copyPeerId")}</Button>
      </Actions>
    </FormRow>
  );
}

function NetworkHint({ network }: { network: NetworkStatus }) {
  const { t } = useI18n();
  switch (network.type) {
    case "online":
      return <Hint tone="ok">{t("friendsSettings.networkOnline", { relayHost: network.relayHost })}</Hint>;
    case "degraded":
      return <Hint tone="bad" live>{t("friendsSettings.networkDegraded", { reason: t(`friendsSettings.degraded.${network.reason}`) })}</Hint>;
    case "starting":
      return <Hint icon="info">{t("friendsSettings.networkStarting")}</Hint>;
    case "off":
      return <Hint icon="info">{t("friendsSettings.networkOff")}</Hint>;
  }
}

function NetworkRow({ network }: { network: NetworkStatus }) {
  const { t } = useI18n();
  return (
    <FormRow label={t("friendsSettings.networkLabel")}>
      <NetworkHint network={network} />
    </FormRow>
  );
}

/** Die Sperrliste mit „Entsperren“. */
function BlockedSection() {
  const { t } = useI18n();
  const blocked = useBlockedPeers();
  const unblock = useUnblockPeer();
  return (
    <FormSection title={t("friendsSettings.sectionBlocked")} level={3}>
      <Hint icon="info" className="mb-2.5">{t("friendsSettings.blockedHint")}</Hint>
      <QueryList
        query={blocked}
        error={t("friendsSettings.loadFailed")}
        loading={<Skel h={ROW_SKELETON_HEIGHT_PX} />}
        empty={<Hint>{t("friendsSettings.blockedNone")}</Hint>}
      >
        {(peers) => (
          <List variant="accounts" aria-label={t("friendsSettings.sectionBlocked")}>
            {peers.map((peer) => (
              <ListRow key={peer.peerId}>
                <RowTitle title={peer.displayName} sub={t("friendsSettings.blockedSince", { date: formatDate(peer.blockedAt * SECOND_MS) })} />
                <Button size="s" disabled={unblock.isPending} onClick={() => unblock.mutate(peer.peerId)}>{t("friendsSettings.unblock")}</Button>
              </ListRow>
            ))}
          </List>
        )}
      </QueryList>
    </FormSection>
  );
}

/** Gefahrenknopf mit Rückfrage für eine Änderung der Identität; danach eine Bestätigung als Toast. */
function IdentityAction({ mutation, icon, buttonLabel, title, text, doneMessage }: {
  mutation: UseMutationResult<FriendsState, Error, void>; icon: IconName; buttonLabel: string; title: string; text: string; doneMessage: string;
}) {
  const [asking, setAsking] = useState(false);

  async function confirm() {
    try {
      await mutation.mutateAsync();
    } catch {
      return; // Den Fehler meldet schon der zentrale Mutations-Toast.
    }
    setAsking(false);
    toast.success(doneMessage);
  }

  return (
    <>
      <Button variant="danger" icon={icon} onClick={() => setAsking(true)}>{buttonLabel}</Button>
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={title} text={text} confirmLabel={buttonLabel} pending={mutation.isPending} onConfirm={() => void confirm()} />
    </>
  );
}

function ResetIdentityAction() {
  const { t } = useI18n();
  const reset = useResetFriends();
  return (
    <IdentityAction
      mutation={reset}
      icon="trash"
      buttonLabel={t("friendsSettings.resetButton")}
      title={t("friendsSettings.resetTitle")}
      text={t("friendsSettings.resetText")}
      doneMessage={t("friendsSettings.resetDone")}
    />
  );
}

function DangerSection() {
  const { t } = useI18n();
  const rotate = useRotateFriendsIdentity();
  return (
    <FormSection title={t("friendsSettings.sectionDanger")} level={3} className="settings-field-grid">
      <FormRow label={t("friendsSettings.rotateLabel")} hint={t("friendsSettings.rotateHint")}>
        <Actions>
          <IdentityAction
            mutation={rotate}
            icon="redo"
            buttonLabel={t("friendsSettings.rotateButton")}
            title={t("friendsSettings.rotateTitle")}
            text={t("friendsSettings.rotateText")}
            doneMessage={t("friendsSettings.rotated")}
          />
        </Actions>
      </FormRow>
      <FormRow label={t("friendsSettings.resetLabel")} hint={t("friendsSettings.resetHint")}>
        <Actions>
          <ResetIdentityAction />
        </Actions>
      </FormRow>
    </FormSection>
  );
}

/** Einstellungen bei verfügbarem Schlüsselbund: Schalter und, wenn Freunde an sind, alles Weitere. */
function AvailableSettings({ state }: { state: FriendsState }) {
  const { t } = useI18n();
  const [optingIn, setOptingIn] = useState(false);
  return (
    <>
      <FormSection title={t("friendsSettings.sectionGeneral")} level={3} className="settings-field-grid">
        <EnableRow enabled={state.enabled} onEnable={() => setOptingIn(true)} />
        {state.enabled && (
          <>
            <MinecraftNameRow />
            <AlwaysRelayRow settings={state.settings} />
            {state.directory.state !== "unavailable" && <FindableRow settings={state.settings} directory={state.directory} />}
            <IngameActionsRow settings={state.settings} />
            {state.me && <FingerprintRow me={state.me} />}
            <NetworkRow network={state.network} />
          </>
        )}
      </FormSection>
      {state.enabled && (
        <>
          <BlockedSection />
          <DangerSection />
        </>
      )}
      {optingIn && <FriendsOptInDialog onClose={() => setOptingIn(false)} />}
    </>
  );
}

function UnavailableSettings({ availability }: { availability: Exclude<FriendsState["availability"], "available"> }) {
  const { t } = useI18n();
  if (availability === "noSecretStore") return <StatusPanel>{t("friendsSettings.noSecretStore")}</StatusPanel>;
  return (
    <StatusPanel tone="bad" role="alert" title={t("friendsSettings.identityLostTitle")} actions={<ResetIdentityAction />}>
      {t("friendsSettings.identityLostText")}
    </StatusPanel>
  );
}

/** Einstellungen › Freunde: ein- und ausschalten, Anzeigename, Relay, Sperrliste und die Identität. */
export function FriendsTab() {
  const { t } = useI18n();
  const query = useFriendsState();
  if (query.error) return <ErrorBox title={t("friendsSettings.loadFailed")} error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Skel h={ROW_SKELETON_HEIGHT_PX * 3} />;
  const state = query.data;
  return (
    <>
      <FormSection title={t("friendsSettings.ingameMenu.label")} level={3}>
        <IngameMenuRow settings={state.settings} />
      </FormSection>
      {state.availability === "available" ? <AvailableSettings state={state} /> : <UnavailableSettings availability={state.availability} />}
    </>
  );
}
