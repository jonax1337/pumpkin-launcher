import { t, type TKey } from "@/i18n";
import { TYPE_LABEL_KEYS } from "@/lib/catalog";
import { ALL_SOURCES, SOURCES, type CatalogType, type ContentProject, type ContentVersion, type SearchIndex, type SourceChoice } from "@/lib/content-types";
import type { IconName } from "@/ui";
import { LOADER_LABELS, type ModLoader } from "@/lib/types";

// Reine Funktionen auf Modul-`t`: Der Text entsteht bei jedem Aufruf neu, die aufrufende Komponente rendert bei
// Sprachwechsel über `useI18n()` ohnehin neu.

const SEARCH_PLACEHOLDER_KEYS: Record<CatalogType, TKey> = {
  mod: "components.search.placeholder.mod",
  shader: "components.search.placeholder.shader",
  resourcepack: "components.search.placeholder.resourcepack",
  modpack: "components.search.placeholder.modpack",
  datapack: "components.search.placeholder.datapack",
};

/** Überschrift ohne Suchbegriff je Sortierung. */
const SORT_HEADING_KEYS: Record<SearchIndex, TKey> = {
  relevance: "components.sort.relevance",
  downloads: "components.sort.downloads",
  follows: "components.sort.follows",
  newest: "common.new",
  updated: "components.sort.updated",
};

/** Was eine Sortierung über die Zahlen aussagt, soweit sie Beliebtheit meint. */
const SORT_HINT_KEYS: Partial<Record<SearchIndex, TKey>> = {
  downloads: "components.sort.downloadsHint",
  follows: "components.sort.followsHint",
};

/** Die Art einer Version für die Tabelle; Vorabversionen heißen dort wie beim Anbieter. */
const VERSION_TYPE_NAME_KEYS: Record<ContentVersion["version_type"], TKey> = {
  release: "components.version.type.release",
  beta: "components.version.type.beta",
  alpha: "components.version.type.alpha",
};

/** Ein Begriff für alles Unfertige, wie im Dialog „Neue Instanz“. */
const VERSION_TYPE_KEYS: Record<ContentVersion["version_type"], TKey | null> = {
  release: null,
  beta: "components.version.prerelease",
  alpha: "components.version.prerelease",
};

/** Modrinth-Kategorien in Alltagssprache. */
const CATEGORY_KEYS: Record<string, TKey> = {
  adventure: "detail.worlds.gameMode.adventure", optimization: "components.category.optimization", technology: "components.category.technology",
  magic: "components.category.magic", decoration: "components.category.decoration", utility: "components.category.utility",
  "game-mechanics": "components.category.gameMechanics", library: "components.category.library", worldgen: "components.category.worldgen",
  mobs: "components.category.mobs", storage: "components.category.storage", equipment: "components.category.equipment",
  food: "components.category.food", transportation: "components.category.transportation", social: "components.category.social",
  economy: "components.category.economy", management: "components.category.management", minigame: "components.category.minigame",
  "kitchen-sink": "components.category.kitchenSink", lightweight: "components.category.lightweight", multiplayer: "components.category.multiplayer",
  quests: "components.category.quests", challenging: "components.category.challenging", combat: "components.category.combat",
  realistic: "components.category.realistic", "semi-realistic": "components.category.semiRealistic", cartoon: "components.category.cartoon",
  fantasy: "components.category.fantasy", "vanilla-like": "components.category.vanillaLike", simplistic: "components.category.simplistic",
  themed: "components.category.themed", tweaks: "components.category.tweaks", audio: "components.category.audio",
  blocks: "components.category.blocks", entities: "components.category.entities", gui: "components.category.gui",
  items: "components.category.items", models: "components.category.models", fonts: "components.category.fonts",
  atmosphere: "components.category.atmosphere", bloom: "components.category.bloom", shadows: "components.category.shadows",
  reflections: "components.category.reflections", foliage: "components.category.foliage", "colored-lighting": "components.category.coloredLighting",
  "path-tracing": "components.category.pathTracing", pbr: "components.category.pbr", "high-performance": "components.category.highPerformance",
  "low-performance": "components.category.lowPerformance", potato: "components.category.potato", screenshot: "components.category.screenshot",
  cursed: "components.category.cursed",
};

