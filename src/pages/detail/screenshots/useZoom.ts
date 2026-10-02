import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from "react";

/** Vergrößerungsstufen als Vielfache der Originalgröße; „angepasst“ (ganzes Bild im Fenster) liegt dazwischen. */
const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
/** Mit Strg und Mausrad (oder dem Zusammenziehen zweier Finger) wächst das Bild um diesen Faktor je Rastung. */
const WHEEL_FACTOR = 1.2;
const MIN_SCALE = STEPS[0];
const MAX_SCALE = STEPS[STEPS.length - 1];
/** Zwischen „angepasst“ und einer Stufe liegt höchstens so viel: näher zählt als gleich. */
const SAME_SCALE = 0.001;

type Size = { w: number; h: number };
type Point = { x: number; y: number };
type Zoom = "fit" | number;
/** Stelle des Bilds (Anteil von Breite und Höhe), die nach dem Zoomen wieder unter dem Punkt (x, y) im Fenster liegen soll. */
type Anchor = Point & { fx: number; fy: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Größe des Elements, solange es da ist; folgt dem Fenster. */
function useElementSize(element: HTMLElement | null): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    if (!element) return;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/** Strg+Mausrad auf dem Element; das muss das Scrollen der Seite verhindern, und das geht nur mit einem nicht passiven Zuhörer. */
function useCtrlWheel(element: HTMLElement | null, onWheel: (zoomIn: boolean, at: Point) => void) {
  const latest = useRef(onWheel);
  useEffect(() => {
    latest.current = onWheel;
  });
  useEffect(() => {
    if (!element) return;
    const listener = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      latest.current(e.deltaY < 0, { x: e.clientX, y: e.clientY });
    };
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, [element]);
}

/** Ziehen verschiebt den Inhalt einer scrollenden Fläche (nur, wo er überläuft: `enabled`). */
function usePan(enabled: boolean) {
  const from = useRef<Point | null>(null);
  const end = () => void (from.current = null);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !enabled) return;
      from.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!from.current) return;
      e.currentTarget.scrollLeft -= e.clientX - from.current.x;
      e.currentTarget.scrollTop -= e.clientY - from.current.y;
      from.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

/**
 * Zoom und Verschieben eines Bilds in einer scrollenden Fläche (`stageRef`): ganzes Bild („angepasst“, nie über 100 %),
 * Stufen, Strg+Mausrad auf die Zeigerstelle, Ziehen zum Verschieben. Bei einem neuen Bild (`imageKey`) beginnt es wieder angepasst.
 */
export function useZoom(imageKey: string) {
  const stage = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const anchor = useRef<Anchor | null>(null);
  // Der Dialog setzt seinen Inhalt erst nach dem ersten Rendern ein: Zuhörer hängen sich an, sobald die Fläche da ist.
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((element: HTMLDivElement | null) => {
    stage.current = element;
    setStageElement(element);
  }, []);
  const stageSize = useElementSize(stageElement);
  const [loaded, setLoaded] = useState<{ key: string; size: Size } | null>(null);
  const [choice, setChoice] = useState<{ key: string; zoom: Zoom }>({ key: imageKey, zoom: "fit" });

  const natural = loaded?.key === imageKey ? loaded.size : null;
  const zoom = choice.key === imageKey ? choice.zoom : "fit";
  const fitScale = natural && stageSize.w ? Math.min(1, stageSize.w / natural.w, stageSize.h / natural.h) : 1;
  const scale = zoom === "fit" ? fitScale : zoom;
  const canPan = !!natural && (natural.w * scale > stageSize.w + 1 || natural.h * scale > stageSize.h + 1);

  /** Setzt die Vergrößerung und hält die Stelle unter `point` im Fenster fest; ohne Punkt gilt die Mitte der Fläche. */
  const zoomTo = (next: Zoom, point?: Point) => {
    const img = image.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (img && bounds) {
      const rect = img.getBoundingClientRect();
      const { x, y } = point ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      anchor.current = { x, y, fx: clamp((x - rect.left) / rect.width, 0, 1), fy: clamp((y - rect.top) / rect.height, 0, 1) };
    }
    setChoice({ key: imageKey, zoom: next });
  };

  // Nach jedem Layout, das auf einen Zoom folgt (auch wenn die Größe gleich blieb): die gemerkte Bildstelle zurück unter den
  // Punkt scrollen. Der Anker gilt nur dieses eine Mal; sonst löste ein veralteter später (Fenstergröße, Laden) einen Sprung aus.
  useLayoutEffect(() => {
    const held = anchor.current;
    anchor.current = null;
    const el = stage.current;
    const img = image.current;
    if (!held || !el || !img) return;
    const rect = img.getBoundingClientRect();
    el.scrollLeft += rect.left + held.fx * rect.width - held.x;
    el.scrollTop += rect.top + held.fy * rect.height - held.y;
  });

  useCtrlWheel(stageElement, (zoomIn, at) => zoomTo(clamp(scale * (zoomIn ? WHEEL_FACTOR : 1 / WHEEL_FACTOR), MIN_SCALE, MAX_SCALE), at));

  const stepIn = STEPS.find((step) => step > scale + SAME_SCALE);
  const stepOut = [...STEPS].reverse().find((step) => step < scale - SAME_SCALE);

  return {
    stageRef,
    image,
    /** Anzeigegröße des Bilds in Bildschirmpixeln; null, bis das Bild geladen ist. */
    size: natural && { width: Math.round(natural.w * scale), height: Math.round(natural.h * scale) },
    percent: Math.round(scale * 100),
    isFit: zoom === "fit",
    canPan,
    canZoomIn: stepIn != null,
    canZoomOut: stepOut != null,
    onLoad: (e: SyntheticEvent<HTMLImageElement>) =>
      setLoaded({ key: imageKey, size: { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight } }),
    zoomIn: () => stepIn != null && zoomTo(stepIn),
    zoomOut: () => stepOut != null && zoomTo(stepOut),
    fit: () => zoomTo("fit"),
    actualSize: () => zoomTo(1),
    panProps: usePan(canPan),
  };
}
