/** Fingerabdruck der Pixel eines Bilds (Adresse oder data:-URL): gleiche Pixel ergeben denselben Wert, egal wie das Bild gepackt ist. */
export async function pixelSignature(src: string): Promise<string> {
  const image = new Image();
  // Mojangs Texturserver erlaubt jeden Ursprung; ohne CORS-Anfrage wäre das Canvas nicht lesbar.
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  return `${width}x${height}:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
