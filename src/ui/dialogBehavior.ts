/**
 * Verhalten von Dialog und Seitenpanel (Dialog.tsx, Sheet.tsx): Fokus-Rückgabe an den Auslöser, Akzent-Weitergabe an das Portal
 * und die Autofokus-Priorität. Aussehen: look/dialog.css, look/overlay.css.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { recentMenuOrigin } from "./menuOrigin";

/**
 * Fokus zurück an den Auslöser. Dialoge öffnen kontrolliert ohne Radix-Trigger; Radix fiele dann auf body zurück.
 * Der Auslöser wird beim Öffnen gemerkt (Fokus liegt noch dort), `restore` gehört in onCloseAutoFocus.
 * Kommt der Dialog aus einem Menüeintrag, zählt der Auslöser des Menüs.
 */
export function useReturnFocus(open: boolean) {
  const back = useRef<HTMLElement | null>(null);
  const [acc, setAcc] = useState<string>();
  // Schon beim Öffnen merken, bevor der Inhalt (Portal, eine Runde später) per autoFocus ein Feld fokussiert.
  // onOpenAutoFocus käme dafür zu spät.
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    back.current = active instanceof HTMLElement && active !== document.body && !active.closest("[role=menu]") ? active : recentMenuOrigin();
    setAcc(accentOf(back.current));
  }, [open]);
  return {
    /** Instanz-Akzent des Auslösers (das Portal erbt --acc nicht); undefined = Kupfer von :root. */
    acc,
    restore(e: Event) {
      e.preventDefault();
      const root = e.currentTarget as HTMLElement | null;
      const a = document.activeElement;
      // Hat der Nutzer den Fokus schon woanders hingesetzt (nicht modales Panel), dort lassen.
      if (a && a !== document.body && !root?.contains(a)) return;
      const el = back.current?.isConnected ? back.current : document.querySelector<HTMLElement>("main");
      back.current = null;
      el?.focus({ preventScroll: true });
    },
  };
}

/**
 * --acc am Auslöser (berechnet, also auch geerbt). Ein Gefahrknopf (data-variant="danger") überschreibt
 * --acc nur für sich, dann zählt sein Umfeld. Nur wenn es vom globalen Kupfer abweicht; die Ableitungen
 * (--acc-hi/-mid/-lo) rechnet styles/base.css über [style*="--acc:"].
 */
function accentOf(el: HTMLElement | null) {
  if (!el?.isConnected) return undefined;
  const src = el.closest(".lk-btn[data-variant='danger']")?.parentElement ?? el;
  const v = getComputedStyle(src).getPropertyValue("--acc").trim();
  return v && v !== getComputedStyle(document.documentElement).getPropertyValue("--acc").trim() ? v : undefined;
}

/**
 * Erstes Ziel nach Priorität, nicht in Dokument-Reihenfolge: markiert → Eingabe → Hauptknopf → erstes Bedienbare.
 * Hauptknopf: Kit-Primärknopf im Fuß.
 */
const AUTOFOCUS = [
  "[data-autofocus], [autofocus]",
  "[data-kit-part=dialog-body] input:not([type=checkbox]):not([type=radio]):not([type=file]):not(:disabled), [data-kit-part=dialog-body] textarea:not(:disabled)",
  "[data-kit-part=dialog-foot] .lk-btn[data-variant='primary']:not(:disabled)",
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]",
];

export function autoFocusTarget(root: HTMLElement) {
  for (const sel of AUTOFOCUS) {
    // Sichtbar, per Tab erreichbar und nicht im Kopf (das Schließen-Kreuz bekommt nie den Startfokus)
    const el = [...root.querySelectorAll<HTMLElement>(sel)].find((n) => n.tabIndex >= 0 && n.getClientRects().length > 0 && !n.closest("[data-kit-part=dialog-head]"));
    if (el) return el;
  }
  return null;
}
