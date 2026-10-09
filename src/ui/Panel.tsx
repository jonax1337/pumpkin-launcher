import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Trunc } from "./Tooltip";
import { flag } from "./util";

/** Überschriftenstufen (Display, Versalien): Szene (hero) 52, xl 72 · Seite 40 · Dialog 26 · Abschnitt 22 · Unterabschnitt 20 · Karte 18. */
export type HeadingLevel = "hero" | "page" | "dialog" | "section" | "sub" | "card";
type HTag = "h1" | "h2" | "h3" | "h4";

const TAG: Record<HeadingLevel, HTag> = { hero: "h1", page: "h1", dialog: "h2", section: "h2", sub: "h3", card: "h3" };
const SIZE: Record<HeadingLevel, string> = {
  hero: "text-hd-hero", page: "text-hd-page", dialog: "text-hd-dialog", section: "text-hd-section", sub: "text-hd-sub", card: "text-hd-card",
};
/** Dieselben Stufen, mit der Textgröße-Einstellung (`--tz`) mitwachsend. */
const SIZE_ZOOM: Record<HeadingLevel, string> = {
  hero: "text-hd-hero-z", page: "text-hd-page-z", dialog: "text-hd-dialog-z", section: "text-hd-section-z", sub: "text-hd-sub-z", card: "text-hd-card-z",
};
/** Eigene Größen statt der Stufe: `xl` (nur `hero`) 72 · `bar` 24 (Titel in einer schmalen Leiste) · `title` 44 (Projekttitel). */
type HeadingSize = "xl" | "bar" | "title";
const SIZE_OWN: Record<HeadingSize, string> = { xl: "text-hd-hero-xl", bar: "text-hd-bar", title: "text-hd-title" };

/**
 * Überschrift einer Stufe; das Element (`as`) folgt der Dokumentstruktur, die Größe der Stufe oder `size` (siehe `HeadingSize`).
 * `plain`: wie laufender Text, ohne Schatten, Buchstabenabstand und eigene Ziffernbreite (Titel auf Leisten und Flächen).
 * `zoom`: die Größe der Stufe wächst mit der Textgröße-Einstellung. `trunc`: eine Zeile mit Auslassung; ist `children` ein Text,
 * zeigt ein Tooltip bei Überlauf den ganzen Titel. Weitere Größen, Zeilenhöhen und Abstände kommen als Tailwind in `className`.
 */
export function Heading({ level, as, size, plain, zoom, trunc, className, children, ...props }: {
  level: HeadingLevel; as?: HTag; size?: HeadingSize; plain?: boolean; zoom?: boolean; trunc?: boolean;
} & ComponentProps<"h2">) {
  const Tag = as ?? TAG[level];
  const own = size === "xl" && level !== "hero" ? undefined : size;
  const sized = cn("lk-h min-w-0", own ? SIZE_OWN[own] : zoom ? SIZE_ZOOM[level] : SIZE[level], className);
  const attrs = { "data-level": level, "data-size": size, "data-plain": flag(plain) };
  if (trunc && typeof children === "string") return <Trunc as={Tag} text={children} className={sized} {...attrs} {...props} />;
  return <Tag className={cn(sized, trunc && "truncate")} {...attrs} {...props}>{children}</Tag>;
}

type PanelTag = "div" | "section" | "aside" | "article";

/**
 * Platte mit Fase (Aussehen: `lk-panel`). `level`: flach (Standard), `raised` = erhaben, `sunk` = eingelassen; `notch` 2 = größere Kerbe.
 * `bare`: nur der Rahmen für das Layout, ohne Fläche (z. B. Navigation direkt auf dem Grund).
 * `active`: Rahmen und Fase in der Auswahlfarbe (die Platte, die gerade gilt, z. B. der getragene Skin).
 * Innenabstand `--pg-pad` per Tailwind (`p-(--pg-pad)`); ein eigenes `p-*` im `className` ersetzt ihn.
 * Als Überlagerungs-Kontext (`data-ctx`) hellen Hover und Auswahl der Kinder um eine Stufe auf.
 */
export function Panel({ as: Tag = "div", level, notch, bare, active, className, ...props }: {
  as?: PanelTag; level?: "raised" | "sunk"; notch?: 2; bare?: boolean; active?: boolean;
} & ComponentProps<"div">) {
  return (
    <Tag
      className={cn("lk-panel min-w-0 p-(--pg-pad)", className)}
      data-level={level}
      data-notch={notch}
      data-bare={flag(bare)}
      data-active={flag(active)}
      data-ctx={bare ? undefined : "overlay"}
      {...props}
    />
  );
}
