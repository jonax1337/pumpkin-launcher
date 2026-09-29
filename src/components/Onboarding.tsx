import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Check, Compass, Loader2, Sparkles, TreePine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateInstance, usePlay, useVersions } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import type { ContentVersion } from "@/lib/modrinth";
import { cn } from "@/lib/utils";
import { isValidPlayerName, useSettings } from "@/store/settings";

const SODIUM = "AANobbMI";

type Start = "vanilla" | "mods" | "modpack";

const STARTS: { id: Start; title: string; text: string; icon: typeof TreePine }[] = [
  { id: "vanilla", title: "Minecraft pur", text: "Neueste Version, ohne Mods", icon: TreePine },
  { id: "mods", title: "Mit Mods", text: "Fabric mit Sodium: läuft flüssiger, Mods jederzeit dazu", icon: Sparkles },
  { id: "modpack", title: "Modpack", text: "Ein fertiges Paket aussuchen", icon: Compass },
];

/** Erster Start: Spielername und, solange es keine Instanz gibt, womit es losgeht. */
export function Onboarding({ needsInstance }: { needsInstance: boolean }) {
  const { offlineName, addAccount } = useSettings();
  const [name, setName] = useState(offlineName);
  const [start, setStart] = useState<Start>("vanilla");
  const [busy, setBusy] = useState(false);
  const versions = useVersions();
  const create = useCreateInstance();
  const play = usePlay();
  const navigate = useNavigate();
  const nameOk = isValidPlayerName(name);
  const releases = versions.data?.filter((v) => v.type === "release").map((v) => v.id) ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!nameOk) return;
    if (name !== offlineName) addAccount(name);
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

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card/60 p-8">
      <h1 className="text-3xl font-semibold">{needsInstance ? "Willkommen bei Voxlet" : "Wie heißt du im Spiel?"}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {needsInstance ? "Zwei kurze Fragen, dann geht's los." : "Ohne Spielernamen kann Minecraft nicht starten."}
      </p>

      <div className="mt-8 max-w-sm space-y-2">
        <Label htmlFor="onboarding-name">{needsInstance ? "① Wie heißt du im Spiel?" : "Spielername"}</Label>
        <div className="relative">
          <Input
            id="onboarding-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spielername"
            maxLength={16}
            autoFocus
            aria-invalid={name.length > 0 && !nameOk}
            aria-describedby="onboarding-name-hint"
          />
          {nameOk && <Check className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-primary" aria-hidden />}
        </div>
        <p id="onboarding-name-hint" className={cn("text-xs", name.length > 0 && !nameOk ? "text-destructive" : "text-muted-foreground")}>
          3–16 Zeichen: Buchstaben, Ziffern und Unterstrich.
        </p>
      </div>

      {needsInstance && (
        <fieldset className="mt-8">
          <legend className="text-sm font-medium">② Womit willst du starten?</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {STARTS.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  start === s.id ? "border-primary/50 bg-primary/5" : "hover:border-primary/30",
                )}
              >
                <input type="radio" name="start" value={s.id} checked={start === s.id} onChange={() => setStart(s.id)} className="sr-only" />
                <s.icon className={cn("size-5", start === s.id ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.text}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-8 flex justify-end">
        <Button type="submit" size="lg" disabled={!nameOk || busy || (needsInstance && start !== "modpack" && !releases.length)}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? "Wird eingerichtet…" : needsInstance ? (start === "modpack" ? "Modpack aussuchen" : "Los geht's") : "Speichern"}
        </Button>
      </div>
    </form>
  );
}
