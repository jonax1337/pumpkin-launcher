import type { CatalogType } from "./content-types";
import type { QuickPlay } from "./types";

/**
 * Ein Link von außen, vom Backend geprüft (`deep_link_take`, Vertrag in `src-tauri/src/deep_link.rs`).
 * Der Token einer Verknüpfung bleibt im Backend: `trusted` sagt nur, ob er zur Instanz passte.
 */
export type DeepLinkRequest =
  /** `trusted`: Der Link stammt aus einer Verknüpfung des Nutzers und startet ohne Rückfrage. */
  | { type: "launch"; instanceId: string; quickPlay: QuickPlay | null; trusted: boolean }
  | { type: "open"; instanceId: string }
  /** `contentType` ist nur ein Hinweis des Links; das Projekt kennt seine wirkliche Art. */
  | { type: "installModrinth"; contentType: CatalogType; project: string }
  /** CurseForge-Links nennen keine Art; ihre `fileId` ist für die Oberfläche ohne Belang, die Projektseite lässt die Version wählen. */
  | { type: "installCurseforge"; addonId: number };
