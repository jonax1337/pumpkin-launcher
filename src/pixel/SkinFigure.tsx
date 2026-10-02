import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkinVariant } from "@/lib/types";
import { CAPE, drawCape, prepareSkin } from "./skin";
import { drawTurned, TURN, TURN_SCALE } from "./skinTurn";

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

/**
 * Canvas in Texturpixeln (mal `density` Bildpunkte), vergrößert um `zoom` ganze Icon-Einheiten (--iu) je Texturpixel:
 * scharf in jeder Skalierung. Reine Zeichenfläche: das Beschriften übernimmt der Aufrufer.
 */
function TextureCanvas({ size, zoom, density = 1, label, draw }: {
  size: { w: number; h: number }; zoom: number; density?: number; label?: string; draw: (ctx: CanvasRenderingContext2D) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) draw(ctx);
  }, [draw]);
  const style = { width: `calc(var(--iu, 3px) * ${size.w * zoom})`, height: `calc(var(--iu, 3px) * ${size.h * zoom})` };
  const naming = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return <canvas ref={ref} className="skin-fig" width={size.w * density} height={size.h * density} style={style} {...naming} />;
}

type TurnedSkinProps = { src: string | undefined; variant: SkinVariant; capeSrc?: string; turn: number; zoom?: number };

/** Spielerfigur, um `turn` Grad um die Hochachse gedreht (0 = von vorn, 180 = von hinten), mit Umhang, wenn `capeSrc` da ist. */
export function TurnedSkin({ src, variant, capeSrc, turn, zoom = 2 }: TurnedSkinProps) {
  const skin = useTexture(src);
  const cape = useTexture(capeSrc);
  // Die Textur einmal bereiten: das Drehen zeichnet sie viele Male neu.
  const sheet = useMemo(() => skin && prepareSkin(skin), [skin]);
  const draw = useCallback((ctx: CanvasRenderingContext2D) => void (sheet && drawTurned(ctx, sheet, variant, turn, cape)), [sheet, variant, turn, cape]);
  return <TextureCanvas size={TURN} zoom={zoom} density={TURN_SCALE} draw={draw} />;
}

/** Außenseite eines Umhangs. */
export function CapeFigure({ src, zoom = 2, label }: { src: string; zoom?: number; label: string }) {
  const img = useTexture(src);
  const draw = useCallback((ctx: CanvasRenderingContext2D) => void (img && drawCape(ctx, img)), [img]);
  return <TextureCanvas size={CAPE} zoom={zoom} label={label} draw={draw} />;
}