// Loader-Namen sind für die Anzeige keine Kategorie.
const LOADER_CATEGORIES = new Set([
  "fabric", "forge", "quilt", "neoforge", "iris", "optifine", "canvas", "vanilla", "minecraft", "datapack", "liteloader", "modloader", "rift",
  "bukkit", "paper", "spigot", "purpur", "folia", "velocity", "waterfall", "bungeecord", "sponge",
]);

export const typeLabel = (type: CatalogType) => t(TYPE_LABEL_KEYS[type]);

/** Pixel-Symbol je Katalogart (Reiter, Anbieterlisten). */
export const TYPE_ICONS: Record<CatalogType, IconName> = {
  modpack: "modpack", mod: "mod", shader: "shader", resourcepack: "resourcepack", datapack: "datapack",
};

export const searchPlaceholder = (type: CatalogType) => t(SEARCH_PLACEHOLDER_KEYS[type]);

export const sortHeading = (index: SearchIndex) => t(SORT_HEADING_KEYS[index]);

/** Erklärung zur Sortierung als Tooltip; `undefined`, wo die Überschrift schon alles sagt. */
export const sortHint = (index: SearchIndex) => {
  const key = SORT_HINT_KEYS[index];
  return key && t(key);
};

export const versionTypeName = ({ version_type: type }: ContentVersion) => t(VERSION_TYPE_NAME_KEYS[type]);

export const sourceChoiceLabel = (choice: SourceChoice) => (choice === ALL_SOURCES ? t("pages.discover.allSources") : SOURCES[choice].label);

/** „ · Vorabversion“ für Beta und Alpha, sonst nichts; hängt an der Zeile einer Version. */
export const versionTypeSuffix = (version: ContentVersion) => {
  const key = VERSION_TYPE_KEYS[version.version_type];
  return key ? ` · ${t(key)}` : "";
};

/** Eine Kategorie des Anbieters: `slug` filtert dort, `name` steht in der Oberfläche. */
export interface Category {
  slug: string;
  name: string;
}

export const categoryName = (category: string) =>
  CATEGORY_KEYS[category] ? t(CATEGORY_KEYS[category]) : category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, " ");

/** Die ersten `max` Kategorien eines Treffers ohne Loader-Namen und Auflösungen („16x“). */
export const categoryList = (categories: string[], max: number): Category[] =>
  categories.filter((c) => !LOADER_CATEGORIES.has(c) && !/^\d+x/.test(c)).slice(0, max).map((slug) => ({ slug, name: categoryName(slug) }));

export const categoryNames = (categories: string[], max: number) => categoryList(categories, max).map((c) => c.name);

/** Loader-Namen; „minecraft“ ist Modrinths Marke für Ressourcen ohne Loader, „datapack“ der von Datenpaketen. */
export const loaderText = (loaders: string[]) =>
  loaders.map((l) => (l === "datapack" ? t("components.catalog.kind.datapack") : (LOADER_LABELS[l as ModLoader] ?? l))).join(", ");

/** Die Loader einer Version; leer, wenn sie für Ressourcen ohne Loader gilt. */
export const versionLoaders = (version: ContentVersion) => loaderText(version.loaders.filter((l) => l !== "minecraft"));

export const versionLoadersOrVanilla = (version: ContentVersion) => versionLoaders(version) || LOADER_LABELS.vanilla;

/** Wo das Projekt installiert sein muss: Client = dein Spiel, Server = der Server, auf dem du spielst. */
export const sideText = ({ client_side: client, server_side: server }: ContentProject) => {
  if (client === "unsupported") return t("components.side.serverOnly");
  if (server === "unsupported") return t("components.side.clientOnly");
  if (client === "required" && server === "required") return t("components.side.both");
  if (client === "required") return t("components.side.clientServerOptional");
  if (server === "required") return t("components.side.serverClientOptional");
  return t("components.side.either");
};
