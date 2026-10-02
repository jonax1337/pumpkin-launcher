import { useEffect } from "react";
import { useLatest } from "./useLatest";

/**
 * Ruft `commit` beim Verlassen der Komponente auf. Felder, die erst beim Verlassen des Felds speichern, brauchen das:
 * React meldet onBlur nicht für ein Element, das mit der Seite entfernt wird. `commit` muss unveränderte Eingaben ignorieren.
 */
export function useCommitOnUnmount(commit: () => void) {
  const latest = useLatest(commit);
  useEffect(() => () => latest.current(), [latest]);
}
