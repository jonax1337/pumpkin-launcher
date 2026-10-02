import { useEffect } from "react";
import { useSettings, type TextSize } from "@/store/settings";

/** Faktor je Stufe, mit dem der Text wächst (CSS: `--tz`, siehe ui/a11y.css). */
const TEXT_SCALE: Record<TextSize, number> = { m: 1, l: 1.125, xl: 1.25 };

/** Reicht Bewegung (`data-motion`) und Textgröße (`--tz`) an das Wurzelelement weiter, damit das Stylesheet sie kennt. */
export function useAppearance() {
  const motion = useSettings((s) => s.motion);
  const textSize = useSettings((s) => s.textSize);
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "on" : "off";
  }, [motion]);
  useEffect(() => {
    document.documentElement.style.setProperty("--tz", String(TEXT_SCALE[textSize]));
  }, [textSize]);
}
