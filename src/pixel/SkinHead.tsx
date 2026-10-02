import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { prepareSkin } from "./skin";
import { useTexture } from "./SkinFigure";

/** Der Kopf in Texturpixeln: Kantenlänge, Gesicht und darüber die Hutschicht. */
const HEAD_EDGE = 8;
const FACE_AT = [8, 8] as const;
const HAT_AT = [40, 8] as const;

/**
 * Der Kopf eines Skins (Gesicht samt Hutschicht), scharf auf `size` (CSS-Länge) vergrößert. Solange die Textur lädt
 * oder wenn sie sich nicht laden lässt, steht `fallback` da.
 */
export function SkinHead({ src, size, fallback }: { src: string; size: string; fallback: ReactNode }) {
  const texture = useTexture(src);
  const sheet = useMemo(() => texture && prepareSkin(texture), [texture]);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!sheet || !context) return;
    const edge = HEAD_EDGE * sheet.unit;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, HEAD_EDGE, HEAD_EDGE);
    for (const [x, y] of [FACE_AT, HAT_AT]) {
      context.drawImage(sheet.texture, x * sheet.unit, y * sheet.unit, edge, edge, 0, 0, HEAD_EDGE, HEAD_EDGE);
    }
  }, [sheet]);
  if (!sheet) return fallback;
  return <canvas ref={ref} width={HEAD_EDGE} height={HEAD_EDGE} style={{ width: size, height: size, imageRendering: "pixelated" }} aria-hidden />;
}
