import { useState, type FormEvent } from "react";
import { Check, LogIn, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/common";
import { cn } from "@/lib/utils";
import { isValidPlayerName, useSettings } from "@/store/settings";

function Avatar({ name, active }: { name: string; active?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md font-mono text-xs font-semibold",
        active ? "bg-gold/15 text-gold" : "bg-white/5 text-muted-foreground",
      )}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function AddAccountForm() {
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
      <Label htmlFor="offline-name">Neuer Offline-Account</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="offline-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spielername"
            aria-invalid={invalid}
            aria-describedby="offline-name-hint"
            className="pl-9"
            maxLength={16}
          />
        </div>
        <Button type="submit" disabled={!isValidPlayerName(name)}>
          <Plus aria-hidden /> Anlegen
        </Button>
      </div>
      <p id="offline-name-hint" className={invalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        3–16 Zeichen, nur Buchstaben, Ziffern und Unterstrich. Nur für Einzelspieler und Offline-Server.
      </p>
    </form>
  );
}

export function AccountPage() {
  const { offlineName, offlineAccounts, selectAccount, removeAccount } = useSettings();

  return (
    <>
      <PageHeader title="Konto" description="Mit welchem Namen du spielst." />
      <div className="grid max-w-3xl gap-6">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Offline-Accounts</CardTitle>
            <CardDescription>Der aktive Account wird beim Spielstart verwendet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {offlineAccounts.length > 0 ? (
              <ul className="grid gap-2" aria-label="Offline-Accounts">
                {offlineAccounts.map((name) => {
                  const active = name === offlineName;
                  return (
                    <li key={name} className="group relative">
                      <button
                        type="button"
                        onClick={() => selectAccount(name)}
                        aria-pressed={active}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border p-2.5 pr-14 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "border-gold/40 bg-gold/5" : "hover:border-primary/30 hover:bg-accent",
                        )}
                      >
                        <Avatar name={name} active={active} />
                        <div className="min-w-0 flex-1 leading-tight">
                          <p className="truncate font-medium">{name}</p>
                          <p className="text-xs text-muted-foreground">Offline</p>
                        </div>
                        {active && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-gold">
                            <Check className="size-3.5" aria-hidden /> Aktiv
                          </span>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${name} entfernen`}
                        onClick={() => removeAccount(name)}
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Noch kein Account. Lege einen an, um spielen zu können.
              </p>
            )}
            <AddAccountForm />
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>Microsoft-Konto</CardTitle>
            <CardDescription>
              Für Online-Server und Skins. Die Anmeldung über Microsoft folgt in einer späteren Version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled variant="outline" className="w-full">
              <LogIn aria-hidden /> Mit Microsoft anmelden (folgt)
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
