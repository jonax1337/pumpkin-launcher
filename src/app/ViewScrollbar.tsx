import { useRef, type RefObject } from "react";
import { Scrollbar, type ScrollbarHandle } from "@/ui";
import { useViewObserver } from "./useViewObserver";

/** Außer neuen Seiten zählt der Klassenwechsel der Ansicht (`noscroll` nimmt ihr das Scrollen). */
const CLASS_AND_CHILDREN: MutationObserverInit = { childList: true, attributes: true, attributeFilter: ["class"] };

/**
 * Die Scrollbar des Kits über der Ansicht statt der nativen Spur (`.view` blendet sie aus): Szenen (Start, Instanzkopf)
 * reichen bis an den Fensterrand. Hier steht nur, was die App beisteuert: die Ansicht beobachten und die Bahn unter die Fensterleiste legen.
 */
export function ViewScrollbar({ view }: { view: RefObject<HTMLElement | null> }) {
  const bar = useRef<ScrollbarHandle>(null);
  useViewObserver(view, () => bar.current?.update(), { mutations: CLASS_AND_CHILDREN, scroll: true });
  return <Scrollbar ref={bar} target={view} className="top-(--bar)" />;
}
