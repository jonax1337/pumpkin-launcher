import { useState } from "react";
import { Disclosure, Hint, TextArea } from "@/ui";

/**
 * Aufklappbares Textfeld für Startargumente (JVM oder Spiel), je Leerzeichen ein Argument. Klappt von selbst auf, wenn es
 * schon welche gibt; `onCommit` meldet den Text beim Verlassen des Felds.
 */
export function ArgsField({ label, hint, hintId, placeholder, rows, args, disabled, onCommit }: {
  label: string; hint: string; hintId: string; placeholder: string; rows: number; args: string[]; disabled: boolean;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(args.join(" "));
  return (
    <Disclosure summary={label} open={args.length > 0}>
      <TextArea
        rows={rows}
        aria-label={label}
        aria-describedby={hintId}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
      />
      <Hint id={hintId} className="mt-1.5">{hint}</Hint>
    </Disclosure>
  );
}
