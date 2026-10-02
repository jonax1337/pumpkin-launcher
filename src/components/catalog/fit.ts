import { loaderLine } from "@/components/common";
import type { VersionFilter } from "@/lib/backend";
import type { CatalogType, ContentVersion } from "@/lib/content-types";
import { modLoadersFor } from "@/lib/mods";
import type { Instance, ModKind } from "@/lib/types";

/** Was in eine Instanz passt: Mods und Shader nur mit Mod-Loader, Ressourcenpakete immer. */
export const kindsFor = (instance: Instance): ModKind[] =>
  instance.loader !== "vanilla" ? ["mod", "shader", "resourcepack"] : ["resourcepack"];

/** „Fabric 1.21.4“ für Mods, sonst nur die Minecraft-Version. */
export const fitsLabel = (instance: Instance, type: CatalogType) =>
  type === "mod" ? loaderLine(instance) : `Minecraft ${instance.minecraftVersion}`;

// Für Quilt fragt das Backend Quilt- und Fabric-Mods an; Datenpakete führt Modrinth unter dem Loader „datapack“.
export const loaderFor = (instance: Instance, type: CatalogType) => (type === "mod" ? instance.loader : type === "datapack" ? "datapack" : null);

/** Version und Loader, auf die ein Katalog-Aufruf für diese Instanz einschränkt. */
export const fitFilter = (instance: Instance, type: CatalogType): VersionFilter => ({
  mc: instance.minecraftVersion,
  loader: loaderFor(instance, type),
});

/** Passt die Version zur Instanz: Minecraft-Version, bei Mods und Datenpaketen auch der Loader. */
export const versionFits = (version: ContentVersion, instance: Instance, type: CatalogType) => {
  const loader = loaderFor(instance, type);
  return version.game_versions.includes(instance.minecraftVersion) && (loader == null || version.loaders.some((l) => modLoadersFor(loader).includes(l)));
};
