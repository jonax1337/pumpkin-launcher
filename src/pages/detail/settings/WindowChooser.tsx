import { useState } from "react";
import { Actions, Radio, Input } from "@/ui";
import { useCommitOnUnmount } from "@/hooks/useCommitOnUnmount";
import { useI18n } from "@/i18n";
import { blurOnEnter } from "@/lib/dom";
import type { GameWindow } from "@/lib/types";

type Size = { width: number; height: number };

/** Vorschlag, wenn zum ersten Mal „Feste Größe“ gewählt wird. */
const DEFAULT_SIZE: Size = { width: 1280, height: 720 };

/** Breite des Zahlenfelds in px; fünf Stellen reichen für jede Auflösung. */
const SIZE_FIELD_WIDTH = "w-24";
const SIZE_FIELD_MAX_DIGITS = 5;

const validSize = ({ width, height }: Size) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;

/**
 * Fenster beim Start: wie Minecraft es öffnet, feste Größe oder Vollbild. Die Felder für die Größe bleiben stehen
 * und sind nur gesperrt (wie der Pfad bei Java); sie speichern beim Verlassen des Felds oder der Seite, Ungültiges springt zurück.
 */
export function WindowChooser({ name, value, onChange, disabled }: {
  name: string; value: GameWindow; onChange: (window: GameWindow, done?: string) => void; disabled?: boolean;
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

  // Nur bei fester Größe: sonst stünde im gesperrten Feld noch ein alter Entwurf, der beim Verlassen die Wahl überschriebe.
  useCommitOnUnmount(() => {
    if (sized) commitSize();
  });

  const sizeField = (label: string, text: string, setText: (v: string) => void) => (
    <Input
      className={SIZE_FIELD_WIDTH}
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
      <Radio name={name} checked={value.type === "default"} disabled={disabled} onChange={() => onChange({ type: "default" })}>
        {t("format.memoryDefault")} <span className="st-muted">({t("detail.settings.windowAsMinecraft")})</span>
      </Radio>
      <Radio
        name={name}
        checked={sized}
        disabled={disabled}
        onChange={() => onChange(draft)}
      >
        {t("detail.settings.windowFixedSize")}
      </Radio>
      <Actions>
        {sizeField(t("detail.settings.windowWidthAria"), width, setWidth)}
        <span className="st-muted" aria-hidden>×</span>
        {sizeField(t("detail.settings.windowHeightAria"), height, setHeight)}
      </Actions>
      <Radio
        name={name}
        checked={value.type === "fullscreen"}
        disabled={disabled}
        onChange={() => onChange({ type: "fullscreen" })}
      >
        {t("detail.settings.windowFullscreen")}
      </Radio>
    </>
  );
}
