export type Biome = "forest" | "nether" | "end" | "snow" | "cave" | "sea" | "plains";
export type SceneMode = "flat" | "live" | "hero";
/**
 * Lage der Lichtquelle (Sonne, Mond, Fackel, Insel): `left` links der Mitte (35–55 %, Instanzkopf: rechts steht der Spielen-Knopf),
 * `std` wie im Mockup (Start), `seed` Seite und Lage je Seed (Poster, Miniaturen).
 * Standard folgt dem Modus: live → left, hero → std, flat → seed.
 */
export type SunAnchor = "left" | "std" | "seed";

const SUN_BY_MODE: Record<SceneMode, SunAnchor> = { live: "left", hero: "std", flat: "seed" };
export const sunFor = (mode: SceneMode, sun?: SunAnchor): SunAnchor => sun ?? SUN_BY_MODE[mode];

/** Biome: Akzent (Spielen-Knopf, Poster-Ring, Kopf) und Grundfarbe für Ränder; Namen liegen in `ui.biome.*`. */
export const BIOMES: Record<Biome, { acc: string; bg: string }> = {
  forest: { acc: "#EB85D6", bg: "#1B2140" },
  nether: { acc: "#FF7447", bg: "#1A0708" },
  end: { acc: "#DCD394", bg: "#07060D" },
  snow: { acc: "#F4B4A8", bg: "#2A3764" },
  cave: { acc: "#C8ABEE", bg: "#0A0E16" },
  sea: { acc: "#4FD8E6", bg: "#13284A" },
  plains: { acc: "#98B0FF", bg: "#3C6FB4" },
};
export const BIOME_KEYS = Object.keys(BIOMES) as Biome[];

/** Ob `name` ein bekanntes Biom ist; ein Modpack bringt beliebige Namen mit (`pumpkin.json`). */
export const isBiome = (name: string): name is Biome => Object.hasOwn(BIOMES, name);
