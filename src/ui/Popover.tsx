/**
 * Freie Platte an einem Auslöser des Kits (z. B. Aufgaben in der Fensterleiste): nicht modal, Esc/Klick daneben schließt,
 * Fokus geht an den Auslöser zurück. Fläche `lk-pop` (look/overlay.css) wie Menü und Auswahlliste, Maße als Tailwind.
 */
import type { ReactNode } from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";
import { POP_BOX } from "./Menu";
import { Tip } from "./Tooltip";

/** Breite: m 320 (Kurzinfo), l 400 (Liste, Standard). */
const WIDTH = { m: "w-80", l: "w-100" } as const;

/**
 * `label` ist der zugängliche Name der Fläche, `tip` optional der Tooltip des Auslösers. `size` wählt die Breite;
 * eine andere Breite setzt der Aufrufer per `className` (`w-72`). Innenabstand 4 Einheiten.
 */
export function Popover({ trigger, label, size = "l", align = "end", side = "bottom", tip, open, onOpenChange, className, children }: {
  trigger: ReactNode; label: string; size?: keyof typeof WIDTH; align?: "start" | "center" | "end"; side?: "bottom" | "right"; tip?: string;
  open?: boolean; onOpenChange?: (o: boolean) => void; className?: string; children: ReactNode;
}) {
  const t = <P.Trigger asChild>{trigger}</P.Trigger>;
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      {tip ? <Tip label={tip} side={side}>{t}</Tip> : t}
      <P.Portal>
        <P.Content className={cn(POP_BOX, "p-[calc(var(--px)*4)]", WIDTH[size], className)} data-ctx="overlay" data-kit-overlay="popover" side={side} align={align} sideOffset={side === "right" ? 14 : 6} collisionPadding={8} aria-label={label}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
