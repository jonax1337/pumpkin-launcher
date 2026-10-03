// Reine Logik der Kontenwahl (kein React), damit accountModel.check.mjs sie ohne Bundler prüft.
import type { ActiveAccount } from "../../store/settings.ts";

/** Eindeutiger Schlüssel eines Kontos (Art und Kennung): zwei Konten sind genau dann dasselbe, wenn ihre Schlüssel es sind. */
export const keyOf = (a: ActiveAccount) => (a.kind === "microsoft" ? `ms:${a.id}` : `off:${a.name}`);

/**
 * Das Konto, mit dem eine Instanz startet: ihr eigenes (`defaultAccount`), solange es unter `known` noch existiert und starten darf,
 * sonst das nutzbare aktive Konto (`null` = keins).
 */
export const pickLaunchAccount = (known: ActiveAccount[], defaultAccount: string | null, current: ActiveAccount | null): ActiveAccount | null =>
  known.find((account) => keyOf(account) === defaultAccount) ?? current;
