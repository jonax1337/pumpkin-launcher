import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { SceneHost, type Biome, type SceneMode } from "./scene";
import { onPxChange } from "./unit";

const RO = typeof ResizeObserver !== "undefined"
  ? new ResizeObserver((entries) => { for (const e of entries) (e.target as HTMLElement & { _scene?: SceneHost })._scene?.paint(); })
  : null;

/**
 * Pixel-Szene als Box. `scene` füllt den Elternblock (Start, Kopf), `art` ist eine Kachel (Poster, Miniatur).
 * `flat` rendert einmal und cacht nach Größe; `live` belebt mit 12 fps; `hero` zusätzlich mit Parallax.
 */
export function PixelScene({ bio, seed, mode = "flat", className = "art" }: { bio: Biome; seed: number; mode?: SceneMode; className?: string }) {
  const ref = useRef<HTMLDivElement & { _scene?: SceneHost }>(null);
  const host = useRef<SceneHost | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const h = new SceneHost(el, bio, seed, mode);
    host.current = h;
    el._scene = h;
    h.paint(true);
    RO?.observe(el);
    const off = onPxChange(() => h.paint(true));
    return () => {
      off();
      RO?.unobserve(el);
      h.dispose();
      host.current = null;
      delete el._scene;
    };
    // Biom/Seed/Modus wechseln unten ohne neuen Canvas (Bayer-Übergang).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    host.current?.set(bio, seed, mode);
  }, [bio, seed, mode]);

  return <div ref={ref} className={cn(className)} aria-hidden />;
}
