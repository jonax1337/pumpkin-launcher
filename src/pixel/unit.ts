import { useEffect } from "react";
import { useSettings, type PxSize } from "@/store/settings";

/**
 * Pixeleinheit: ein Welt-Pixel trifft immer ganze Gerätepixel.
 * Stufe klein/mittel/groß = 2/3/4 CSS-px bei 100 %. Bei 125 % wird aus 3 px also 4 Gerätepixel = 3,2 CSS-px.
 * Alles Pixelige (Kerben, Bevel, Icons, Szenen) rechnet mit --px; Layout-Maße nie.
 */
export const PX = { css: 3, dev: 3, eff: 1 };

const listeners = new Set<() => void>();

/** Szenen melden sich hier an und zeichnen neu, wenn sich die Einheit ändert. */
export function onPxChange(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** CSS-px je Welt-Pixel bei 100 % für die Stufen klein/mittel/groß. */
const PX_TARGETS: Record<PxSize, number> = { s: 2, m: 3, l: 4 };
/** Icon-Einheit (--iu) in CSS-px bei 100 %. */
const ICON_UNIT_CSS = 3;
/** Rundungsspielraum, damit eine Zelle, die knapp in die Box passt, nicht herausfällt. */
const FIT_TOLERANCE = 0.01;
/** Feste Boxen (CSS-px) für Avatar (--avs) und großen Avatar (--av-32) sowie der Icon-Slot m (7×7 nur, wenn er hineinpasst). */
const AVATAR_BOX = 28;
const AVATAR_BOX_LARGE = 32;
const ICON_SLOT_M_BOX = 24;
const AVATAR_CELLS = 8;
const GLYPH_CELLS = 10;
/** Boxgrößen der Kit-Glyphen (--gl-<Box>); dieselbe Liste steht in ui/icon.css und ui/Icon.tsx. */
export const GLYPH_BOXES = [40, 52, 64, 72, 104] as const;

/** Kantenlänge einer Box, die ganze Zellen aus ganzen Icon-Einheiten fasst und noch in `box` passt. */
const fitCells = (box: number, cells: number, iu: number) =>
  `${Math.max(1, Math.floor((box + FIT_TOLERANCE) / (cells * iu))) * cells * iu}px`;

/** Pixelstufe (CSS-px je Welt-Pixel) so, dass ein Welt-Pixel immer ganze Gerätepixel trifft. */
function pixelUnitFor(size: PxSize) {
  const eff = window.devicePixelRatio || 1;
  const dev = Math.max(1, Math.round(PX_TARGETS[size] * eff));
  return { css: dev / eff, dev, eff };
}

/** Icons, Glyphen, Avatare hängen NICHT an der Pixelstufe (die gilt nur für Rahmen, Kerben, Szenen):
 * eigene Einheit --iu = 3 CSS-px, auf ganze Gerätepixel gerundet. So bleiben sie in jeder Stufe gleich groß und scharf. */
function applyIconUnit(style: CSSStyleDeclaration, eff: number) {
  const iu = Math.max(1, Math.round(ICON_UNIT_CSS * eff)) / eff;
  style.setProperty("--iu", `${iu}px`);
  style.setProperty("--avs", fitCells(AVATAR_BOX, AVATAR_CELLS, iu));
  style.setProperty("--av-32", fitCells(AVATAR_BOX_LARGE, AVATAR_CELLS, iu));
  for (const box of GLYPH_BOXES) style.setProperty(`--gl-${box}`, fitCells(box, GLYPH_CELLS, iu));
  // Kit (src/ui): Icon-Slot m zeichnet 7×7 nur, wenn 7 Einheiten hineinpassen, sonst 5×5.
  document.documentElement.dataset.icoM = 7 * iu <= ICON_SLOT_M_BOX + FIT_TOLERANCE ? "7" : "5";
}

export function applyPx(size: PxSize) {
  const next = pixelUnitFor(size);
  const style = document.documentElement.style;
  if (PX.css === next.css && PX.eff === next.eff && style.getPropertyValue("--px")) return;
  Object.assign(PX, next);
  style.setProperty("--px", `${next.css}px`);
  applyIconUnit(style, next.eff);
  listeners.forEach((cb) => cb());
}

/** Auf Gerätepixel runden (für Canvas-Versatz und Positionen). */
export const snap = (v: number) => Math.round(v * PX.eff) / PX.eff;

/** Einmal im Layout: setzt --px und rechnet neu, wenn Pixelgröße oder Windows-Skalierung wechseln. */
export function usePixelUnit() {
  const size = useSettings((s) => s.pxSize);
  useEffect(() => {
    applyPx(size);
    let mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      applyPx(size);
      mq.removeEventListener("change", onChange);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener("change", onChange);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [size]);
}
