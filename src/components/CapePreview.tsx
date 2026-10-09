import { useEffect, useRef } from "react";
import { useTexture } from "@/pixel/SkinFigure";

/** Außenseite des Umhangs in der 64×32-Textur: linke obere Ecke und Größe in Texturpixeln. */
const FRONT = { x: 1, y: 1, w: 10, h: 16 };
const TEXTURE_WIDTH = 64;

/**
 * Vorderansicht eines Umhangs: die Außenseite der Textur, pixelscharf ausgeschnitten (auch bei HD-Texturen).
 * Ohne ladbare Textur zeigt das Stufenmuster aus dem Entwurf die Größe an.
 */
export function CapePreview({ src }: { src: string | undefined }) {
  const texture = useTexture(src);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !texture) return;
    const scale = texture.width / TEXTURE_WIDTH;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, FRONT.w, FRONT.h);
    ctx.drawImage(texture, FRONT.x * scale, FRONT.y * scale, FRONT.w * scale, FRONT.h * scale, 0, 0, FRONT.w, FRONT.h);
  }, [texture]);
  if (!texture) return <span className="cape-preview" data-fallback aria-hidden />;
  return <canvas ref={ref} className="cape-preview" width={FRONT.w} height={FRONT.h} aria-hidden />;
}
