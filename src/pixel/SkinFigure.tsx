import { useCallback, useEffect, useRef, useState } from "react";
import type { SkinVariant } from "@/lib/types";
import { CAPE, drawCape, drawSkin, FIGURE } from "./skin";

/** Lädt eine Textur (Adresse oder data:-URL); bis die nächste da ist, bleibt die vorige stehen. */
function useTexture(src: string | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const next = new Image();
    next.onload = () => setImg(next);
    next.src = src;
    return () => void (next.onload = null);
  }, [src]);
  return img;
}

/**
 * Canvas in Texturpixeln, vergrößert um `zoom` ganze Icon-Einheiten (--iu) je Texturpixel: scharf in jeder Skalierung.
 */
function TextureCanvas({ size, zoom, label, draw }: {
  size: { w: number; h: number }; zoom: number; label: string; draw: (ctx: CanvasRenderingContext2D) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) draw(ctx);
  }, [draw]);
  const style = { width: `calc(var(--iu, 3px) * ${size.w * zoom})`, height: `calc(var(--iu, 3px) * ${size.h * zoom})` };
  return <canvas ref={ref} className="skin-fig" width={size.w} height={size.h} style={style} role="img" aria-label={label} />;
}

/** Spielerfigur von vorn: Grundschicht und zweite Schicht, schlanke Arme bei `slim`. */
export function SkinFigure({ src, variant, zoom = 2, label }: { src: string | undefined; variant: SkinVariant; zoom?: number; label: string }) {
  const img = useTexture(src);
  const draw = useCallback((ctx: CanvasRenderingContext2D) => void (img && drawSkin(ctx, img, variant)), [img, variant]);
  return <TextureCanvas size={FIGURE} zoom={zoom} label={label} draw={draw} />;
}

/** Außenseite eines Umhangs. */
export function CapeFigure({ src, zoom = 2, label }: { src: string; zoom?: number; label: string }) {
  const img = useTexture(src);
  const draw = useCallback((ctx: CanvasRenderingContext2D) => void (img && drawCape(ctx, img)), [img]);
  return <TextureCanvas size={CAPE} zoom={zoom} label={label} draw={draw} />;
}
