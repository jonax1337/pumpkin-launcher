import { useEffect, useMemo, useRef, useState } from "react";
import type { SkinVariant } from "@/lib/types";
import { prepareSkin } from "./skin";
import { drawFigure } from "./skinGl";
import { FRAME } from "./skinModel";

/** Bildpunkte der 3D-Figur je Zoomstufe: so viele, dass sie auch auf dichten Bildschirmen scharf bleibt (eine Stufe misst 3 CSS-Pixel je Texturpixel). */
const FIGURE_DENSITY_PER_ZOOM = 6;

/**
 * Lädt eine Textur (Adresse oder data:-URL); bis die nächste da ist, bleibt die vorige stehen, ohne Adresse gibt es keine.
 * CORS-Anfrage, damit die Pixel lesbar sind: Mojangs Texturserver erlaubt jeden Ursprung.
 */
function useTexture(src: string | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const next = new Image();
    next.crossOrigin = "anonymous";
    next.onload = () => setImg(next);
    next.src = src;
    return () => void (next.onload = null);
  }, [src]);
  return src ? img : null;
}

type TurnedSkinProps = { src: string | undefined; variant: SkinVariant; capeSrc?: string; turn: number; tilt: number; zoom?: number };

/**
 * Beleuchtete 3D-Spielerfigur, um `turn` Grad um die Hochachse gedreht (0 = von vorn, 180 = von hinten) und um `tilt` Grad
 * nach vorn geneigt, mit Umhang, wenn `capeSrc` da ist. Das Canvas wird um `zoom` ganze Icon-Einheiten (--iu) je Texturpixel
 * vergrößert; das Beschriften übernimmt der Aufrufer.
 */
export function TurnedSkin({ src, variant, capeSrc, turn, tilt, zoom = 2 }: TurnedSkinProps) {
  const skin = useTexture(src);
  const cape = useTexture(capeSrc);
  const ref = useRef<HTMLCanvasElement>(null);
  // Die Textur einmal bereiten: das Drehen zeichnet sie viele Male neu.
  const sheet = useMemo(() => skin && prepareSkin(skin), [skin]);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx && sheet) drawFigure(ctx, { sheet, variant, cape, turn, tilt });
  }, [sheet, variant, cape, turn, tilt]);
  const density = zoom * FIGURE_DENSITY_PER_ZOOM;
  const style = { width: `calc(var(--iu, 3px) * ${FRAME.w * zoom})`, height: `calc(var(--iu, 3px) * ${FRAME.h * zoom})` };
  return <canvas ref={ref} className="skin-fig" width={FRAME.w * density} height={FRAME.h * density} style={style} aria-hidden />;
}
