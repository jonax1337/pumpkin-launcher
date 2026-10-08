import { glyphRects, type GlyphName, type GlyphPalette } from "@/pixel/icons";
import { BIOMES, type Biome } from "@/pixel/sceneConfig";
import { lookOf } from "@/store/look";
import { api } from "./api";
import { chooseIcon } from "./instanceIcon";
import type { IconChoice, Instance } from "./types";

/** Kantenlänge des PNG: das größte Bild, das eine Windows-Icon-Datei als Eintrag nennen kann. */
const ICON_SIDE = 256;
/** Bilder bis zu dieser Breite (Pixel-Art von Modpacks) werden ohne Glättung vergrößert, wie in `InstanceIcon`. */
const CRISP_SOURCE_WIDTH = 128;
/** Das Pixel-Icon hat ein Raster von 10×10 und füllt die Kachel bis auf einen Rand. */
const GLYPH_GRID = 10;
const GLYPH_CELL = 20;

/**
 * Das Icon der Instanz als quadratisches PNG (`data:`-URL) für ihre Desktop-Verknüpfung: dasselbe Bild, das die Oberfläche
 * zeigt, also die Wahl des Nutzers, sonst das Icon des Modpacks, sonst das Pixel-Icon aus der ID. Das Modpack-Icon
 * holt das Backend (die Oberfläche darf fremde Bilder nicht lesen); ohne eines gilt das Pixel-Icon.
 */
export async function renderShortcutIcon(instance: Instance): Promise<string> {
  const packIcon = instance.icon ? null : await api.packIcon(instance.id).catch(() => null);
  const { icon, standard } = chooseIcon(instance, packIcon ?? undefined);
  return paint(icon, standard, lookOf(instance).bio);
}

async function paint(icon: IconChoice, standard: IconChoice, bio: Biome): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_SIDE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  if (icon.type === "image" && (await tryDrawImage(context, icon.src))) return canvas.toDataURL("image/png");
  if (standard.type === "glyph") drawGlyph(context, standard.glyph, standard.palette, bio);
  return canvas.toDataURL("image/png");
}

/** Zeichnet das Bild bildfüllend und mittig zugeschnitten; `false`, wenn es sich nicht laden lässt. */
async function tryDrawImage(context: CanvasRenderingContext2D, src: string): Promise<boolean> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    return false;
  }
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side === 0) return false;
  context.imageSmoothingEnabled = side > CRISP_SOURCE_WIDTH;
  context.imageSmoothingQuality = "high";
  const left = (image.naturalWidth - side) / 2;
  const top = (image.naturalHeight - side) / 2;
  context.drawImage(image, left, top, side, side, 0, 0, ICON_SIDE, ICON_SIDE);
  return true;
}

/** Das Pixel-Icon auf der Grundfarbe des Bioms, wie die Kachel der Oberfläche. */
function drawGlyph(context: CanvasRenderingContext2D, glyph: GlyphName, palette: GlyphPalette, bio: Biome) {
  context.fillStyle = BIOMES[bio].bg;
  context.fillRect(0, 0, ICON_SIDE, ICON_SIDE);
  const offset = (ICON_SIDE - GLYPH_GRID * GLYPH_CELL) / 2;
  for (const { x, y, length, fill } of glyphRects(glyph, palette)) {
    context.fillStyle = fill;
    context.fillRect(offset + x * GLYPH_CELL, offset + y * GLYPH_CELL, length * GLYPH_CELL, GLYPH_CELL);
  }
}
