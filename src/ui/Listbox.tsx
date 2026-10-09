/**
 * Auswahlliste mit Fokus im Eingabefeld (Combobox-Muster, z. B. Befehlspalette): `Listbox` (Fläche), `ListboxGroup` (Gruppe mit Kopf),
 * `ListboxOption` (Eintrag). Gewählt wird nicht per Fokus, sondern über `aria-activedescendant` des Felds: der Aufrufer hält den
 * markierten Eintrag (`active`) und setzt dessen `id` am Feld. Aussehen: look/listbox.css (Rahmen des Item-Tooltips, Einträge wie im
 * Menü), Maße als Tailwind-Utilities hier.
 */
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { MenuLabel } from "./Menu";
import type { IconName } from "./types";
import { flag } from "./util";

/**
 * Fläche der Liste (scrollt, Gutter stabil). Höhe und Füllung wählt der Aufrufer (`className="min-h-0 flex-1"`).
 * `label` ist der zugängliche Name.
 */
export function Listbox({ label, className, ...props }: { label: string } & Omit<ComponentProps<"div">, "role" | "aria-label">) {
  return <div role="listbox" aria-label={label} className={cn("lk-lbx overflow-y-auto p-u2 [scrollbar-gutter:stable]", className)} {...props} />;
}

/** Gruppe mit Kopf (Versalien, wie `MenuLabel`); der Kopf benennt die Gruppe für Vorleser. */
export function ListboxGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <MenuLabel id={id}>{label}</MenuLabel>
      {children}
    </div>
  );
}

/**
 * Eintrag: Symbol `icon`, Name (`children`), Zusatz `sub` darunter, rechts `trail` (Tastenkürzel; für Vorleser versteckt).
 * Mindestens 48 px hoch. `active` = markiert (Fokusbalken links; der Eintrag scrollt dann in den sichtbaren Bereich, unter dem
 * Gruppenkopf bleibt Luft). `disabled` dimmt: gerade nicht ausführbar, der Grund steht als `sub`; der Eintrag bleibt anwählbar.
 * `onActivate`: der Zeiger bewegte sich über dem Eintrag (nur echte Bewegung, ein Scrollen unter ruhendem Zeiger zählt nicht).
 * Ein Mausdruck nimmt dem Feld den Fokus nicht.
 */
export function ListboxOption({ icon, sub, trail, active, disabled, onActivate, className, children, ...props }: {
  icon?: IconName; sub?: ReactNode; trail?: ReactNode; active?: boolean; disabled?: boolean; onActivate?: () => void;
} & Omit<ComponentProps<"div">, "role" | "onMouseMove" | "onMouseDown">) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={!!active}
      aria-disabled={disabled || undefined}
      data-active={flag(active)}
      className={cn("lk-lbx-opt relative flex min-h-12 scroll-mt-8 scroll-mb-1 items-center gap-3 py-1.5 pr-3 pl-2.5", className)}
      onMouseMove={(e) => {
        if (e.movementX !== 0 || e.movementY !== 0) onActivate?.();
      }}
      onMouseDown={(e) => e.preventDefault()}
      {...props}
    >
      {icon && <Icon name={icon} size="s" className="flex-none" />}
      <span className="flex min-w-0 flex-1 flex-col leading-[1.25]">
        <span className="truncate text-ctl-m font-semibold">{children}</span>
        {sub && <span className="lk-lbx-sub truncate text-ctl-s">{sub}</span>}
      </span>
      {trail !== undefined && <span className="flex flex-none gap-1.5" aria-hidden="true">{trail}</span>}
    </div>
  );
}
