import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { Btn, Dialog, DialogClose, ErrorBox, Menu, Progress, Skel, TextField, type MenuEntry } from "@/components/px";
import { api } from "@/lib/api";
import type { MsLoginStart } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Face, Icon } from "@/pixel/icons";
import { accountName, isValidPlayerName, useSettings, type ActiveAccount } from "@/store/settings";

// ---------- Microsoft-Anmeldung (ein Dialog für Kontomenü, Einstellungen und Onboarding) ----------

type LoginState = { step: "idle" } | { step: "starting" } | { step: "code"; info: MsLoginStart } | { step: "done"; name: string } | { step: "error"; message: string };
const useMsLogin = create<LoginState>(() => ({ step: "idle" }));
// Jeder Versuch bekommt eine Nummer; Antworten eines abgebrochenen Versuchs werden verworfen.
let attempt = 0;

export async function startMsLogin(qc: QueryClient) {
  const mine = ++attempt;
  useMsLogin.setState({ step: "starting" }, true);
  try {
    const info = await api.msLoginStart(useSettings.getState().msClientId);
    if (mine !== attempt) return;
    useMsLogin.setState({ step: "code", info }, true);
    void api.openExternal(info.verificationUri).catch(() => undefined);
    const account = await api.msLoginFinish();
    if (mine !== attempt) return;
    useSettings.getState().selectAccount({ kind: "microsoft", id: account.id, username: account.username });
    void qc.invalidateQueries({ queryKey: ["ms-accounts"] });
    useMsLogin.setState({ step: "done", name: account.username }, true);
  } catch (err) {
    if (mine === attempt) useMsLogin.setState({ step: "error", message: err instanceof Error ? err.message : String(err) }, true);
  }
}

function closeMsLogin() {
  const running = ["starting", "code"].includes(useMsLogin.getState().step);
  attempt++;
  useMsLogin.setState({ step: "idle" }, true);
  if (running) void api.msLoginCancel().catch(() => undefined);
}

function MsLoginDialog() {
  const state = useMsLogin();
  const qc = useQueryClient();

  function copy(code: string) {
    void navigator.clipboard.writeText(code).then(
      () => toast.success("Code kopiert"),
      () => toast.error("Kopieren hat nicht geklappt"),
    );
  }

  return (
    <Dialog
      open={state.step !== "idle"}
      onOpenChange={(o) => !o && closeMsLogin()}
      title="Mit Microsoft anmelden"
      width={520}
      height={420}
      footer={
        <>
          {state.step === "code" && (
            <Btn icon="ext" onClick={() => void api.openExternal(state.info.verificationUri)}>Seite öffnen</Btn>
          )}
          {state.step === "done" ? (
            <Btn variant="p" full style={{ width: 124 }} onClick={closeMsLogin}>Fertig</Btn>
          ) : (
            <DialogClose asChild><Btn full style={{ width: 124 }}>{state.step === "error" ? "Schließen" : "Abbrechen"}</Btn></DialogClose>
          )}
        </>
      }
    >
      {state.step === "starting" && (
        <div className="flex flex-col gap-3 pt-1" aria-busy>
          <Skel style={{ height: 20, width: "80%" }} />
          <Skel style={{ height: 64, width: 280 }} />
          <Skel style={{ height: 16, width: "60%" }} />
        </div>
      )}
      {state.step === "code" && (
        <>
          <p>Öffne <b>{state.info.verificationUri.replace(/^https?:\/\/(www\.)?/, "")}</b> in deinem Browser und gib diesen Code ein:</p>
          <div className="codebox">
            <span className="code select-all" aria-label={`Code ${state.info.userCode.split("").join(" ")}`}>{state.info.userCode}</span>
            <Btn icon="copy" onClick={() => copy(state.info.userCode)}>Kopieren</Btn>
          </div>
          <div className="wait" aria-live="polite">
            <Progress />
            <span>Warte auf deine Anmeldung. Der Code gilt {Math.max(1, Math.round(state.info.expiresIn / 60))} Minuten.</span>
          </div>
        </>
      )}
      {state.step === "done" && (
        <div className="row mt-2" style={{ gap: 14 }}>
          <span className="avatar" style={{ width: 48, height: 48 }}><Face name={state.name} size="calc(var(--avs) * 1.5)" /></span>
          <div>
            <p className="ok-msg">Angemeldet als {state.name}</p>
            <p>Das Konto ist jetzt aktiv. Du kannst jederzeit oben rechts wechseln.</p>
          </div>
        </div>
      )}
      {state.step === "error" && (
        <>
          <p className="err-msg">Anmeldung hat nicht geklappt.</p>
          <p>{state.message}</p>
          <p className="mt-2">Mit einem Spielernamen kannst du auch ohne Anmeldung spielen.</p>
          <div className="row mt-3.5">
            <Btn icon="redo" onClick={() => void startMsLogin(qc)}>Erneut versuchen</Btn>
          </div>
        </>
      )}
    </Dialog>
  );
}

