/**
 * Bildkachel des Kits (Screenshots): Plattenrahmen mit dem Bild (16:9) im Slot und einer Beschriftung darunter, wie im Inventar.
 * Aussehen: look/photo.css (Rahmen auf ::before, damit die Kerbe den Fokusring nicht abschneidet), Maße als Tailwind-Utilities hier.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { flag } from "./util";

/**
 * `label` ist der zugängliche Name des Knopfs (das Bild ist Dekor, `caption` für Vorleser versteckt). Das Bild lädt erst im Sichtbereich
 * (viele Bilder in voller Auflösung). `selecting`: Auswahlmodus, die Kachel trägt `aria-pressed` und links oben eine Marke; mit `selected`
 * zeigt die Marke einen Haken (Kupfer) und die Platte ist getönt, mit Rahmen. Alle übrigen Knopf-Eigenschaften (`onClick`, `data-*`)
 * gehen an den Knopf. Kachelbreite und Raster bestimmt der Aufrufer (`CardGrid`).
 */
export function PhotoTile({ src, label, caption, selecting, selected, className, ...props }: {
  src: string; label: string; caption: ReactNode; selecting?: boolean; selected?: boolean;
} & Omit<ComponentProps<"button">, "children" | "aria-label" | "aria-pressed">) {
  return (
    <button
      type="button"
      className={cn("lk-photo fx flex flex-col px-u2 pt-u2 text-left", className)}
      aria-label={label}
      aria-pressed={selecting ? !!selected : undefined}
      data-selected={flag(selected)}
      {...props}
    >
      <span className="lk-slot block aspect-video">
        <img className="block size-full object-cover" src={src} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="lk-text block px-[9px] pt-1 pb-1.5 text-ctl-m font-bold" aria-hidden>{caption}</span>
      {selecting && (
        <span className="lk-photo-mark absolute top-[calc(var(--u2)+8px)] left-[calc(var(--u2)+8px)] z-2 grid size-6 place-items-center" aria-hidden>
          {selected && <Icon name="check" size="s" />}
        </span>
      )}
    </button>
  );
}
