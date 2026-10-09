/**
 * Bildergalerie des Kits: ein großes Bild im eingelassenen Rahmen, darunter Vorschauen zum Wechseln; die gewählte trägt die Akzentkante.
 * Aussehen: look/gallery.css (Slot, Akzentkante), Maße als Tailwind-Utilities hier. Die Bilder laden verzögert und ohne Referrer.
 * Der Aufrufer prüft vorher, welchen Hosts er Bilder anvertraut; ohne Bilder erscheint nichts.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

export type GalleryItem = {
  src: string;
  /** Alternativtext des großen Bilds. */
  alt: string;
  /** Bildunterschrift unter dem großen Bild. */
  caption?: string;
  /** Zugänglicher Name der Vorschau (z. B. „Bild 2 von 5 zeigen“). */
  thumbLabel: string;
};

/** `label` benennt den Bereich für Vorleser. Die Vorschauleiste erscheint erst ab zwei Bildern. */
export function ImageGallery({ label, items, className }: { label: string; items: readonly GalleryItem[]; className?: string }) {
  const [current, setCurrent] = useState(0);
  if (items.length === 0) return null;
  const item = items[Math.min(current, items.length - 1)];
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)} aria-label={label}>
      <img className="lk-pit block max-h-[360px] w-full object-contain" src={item.src} alt={item.alt} loading="lazy" referrerPolicy="no-referrer" />
      {item.caption && <p className="lk-gallery-cap text-ctl-s">{item.caption}</p>}
      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-0.5 pt-0.5 pb-1.5">
          {items.map((thumb, i) => (
            <button
              key={thumb.src}
              type="button"
              className="lk-gallery-thumb lk-slot fx h-[54px] w-24 flex-none p-0"
              aria-pressed={i === current}
              aria-label={thumb.thumbLabel}
              onClick={() => setCurrent(i)}
            >
              <img className="block size-full object-cover" src={thumb.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
