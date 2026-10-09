/* Gemeinsame Typen des Kits (src/ui). */
import type { WIDTH } from "@/lib/breakpoints";

export type { IconName } from "@/pixel/icon-data";

/** Komponentengröße: Höhe 32 / 40 / 56 px (fest, nie von --px abhängig). */
export type Size = "s" | "m" | "l";
/** Statusfarben; `acc` = Instanz-Akzent (--acc). */
export type Tone = "neutral" | "acc" | "warn" | "bad" | "run";
/** Icon-Slot: Box 16 / 24 / 32 / 48 px, 8×8-Raster mit Zellen 2 / 3 / 4 / 6 px (siehe ui/icon.css). */
export type IconSize = "s" | "m" | "l" | "xl";
/** Fensterbreiten (px), an denen die Stylesheets umschalten (lib/breakpoints). */
export type Breakpoint = (typeof WIDTH)[keyof typeof WIDTH];
/** Breakpoints, unter denen Knöpfe kompakt werden (nur Symbol + Zahl). */
export type Compact = Extract<Breakpoint, 900 | 1096 | 1180>;
