import { mock as deMock } from "../de/mock.ts";

// Gleiche Schlüssel wie Deutsch (erzwingt der Typ), natürliches Launcher-Englisch.
export const mock: typeof deMock = {
  "mock.mods.missingEntry": "Mock mod {slug} is missing",
  "mock.instance.stillRunning": "Instance is still running",
  "mock.modrinth.unreachable": "Modrinth is not responding ({status})",
  "mock.content.requiredModMissing": "A required mod is not available for this Minecraft version.",
  "mock.pack.loaderUnsupported": "This modpack needs a mod loader that Pumpkin Launcher does not support yet.",
  "mock.world.notFound": "World “{id}” not found",
  "mock.backup.notFound": "Backup “{id}” not found",
  "mock.datapack.notFound": "Datapack “{id}” not found",
  "mock.screenshot.notFound": "Screenshot “{datei}” not found",
  "mock.skin.notFound": "Skin “{id}” not found",
  "mock.skin.noneOnAccount": "Minecraft reports no skin for this account right now.",
  "mock.skin.alreadyInLibrary": "This skin is already in the library: “{name}”.",
};
