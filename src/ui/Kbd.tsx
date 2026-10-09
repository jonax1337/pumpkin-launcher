/**
 * Tastenkappen des Kits: `Kbd` (eine Taste), `KeyCombo` (eine Tastenkombination) und `ShortcutList` (Übersicht: Beschreibung links,
 * Tasten rechts). Aussehen: look/keys.css (Slot, Pixelschrift), Maße als Tailwind-Utilities hier.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** s: 20 px hoch, eckig (in Listenzeilen, Fuß eines Dialogs); m: 24 px hoch, gekerbt (Übersicht). */
const SIZE = {
  s: "h-5 px-1.5 text-[length:calc(15px*var(--tz))]",
  m: "h-6 px-(--u3) text-[length:calc(16px*var(--tz))]",
} as const;

/** Eine Taste als Kappe im Slot, z. B. `Strg`, `K`, `Esc`. `size` s für Zeilen, m (Standard) für die Übersicht. */
export function Kbd({ size = "m", className, ...props }: { size?: keyof typeof SIZE } & ComponentProps<"kbd">) {
  return <kbd className={cn("lk-kbd lk-slot inline-flex items-center whitespace-nowrap", SIZE[size], className)} data-size={size} {...props} />;
}

/** Kombination: jede Taste eine eigene Kappe (`["Strg", "K"]`). */
export function KeyCombo({ keys, size, className }: { keys: readonly string[]; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span className={cn("inline-flex gap-1", className)}>
      {keys.map((key, i) => <Kbd key={i} size={size}>{key}</Kbd>)}
    </span>
  );
}

export type ShortcutRow = {
  label: ReactNode;
  /** Alternativen derselben Aktion; jede Kombination als Liste ihrer Tasten (`[["Strg", "F"], ["/"]]`). */
  combos: readonly (readonly string[])[];
};

/**
 * Gruppe einer Tastenkürzel-Übersicht: Überschrift (Pixelschrift) und darunter Zeilen mit Linie, links die Beschreibung,
 * rechts die Kombinationen. Spalten und Abstand zwischen Gruppen setzt der Aufrufer (`className`, `grid`).
 */
export function ShortcutList({ title, rows, className }: { title: ReactNode; rows: readonly ShortcutRow[]; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <h3 className="lk-keys-h mb-1.5 text-[length:calc(var(--fs-px-m)*var(--tz))] leading-none">{title}</h3>
      <dl className="m-0">
        {rows.map(({ label, combos }, i) => (
          <div key={i} className="lk-keys-row flex min-h-9 items-center justify-between gap-2.5 px-0.5">
            <dt className="text-[length:calc(15px*var(--tz))]">{label}</dt>
            <dd className="m-0 flex flex-none gap-2">
              {combos.map((keys, j) => <KeyCombo key={j} keys={keys} />)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
