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

export function applyPx(size: PxSize) {
  const eff = window.devicePixelRatio || 1;
  const target = { s: 2, m: 3, l: 4 }[size];
  const dev = Math.max(1, Math.round(target * eff));
  const css = dev / eff;
  if (PX.css === css && PX.eff === eff && document.documentElement.style.getPropertyValue("--px")) return;
  Object.assign(PX, { css, dev, eff });
  const st = document.documentElement.style;
  st.setProperty("--px", `${css}px`);
  // Icons: feste Box, Glyphe ein ganzzahliges Vielfaches der Einheit, das in die Box passt.
  const fit = (box: number, cells: number) => `${Math.max(1, Math.floor((box + 0.01) / (cells * css))) * cells * css}px`;
  st.setProperty("--pis", fit(28, 7));
  st.setProperty("--piss", fit(20, 5));
  st.setProperty("--mis", fit(40, 10));
  st.setProperty("--mil", fit(64, 10));
  st.setProperty("--avs", fit(28, 8));
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