// ---------- Konten ----------

/** Offene Kontenteile: Menü in der Fensterleiste und Dialog „Spielername hinzufügen“. */
const useAccountUi = create<{ menu: boolean; offline: boolean }>(() => ({ menu: false, offline: false }));
/** Öffnet das Kontomenü oben rechts (z. B. aus „Erst Spielernamen festlegen“). */
export const openAccounts = () => useAccountUi.setState({ menu: true });
export const openAddOffline = () => useAccountUi.setState({ offline: true, menu: false });

function useMsAccounts() {
  const query = useQuery({ queryKey: ["ms-accounts"], queryFn: api.msAccounts, staleTime: 5 * 60_000, retry: false });
  const syncMicrosoft = useSettings((s) => s.syncMicrosoft);
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
  const ms = useMsAccounts();
  return [
    ...(ms.data ?? []).map((a): ActiveAccount => ({ kind: "microsoft", id: a.id, username: a.username })),
    ...offline.map((name): ActiveAccount => ({ kind: "offline", name })),
  ];
}

const kindLabel = (a: ActiveAccount) => (a.kind === "microsoft" ? "Microsoft-Konto" : "Spielername · Einzelspieler und LAN");
const keyOf = (a: ActiveAccount) => (a.kind === "microsoft" ? `ms:${a.id}` : `off:${a.name}`);

function useRemoveAccount() {
  const { removeAccount, forgetMicrosoft } = useSettings();
  const qc = useQueryClient();
  const removeMs = useMutation({
    mutationFn: (id: string) => api.msAccountRemove(id),
    onSuccess: (_, id) => {
      forgetMicrosoft(id);
      return qc.invalidateQueries({ queryKey: ["ms-accounts"] });
    },
  });
  return { remove: (a: ActiveAccount) => (a.kind === "offline" ? removeAccount(a.name) : removeMs.mutate(a.id)), pending: removeMs.isPending };
}

/** Kontomenü oben rechts: Kopf + Name, Konten wechseln, anmelden, Spielername hinzufügen. */
export function AccountMenu() {
  const active = useSettings((s) => s.active);
  const select = useSettings((s) => s.selectAccount);
  const accounts = useAllAccounts();
  const { remove } = useRemoveAccount();
  const open = useAccountUi((s) => s.menu);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const name = accountName(active);

  const items: MenuEntry[] = [
    ...(accounts.length ? [{ label: "Konten" } as const] : []),
    ...accounts.map((a): MenuEntry => ({
      id: keyOf(a),
      text: accountName(a),
      sub: kindLabel(a),
      lead: <span className="avatar"><Face name={accountName(a)} /></span>,
      checked: sameAccount(active, a),
      onSelect: () => select(a),
    })),
    ...(accounts.length ? ["-" as const] : []),
    { id: "ms", text: "Mit Microsoft anmelden", icon: "user", onSelect: () => void startMsLogin(qc) },
    { id: "off", text: "Spielername hinzufügen", icon: "plus", onSelect: openAddOffline },
    { id: "set", text: "Einstellungen", icon: "gear", onSelect: () => navigate("/settings#konten") },
    ...(active?.kind === "microsoft"
      ? ["-" as const, { id: "out", text: `Abmelden (${name})`, icon: "power" as const, bad: true, onSelect: () => remove(active) }]
      : []),
  ];

  return (
    <>
      <Menu
        open={open}
        onOpenChange={(o) => useAccountUi.setState({ menu: o })}
        className="me"
        items={items}
        trigger={
          <button type="button" className="barbtn mebtn fx" aria-label={name ? `Konto: ${name}. Wechseln` : "Kein Konto. Festlegen"}>
            <span className="avatar">{name ? <Face name={name} /> : <Icon name="user" />}</span>
            <span className={cn("who", !name && "text-warn")}>{name || "Kein Konto"}</span>
            <Icon name="chevd" small />
          </button>
        }
      />
      <MsLoginDialog />
      <AddOfflineDialog />
    </>
  );
}

