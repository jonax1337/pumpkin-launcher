import { useLayoutEffect, useRef } from "react";

/**
 * Ref auf den neuesten Wert, den Timer und Ereignisbehandlungen lesen, ohne dass sie neu angelegt werden.
 * Gesetzt wird nach dem Rendern statt währenddessen: ein abgebrochenes Rendern lässt den Wert unberührt.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
