import { create } from "zustand";
import type { Instance } from "@/lib/types";

/** Offene Rückfrage „Minecraft beenden?“ (StopDialog in game.tsx, einmal global eingehängt). */
export const useStopAsk = create<{ instance: Instance | null }>(() => ({ instance: null }));

/**
 * Beenden mit Rückfrage: öffnet „Minecraft beenden?“; erst „Beenden“ dort beendet hart (useKill).
 * Für alle Auslöser (Spielen-Knopf, Instanz-Menü, Protokoll), damit nie ohne Rückfrage gestoppt wird.
 */
export const askStop = (instance: Instance) => useStopAsk.setState({ instance });

// Vom Nutzer gestoppte Instanzen: deren Exit-Code (unter Windows 1) ist kein Fehler.
const stoppedByUser = new Set<string>();

export const markStoppedByUser = (instanceId: string) => void stoppedByUser.add(instanceId);

/** Das Beenden ist doch gescheitert: die Instanz zählt nicht als vom Nutzer gestoppt. */
export const unmarkStoppedByUser = (instanceId: string) => void stoppedByUser.delete(instanceId);

/** Hat der Nutzer diese Instanz beendet? Die Markierung gilt nur für ein Ende und verfällt hier. */
export const consumeStoppedByUser = (instanceId: string): boolean => stoppedByUser.delete(instanceId);
