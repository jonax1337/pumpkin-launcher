/**
 * Tooltips des Kits: Item-Tooltip und abgeschnittener Text mit Volltext. Verhalten (Radix, Wirt, Überlaufmessung, Beschreibung
 * für Vorleser) kommt aus tipBase.tsx (`TipBase`, `TruncBase`); Aussehen aus look/overlay.css (lk-tip), Maße hier als Tailwind.
 * Radix verlangt einen Anbieter: liegt kein `TipProvider` über dem Baum, legt jeder Tooltip selbst einen an, die Bausteine laufen also auch allein.
 */
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { TipBase, TipScope, TruncBase, type TipProps, type TruncProps } from "./tipBase";

export { TipProvider } from "./tipBase";

/** Fläche: höchstens 300 breit, Innenabstand 8/12, Schrift 13. */
export const TIP_BOX = "lk-tip relative z-90 max-w-[300px] px-3 py-2 text-ctl-s leading-[1.45]";

/** Name (fett, hell) im Inhalt eines reichen Tooltips (`Tip label={<>…</>}`). */
export function TipTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("lk-tip-n", className)} {...props} />;
}

/** Zeilenart im reichen Tooltip: `muted` Wert und Hinweis, `update` Update verfügbar, `bad` Warnung, `desc` Beschreibung (1 Einheit Abstand). */
const TIP_LINE = { muted: "lk-tip-v", update: "lk-tip-u", bad: "lk-tip-w", desc: "lk-tip-d mt-1" } as const;

/** Eine Zeile unter dem Namen (`TipTitle`) im reichen Tooltip. */
export function TipLine({ tone = "muted", className, ...props }: { tone?: keyof typeof TIP_LINE } & ComponentProps<"div">) {
  return <div className={cn(TIP_LINE[tone], className)} {...props} />;
}

/**
 * Item-Tooltip (dunkel, Verlaufsrahmen).
 * `describe`: Der Text trägt Information (nicht nur die Beschriftung wiederholt) → zusätzlich als verstecktes
 * `.sr`-Span direkt hinter dem Auslöser und per aria-describedby. Für Tastatur und Screenreader auch auf
 * nicht fokussierbaren Auslösern (Chip, Statuszeile), die den Tooltip sonst nur mit der Maus zeigen.
 */
export function Tip(props: TipProps) {
  return (
    <TipScope>
      <TipBase {...props} contentClass={TIP_BOX} />
    </TipScope>
  );
}

/**
 * Text mit Auslassung („…“), der bei Überlauf den vollen Text als Tooltip zeigt: bei Hover über den Wirt (450 ms) und sofort bei
 * Tastaturfokus des Wirts. Ohne Überlauf kein Tooltip. Wirt: `host` (Selektor, gesucht im nächsten Vorfahren, der ihn enthält,
 * z. B. ".hit" im Poster), sonst der nächste fokussierbare Vorfahr (Link in der Listenzeile), sonst das Elternelement.
 * Der Screenreader-Name gehört an den Wirt (aria-label/Linktext); der Tooltip ist nur die sichtbare Ergänzung.
 */
export function Trunc(props: TruncProps) {
  return (
    <TipScope>
      <TruncBase {...props} truncClass="min-w-0 truncate" tipClass={TIP_BOX} />
    </TipScope>
  );
}
