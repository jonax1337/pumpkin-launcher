import type { ComponentProps, KeyboardEvent, KeyboardEventHandler, MouseEvent, Ref } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

/**
 * Trefferfläche einer Karte oder Zeile: Link (`to`, Name Pflicht) oder Knopf (`onClick`, Name Standard: Titel).
 * Liegt als Fläche über der ganzen Karte/Zeile und trägt immer die Klasse `hit` (Trunc host=".hit", ContextMenu).
 * Ein Link darf seinen Klick abfangen (`onClick`, z. B. Auswählen statt Öffnen); `preventDefault` hält die Navigation an.
 */
export type Hit =
  | { to: string; label: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }
  | {
    to?: never;
    onClick: () => void;
    onDoubleClick?: () => void;
    onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
    label?: string;
    describedBy?: string;
  };

type HitProps = {
  hit: Hit;
  /** Zugänglicher Name, falls `hit.label` fehlt (Knopf). */
  fallbackLabel: string;
  current?: boolean;
  pressed?: boolean;
  className?: string;
  ref?: Ref<HTMLElement>;
} & Omit<ComponentProps<"button">, "ref" | "className" | "children">;

/** Rendert die Fläche; Props eines Radix-Auslösers (asChild) werden durchgereicht und Handler verkettet. */
export function HitEl({ hit, fallbackLabel, current, pressed, className, ref, onClick, onDoubleClick, onKeyDown, ...rest }: HitProps) {
  const cls = cn("hit fx", className);
  if (hit.to != null) {
    return (
      <Link
        ref={ref as Ref<HTMLAnchorElement>}
        to={hit.to}
        className={cls}
        aria-label={hit.label}
        aria-current={current ? "page" : undefined}
        {...(rest as Omit<ComponentProps<"a">, "ref">)}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          (onClick as unknown as ComponentProps<"a">["onClick"])?.(e);
          hit.onClick?.(e);
        }}
      />
    );
  }
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      className={cls}
      aria-label={hit.label ?? fallbackLabel}
      aria-describedby={hit.describedBy}
      aria-current={current || undefined}
      aria-pressed={pressed != null ? pressed : undefined}
      {...rest}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        hit.onClick();
      }}
      onDoubleClick={(e: MouseEvent<HTMLButtonElement>) => {
        onDoubleClick?.(e);
        hit.onDoubleClick?.();
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(e);
        hit.onKeyDown?.(e);
      }}
    />
  );
}
