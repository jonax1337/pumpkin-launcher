import type { ComponentProps, ElementType } from "react";
import { cn } from "@/lib/utils";

/** `slot` = eingelassen und bedienbar (Hover-/Fokuskante), `pit` = eingelassen ohne Bedienung, `stone` = erhaben (Steinplatte). */
export type SurfaceKind = "slot" | "pit" | "stone";
type SurfaceTag = "div" | "span" | "code" | "dl" | "section" | "header" | "aside" | "article" | "p" | "b" | "button" | "output";

const KIND: Record<SurfaceKind, string> = { slot: "lk-slot", pit: "lk-pit", stone: "lk-stone" };

type SurfaceProps<T extends SurfaceTag> = { kind: SurfaceKind; as?: T; text?: boolean; deep?: boolean } & ComponentProps<T>;

/**
 * Fläche des Inventar-Stils (surface.css) für Elemente, die die Seite selbst besitzt: Rahmen, Fase, Kerbe und Schatten kommen
 * vom Kit, Maße und Anordnung bleiben `className` (Tailwind). `kind` wählt `slot` (eingelassen, mit Hover-/Fokuskante),
 * `pit` (eingelassen ohne Bedienung: Körper, Pfade, Bahnen) oder `stone` (erhaben); `as` das Element (Standard `div`).
 * `text`: Beschriftung mit hartem Schatten. `deep`: Grund tiefer als beim normalen Slot (Protokollkonsole).
 * Alle übrigen Props gehen an das Element.
 */
export function Surface<T extends SurfaceTag = "div">({ kind, as, text, deep, className, ...props }: SurfaceProps<T>) {
  const Tag: ElementType = as ?? "div";
  return <Tag className={cn(KIND[kind], text && "lk-text", deep && "lk-deep", className)} {...(props as object)} />;
}
