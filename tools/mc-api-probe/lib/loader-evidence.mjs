// Belege fuer die Loader-Haken aus den Maven-Repositories von Fabric, NeoForge und Forge (Quellen- und Userdev-Jars).
import { join } from "node:path";
import { ensureDownloaded } from "./download.mjs";
import { openZip } from "./zip.mjs";

const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases";
const FORGE_MAVEN = "https://maven.minecraftforge.net";
const FABRIC_MAVEN = "https://maven.fabricmc.net";
const SCREEN_PATCH = "patches/net/minecraft/client/gui/screens/Screen.java.patch";

async function readEntry(url, cachePath, entryName) {
  const zip = openZip(await ensureDownloaded(url, cachePath));
  try {
    return zip.names.includes(entryName) ? zip.read(entryName).toString("utf8") : null;
  } finally {
    zip.close();
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}

async function fmlVersionOf(neoForgeVersion) {
  const pom = await fetchText(`${NEOFORGE_MAVEN}/net/neoforged/neoforge/${neoForgeVersion}/neoforge-${neoForgeVersion}.pom`);
  return /<artifactId>loader<\/artifactId>\s*<version>([^<]+)</.exec(pom ?? "")?.[1] ?? null;
}

/** Was ein NeoForge-Build fuer den Pausemenue-Haken und die Client-only-Deklaration bietet. */
export async function neoForgeEvidence(version, cacheDir) {
  const base = `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${version}/neoforge-${version}`;
  const dir = join(cacheDir, "loaders");
  const eventSource = await readEntry(`${base}-sources.jar`, join(dir, `neoforge-${version}-sources.jar`), "net/neoforged/neoforge/client/event/ScreenEvent.java");
  const screenPatch = await readEntry(`${base}-userdev.jar`, join(dir, `neoforge-${version}-userdev.jar`), SCREEN_PATCH);
  const fml = await fmlVersionOf(version);
  const modSource = fml && await readEntry(
    `${NEOFORGE_MAVEN}/net/neoforged/fancymodloader/loader/${fml}/loader-${fml}-sources.jar`,
    join(dir, `fml-loader-${fml}-sources.jar`),
    "net/neoforged/fml/common/Mod.java",
  );
  return {
    version,
    fml,
    initPostEvent: eventSource?.includes("class Post extends Init") ?? false,
    postedOnGameBus: /NeoForge\.EVENT_BUS\.post\(new net\.neoforged\.neoforge\.client\.event\.ScreenEvent\.Init\.Post/.test(screenPatch ?? ""),
    modAnnotationHasDist: modSource?.includes("Dist[] dist()") ?? false,
  };
}

/** Wie neoForgeEvidence, fuer Forge 1.20.1 (Userdev-Patch, DisplayTest und clientSideOnly in FML). */
export async function forgeEvidence(version, cacheDir) {
  const base = `${FORGE_MAVEN}/net/minecraftforge/forge/${version}/forge-${version}`;
  const dir = join(cacheDir, "loaders");
  const eventSource = await readEntry(`${base}-sources.jar`, join(dir, `forge-${version}-sources.jar`), "net/minecraftforge/client/event/ScreenEvent.java");
  const screenPatch = await readEntry(`${base}-userdev.jar`, join(dir, `forge-${version}-userdev.jar`), SCREEN_PATCH);
  const fmlBase = (module) => `${FORGE_MAVEN}/net/minecraftforge/${module}/${version}/${module}-${version}-sources.jar`;
  const container = await readEntry(fmlBase("fmlcore"), join(dir, `fmlcore-${version}-sources.jar`), "net/minecraftforge/fml/ModContainer.java");
  const fileInfo = await readEntry(fmlBase("fmlloader"), join(dir, `fmlloader-${version}-sources.jar`), "net/minecraftforge/fml/loading/moddiscovery/ModFileInfo.java");
  return {
    version,
    initPostEvent: eventSource?.includes("public static class Post extends Init") ?? false,
    postedOnGameBus: /MinecraftForge\.EVENT_BUS\.post\(new net\.minecraftforge\.client\.event\.ScreenEvent\.Init\.Post/.test(screenPatch ?? ""),
    displayTestKey: container?.includes('getConfigElement("displayTest")') ?? false,
    clientSideOnlyImpliesIgnoreAllVersion: /CLIENT_SIDE_ONLY_PROP[^;]*\? "IGNORE_ALL_VERSION"/.test(container ?? ""),
    clientSideOnlyKey: fileInfo?.includes('getConfigElement("clientSideOnly")') ?? false,
  };
}

/** Der erste und der letzte Fabric-API-Build zu einer Minecraft-Version nennen die Loader-Untergrenze der Version. */
export async function fabricApiFloors(minecraftId, cacheDir) {
  const metadata = await fetchText(`${FABRIC_MAVEN}/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml`);
  const builds = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => v.endsWith(`+${minecraftId}`));
  if (builds.length === 0) return { minecraftId, builds: [] };
  const describe = async (build) => {
    const text = await readEntry(
      `${FABRIC_MAVEN}/net/fabricmc/fabric-api/fabric-api/${build}/fabric-api-${build}.jar`,
      join(cacheDir, "loaders", `fabric-api-${build}.jar`),
      "fabric.mod.json",
    );
    return { build, loader: JSON.parse(text).depends.fabricloader };
  };
  return { minecraftId, builds: [await describe(builds[0]), await describe(builds.at(-1))] };
}
