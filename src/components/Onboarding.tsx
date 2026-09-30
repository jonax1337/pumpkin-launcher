import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn, TextField } from "@/components/px";
import { startMsLogin } from "@/components/PlayerNames";
import { useCreateInstance, usePlay, useVersions } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import type { ContentVersion } from "@/lib/modrinth";
import { cn } from "@/lib/utils";
import { Glyph, Icon, type GlyphName, type GlyphPalette } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { accountName, isValidPlayerName, useSettings } from "@/store/settings";

const SODIUM = "AANobbMI";

type Start = "vanilla" | "mods" | "modpack";

const STARTS: { id: Start; glyph: GlyphName; pal: GlyphPalette; title: string; text: string }[] = [
  { id: "vanilla", glyph: "cube", pal: "steel", title: "Minecraft pur", text: "Neueste Version, ohne Mods" },
  { id: "mods", glyph: "bolt", pal: "gold", title: "Mit Mods", text: "Fabric mit Sodium für mehr Bilder pro Sekunde" },
  { id: "modpack", glyph: "chest", pal: "violet", title: "Modpack aussuchen", text: "Fertige Sammlungen im Katalog ansehen" },
];

/** Erster Start ohne Instanz: zwei Schritte über der Szene. Name (oder Microsoft), dann womit es losgeht. */
export function Onboarding() {
  const active = useSettings((s) => s.active);
  const addAccount = useSettings((s) => s.addAccount);
  const [step, setStep] = useState<1 | 2>(active ? 2 : 1);
  const [name, setName] = useState(active?.kind === "offline" ? active.name : "");
  const [start, setStart] = useState<Start>("mods");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const versions = useVersions();
  const create = useCreateInstance();
  const play = usePlay();
  const navigate = useNavigate();
  const microsoft = active?.kind === "microsoft";
  const nameOk = isValidPlayerName(name);
  const invalid = name.length > 0 && !nameOk;
  const releases = versions.data?.filter((v) => v.type === "release").map((v) => v.id) ?? [];

  function next(e: FormEvent) {
    e.preventDefault();
    if (!microsoft) {
      if (!nameOk) return;
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
      <div className="onb-card plate" role="dialog" aria-modal="true" aria-labelledby="onb-t">
        {step === 1 ? (
          <form onSubmit={next} className="contents">
            {steps}
            <h1 id="onb-t">Willkommen bei Voxlet</h1>
            <p>Wie heißt du im Spiel?</p>
            <div className="ob">
              {microsoft ? (
                <p className="ok-msg">Angemeldet als {accountName(active)}</p>
              ) : (
                <div className="nf">
                  <label htmlFor="ob-name">Spielername</label>
                  <TextField id="ob-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="z. B. Steve_42" autoFocus aria-invalid={invalid} aria-describedby="ob-help" />
                  {/* Fehler ersetzt den Hilfetext an gleicher Stelle: keine leere Reservezeile, kein Springen */}
                  <span className={invalid ? "help text-bad" : "help"} id="ob-help" aria-live="polite">
                    {invalid ? "Nur Buchstaben, Ziffern und Unterstrich, 3 bis 16 Zeichen." : "Reicht für Einzelspieler, LAN und Server ohne Anmeldung."}
                  </span>
                </div>
              )}
              <div className="or">oder</div>
              <Btn icon="user" full style={{ width: "100%" }} onClick={() => void startMsLogin(qc)}>Mit Microsoft anmelden</Btn>
              <p className="help" style={{ marginTop: 8 }}>Nötig für die meisten Server und Realms. Du kannst es später nachholen.</p>
            </div>
            <div className="of">
              <span className="faint" style={{ fontSize: 12.5 }}>Schritt 1 von 2</span>
              <Btn type="submit" variant="p" full style={{ width: 140 }} disabled={!microsoft && !nameOk}>
                Weiter<Icon name="chev" />
              </Btn>
            </div>
          </form>
        ) : (
          <>
            {steps}
            <h1 id="onb-t">Womit willst du starten?</h1>
            <p>Du kannst jederzeit weitere Instanzen anlegen.</p>
            <div className="ob">
              <div className="starts" role="radiogroup" aria-label="Start">
                {STARTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="start fx"
                    role="radio"
                    aria-checked={start === s.id}
                    aria-pressed={start === s.id}
                    onClick={() => setStart(s.id)}
                  >
                    <Glyph name={s.glyph} pal={s.pal} />
                    <div>
                      <b>{s.title}</b>
                      <span>{s.text}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="of">
              {microsoft ? (
                <span className="faint" style={{ fontSize: 12.5 }}>Angemeldet als {accountName(active)}</span>
              ) : (
                <Btn variant="g" onClick={() => setStep(1)} disabled={busy}>Zurück</Btn>
              )}
              <Btn
                variant="p"
                size="l"
                full
                style={{ width: 200 }}
                disabled={busy || (start !== "modpack" && !releases.length)}
                onClick={() => void go()}
              >
                {busy ? "Wird eingerichtet" : <>Los geht's<Icon name="play" /></>}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
