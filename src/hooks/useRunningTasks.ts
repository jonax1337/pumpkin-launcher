import { useSyncExternalStore } from "react";
import { shallow } from "zustand/shallow";
import { useContentQueue } from "@/store/contentQueue";
import { useContentState } from "@/store/contentState";
import { useGame } from "@/store/game";

/**
 * Laufende Aufgaben aus ihren Stores (null = keine): Vorbereitungen der Instanzen, Inhalts- und Instanz-Vorgänge
 * (Installieren, Importieren, Duplizieren, Exportieren, Arbeit an Welten) und die vorgemerkten dahinter. Das
 * Aufgaben-Menü zeigt sie, der Neustart nach einem Update wartet auf sie; ein neuer Vorgang kommt nur hier dazu.
 */
function readRunningTasks() {
  const { installs } = useGame.getState();
  const content = useContentState.getState();
  const { jobs } = useContentQueue.getState();
  return {
    installs: Object.keys(installs).length > 0 ? installs : null,
    content: content.active != null ? content : null,
    queued: jobs.length > 0 ? jobs : null,
  };
}

let snapshot = readRunningTasks();

/** Derselbe Stand bleibt dasselbe Objekt, sonst rendert `useSyncExternalStore` endlos neu. */
function currentRunningTasks() {
  const next = readRunningTasks();
  if (!shallow(snapshot, next)) snapshot = next;
  return snapshot;
}

/** Ruft `onChange` bei jeder Änderung der Stores mit laufenden Aufgaben; liefert die Abmeldung. */
export function subscribeRunningTasks(onChange: () => void) {
  const offs = [useGame.subscribe(onChange), useContentState.subscribe(onChange), useContentQueue.subscribe(onChange)];
  return () => offs.forEach((off) => off());
}

export const useRunningTasks = () => useSyncExternalStore(subscribeRunningTasks, currentRunningTasks);

export const anyTaskRunning = () => Object.values(currentRunningTasks()).some((task) => task != null);
