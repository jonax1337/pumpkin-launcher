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

export function drawSkin(ctx: CanvasRenderingContext2D, img: HTMLImageElement, variant: SkinVariant) {
  // Bildpixel je Texturpixel (HD-Texturen) und Höhe der Textur in Texturpixeln (64 oder 32).
  const unit = img.naturalWidth / 64;
  const rows = img.naturalHeight / unit;
  const inTexture = ([, y]: Point, h: number) => y + h <= rows;
  const face = ([sx, sy]: Point, { w, h, at: [dx, dy] }: Part) => ctx.drawImage(img, sx * unit, sy * unit, w * unit, h * unit, dx, dy, w, h);
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
  const unit = img.naturalWidth / 64;
  ctx.clearRect(0, 0, CAPE.w, CAPE.h);
  ctx.drawImage(img, unit, unit, CAPE.w * unit, CAPE.h * unit, 0, 0, CAPE.w, CAPE.h);
}
