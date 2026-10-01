import type { CatalogType } from "./content-types";
import type { TKey } from "../i18n/core.ts";
import type { ModKind } from "./types";

// Beschriftungen als Wörterbuchschlüssel: Der Text entsteht erst bei der Ausgabe, damit ein Sprachwechsel sofort greift.

/** Art eines Inhalts im Plural („Mods“) für Filter und Listen. */
export const KIND_LABEL_KEYS: Record<ModKind, TKey> = {
  mod: "components.catalog.kind.mod",
  shader: "components.catalog.kind.shader",
  resourcepack: "components.catalog.kind.resourcepack",
};

/** Katalogart im Plural; Modpacks und Datenpakete kommen zu den Arten eines Inhalts hinzu. */
export const TYPE_LABEL_KEYS: Record<CatalogType, TKey> = {
  modpack: "components.catalog.kind.modpack",
  ...KIND_LABEL_KEYS,
  datapack: "components.catalog.kind.datapack",
};

/** Katalogart im Singular („Mod“), auch für die Art eines einzelnen Inhalts. */
export const TYPE_ONE_KEYS: Record<CatalogType, TKey> = {
  modpack: "components.catalog.one.modpack",
  mod: "components.catalog.one.mod",
  shader: "components.catalog.one.shader",
  resourcepack: "components.catalog.one.resourcepack",
  datapack: "components.catalog.one.datapack",
};
