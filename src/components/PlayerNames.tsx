import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { StopDialog } from "@/components/game";
import { api } from "@/lib/api";
import type { MsLoginStart } from "@/lib/types";
import {
  Actions, Avatar, BarButton, Button, Dialog, DialogActions, Empty, ErrorBox, Field, Hint, Icon, List, ListRow, Menu, Progress, RowTitle, Skel,
  TextField, type MenuEntry,
} from "@/ui";
import { refreshOfflineAllowed, useOfflineAllowed, useUsableAccount } from "@/store/offline";
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
    // Aus „Spielen“ ohne Namen gekommen: Dialog zu und direkt weiter (der Spielen-Knopf zeigt den Fortschritt).
    const then = useAccountUi.getState().then;
    if (then) {
      useAccountUi.setState({ then: null });
      useMsLogin.setState({ step: "idle" }, true);
      toast.success(`Angemeldet als ${account.username}`);
      return then.run();
    }
    useMsLogin.setState({ step: "done", name: account.username }, true);
  } catch (err) {
    if (mine === attempt) useMsLogin.setState({ step: "error", message: err instanceof Error ? err.message : String(err) }, true);
  }
}

function closeMsLogin() {
  const running = ["starting", "code"].includes(useMsLogin.getState().step);
  attempt++;
  useAccountUi.setState({ then: null });
  useMsLogin.setState({ step: "idle" }, true);
  if (running) void api.msLoginCancel().catch(() => undefined);
}

