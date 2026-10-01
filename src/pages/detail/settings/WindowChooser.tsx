import { useState } from "react";
import { Actions, Radio, TextField } from "@/ui";
import { useI18n } from "@/i18n";
import { blurOnEnter } from "@/lib/dom";
import type { GameWindow } from "@/lib/types";

type Size = { width: number; height: number };

/** Vorschlag, wenn zum ersten Mal „Feste Größe“ gewählt wird. */
const DEFAULT_SIZE: Size = { width: 1280, height: 720 };

/** Breite des Zahlenfelds in px; fünf Stellen reichen für jede Auflösung. */
const SIZE_FIELD_WIDTH = 96;
const SIZE_FIELD_MAX_DIGITS = 5;

const validSize = ({ width, height }: Size) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;

/**
 * Fenster beim Start: wie Minecraft es öffnet, feste Größe oder Vollbild. Die Felder für die Größe bleiben stehen
 * und sind nur gesperrt (wie der Pfad bei Java); sie speichern beim Verlassen, Ungültiges springt zurück.
 */
export function WindowChooser({ value, onChange, disabled }: {
  value: GameWindow; onChange: (window: GameWindow, done?: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const sized = value.type === "size";
  const saved = sized ? value : DEFAULT_SIZE;
  const [width, setWidth] = useState(String(saved.width));
  const [height, setHeight] = useState(String(saved.height));
  const draft = { type: "size" as const, width: Number(width), height: Number(height) };

  function commitSize() {
    if (!validSize(draft)) {
      setWidth(String(saved.width));
      setHeight(String(saved.height));
    } else if (draft.width !== saved.width || draft.height !== saved.height) {
      onChange(draft, t("detail.settings.windowSizeSaved"));
    }
  }

  const sizeField = (label: string, text: string, setText: (v: string) => void) => (
    <TextField
      width={SIZE_FIELD_WIDTH}
      inputMode="numeric"
      maxLength={SIZE_FIELD_MAX_DIGITS}
      aria-label={label}
      disabled={disabled || !sized}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commitSize}
      onKeyDown={blurOnEnter}
    />
  );

  return (
    <>
      <Radio name="inst-window" checked={value.type === "default"} disabled={disabled} onChange={() => onChange({ type: "default" })}>
        {t("format.memoryDefault")} <span className="text-fg-3">({t("detail.settings.windowAsMinecraft")})</span>
      </Radio>
      <Radio
        name="inst-window"
        checked={sized}
        disabled={disabled}
        onChange={() => onChange(draft)}
      >
        {t("detail.settings.windowFixedSize")}
      </Radio>
      <Actions>
        {sizeField(t("detail.settings.windowWidthAria"), width, setWidth)}
        <span className="text-fg-3" aria-hidden>×</span>
        {sizeField(t("detail.settings.windowHeightAria"), height, setHeight)}
      </Actions>
      <Radio
        name="inst-window"
        checked={value.type === "fullscreen"}
        disabled={disabled}
        onChange={() => onChange({ type: "fullscreen" })}
      >
        {t("detail.settings.windowFullscreen")}
      </Radio>
    </>
  );
}
