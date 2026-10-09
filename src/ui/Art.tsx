/**
 * Bildfläche des Kits für Szenen und Pixelbilder: füllt ihren Rahmen, geschnitten wie die Karten (Kerbe), Leinwände darin
 * liegen absolut (scene.ts platziert sie). Aussehen: `lk-art` in look/card.css.
 * Der Rahmen (Aufrufer) braucht `relative` und eine Größe; `ArtFrame` bringt beides mit samt Slot-Rand.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { cssVars, flag } from "./util";

/** Klassen der Bildfläche; für Bausteine, die selbst ein Element liefern (`PixelScene className={ART}`). */
export const ART = "lk-art absolute inset-0 overflow-hidden [&_canvas]:absolute";

/** Bildfläche (`ART`) als Element; `className` ergänzt oder ersetzt Utilities. */
export function Art({ className, children }: { className?: string; children?: ReactNode }) {
  return <span className={cn(ART, className)}>{children}</span>;
}

/**
 * Bild im Slot-Rand (Instanzbild, Vorschau): der Rand liegt über dem Bild, das Bild behält sein volles Maß. Die Größe setzt der
 * Aufrufer (`className="size-[72px]"`). Ein Standardicon darin (`IconView`) wächst mit `[--icon-k:2]` (ganze Zellen je Glyphenpixel).
 * Dekor: für Vorleser versteckt.
 */
export function ArtFrame({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span className={cn("lk-sthumb block flex-none", className)} aria-hidden>
      <Art>{children}</Art>
    </span>
  );
}

/**
 * Bild, das die Fläche seines Rahmens füllt (in `ArtFrame`/`Art`, Rahmen mit `relative`); `crisp`: harte Pixel statt Glättung (kleine Pixel-Art).
 */
export function ArtImage({ crisp, className, alt = "", ...props }: { crisp?: boolean } & ComponentProps<"img">) {
  return <img className={cn("lk-icon", className)} data-crisp={flag(crisp)} alt={alt} {...props} />;
}

/**
 * Pixel-Glyphe (`children`, ein SVG) mittig auf einem Verlauf von `tileHi` (oben, 40 %) zu `tile` (unten), füllt die Fläche seines Rahmens.
 * Der Maßstab der Glyphe (ganze Zellen je Glyphenpixel) kommt vom Rahmen: `[--icon-k:2]`.
 */
export function ArtGlyph({ tile, tileHi, className, children }: { tile: string; tileHi: string; className?: string; children?: ReactNode }) {
  return <span className={cn("lk-icon", className)} data-default="" style={cssVars({ "--tile": tile, "--tile-hi": tileHi })}>{children}</span>;
}
