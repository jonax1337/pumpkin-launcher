import type { Dict } from "../types.ts";

// Fehlermeldungen der Browser-Mocks (Instanz/Welt/Sicherung/Datenpaket/Screenshot/Skin). Deutsch ist Quelle der Wahrheit.
export const mock = {
  "mock.mods.missingEntry": "Mock-Mod {slug} fehlt",
  "mock.instance.stillRunning": "Instanz läuft noch",
  "mock.modrinth.unreachable": "Modrinth antwortet nicht ({status})",
  "mock.content.requiredModMissing": "Eine benötigte Mod gibt es nicht für diese Minecraft-Version.",
  "mock.pack.loaderUnsupported": "Dieses Modpack braucht einen Mod-Loader, den Pumpkin Launcher noch nicht kann.",
  "mock.world.notFound": "Welt „{id}“ wurde nicht gefunden",
  "mock.backup.notFound": "Sicherung „{id}“ wurde nicht gefunden",
  "mock.datapack.notFound": "Datenpaket „{id}“ wurde nicht gefunden",
  "mock.screenshot.notFound": "Screenshot „{datei}“ wurde nicht gefunden",
  "mock.skin.notFound": "Skin „{id}“ wurde nicht gefunden",
  "mock.skin.noneOnAccount": "Minecraft meldet für dieses Konto gerade keinen Skin.",
  "mock.skin.alreadyInLibrary": "Dieser Skin ist schon in der Bibliothek: „{name}“.",
} satisfies Dict;
