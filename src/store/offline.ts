import { create } from "zustand";
import { api } from "@/lib/api";
import { useSettings, type ActiveAccount } from "@/store/settings";

/**
 * Darf der Launcher Spielernamen ohne Konto anbieten? Das Backend entscheidet (`auth::offline_allowed`):
 * in Dev-Builds immer, sonst nur mit angemeldetem Microsoft-Konto. Vor der ersten Antwort gilt „nein“.
 */
export const useOfflineAllowed = create<{ allowed: boolean }>(() => ({ allowed: false }));

/** Fragt das Backend neu ab, z. B. nachdem sich die Microsoft-Konten geändert haben. */
export function refreshOfflineAllowed() {
  return api.offlineAllowed().then(
    (allowed) => useOfflineAllowed.setState({ allowed }),
    (err: unknown) => {
      console.warn("Abfrage „Offline erlaubt“ fehlgeschlagen", err);
      useOfflineAllowed.setState({ allowed: false });
    },
  );
}

/** Aktives Konto, sofern es der Launcher gerade starten darf (ein Spielername nur, wenn Offline erlaubt ist). */
export function usableAccount(active: ActiveAccount | null, offlineAllowed: boolean): ActiveAccount | null {
  return active && (active.kind === "microsoft" || offlineAllowed) ? active : null;
}

export function useUsableAccount(): ActiveAccount | null {
  const active = useSettings((s) => s.active);
  const allowed = useOfflineAllowed((s) => s.allowed);
  return usableAccount(active, allowed);
}

/** Wie `useUsableAccount`, aber außerhalb von React gelesen (Mutationen, Ereignisse). */
export const currentUsableAccount = (): ActiveAccount | null =>
  usableAccount(useSettings.getState().active, useOfflineAllowed.getState().allowed);
