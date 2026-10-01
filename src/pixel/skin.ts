import type { SkinVariant } from "@/lib/types";

/*
 * Vorderansicht einer Spielerfigur aus der Skin-Textur (64×64, altes Format 64×32) und eines Umhangs.
 * Gezeichnet wird in Texturpixeln (Figur 16×32, Umhang 10×16); vergrößert wird per CSS (pixelated).
 */

export const FIGURE = { w: 16, h: 32 } as const;
export const CAPE = { w: 10, h: 16 } as const;

type Point = readonly [x: number, y: number];

/**
 * Körperteil: Vorderseite in der Grundschicht (`base`) und der zweiten Schicht (`layer`), Platz in der Figur (`at`).
 * `mirrors`: Das alte Format hat keine eigenen linken Gliedmaßen; Minecraft spiegelt dann die rechten.
 */
type Part = { w: number; h: number; base: Point; layer: Point; at: Point; mirrors?: Point };

// Rechts = rechte Seite der Figur, in der Vorderansicht also links im Bild.
function parts(variant: SkinVariant): Part[] {
  const arm = variant === "slim" ? 3 : 4;
  return [
    { w: 8, h: 8, base: [8, 8], layer: [40, 8], at: [4, 0] },
    { w: 8, h: 12, base: [20, 20], layer: [20, 36], at: [4, 8] },
    { w: arm, h: 12, base: [44, 20], layer: [44, 36], at: [4 - arm, 8] },
    { w: arm, h: 12, base: [36, 52], layer: [52, 52], at: [12, 8], mirrors: [44, 20] },
    { w: 4, h: 12, base: [4, 20], layer: [4, 36], at: [4, 20] },
    { w: 4, h: 12, base: [20, 52], layer: [4, 52], at: [8, 20], mirrors: [4, 20] },
  ];
}

/** Bereich in Texturpixeln: [x0, y0, x1, y1). */
type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

// Grundschicht, die Minecraft deckend zeichnet, und die Hutschicht des alten Formats.
const OPAQUE: readonly Rect[] = [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]];
const LEGACY_HAT: Rect = [32, 0, 64, 16];

/** Bildpixel je Texturpixel (HD-Texturen) und Höhe der Textur in Texturpixeln (64 oder 32). */
function textureScale(img: HTMLImageElement) {
  const unit = img.naturalWidth / 64;
  return { unit, rows: img.naturalHeight / unit };
}

/**
 * Bereitet die Textur auf wie Minecraft: Die Grundschicht ist deckend, und hat ein alter 64×32-Skin in der
 * Hutschicht keinen einzigen durchsichtigen Pixel, gilt sie als leer – viele alte Skins füllen sie einfarbig.
 */
function prepare(img: HTMLImageElement, unit: number, rows: number): CanvasImageSource {
  const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
  const ctx = canvas.getContext("2d");
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Index des Alphawerts jedes Bildpixels im Bereich; ein Generator, weil HD-Skins Millionen davon haben.
  function* alphas([x0, y0, x1, y1]: Rect) {
    for (let y = y0 * unit; y < y1 * unit; y++)
      for (let x = x0 * unit; x < x1 * unit; x++) yield (y * canvas.width + x) * 4 + 3;
  }
  const setAlpha = (rect: Rect, alpha: number) => {
    for (const i of alphas(rect)) image.data[i] = alpha;
  };
  const hatIsFilled = () => {
    for (const i of alphas(LEGACY_HAT)) if (image.data[i] < 128) return false;
    return true;
  };
  if (rows === 32 && hatIsFilled()) setAlpha(LEGACY_HAT, 0);
  for (const rect of OPAQUE) if (rect[3] <= rows) setAlpha(rect, 255);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function drawSkin(ctx: CanvasRenderingContext2D, img: HTMLImageElement, variant: SkinVariant) {
  const { unit, rows } = textureScale(img);
  const texture = prepare(img, unit, rows);
  const inTexture = ([, y]: Point, h: number) => y + h <= rows;
  const face = ([sx, sy]: Point, { w, h, at: [dx, dy] }: Part) => ctx.drawImage(texture, sx * unit, sy * unit, w * unit, h * unit, dx, dy, w, h);
  const mirroredFace = (source: Point, part: Part) => {
    ctx.save();
    ctx.translate(2 * part.at[0] + part.w, 0);
    ctx.scale(-1, 1);
    face(source, part);
    ctx.restore();
  };
  ctx.clearRect(0, 0, FIGURE.w, FIGURE.h);
  for (const part of parts(variant)) {
    if (inTexture(part.base, part.h)) face(part.base, part);
    else if (part.mirrors) mirroredFace(part.mirrors, part);
    if (inTexture(part.layer, part.h)) face(part.layer, part);
  }
}

/** Außenseite des Umhangs (so, wie andere ihn von hinten sehen). */
export function drawCape(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const { unit } = textureScale(img);
  ctx.clearRect(0, 0, CAPE.w, CAPE.h);
  ctx.drawImage(img, unit, unit, CAPE.w * unit, CAPE.h * unit, 0, 0, CAPE.w, CAPE.h);
}
