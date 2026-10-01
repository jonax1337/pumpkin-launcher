import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t, useI18n } from "@/i18n";
import { StopDialog } from "@/components/game";
import { PlayerNameField } from "@/components/PlayerNameField";
import { accountKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import { WIDTH } from "@/lib/breakpoints";
import { copyWithToast } from "@/lib/clipboard";
import { openPage } from "@/lib/links";
import { MINUTE } from "@/lib/time";
import type { MsLoginStart } from "@/lib/types";
import {
  Actions, Avatar, BarButton, Button, Dialog, DialogActions, Empty, ErrorBox, Hint, Icon, List, ListRow, Menu, Progress, RowTitle, Skel, type MenuEntry,
} from "@/ui";
import { closeMsLogin, openAddOffline, startMsLogin, useAccountUi, useMsLogin } from "@/store/accountUi";
import { refreshOfflineAllowed, useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, isValidPlayerName, useSettings, type ActiveAccount } from "@/store/settings";

// ---------- Microsoft-Anmeldung (ein Dialog für Kontomenü, Einstellungen und Onboarding) ----------

/** So viele ganze Minuten läuft die Anmeldung noch, mindestens eine. */
const validMinutes = (info: MsLoginStart) => Math.max(1, Math.round(info.expiresIn / 60));

/** Dialog-Untertitel „Danach startet {name}.“ – der Name bleibt als React-Knoten fett. */
function ThenSub({ label }: { label: string }) {
  const { tAround } = useI18n();
  const [before, after] = tAround("components.account.then", "name");
  return (
    <>
      {before}
      <b>{label}</b>
      {after}
    </>
  );
}

function MsLoginDialog() {
  const { t } = useI18n();
  const state = useMsLogin();
  const then = useAccountUi((s) => s.then);
  const offlineAllowed = useOfflineAllowed((s) => s.allowed);
  const qc = useQueryClient();

  return (
    <Dialog
      open={state.step !== "idle"}
      onOpenChange={(o) => !o && closeMsLogin()}
      title={t("components.account.msLogin")}
      sub={then && state.step !== "done" ? <ThenSub label={then.label} /> : undefined}
      width={520}
      height={420}
      footer={
        state.step === "done" ? (
          <DialogActions confirm={{ label: t("common.done"), width: 124, onClick: closeMsLogin }} />
        ) : (
          <>
            {state.step === "code" && (
              <Button icon="ext" onClick={() => openPage(state.info.verificationUri)}>{t("common.open")}</Button>
            )}
            {state.step === "code" && state.info.mode === "browser" && (
              <Button variant="ghost" onClick={() => void startMsLogin(qc, "device")}>{t("components.ms.useCodeInstead")}</Button>
            )}
            <DialogActions cancel={{ label: state.step === "error" ? t("common.close") : t("common.cancel"), width: 124 }} />
          </>
        )
      }
    >
      {state.step === "starting" && (
        <div className="flex flex-col gap-3 pt-1" aria-busy>
          <Skel h={20} w="80%" />
          <Skel h={64} w={280} />
          <Skel h={16} w="60%" />
        </div>
      )}
      {state.step === "code" && state.info.mode === "browser" && (
        <>
          <p>{t("components.ms.browserOpened")}</p>
          <div className="flex h-8 items-center gap-3" aria-live="polite">
            <Progress width={120} label={t("components.ms.waiting")} />
            <Hint>{t("components.ms.windowWaits", { min: validMinutes(state.info) })}</Hint>
          </div>
          <Hint className="mt-3">{t("components.ms.nothingHappens")}</Hint>
        </>
      )}
      {state.step === "code" && state.info.mode === "device" && (
        <>
          <p>{t("components.ms.openAt")} <b>{state.info.verificationUri.replace(/^https?:\/\/(www\.)?/, "")}</b> {t("components.ms.enterCode")}</p>
          {/* Code-Anzeige (Sonderform: große Pixelschrift in eingelassener Platte) */}
          <div className="codebox">
            <span className="code select-all" aria-label={t("components.ms.codeSpaced", { code: state.info.userCode.split("").join(" ") })}>{state.info.userCode}</span>
            <Button icon="copy" onClick={() => copyWithToast(state.info.userCode, t("components.ms.codeCopied"))}>{t("common.copy")}</Button>
          </div>
          <div className="flex h-8 items-center gap-3" aria-live="polite">
            <Progress width={120} label={t("components.ms.waiting")} />
            <Hint>{t("components.ms.codeValid", { min: validMinutes(state.info) })}</Hint>
          </div>
        </>
      )}
      {state.step === "done" && (
        <div className="mt-2 flex items-center gap-3.5">
          <Avatar name={state.name} />
          <div>
            <Hint tone="ok">{t("components.account.loggedInAs", { name: state.name })}</Hint>
            <p>{t("components.ms.accountActive")}</p>
          </div>
        </div>
      )}
      {state.step === "error" && (
        <>
          <ErrorBox title={t("components.ms.loginFailed")} error={state.message} onRetry={() => void startMsLogin(qc)} />
          {offlineAllowed && <p className="mt-3">{t("components.ms.offlinePossible")}</p>}
        </>
      )}
    </Dialog>
  );
}

// ---------- Konten ----------

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

const sameAccount = (a: ActiveAccount | null, b: ActiveAccount) =>
  !!a && a.kind === b.kind && (a.kind === "offline" ? a.name === (b as typeof a).name : a.id === (b as typeof a).id);

/** Alle Konten in einer Liste: Microsoft zuerst, dann Offline-Namen. */
function useAllAccounts(): ActiveAccount[] {
  const offline = useSettings((s) => s.offlineAccounts);
  const allowed = useOfflineAllowed((s) => s.allowed);
  const ms = useMsAccounts();
  return [
    ...(ms.data ?? []).map((a): ActiveAccount => ({ kind: "microsoft", id: a.id, username: a.username })),
    ...(allowed ? offline : []).map((name): ActiveAccount => ({ kind: "offline", name })),
  ];
}

const kindLabel = (a: ActiveAccount) => (a.kind === "microsoft" ? t("components.account.kindMicrosoft") : t("components.account.kindOffline"));
const keyOf = (a: ActiveAccount) => (a.kind === "microsoft" ? `ms:${a.id}` : `off:${a.name}`);

function useRemoveAccount() {
  const { removeAccount, forgetMicrosoft } = useSettings();
  const qc = useQueryClient();
  const removeMs = useMutation({
    mutationFn: (id: string) => api.msAccountRemove(id),
    onSuccess: (_, id) => {
      forgetMicrosoft(id);
      return qc.invalidateQueries({ queryKey: accountKeys.microsoft });
    },
  });
  return { remove: (a: ActiveAccount) => (a.kind === "offline" ? removeAccount(a.name) : removeMs.mutate(a.id)), pending: removeMs.isPending };
}

/** Kontomenü oben rechts: Kopf + Name, Konten wechseln, anmelden, Spielername hinzufügen. */
export function AccountMenu() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const allowed = useOfflineAllowed((s) => s.allowed);
  const select = useSettings((s) => s.selectAccount);
  const accounts = useAllAccounts();
  const { remove } = useRemoveAccount();
  const open = useAccountUi((s) => s.menu);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const name = accountName(active);

  const items: MenuEntry[] = [
    ...(accounts.length ? [{ label: t("components.account.accounts") } as const] : []),
    ...accounts.map((a): MenuEntry => ({
      id: keyOf(a),
      text: accountName(a),
      sub: kindLabel(a),
      lead: <Avatar name={accountName(a)} />,
      checked: sameAccount(active, a),
      onSelect: () => select(a),
    })),
    ...(accounts.length ? ["-" as const] : []),
    { id: "ms", text: t("components.account.msLogin"), icon: "user", onSelect: () => void startMsLogin(qc) },
    ...(allowed ? [{ id: "off", text: t("components.account.addPlayerName"), icon: "plus" as const, onSelect: openAddOffline }] : []),
    { id: "skins", text: t("components.account.skins"), icon: "shirt", onSelect: () => navigate("/skins") },
    { id: "set", text: t("common.settings"), icon: "gear", onSelect: () => navigate("/settings#konten") },
    ...(active?.kind === "microsoft"
      ? ["-" as const, { id: "out", text: t("components.account.signOutNamed", { name }), icon: "power" as const, bad: true, onSelect: () => remove(active) }]
      : []),
  ];

  return (
    <>
      <Menu
        open={open}
        onOpenChange={(o) => useAccountUi.setState({ menu: o })}
        width={320}
        items={items}
        trigger={
          <BarButton
            aria-label={name ? t("components.account.switchWith", { name }) : allowed ? t("components.account.noNameChoose") : t("components.account.notLoggedInChoose")}
            label={name || (allowed ? t("components.account.noName") : t("components.account.notLoggedIn"))}
            tone={name ? undefined : "warn"}
            iconEnd="chevd"
            compactBelow={WIDTH.sm}
          >
            {/* Ohne Namen: Warnsymbol statt Kopf (Form, nicht nur gelbe Schrift; bleibt auch schmal sichtbar, wenn der Text wegfällt) */}
            {name ? <Avatar name={name} /> : <Icon name="warn" tone="warn" />}
          </BarButton>
        }
      />
      <MsLoginDialog />
      <AddOfflineDialog />
      {/* Globale Rückfrage „Minecraft beenden?“ (askStop); hier, weil das Kontomenü immer eingehängt ist */}
      <StopDialog />
    </>
  );
}

