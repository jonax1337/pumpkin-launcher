import { useI18n } from "@/i18n";

/**
 * Fingerabdruck eines Freundes in Vierergruppen (Pixelschrift). Er hängt am Schlüssel, nicht am Namen: wer ihn vergleicht,
 * erkennt eine Verwechslung. Der Vorleser bekommt ihn als Text mit Beschriftung.
 */
export function Fingerprint({ value, size = "s" }: { value: string; size?: "s" | "l" }) {
  const { t } = useI18n();
  return (
    <span className="fr-fingerprint" data-size={size}>
      <span className="sr">{t("friends.fingerprint.label")}</span>
      {value}
    </span>
  );
}
