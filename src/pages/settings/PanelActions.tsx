import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Der Platz rechts neben dem Abschnittstitel (Kopf der Inhaltsplatte), in den die Reiter ihre Aktionen legen. */
const PanelActionsTarget = createContext<HTMLElement | null>(null);

export const PanelActionsProvider = PanelActionsTarget.Provider;

/** Zeigt `children` im Kopf der Inhaltsplatte (neben dem Titel) statt an der Stelle im Reiter, z. B. „Hinweise“ oder „Konto hinzufügen“. */
export function PanelActions({ children }: { children: ReactNode }) {
  const target = use(PanelActionsTarget);
  return target ? createPortal(children, target) : null;
}
