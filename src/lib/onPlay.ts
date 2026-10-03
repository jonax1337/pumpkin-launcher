import type { LauncherOnPlay } from "@/store/settings";

/**
 * Was das Fenster beim Spielstart wirklich tut: Mit Freunden läuft der Tunnel im Launcher-Prozess, darum wird „Schließen“
 * zu „Minimieren“. Nur ein `false` aus dem Backend hebt das auf; `null` (unbekannt) gilt als eingeschaltet.
 */
export function effectiveOnPlay(mode: LauncherOnPlay, friendsEnabled: boolean | null): LauncherOnPlay {
  return mode === "close" && friendsEnabled !== false ? "minimize" : mode;
}

/**
 * Ob Freunde eingeschaltet sind: der gespiegelte Wert, sonst die Antwort des Backends. `null` nur, wenn die Abfrage
 * scheitert oder länger als `timeoutMs` braucht; dann gilt die vorsichtige Annahme „eingeschaltet“ (`effectiveOnPlay`).
 */
export async function resolveFriendsEnabled(
  cached: boolean | null,
  fetchEnabled: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean | null> {
  if (cached !== null) return cached;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const fetched = Promise.resolve().then(fetchEnabled).catch(() => null);
  try {
    return await Promise.race([fetched, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
