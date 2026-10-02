import { useState } from "react";
import { Buddy, type BuddyMood } from "@/branding/Brand";
import { InstanceMenuButton } from "@/components/instance";
import { PlayButton } from "@/components/play/PlayButton";
import { usePhase, type Phase } from "@/components/play/phase";
import type { Instance } from "@/lib/types";

/**
 * Stimmung des Maskottchens: erschrocken nach einem Absturz, wach beim Spielen, am Laden bei Vorgängen,
 * sonst winkend (`awake`) oder schlafend.
 */
function buddyMood(phase: Phase, awake: boolean): BuddyMood {
  switch (phase) {
    case "crashed":
      return "oops";
    case "running":
      return "idle";
    case "loading":
    case "preparing":
    case "starting":
      return "loading";
    default:
      return awake ? "hello" : "sleep";
  }
}

/**
 * Buddy schläft neben dem Spielen-Knopf (rechts hinter dem Menü, gleiche Zeile) und hängt an ihm: Läuft die Instanz nicht, schläft er;
 * Überfahren oder Fokus auf „Spielen“ weckt ihn (winkt); Laden/Installieren/Starten zeigt die Lade-Animation,
 * beim Spielen ist er wach (Standbild, die App pausiert Animationen, solange ein Spiel läuft), nach einem Absturz schaut er erschrocken.
 */
function HomeBuddy({ instanceId, awake }: { instanceId: string; awake: boolean }) {
  const phase = usePhase(instanceId);
  return <Buddy mood={buddyMood(phase, awake)} size={120} className="buddy-rest" />;
}

/** Spielen, Menü und Buddy der gewählten Instanz; der Zustand „Spielen überfahren“ bleibt hier, damit nur diese Zeile neu rendert. */
export function HeroActions({ instance }: { instance: Instance }) {
  const [awake, setAwake] = useState(false);
  const wakeIfPlay = (target: EventTarget) => setAwake(!!(target as Element).closest(".play"));
  return (
    <div
      className="acts"
      onPointerOver={(e) => wakeIfPlay(e.target)}
      onPointerLeave={() => setAwake(false)}
      onFocus={(e) => wakeIfPlay(e.target)}
      onBlur={() => setAwake(false)}
    >
      <PlayButton key={instance.id} instance={instance} main />
      <InstanceMenuButton instance={instance} onScene size="l" />
      <HomeBuddy key={`buddy-${instance.id}`} instanceId={instance.id} awake={awake} />
    </div>
  );
}
