import { useState, type ComponentProps, type ReactNode } from "react";
import type { ConfirmDialog } from "@/ui";

type ConfirmProps = ComponentProps<typeof ConfirmDialog>;

/** Was die Rückfrage zu einem Ziel sagt und tut; `close` schließt sie nach getaner Arbeit. */
export type ConfirmSpec<T> = {
  title: (target: T) => string;
  text?: (target: T) => ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: (target: T, close: () => void) => void;
};

/**
 * Props für ein `ConfirmDialog` über einem Ziel (`null` = geschlossen). Für Ziele, die nicht im Komponenten-State liegen
 * (z. B. in einem Store); sonst `useConfirmTarget`.
 */
export function confirmTargetProps<T>(target: T | null, close: () => void, spec: ConfirmSpec<T>): ConfirmProps {
  return {
    open: target !== null,
    onOpenChange: (open) => !open && close(),
    title: target === null ? "" : spec.title(target),
    text: target === null ? undefined : spec.text?.(target),
    confirmLabel: spec.confirmLabel,
    pending: spec.pending,
    onConfirm: () => target !== null && spec.onConfirm(target, close),
  };
}

/**
 * Lösch- bzw. Rückfrage-Ziel einer Liste: `ask(item)` öffnet die Rückfrage, `dialogProps(spec)` gehört an ein `ConfirmDialog`.
 * Wer fertig ist (z. B. `onSuccess` der Mutation), ruft das übergebene `close`.
 */
export function useConfirmTarget<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const close = () => setTarget(null);
  return { target, ask: setTarget, close, dialogProps: (spec: ConfirmSpec<T>) => confirmTargetProps(target, close, spec) };
}