function AddOfflineDialog() {
  const open = useAccountUi((s) => s.offline);
  const addAccount = useSettings((s) => s.addAccount);
  const [name, setName] = useState("");
  const invalid = name.length > 0 && !isValidPlayerName(name);
  const close = () => {
    useAccountUi.setState({ offline: false });
    setName("");
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPlayerName(name)) return;
    addAccount(name);
    toast.success(`Spielername „${name}“ ist aktiv`);
    close();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Spielername hinzufügen"
      width={480}
      height={330}
      footer={
        <>
          <DialogClose asChild><Btn>Abbrechen</Btn></DialogClose>
          <Btn variant="p" full style={{ width: 140 }} type="submit" form="off-form" disabled={!isValidPlayerName(name)}>Hinzufügen</Btn>
        </>
      }
    >
      <form id="off-form" className="nf" onSubmit={submit}>
        <label htmlFor="off-name">Spielername</label>
        <TextField id="off-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="z. B. Steve_42" autoFocus aria-invalid={invalid} />
        <span className={invalid ? "help text-bad" : "help"} aria-live="polite">
          {invalid ? "Nur Buchstaben, Ziffern und Unterstrich, 3 bis 16 Zeichen." : "3 bis 16 Zeichen: Buchstaben, Ziffern und Unterstrich. Reicht für Einzelspieler, LAN und Server ohne Anmeldung."}
        </span>
      </form>
    </Dialog>
  );
}

/** Konten verwalten (Einstellungen). */
export function AccountsSection() {
  const active = useSettings((s) => s.active);
  const select = useSettings((s) => s.selectAccount);
  const accounts = useAllAccounts();
  const ms = useMsAccounts();
  const { remove, pending } = useRemoveAccount();
  const qc = useQueryClient();

  return (
    <>
      <div className="acc-list" aria-label="Konten">
        {ms.isPending && accounts.length === 0 ? (
          <Skel style={{ height: 60 }} />
        ) : accounts.length ? (
          accounts.map((a) => {
            const on = sameAccount(active, a);
            const name = accountName(a);
            return (
              <div key={keyOf(a)} className={cn("acct", on && "on")}>
                <span className="avatar"><Face name={name} /></span>
                <div className="an">
                  <b className="ell block">{name}</b>
                  <span>{kindLabel(a)}{on ? " · aktiv" : ""}</span>
                </div>
                {!on && <Btn size="s" onClick={() => select(a)}>Wechseln</Btn>}
                <Btn variant="g" size="s" disabled={a.kind === "microsoft" && pending} onClick={() => remove(a)}>
                  {a.kind === "microsoft" ? "Abmelden" : "Entfernen"}
                </Btn>
              </div>
            );
          })
        ) : (
          <p className="muted py-3">Noch kein Konto. Melde dich an oder leg einen Spielernamen an.</p>
        )}
      </div>
      {ms.error && <ErrorBox className="mt-3" title="Microsoft-Konten konnten nicht geladen werden" error={ms.error} onRetry={() => void ms.refetch()} />}
      <div className="row flex-wrap" style={{ marginTop: 12 }}>
        <Btn icon="user" onClick={() => void startMsLogin(qc)}>Mit Microsoft anmelden</Btn>
        <Btn icon="plus" onClick={openAddOffline}>Spielername hinzufügen</Btn>
      </div>
      <p className="help" style={{ marginTop: 10 }}>Mit einem Spielernamen spielst du allein, im LAN und auf Servern ohne Anmeldung. Für die meisten Server brauchst du ein Microsoft-Konto.</p>
    </>
  );
}
