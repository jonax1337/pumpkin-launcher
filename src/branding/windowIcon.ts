/** Kantenlänge des Fenstericons in Pixeln und Raster des Motivs (32×32 Zellen). */
const ICON_SIZE = 256;
const MARK_GRID = 32;
const CELL = ICON_SIZE / MARK_GRID;
const ALPHA_OFFSET = 3;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Rechteck der Pixel, die nicht ganz durchsichtig sind; null bei leerem Bild. */
function opaqueBounds({ data }: ImageData, size: number): Bounds | null {
  const bounds = { minX: size, minY: size, maxX: -1, maxY: -1 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + ALPHA_OFFSET] === 0) continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds.maxX < 0 ? null : bounds;
}

/** Quadratischer, mittiger Ausschnitt um die belegten Pixel, an Zellgrenzen des 32er-Rasters ausgerichtet. */
function squareCrop({ minX, minY, maxX, maxY }: Bounds) {
  const w = maxX + 1 - minX, h = maxY + 1 - minY, side = Math.max(w, h);
  return {
    x: minX - Math.floor((side - w) / 2 / CELL) * CELL,
    y: minY - Math.floor((side - h) / 2 / CELL) * CELL,
    side,
  };
}

async function encodePng(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Icon konnte nicht kodiert werden');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Fenstericon: das Motiv lässt im 32er-Raster Luft, die Taskbar soll aber die volle Fläche bekommen.
 * Also auf die belegten Pixel zuschneiden (quadratisch, mittig), wie `scripts/sync-branding.mjs`.
 */
export async function croppedWindowIcon(markUrl: string): Promise<Uint8Array> {
  const image = new Image();
  image.src = markUrl;
  await image.decode();
  const source = document.createElement('canvas');
  source.width = source.height = ICON_SIZE;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })!;
  sourceCtx.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
  const bounds = opaqueBounds(sourceCtx.getImageData(0, 0, ICON_SIZE, ICON_SIZE), ICON_SIZE);
  if (!bounds) throw new Error('Icon ist leer');
  const crop = squareCrop(bounds);
  const out = document.createElement('canvas');
  out.width = out.height = ICON_SIZE;
  const outCtx = out.getContext('2d')!;
  outCtx.imageSmoothingEnabled = false;
  outCtx.drawImage(source, crop.x, crop.y, crop.side, crop.side, 0, 0, ICON_SIZE, ICON_SIZE);
  return encodePng(out);
}
