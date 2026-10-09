import { useI18n } from "@/i18n";
import type { GalleryImage } from "@/lib/content-types";
import { isTrustedImageUrl } from "@/lib/image-hosts";
import { ImageGallery } from "@/ui";

/** Nur Bilder vertrauten Hosts, wie in Beschreibungen (Description): jeder andere Host sähe die IP-Adresse des Spielers. */
const isShowable = (image: GalleryImage) => isTrustedImageUrl(image.url);

/** Bilder der Projektseite: ein großes, darunter Vorschauen zum Wechseln. Ohne Bilder erscheint nichts. */
export function Gallery({ images, project }: { images: GalleryImage[]; project: string }) {
  const { t } = useI18n();
  const shown = images.filter(isShowable);
  return (
    <ImageGallery
      className="mt-[18px]"
      label={t("components.detail.gallery")}
      items={shown.map((image, i) => ({
        src: image.url,
        alt: image.title ?? t("components.detail.galleryImage", { n: i + 1, project }),
        caption: image.description ?? undefined,
        thumbLabel: t("components.detail.showImage", { n: i + 1, total: shown.length }),
      }))}
    />
  );
}
