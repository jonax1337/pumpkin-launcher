/** Kantenlänge eines eigenen Instanz-Icons in Pixeln: scharf genug für das größte Poster, klein genug für den lokalen Speicher. */
export const ICON_SIZE_PX = 256;
const ICON_FORMAT = "image/webp";
const ICON_QUALITY = 0.9;

/** Das Bild aus `file` als Datenadresse, mittig quadratisch zugeschnitten und auf `ICON_SIZE_PX` verkleinert. */
export async function squareIcon(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const edge = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(edge, ICON_SIZE_PX);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(ICON_FORMAT, ICON_QUALITY);
}
