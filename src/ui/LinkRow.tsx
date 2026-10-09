import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName } from "./types";

/** Eingelassene Fläche für `LinkRow`s: die Zeilen stehen ohne Abstand untereinander, eine Haarlinie trennt sie. */
export function LinkList({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("lk-slot grid p-0", className)} {...props} />;
}

/**
 * Eine Zeile der Linkliste (Knopf): Symbol, Name mit Zusatzzeile, Pfeil rechts (`external` = nach außen, sonst weiter).
 * Gehört in eine `LinkList`; `onClick` öffnet die Seite oder einen Dialog.
 */
export function LinkRow({ icon, label, hint, external = true, className, ...props }: {
  icon: IconName; label: ReactNode; hint?: ReactNode; external?: boolean;
} & Omit<ComponentProps<"button">, "children">) {
  return (
    <button
      type="button"
      className={cn("lk-linkrow fx grid min-h-12 w-full grid-cols-[24px_minmax(0,1fr)_24px] items-center gap-2 px-3 text-left", className)}
      {...props}
    >
      <Icon name={icon} size="s" />
      <span className="grid min-w-0 gap-0.5 py-2">
        <span>{label}</span>
        {hint && <small className="lk-linkrow-hint text-ctl-s">{hint}</small>}
      </span>
      <Icon name={external ? "external" : "chev-right"} size="s" className="lk-linkrow-out" />
    </button>
  );
}
