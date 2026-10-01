import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "@/lib/api";

/**
 * Aufs Fenster gezogene Dateien, solange `enabled`: `onDrop` bekommt die absoluten Pfade (nur in der App,
 * der Browser kennt keine). Liefert, ob gerade etwas über dem Fenster schwebt (für die Ablage-Fläche).
 */
export function useFileDrop(enabled: boolean, onDrop: (paths: string[]) => void): boolean {
  const [over, setOver] = useState(false);
  // Immer der neueste Handler, ohne den Listener bei jedem Rendern neu anzumelden.
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  });
  useEffect(() => {
    if (!api.capabilities.fileDrop || !enabled) return;
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      setOver(payload.type === "enter" || payload.type === "over");
      if (payload.type === "drop") handler.current(payload.paths);
    });
    return () => {
      setOver(false);
      void unlisten.then((f) => f());
    };
  }, [enabled]);
  return over;
}
