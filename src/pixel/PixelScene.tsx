import { useEffect, useRef } from "react";
import { SceneHost, type Biome, type SceneMode, type SunAnchor } from "./scene";
import { onPxChange } from "./unit";

const HOSTS = new WeakMap<Element, SceneHost>();
const RO = typeof ResizeObserver !== "undefined"
  ? new ResizeObserver((entries) => { for (const e of entries) HOSTS.get(e.target)?.refresh(); })
  : null;

type PixelSceneProps = { bio: Biome; seed: number; mode?: SceneMode; sun?: SunAnchor; className?: string };

/**
 * Pixel-Szene als Box. `scene` füllt den Elternblock (Start, Kopf), `art` ist eine Kachel (Poster, Miniatur).
 * `flat` rendert einmal und cacht nach Größe; `live` belebt mit 12 fps; `hero` zusätzlich mit Parallax.
 * `sun`: Lage der Lichtquelle (siehe SunAnchor); ohne Angabe `live` → links der Mitte (Instanzkopf), `hero` → Mockup, `flat` → je Seed.
 */
export function PixelScene({ bio, seed, mode = "flat", sun, className = "art" }: PixelSceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const host = useRef<SceneHost | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const h = new SceneHost(el, bio, seed, mode, sun);
    host.current = h;
    HOSTS.set(el, h);
    h.repaint();
    RO?.observe(el);
    const off = onPxChange(() => h.repaint());
    return () => {
      off();
      RO?.unobserve(el);
      h.dispose();
      host.current = null;
      HOSTS.delete(el);
    };
    // Biom/Seed/Modus wechseln unten ohne neuen Canvas (Bayer-Übergang).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    host.current?.set(bio, seed, mode, sun);
  }, [bio, seed, mode, sun]);

  return <div ref={ref} className={className} aria-hidden />;
}
