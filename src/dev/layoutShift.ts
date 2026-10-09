type LayoutShift = PerformanceEntry & { value: number; hadRecentInput: boolean };

/** Nur Entwicklung: Layoutshift-Summe (siehe „Interaction and state“ in PIXELKINO.md) in window.__cls. */
export function trackLayoutShift() {
  if (typeof PerformanceObserver === "undefined") return;
  const win = window as Window & { __cls?: number };
  win.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShift[]) {
        if (!entry.hadRecentInput) win.__cls = (win.__cls ?? 0) + entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // layout-shift nicht unterstützt
  }
}