function AddOfflineDialog() {
  const { t } = useI18n();
  const open = useAccountUi((s) => s.offline);
  const then = useAccountUi((s) => s.then);
  const addAccount = useSettings((s) => s.addAccount);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const close = () => {
    useAccountUi.setState({ offline: false, then: null });
    setName("");
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPlayerName(name)) return;
    addAccount(name);
    // Startet danach das Spiel, zeigt der Spielen-Knopf den Fortschritt; eine Meldung wäre doppelt.
    if (!then) toast.success(t("components.account.playerNameActive", { name }));
    close();
    then?.run();
  }

  // Beim Spielen: statt Namen mit Microsoft anmelden; `then` bleibt stehen und startet nach der Anmeldung.
  function microsoft() {
    useAccountUi.setState({ offline: false });
    setName("");
    void startMsLogin(qc);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={then ? t("components.account.askName") : t("components.account.addPlayerName")}
      sub={then ? <ThenSub label={then.label} /> : undefined}
      width={480}
      height={then ? 402 : 278}
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{ label: then ? t("components.account.saveAndPlay") : t("common.add"), width: then ? 196 : 140, form: "off-form", icon: then ? "play" : undefined, disabled: !isValidPlayerName(name) }}
        />
      }
    >
      <form id="off-form" onSubmit={submit}>
        {/* Zwei Zeilen reserviert: der kürzere Fehler ersetzt den Hilfetext, ohne dass etwas nachrückt */}
        <PlayerNameField value={name} onChange={setName} help={t("components.playerName.helpLong")} reserveLines={2} />
      </form>
      {then && (
        <>
          <div className="or">{t("components.common.or")}</div>
          <Button icon="user" width="full" onClick={microsoft}>{t("components.account.msLogin")}</Button>
          <Hint className="mt-2">{t("components.account.neededForServers")}</Hint>
        </>
      )}
    </Dialog>
  );
}

