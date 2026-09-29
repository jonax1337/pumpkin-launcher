import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Compass, Loader2, LogIn, Sparkles, TreePine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startMsLogin } from "@/components/PlayerNames";
import { useCreateInstance, usePlay, useVersions } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import type { ContentVersion } from "@/lib/modrinth";
import { cn } from "@/lib/utils";
import { accountName, isValidPlayerName, useSettings } from "@/store/settings";

const SODIUM = "AANobbMI";

type Start = "vanilla" | "mods" | "modpack";

const STARTS: { id: Start; title: string; text: string; icon: typeof TreePine }[] = [
  { id: "vanilla", title: "Minecraft pur", text: "Neueste Version, ohne Mods.", icon: TreePine },
  { id: "mods", title: "Mit Mods", text: "Fabric mit Sodium: läuft flüssiger, weitere Mods jederzeit.", icon: Sparkles },
  { id: "modpack", title: "Modpack", text: "Ein fertiges Paket aus Entdecken aussuchen.", icon: Compass },
];

function NameField({ name, setName, autoFocus }: { name: string; setName: (n: string) => void; autoFocus?: boolean }) {
  const nameOk = isValidPlayerName(name);
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor="onboarding-name">Spielername</Label>
      <div className="relative">
        <Input
          id="onboarding-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Steve_42"
          maxLength={16}
          autoFocus={autoFocus}
          autoComplete="off"
          aria-invalid={name.length > 0 && !nameOk}
          aria-describedby="onboarding-name-hint"
          className="pr-9"
        />
        {nameOk && <Check className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-primary" aria-hidden />}
      </div>
      <p id="onboarding-name-hint" className={cn("text-xs", name.length > 0 && !nameOk ? "text-destructive" : "text-muted-foreground")}>
        3–16 Zeichen: Buchstaben, Ziffern und Unterstrich.
      </p>
    </div>
  );
}

/** Erster Start: Konto (Spielername oder Microsoft) und, solange es keine Instanz gibt, womit es losgeht. */
export function Onboarding({ needsInstance }: { needsInstance: boolean }) {
  const active = useSettings((s) => s.active);
  const addAccount = useSettings((s) => s.addAccount);
  const [name, setName] = useState(active?.kind === "offline" ? active.name : "");
  const [start, setStart] = useState<Start>("vanilla");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const versions = useVersions();
  const create = useCreateInstance();
  const play = usePlay();
  const navigate = useNavigate();
  const nameOk = isValidPlayerName(name);
  const microsoft = active?.kind === "microsoft";
  const accountOk = nameOk || microsoft;
  const releases = versions.data?.filter((v) => v.type === "release").map((v) => v.id) ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountOk) return;
    if (!microsoft && name !== accountName(active)) addAccount(name);
    if (!needsInstance) return;
    if (start === "modpack") return navigate("/discover");
    setBusy(true);
    try {
      if (start === "vanilla") {
        const inst = await create.mutateAsync({ name: `Minecraft ${releases[0]}`, minecraftVersion: releases[0], loader: "vanilla", loaderVersion: null, memoryMb: null });
        void play(inst);
        return;
      }
      // Neueste Minecraft-Version, für die es Sodium schon gibt; Release-Versionen von Sodium bevorzugt.
      const sodium = (await api.modrinthVersions(SODIUM, null, "fabric")) as (ContentVersion & { version_type?: string })[];
      const ranked = [...sodium.filter((v) => (v.version_type ?? "release") === "release"), ...sodium];
      const mc = releases.find((r) => ranked.some((v) => v.game_versions.includes(r)));
      const version = ranked.find((v) => mc && v.game_versions.includes(mc));
      if (!mc || !version) throw new Error("Keine passende Sodium-Version gefunden");
      const inst = await create.mutateAsync({ name: `Fabric ${mc}`, minecraftVersion: mc, loader: "fabric", loaderVersion: null, memoryMb: null });
      const withMods = await api.modrinthInstallMod(inst.id, version.id, crypto.randomUUID());
      void play(withMods);
    } catch (err) {
      toast.error("Das hat nicht geklappt", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const msButton = (
    <Button type="button" variant="outline" onClick={() => void startMsLogin(qc)}>
      <LogIn aria-hidden /> Mit Microsoft anmelden
    </Button>
  );

  // Kompakt über dem Hero, wenn nur das Konto fehlt.
  if (!needsInstance)
    return (
      <form onSubmit={submit} aria-labelledby="account-needed" className="rounded-xl border bg-card p-5">
        <h2 id="account-needed" className="text-base font-semibold">
          Mit welchem Namen spielst du?
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Ohne Konto kann Minecraft nicht starten.</p>
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <div className="w-full max-w-xs min-w-48 flex-1">
            <NameField name={name} setName={setName} />
          </div>
          <div className="flex flex-wrap gap-2 sm:mt-[1.375rem]">
            <Button type="submit" variant="secondary" disabled={!nameOk}>
              Speichern
            </Button>
            {msButton}
          </div>
        </div>
      </form>
    );

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-10 py-2 xl:py-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight xl:text-4xl">Willkommen bei Voxlet</h1>
        <p className="mt-2 text-sm text-muted-foreground">Zwei kurze Fragen, dann geht es los.</p>
      </header>

      <section aria-labelledby="step-account" className="space-y-4">
        <h2 id="step-account" className="text-base font-semibold">
          1. Mit welchem Namen spielst du?
        </h2>
        {microsoft ? (
          <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
            <Check className="size-4 text-gold" aria-hidden /> Angemeldet als <span className="font-medium">{accountName(active)}</span>
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="w-full max-w-xs min-w-48 flex-1">
              <NameField name={name} setName={setName} autoFocus />
            </div>
            <div className="flex items-center gap-3 sm:mt-[1.375rem]">
              <span className="text-sm text-muted-foreground">oder</span>
              {msButton}
            </div>
          </div>
        )}
      </section>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">2. Womit willst du starten?</legend>
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {STARTS.map((s) => (
            <label
              key={s.id}
              className={cn(
                "flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset",
                start === s.id ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <input type="radio" name="start" value={s.id} checked={start === s.id} onChange={() => setStart(s.id)} className="sr-only" />
              <s.icon className={cn("size-5 shrink-0", start === s.id ? "text-primary" : "text-muted-foreground")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.title}</span>
                <span className="block text-sm text-muted-foreground">{s.text}</span>
              </span>
              <span
                aria-hidden
                className={cn("grid size-4 shrink-0 place-items-center rounded-full border", start === s.id ? "border-primary" : "border-muted-foreground/60")}
              >
                {start === s.id && <span className="size-2 rounded-full bg-primary" />}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" className="h-12 px-8 text-base font-semibold" disabled={!accountOk || busy || (start !== "modpack" && !releases.length)}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {busy ? "Wird eingerichtet …" : start === "modpack" ? "Modpack aussuchen" : "Los geht's"}
      </Button>
    </form>
  );
}