function MsLoginDialog() {
  const state = useMsLogin();
  const then = useAccountUi((s) => s.then);
  const offlineAllowed = useOfflineAllowed((s) => s.allowed);
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
      sub={then && state.step !== "done" ? <>Danach startet <b>{then.label}</b>.</> : undefined}
      width={520}
      height={420}
      footer={
        state.step === "done" ? (
          <DialogActions confirm={{ label: "Fertig", width: 124, onClick: closeMsLogin }} />
        ) : (
          <>
            {state.step === "code" && (
              <Button icon="ext" onClick={() => void api.openExternal(state.info.verificationUri)}>Seite öffnen</Button>
            )}
            <DialogActions cancel={{ label: state.step === "error" ? "Schließen" : "Abbrechen", width: 124 }} />
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
      {state.step === "code" && (
        <>
          <p>Öffne <b>{state.info.verificationUri.replace(/^https?:\/\/(www\.)?/, "")}</b> in deinem Browser und gib diesen Code ein:</p>
          {/* Code-Anzeige (Sonderform: große Pixelschrift in eingelassener Platte) */}
          <div className="codebox">
            <span className="code select-all" aria-label={`Code ${state.info.userCode.split("").join(" ")}`}>{state.info.userCode}</span>
            <Button icon="copy" onClick={() => copy(state.info.userCode)}>Kopieren</Button>
          </div>
          <div className="flex h-8 items-center gap-3" aria-live="polite">
            <Progress width={120} label="Warte auf Anmeldung" />
            <Hint>Warte auf deine Anmeldung. Der Code gilt {Math.max(1, Math.round(state.info.expiresIn / 60))} Minuten.</Hint>
          </div>
        </>
      )}
      {state.step === "done" && (
        <div className="mt-2 flex items-center gap-3.5">
          <Avatar name={state.name} />
          <div>
            <Hint tone="ok">Angemeldet als {state.name}</Hint>
            <p>Das Konto ist jetzt aktiv. Du kannst jederzeit oben rechts wechseln.</p>
          </div>
        </div>
      )}
      {state.step === "error" && (
        <>
          <ErrorBox title="Anmeldung hat nicht geklappt" error={state.message} onRetry={() => void startMsLogin(qc)} />
          {offlineAllowed && <p className="mt-3">Mit einem Spielernamen kannst du auch ohne Anmeldung spielen.</p>}
        </>
      )}
    </Dialog>
  );
}

// ---------- Konten ----------

/** Was nach dem Speichern des Namens passiert (z. B. „Spielen“ fortsetzen); `label` nennt die Instanz. */
type AfterName = { label: string; run: () => void };
/** Offene Kontenteile: Menü in der Fensterleiste und Dialog „Spielername hinzufügen“. */
const useAccountUi = create<{ menu: boolean; offline: boolean; then: AfterName | null }>(() => ({ menu: false, offline: false, then: null }));
/** Öffnet das Kontomenü oben rechts. */
export const openAccounts = () => useAccountUi.setState({ menu: true });
/** Spielername hinzufügen; ohne Erlaubnis des Backends (`offline_allowed`) gibt es den Dialog nicht. */
export const openAddOffline = () => {
  if (useOfflineAllowed.getState().allowed) useAccountUi.setState({ offline: true, menu: false, then: null });
};
/**
 * „Spielen“ ohne Konto: Dialog für den Namen öffnen, danach geht es mit `then` weiter.
 * Ist Offline nicht erlaubt (offizieller Build ohne Microsoft-Konto), startet stattdessen die Anmeldung.
 */
export const askPlayerName = (then: AfterName, qc: QueryClient) => {
  if (useOfflineAllowed.getState().allowed) return useAccountUi.setState({ offline: true, menu: false, then });
  useAccountUi.setState({ menu: false, then });
  void startMsLogin(qc);
};

function useMsAccounts() {
  const query = useQuery({ queryKey: ["ms-accounts"], queryFn: api.msAccounts, staleTime: 5 * 60_000, retry: false });
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
    ...(accounts.length ? [{ label: "Konten" } as const] : []),
    ...accounts.map((a): MenuEntry => ({
      id: keyOf(a),
      text: accountName(a),
      sub: kindLabel(a),
      lead: <Avatar name={accountName(a)} />,
      checked: sameAccount(active, a),
      onSelect: () => select(a),
    })),
    ...(accounts.length ? ["-" as const] : []),
    { id: "ms", text: "Mit Microsoft anmelden", icon: "user", onSelect: () => void startMsLogin(qc) },
    ...(allowed ? [{ id: "off", text: "Spielername hinzufügen", icon: "plus" as const, onSelect: openAddOffline }] : []),
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
        width={320}
        items={items}
        trigger={
          <BarButton
            aria-label={name ? `Konto: ${name}. Wechseln` : allowed ? "Spielername fehlt. Konto wählen" : "Nicht angemeldet. Konto wählen"}
            label={name || (allowed ? "Spielername fehlt" : "Nicht angemeldet")}
            tone={name ? undefined : "warn"}
            iconEnd="chevd"
            compactBelow={900}
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

/**
 * Fehler zum Spielernamen erst zeigen, wenn er etwas bedeutet: nach Verlassen des Felds oder ab 3 Zeichen.
 * Unerlaubte Zeichen sofort (die werden auch mit mehr Tippen nicht richtig).
 */
export function showNameError(name: string, touched: boolean) {
  if (!name || isValidPlayerName(name)) return false;
  return touched || name.length >= 3 || /[^A-Za-z0-9_]/.test(name);
}

function AddOfflineDialog() {
  const open = useAccountUi((s) => s.offline);
  const then = useAccountUi((s) => s.then);
  const addAccount = useSettings((s) => s.addAccount);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const invalid = showNameError(name, touched);
  const close = () => {
    useAccountUi.setState({ offline: false, then: null });
    setName("");
    setTouched(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPlayerName(name)) return;
    addAccount(name);
    // Startet danach das Spiel, zeigt der Spielen-Knopf den Fortschritt; eine Meldung wäre doppelt.
    if (!then) toast.success(`Spielername „${name}“ ist aktiv`);
    close();
    then?.run();
  }

  /** Beim Spielen: statt Namen mit Microsoft anmelden; `then` bleibt stehen und startet nach der Anmeldung. */
  function microsoft() {
    useAccountUi.setState({ offline: false });
    setName("");
    void startMsLogin(qc);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={then ? "Wie heißt du im Spiel?" : "Spielername hinzufügen"}
      sub={then ? <>Danach startet <b>{then.label}</b>.</> : undefined}
      width={480}
      height={then ? 402 : 278}
      footer={
        <DialogActions
          cancel="Abbrechen"
          confirm={{ label: then ? "Speichern und spielen" : "Hinzufügen", width: then ? 196 : 140, form: "off-form", icon: then ? "play" : undefined, disabled: !isValidPlayerName(name) }}
        />
      }
    >
      <form id="off-form" onSubmit={submit}>
        {/* Zwei Zeilen reserviert: der kürzere Fehler ersetzt den Hilfetext, ohne dass etwas nachrückt */}
        <Field
          label="Spielername"
          htmlFor="off-name"
          reserveLines={2}
          help="3 bis 16 Zeichen: Buchstaben, Ziffern und Unterstrich. Reicht für Einzelspieler, LAN und Server ohne Anmeldung."
          error={invalid && "Nur Buchstaben, Ziffern und Unterstrich, 3 bis 16 Zeichen."}
        >
          <TextField
            id="off-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={16}
            placeholder="z. B. Steve_42"
            autoFocus
          />
        </Field>
      </form>
      {then && (
        <>
          <div className="or">oder</div>
          <Button icon="user" width="full" onClick={microsoft}>Mit Microsoft anmelden</Button>
          <Hint className="mt-2">Nötig für die meisten Server und Realms.</Hint>
        </>
      )}
    </Dialog>
  );
}

/** Konten verwalten (Einstellungen). */
export function AccountsSection() {
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
        <List variant="accounts" aria-label="Konten">
          {accounts.map((a) => {
            const on = sameAccount(active, a);
            const name = accountName(a);
            return (
              <ListRow key={keyOf(a)} selected={on}>
                <Avatar name={name} />
                <RowTitle title={name} sub={`${kindLabel(a)}${on ? " · aktiv" : ""}`} />
                {!on && <Button size="s" onClick={() => select(a)}>Wechseln</Button>}
                <Button variant="ghost" size="s" disabled={a.kind === "microsoft" && pending} onClick={() => remove(a)}>
                  {a.kind === "microsoft" ? "Abmelden" : "Entfernen"}
                </Button>
              </ListRow>
            );
          })}
        </List>
      ) : (
        <Empty size="pane" ill="user" title="Noch kein Konto">{offlineAllowed ? "Melde dich an oder leg einen Spielernamen an." : "Melde dich mit deinem Microsoft-Konto an."}</Empty>
      )}
      {ms.error && <ErrorBox className="mt-3" title="Microsoft-Konten konnten nicht geladen werden" error={ms.error} onRetry={() => void ms.refetch()} />}
      <Actions wrap className="mt-3">
        <Button icon="user" onClick={() => void startMsLogin(qc)}>Mit Microsoft anmelden</Button>
        {offlineAllowed && <Button icon="plus" onClick={openAddOffline}>Spielername hinzufügen</Button>}
      </Actions>
      <Hint className="mt-2.5 max-w-[70ch]">
        {offlineAllowed
          ? "Mit einem Spielernamen spielst du allein, im LAN und auf Servern ohne Anmeldung. Für die meisten Server brauchst du ein Microsoft-Konto."
          : "Du brauchst ein Microsoft-Konto, das Minecraft: Java Edition besitzt."}
      </Hint>
    </>
  );
}
