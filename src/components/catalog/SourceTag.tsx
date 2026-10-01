import { Chip, type IconName } from "@/ui";
import { SOURCES, type Source } from "@/lib/content-types";

/** Logo und Hauptfarbe der Anbieter; der Chip hellt die Farbe für den Text auf. */
const BRANDS: Record<Source, { icon: IconName; color: string }> = {
  modrinth: { icon: "modrinth", color: "#1bd96a" },
  curseforge: { icon: "curseforge", color: "#f16436" },
  ftb: { icon: "ftb", color: "#ffa21f" },
  technic: { icon: "technic", color: "#2f8fe0" },
};

/** Kleines Etikett mit dem Anbieter eines Projekts in dessen Farbe. */
export function SourceTag({ source }: { source: Source }) {
  const { icon, color } = BRANDS[source];
  return <Chip size="s" icon={icon} color={color}>{SOURCES[source].label}</Chip>;
}
