import { useState } from "react";

/** Gespeicherter Wert, sofern er einer der erlaubten ist; ohne Speicher oder bei Fremdem der Vorgabewert. */
function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return allowed.find((value) => value === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Wie `useState` für eine Auswahl, die den Neustart überlebt (localStorage). Das erste Element von `allowed` ist die Vorgabe. */
export function usePersistedState<T extends string>(key: string, allowed: readonly [T, ...T[]]): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readStored(key, allowed, allowed[0]));
  function change(next: T) {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Ohne Speicher bleibt die Wahl nur bis zum Neustart.
    }
  }
  return [value, change];
}
