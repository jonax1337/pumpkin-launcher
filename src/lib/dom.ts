import type { KeyboardEvent } from "react";

/** Für `onKeyDown` von Textfeldern, die erst beim Verlassen speichern: Enter verlässt das Feld. */
export function blurOnEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
}
