import type { ReactNode } from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";

/**
 * Freie Platte an einem Auslöser (z. B. Aufgaben in der Fensterleiste): nicht modal, Esc/Klick daneben schließt,
 * Fokus geht an den Auslöser zurück. `label` ist der zugängliche Name der Fläche, `tip` optional der Tooltip des Auslösers.
 * Aussehen: ui/overlay.css (vx-pop).
 */
export function Popover({ trigger, label, width = 400, align = "end", side = "bottom", tip, open, onOpenChange, className, children }: {
  trigger: ReactNode; label: string; width?: number; align?: "start" | "center" | "end"; side?: "bottom" | "right"; tip?: string;
  open?: boolean; onOpenChange?: (o: boolean) => void; className?: string; children: ReactNode;
}) {
  const t = <P.Trigger asChild>{trigger}</P.Trigger>;
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      {tip ? <Tip label={tip} side={side}>{t}</Tip> : t}
      <P.Portal>
        <P.Content className={cn("vx-pop", className)} data-ctx="overlay" data-pad="l" style={{ width }} side={side} align={align} sideOffset={side === "right" ? 14 : 6} collisionPadding={8} aria-label={label}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
