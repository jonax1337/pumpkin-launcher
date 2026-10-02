import { Chip, type IconName } from "@/ui";
import { SOURCES, type Source } from "@/lib/content-types";

/** Logo der Anbieter; sie bleiben am Logo und Namen erkennbar, nicht an einer Markenfarbe (das Design kennt kein Grün). */
const LOGOS: Record<Source, IconName> = {
  modrinth: "modrinth",
  curseforge: "curseforge",
  ftb: "ftb",
  technic: "technic",
};

/** Kleines Etikett mit dem Anbieter eines Projekts. */
export function SourceTag({ source }: { source: Source }) {
  return <Chip size="s" icon={LOGOS[source]}>{SOURCES[source].label}</Chip>;
}
