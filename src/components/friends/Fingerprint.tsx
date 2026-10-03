import { useI18n } from "@/i18n";

const SIZE = { s: "text-[17px] tracking-[.04em]", l: "text-[30px] tracking-[.06em]" } as const;

/**
 * Fingerabdruck eines Freundes in Vierergruppen (Pixelschrift). Er hängt am Schlüssel, nicht am Namen: wer ihn vergleicht,
 * erkennt eine Verwechslung. Der Vorleser bekommt ihn als Text mit Beschriftung.
 */
export function Fingerprint({ value, size = "s" }: { value: string; size?: keyof typeof SIZE }) {
  const { t } = useI18n();
  return (
    <span className={`font-px leading-none whitespace-nowrap ${SIZE[size]}`}>
      <span className="sr">{t("friends.fingerprint.label")}</span>
      {value}
    </span>
  );
}
