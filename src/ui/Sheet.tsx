/**
 * Seitenpanel rechts des Kits (Katalog im Kontext einer Instanz). Nicht modal: die Liste daneben bleibt bedienbar.
 * Verhalten (Radix, Fokus-Rückgabe, Akzent-Weitergabe) kommt aus dialogBehavior.ts (`useReturnFocus`); Aussehen aus look/overlay.css
 * (lk-sheet: Steinplatte mit eingelassenem Körper wie der Dialog), Lage und Maße als Tailwind-Utilities hier.
 */
import type { ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useReturnFocus } from "./dialogBehavior";
import { cssVars } from "./util";
import { IconButton } from "./Button";
import { Heading } from "./Panel";

/**
 * Kopf (Titel Stufe section mit Zeilenhöhe 32 = Schließen-Knopf, damit beide auf einer Mitte stehen), optional `tools` (Suche, Filter)
 * darunter, scrollender Körper. Breite 460 (das Fenster begrenzt), unter der Fensterleiste, 8 px Rand. `acc`: Akzent des Panels (sonst der des Auslösers).
 */
export function Sheet({ open, onOpenChange, title, sub, acc, children, tools, className }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; sub?: ReactNode; acc?: string; children: ReactNode; tools?: ReactNode; className?: string;
}) {
  const { t } = useI18n();
  const ret = useReturnFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <D.Portal>
        <D.Content
          className={cn(
            "lk-sheet fixed top-[calc(var(--bar)+8px)] right-2 bottom-2 z-62 flex flex-col p-u2",
            "w-[min(460px,calc(var(--vw1,1vw)*100_-_48px))]",
            className,
          )}
          data-ctx="overlay"
          data-kit-overlay="sheet"
          aria-describedby={undefined}
          style={cssVars({ "--acc": acc ?? ret.acc })}
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={ret.restore}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-u2">
            <div className="lk-sheet-h flex flex-none items-start gap-2.5 py-1 pr-1 pl-3">
              <div className="min-w-0 flex-1">
                <D.Title asChild><Heading level="section" as="h2" className="leading-8">{title}</Heading></D.Title>
                {sub && <p className="lk-sheet-sub text-ctl-s">{sub}</p>}
              </div>
              <D.Close asChild>
                <IconButton icon="close" label={t("ui.sheet.closeAria")} size="s" tip={false} />
              </D.Close>
            </div>
            {tools && <div className="flex flex-none flex-col gap-2.5 px-3">{tools}</div>}
            <div className="lk-pit min-h-0 flex-1 overflow-y-auto py-3 pr-2 pl-3 [scrollbar-gutter:stable]">{children}</div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
