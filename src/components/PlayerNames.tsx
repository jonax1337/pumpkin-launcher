import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { Check, ChevronsUpDown, Copy, ExternalLink, Loader2, LogIn, Plus, Settings2, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorNote, Tip } from "@/components/common";
import { api } from "@/lib/api";
import type { MsLoginStart } from "@/lib/types";
import { cn } from "@/lib/utils";
import { accountName, isValidPlayerName, useSettings, type ActiveAccount } from "@/store/settings";

// ---------- Microsoft-Anmeldung (ein Dialog für Seitenleiste und Einstellungen) ----------

type LoginState = { step: "idle" } | { step: "starting" } | { step: "code"; info: MsLoginStart } | { step: "error"; message: string };
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
    useMsLogin.setState({ step: "idle" }, true);
    toast.success(`Angemeldet als ${account.username}`);
  } catch (err) {
    if (mine === attempt) useMsLogin.setState({ step: "error", message: err instanceof Error ? err.message : String(err) }, true);
  }
}

function cancelMsLogin() {
  const running = useMsLogin.getState().step !== "idle" && useMsLogin.getState().step !== "error";
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
    <Dialog open={state.step !== "idle"} onOpenChange={(o) => !o && cancelMsLogin()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mit Microsoft anmelden</DialogTitle>
          <DialogDescription>
            Mit deinem Microsoft-Konto spielst du mit deinem gekauften Minecraft, auch auf Online-Servern.
          </DialogDescription>
        </DialogHeader>
        {state.step === "starting" && (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {state.step === "code" && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Im Browser öffnet sich die Microsoft-Seite.</li>
              <li>Gib dort diesen Code ein und bestätige die Anmeldung.</li>
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
              <p className="font-mono text-3xl font-semibold tracking-[0.18em] tabular-nums select-all" aria-label={`Code ${state.info.userCode.split("").join(" ")}`}>
                {state.info.userCode}
              </p>
              <Button variant="secondary" onClick={() => copy(state.info.userCode)}>
                <Copy aria-hidden /> Kopieren
              </Button>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Warte auf deine Bestätigung im Browser …
            </p>
            <p className="text-xs text-muted-foreground">Der Code gilt {Math.max(1, Math.round(state.info.expiresIn / 60))} Minuten.</p>
          </div>
        )}
        {state.step === "error" && <ErrorNote error={new Error(state.message)} onRetry={() => void startMsLogin(qc)} />}
        <DialogFooter>
          <Button variant="ghost" onClick={cancelMsLogin}>
            {state.step === "error" ? "Schließen" : "Abbrechen"}
          </Button>
          {state.step === "code" && (
            <Button variant="outline" onClick={() => void api.openExternal(state.info.verificationUri)}>
              <ExternalLink aria-hidden /> Seite erneut öffnen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Konten ----------

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

const kindLabel = (a: ActiveAccount) => (a.kind === "microsoft" ? "Microsoft-Konto" : "Offline-Spielername");
const keyOf = (a: ActiveAccount) => (a.kind === "microsoft" ? `ms:${a.id}` : `off:${a.name}`);

function Avatar({ name, active, className }: { name: string; active?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-xs font-semibold",
        active ? "bg-gold/15 text-gold" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {name.slice(0, 2).toUpperCase() || <UserRound className="size-4" />}
    </div>
  );
}

/** Kontowechsler unten in der Seitenleiste; enthält den einen Microsoft-Anmeldedialog. */
export function AccountSwitcher({ collapsed }: { collapsed: boolean }) {
  const active = useSettings((s) => s.active);
  const select = useSettings((s) => s.selectAccount);
  const accounts = useAllAccounts();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const name = accountName(active);
  const label = name ? `Konto: ${name}` : "Kein Konto festgelegt";

  return (
    <>
      <DropdownMenu>
        <Tip show={collapsed} label={label}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label}. Konto wechseln`}
              className={cn(
                "flex h-12 min-w-0 items-center gap-3 rounded-lg text-left outline-none transition-colors duration-150 hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-sidebar-accent",
                collapsed ? "justify-center" : "px-2",
              )}
            >
              <Avatar name={name} active={!!active} />
              <span className={cn("min-w-0 flex-1 leading-tight", collapsed && "sr-only")}>
                <span className="block truncate text-sm font-medium" title={name || undefined}>
                  {name || "Kein Konto"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {active ? (active.kind === "microsoft" ? "Microsoft" : "Offline") : "Jetzt festlegen"}
                </span>
              </span>
              {!collapsed && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            </button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="w-64">
          {accounts.length > 0 && <DropdownMenuLabel>Konto wechseln</DropdownMenuLabel>}
          {accounts.map((a) => {
            const on = sameAccount(active, a);
            return (
              <DropdownMenuItem key={keyOf(a)} onSelect={() => select(a)} aria-checked={on} role="menuitemradio">
                <Avatar name={accountName(a)} active={on} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{accountName(a)}</span>
                  <span className="block text-xs text-muted-foreground">{kindLabel(a)}</span>
                </span>
                {on && <Check className="text-gold" aria-hidden />}
              </DropdownMenuItem>
            );
          })}
          {accounts.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => void startMsLogin(qc)}>
            <LogIn aria-hidden /> Mit Microsoft anmelden …
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/settings#konten")}>
            <Settings2 aria-hidden /> Konten verwalten
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MsLoginDialog />
    </>
  );
}

function AddOfflineForm() {
  const addAccount = useSettings((s) => s.addAccount);
  const [name, setName] = useState("");
  const invalid = name.length > 0 && !isValidPlayerName(name);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPlayerName(name)) return;
    addAccount(name);
    setName("");
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor="offline-name">Spielername ohne Anmeldung</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="offline-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Steve_42"
          aria-invalid={invalid}
          aria-describedby="offline-name-hint"
          className="min-w-40 flex-1"
          maxLength={16}
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" disabled={!isValidPlayerName(name)}>
          <Plus aria-hidden /> Hinzufügen
        </Button>
      </div>
      <p id="offline-name-hint" className={invalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        3–16 Zeichen: Buchstaben, Ziffern und Unterstrich. Reicht für Einzelspieler und Server ohne Anmeldung.
      </p>
    </form>
  );
}

/** Konten verwalten (Einstellungen; der Kontowechsler in der Seitenleiste führt hierher). */
export function AccountsSection() {
  const { active, selectAccount, removeAccount, forgetMicrosoft } = useSettings();
  const accounts = useAllAccounts();
  const ms = useMsAccounts();
  const qc = useQueryClient();
  const removeMs = useMutation({
    mutationFn: (id: string) => api.msAccountRemove(id),
    onSuccess: (_, id) => {
      forgetMicrosoft(id);
      return qc.invalidateQueries({ queryKey: ["ms-accounts"] });
    },
  });

  function remove(a: ActiveAccount) {
    if (a.kind === "offline") removeAccount(a.name);
    else removeMs.mutate(a.id);
  }

  return (
    <section id="konten" aria-labelledby="konten-title" className="scroll-mt-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="konten-title" className="text-base font-semibold">
            Konten
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Mit dem aktiven Konto startet Minecraft.</p>
        </div>
        <Button onClick={() => void startMsLogin(qc)}>
          <LogIn aria-hidden /> Mit Microsoft anmelden
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        {ms.isPending && accounts.length === 0 ? (
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : accounts.length > 0 ? (
          <ul className="divide-y" aria-label="Konten">
            {accounts.map((a) => {
              const on = sameAccount(active, a);
              const name = accountName(a);
              return (
                <li key={keyOf(a)} className="flex min-w-0 items-center gap-3 px-4 py-3">
                  <Avatar name={name} active={on} className="size-9" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate font-medium" title={name}>
                      {name}
                    </p>
                    <p className="text-xs text-muted-foreground">{kindLabel(a)}</p>
                  </div>
                  {on ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gold">
                      <Check className="size-3.5" aria-hidden /> Aktiv
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => selectAccount(a)}>
                      Verwenden
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${name} entfernen`}
                    title="Entfernen"
                    disabled={a.kind === "microsoft" && removeMs.isPending}
                    onClick={() => remove(a)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Noch kein Konto. Melde dich an oder leg einen Spielernamen an.</p>
        )}
        {ms.error && <ErrorNote className="m-4" title="Microsoft-Konten konnten nicht geladen werden" error={ms.error} onRetry={() => void ms.refetch()} />}
        <div className="border-t p-4">
          <AddOfflineForm />
        </div>
      </div>
    </section>
  );
}
