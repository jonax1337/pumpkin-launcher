/* Gemeinsame Typen des Pixel-Kits (src/ui). */
export type { IconName } from "@/pixel/icon-data";

/** Komponentengröße: Höhe 32 / 40 / 56 px (fest, nie von --px abhängig). */
export type Size = "s" | "m" | "l";
/** Statusfarben; `acc` = Instanz-Akzent (--acc). */
export type Tone = "neutral" | "acc" | "warn" | "bad" | "run";
/** Icon-Slot: Box 20 / 24 / 28 / 56 px (Raster siehe ui/icon.css). */
export type IconSize = "s" | "m" | "l" | "xl";
/** Breakpoints, unter denen Knöpfe kompakt werden (nur Symbol + Zahl). */
export type Compact = 1180 | 1096 | 900;
