/*
 * Textur für die Skin-Vorschau: der Skin, wie Minecraft ihn zeichnet (64×64, altes Format 64×32).
 * Die drehbare 3D-Figur steht in skinModel.ts und skinGl.ts.
 */

/** Bereich in Texturpixeln: [x0, y0, x1, y1). */
type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

// Grundschicht, die Minecraft deckend zeichnet, und die Hutschicht des alten Formats.
const OPAQUE: readonly Rect[] = [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]];
const LEGACY_HAT: Rect = [32, 0, 64, 16];

/** Bildpixel je Texturpixel (HD-Texturen) und Höhe der Textur in Texturpixeln (64 oder 32). */
export function textureScale(img: HTMLImageElement) {
  const unit = img.naturalWidth / 64;
  return { unit, rows: img.naturalHeight / unit };
}

/**
 * Bereitet die Textur auf wie Minecraft: Die Grundschicht ist deckend, und hat ein alter 64×32-Skin in der
 * Hutschicht keinen einzigen durchsichtigen Pixel, gilt sie als leer – viele alte Skins füllen sie einfarbig.
 */
function prepare(img: HTMLImageElement, unit: number, rows: number): HTMLCanvasElement | HTMLImageElement {
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

/** Textur, wie Minecraft sie zeichnet (siehe `prepare`), samt Maßen: einmal je Bild bereiten, dann beliebig oft zeichnen. */
export type SkinSheet = { texture: HTMLCanvasElement | HTMLImageElement; unit: number; rows: number };

export function prepareSkin(img: HTMLImageElement): SkinSheet {
  const { unit, rows } = textureScale(img);
  return { texture: prepare(img, unit, rows), unit, rows };
}

