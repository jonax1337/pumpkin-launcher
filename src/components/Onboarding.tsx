import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { showNameError, startMsLogin } from "@/components/PlayerNames";
import { useCreateInstance, usePlay, useVersions } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import type { ContentVersion } from "@/lib/modrinth";
import { cn } from "@/lib/utils";
import { Button, Choice, Field, Glyph, Hint, TextField, useRoving } from "@/ui";
import type { GlyphName, GlyphPalette } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { Buddy } from "@/branding/Brand";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, isValidPlayerName, useSettings } from "@/store/settings";

const SODIUM = "AANobbMI";

type Start = "vanilla" | "mods" | "modpack";

const STARTS: { id: Start; glyph: GlyphName; pal: GlyphPalette; title: string; text: string; cta: string; next: string }[] = [
  { id: "vanilla", glyph: "cube", pal: "steel", title: "Minecraft pur", text: "Neueste Version, ohne Mods", cta: "Anlegen und spielen", next: "Legt die Instanz an, installiert Minecraft und startet das Spiel." },
  { id: "mods", glyph: "bolt", pal: "gold", title: "Mit Mods", text: "Fabric mit Sodium für mehr Bilder pro Sekunde", cta: "Anlegen und spielen", next: "Legt die Instanz an, installiert Fabric mit Sodium und startet das Spiel." },
  { id: "modpack", glyph: "chest", pal: "violet", title: "Modpack aussuchen", text: "Fertige Sammlungen im Katalog ansehen", cta: "Modpacks ansehen", next: "Öffnet den Katalog: Dort wählst du ein Modpack und legst es an." },
];

/** Erster Start ohne Instanz: zwei Schritte über der Szene. Name (oder Microsoft), dann womit es losgeht. */
export function Onboarding() {
  const active = useUsableAccount();
  // Offizieller Build ohne Microsoft-Konto: nur die Anmeldung, kein Spielername (Backend: `offline_allowed`).
  const offlineOk = useOfflineAllowed((s) => s.allowed);
  const addAccount = useSettings((s) => s.addAccount);
  const [step, setStep] = useState<1 | 2>(active ? 2 : 1);
  const [name, setName] = useState(active?.kind === "offline" ? active.name : "");
  const [start, setStart] = useState<Start>("mods");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const qc = useQueryClient();
  const versions = useVersions();
  const create = useCreateInstance();
  const play = usePlay();
  const navigate = useNavigate();
  const microsoft = active?.kind === "microsoft";
  const nameOk = isValidPlayerName(name);
  const invalid = showNameError(name, touched);
  const releases = versions.data?.filter((v) => v.type === "release").map((v) => v.id) ?? [];
  const choice = STARTS.find((s) => s.id === start)!;
  // Pfeiltasten in der Startwahl: Auswahl folgt dem Fokus, ein Tab-Stopp.
  const roveStarts = useRoving<HTMLDivElement>("xy");

  function next(e: FormEvent) {
    e.preventDefault();
    if (!microsoft) {
      if (!offlineOk || !nameOk) return;
      if (name !== accountName(active)) addAccount(name);
    }
    setStep(2);
  }

  async function go() {
    if (start === "modpack") return navigate("/discover");
    setBusy(true);
    try {
      if (start === "vanilla") {
        const inst = await create.mutateAsync({ name: `Minecraft ${releases[0]}`, minecraftVersion: releases[0], loader: "vanilla", loaderVersion: null, memoryMb: null });
        void play(inst);
        return;
      }
      // Neueste Minecraft-Version, für die es Sodium schon gibt; Release-Versionen von Sodium bevorzugt.
      const sodium = (await api.modrinthVersions(SODIUM, null, "fabric")) as ContentVersion[];
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

  const steps = (
    <div className="steps" aria-label={`Schritt ${step} von 2`}>
      <i className="on" />
      <i className={cn(step > 1 && "on")} />
    </div>
  );

  return (
    <div className="onb">
      <PixelScene bio="forest" seed={12} mode="hero" className="scene" />
      <div className="shade-onb" />
      {/* Kein Modal: die Fensterleiste bleibt bedienbar, deshalb eine benannte Region */}
      <section className="onb-card plate" aria-labelledby="onb-t">
        {step === 1 ? (
          <form onSubmit={next} className="contents">
            {steps}
            <div className="onb-heading">
              <Buddy mood="hello" size={72} />
              <h1 id="onb-t">Willkommen bei Pumpkin Launcher</h1>
            </div>
            <p>{offlineOk || microsoft ? "Wie heißt du im Spiel?" : "Melde dich mit deinem Microsoft-Konto an."}</p>
            <div className="ob">
              {microsoft ? (
                <p className="ok-msg">Angemeldet als {accountName(active)}</p>
              ) : !offlineOk ? null : (
                // Fehler ersetzt den Hilfetext an derselben Stelle: keine leere Reservezeile, kein Springen
                <Field
                  label="Spielername"
                  htmlFor="ob-name"
                  help="Reicht für Einzelspieler, LAN und Server ohne Anmeldung."
                  error={invalid ? <>Nur Buchstaben, Ziffern und Unterstrich, 3 bis 16 Zeichen.</> : undefined}
                >
                  <TextField id="ob-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} maxLength={16} placeholder="z. B. Steve_42" autoFocus aria-invalid={invalid} width="full" />
                </Field>
              )}
              {offlineOk && <div className="or">oder</div>}
              <Button icon="user" variant={offlineOk ? undefined : "primary"} width="full" onClick={() => void startMsLogin(qc)}>Mit Microsoft anmelden</Button>
              <Hint className="ob-ms">
                {offlineOk ? "Nötig für die meisten Server und Realms. Du kannst es später nachholen." : "Dafür brauchst du ein Konto, das Minecraft: Java Edition besitzt."}
              </Hint>
            </div>
            <div className="of">
              <span className="faint" style={{ fontSize: 12.5 }}>Schritt 1 von 2</span>
              <Button type="submit" variant="primary" width={140} iconEnd="chev" disabled={!microsoft && (!offlineOk || !nameOk)}>
                Weiter
              </Button>
            </div>
          </form>
        ) : (
          <>
            {steps}
            <div className="onb-heading">
              <Buddy mood={busy ? 'loading' : 'hello'} size={72} />
              <h1 id="onb-t">Womit willst du starten?</h1>
            </div>
            <p>Du kannst jederzeit weitere Instanzen anlegen.</p>
            <div className="ob">
              <div className="starts" role="radiogroup" aria-label="Start" onKeyDown={roveStarts}>
                {STARTS.map((s) => (
                  <Choice
                    key={s.id}
                    size="l"
                    role="radio"
                    media={<Glyph name={s.glyph} pal={s.pal} box={40} />}
                    title={s.title}
                    sub={s.text}
                    selected={start === s.id}
                    tabIndex={start === s.id ? 0 : -1}
                    onClick={() => setStart(s.id)}
                  />
                ))}
              </div>
              <p className="help onb-next" aria-live="polite">{choice.next}</p>
            </div>
            <div className="of">
              {microsoft ? (
                <span className="faint" style={{ fontSize: 12.5 }}>Angemeldet als {accountName(active)}</span>
              ) : (
                <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>Zurück</Button>
              )}
              {/* Symbol links wie bei allen Knöpfen; beim Anlegen die Sanduhr */}
              <Button
                variant="primary"
                size="l"
                icon={busy ? "hour" : start === "modpack" ? "grid" : "play"}
                width={232}
                disabled={busy || (start !== "modpack" && !releases.length)}
                onClick={() => void go()}
              >
                {busy ? "Wird angelegt" : choice.cta}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
