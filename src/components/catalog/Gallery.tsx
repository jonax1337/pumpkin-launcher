import { useState } from "react";
import { useI18n } from "@/i18n";
import type { GalleryImage } from "@/lib/content-types";
import { isTrustedImageUrl } from "@/lib/image-hosts";

/** Nur Bilder vertrauten Hosts, wie in Beschreibungen (Description): jeder andere Host sähe die IP-Adresse des Spielers. */
const isShowable = (image: GalleryImage) => isTrustedImageUrl(image.url);

/** Bilder der Projektseite: ein großes, darunter Vorschauen zum Wechseln. Ohne Bilder erscheint nichts. */
export function Gallery({ images, project }: { images: GalleryImage[]; project: string }) {
  const { t } = useI18n();
  const shown = images.filter(isShowable);
  const [current, setCurrent] = useState(0);
  if (shown.length === 0) return null;
  const image = shown[Math.min(current, shown.length - 1)];
  const alt = (img: GalleryImage, n: number) => img.title ?? t("components.detail.galleryImage", { n, project });
  return (
    <section className="gal" aria-label={t("components.detail.gallery")}>
      <img className="gal-main vx-pit" src={image.url} alt={alt(image, current + 1)} loading="lazy" referrerPolicy="no-referrer" />
      {image.description && <p className="gal-cap">{image.description}</p>}
      {shown.length > 1 && (
        <div className="gal-thumbs">
          {shown.map((img, i) => (
            <button
              key={img.url}
              type="button"
              className="gal-thumb vx-slot fx"
              aria-pressed={i === current}
              aria-label={t("components.detail.showImage", { n: i + 1, total: shown.length })}
              onClick={() => setCurrent(i)}
            >
              <img src={img.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