/** Konten verwalten (Einstellungen). */
export function AccountsSection() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const offlineAllowed = useOfflineAllowed((s) => s.allowed);
  const select = useSettings((s) => s.selectAccount);
  const accounts = useAllAccounts();
  const ms = useMsAccounts();
  const { remove, pending } = useRemoveAccount();
  const qc = useQueryClient();

  return (
    <>
      {ms.isPending && accounts.length === 0 ? (
        <Skel h={60} />
      ) : accounts.length ? (
        <List variant="accounts" aria-label={t("components.account.accounts")}>
          {accounts.map((a) => {
            const on = sameAccount(active, a);
            const name = accountName(a);
            return (
              <ListRow key={keyOf(a)} selected={on}>
                <Avatar name={name} />
                <RowTitle title={name} sub={`${kindLabel(a)}${on ? ` · ${t("components.account.active")}` : ""}`} />
                {!on && <Button size="s" onClick={() => select(a)}>{t("components.account.switch")}</Button>}
                <Button variant="ghost" size="s" disabled={a.kind === "microsoft" && pending} onClick={() => remove(a)}>
                  {a.kind === "microsoft" ? t("components.account.signOutPlain") : t("common.remove")}
                </Button>
              </ListRow>
            );
          })}
        </List>
      ) : (
        <Empty size="pane" ill="user" title={t("components.account.noneYet")}>{offlineAllowed ? t("components.account.noneOfflineAllowed") : t("components.account.msLoginPrompt")}</Empty>
      )}
      {ms.error && <ErrorBox className="mt-3" title={t("components.account.msLoadFailed")} error={ms.error} onRetry={() => void ms.refetch()} />}
      <Actions wrap className="mt-3">
        <Button icon="user" onClick={() => void startMsLogin(qc)}>{t("components.account.msLogin")}</Button>
        {offlineAllowed && <Button icon="plus" onClick={openAddOffline}>{t("components.account.addPlayerName")}</Button>}
      </Actions>
      <Hint className="mt-2.5 max-w-[70ch]">
        {offlineAllowed
          ? t("components.account.offlineHint")
          : t("components.onboarding.msHintRequired")}
      </Hint>
    </>
  );
}
