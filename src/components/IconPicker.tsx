import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { toastError } from "@/lib/toast";
import { squareIcon } from "@/lib/image";
import { GLYPH_NAMES, GLYPH_PALETTES, PALETTE_NAMES } from "@/pixel/icons";
import type { IconChoice } from "@/lib/types";
import { ArtFrame, Button, cssVars, Glyph, Hint, PickTile, Segmented } from "@/ui";

type Mode = "auto" | "glyph" | "image";
type GlyphChoice = Extract<IconChoice, { type: "glyph" }>;

const modeOf = (icon: IconChoice | null): Mode => icon?.type ?? "auto";

const DEFAULT_GLYPH: GlyphChoice = { type: "glyph", glyph: GLYPH_NAMES[0], palette: PALETTE_NAMES[0] };

function GlyphChooser({ icon, onChange }: { icon: GlyphChoice; onChange: (icon: IconChoice) => void }) {
  const { t } = useI18n();
  return (
    <>
      <div role="group" aria-label={t("components.icon.paletteGroup")} className="ip-tiles">
        {PALETTE_NAMES.map((palette) => (
          <PickTile
            key={palette}
            size={32}
            label={t(`components.icon.palette.${palette}`)}
            pressed={palette === icon.palette}
            onClick={() => onChange({ ...icon, palette })}
          >
            <span className="block size-4 bg-(--sw) shadow-[inset_0_0_0_var(--px)_rgba(3,5,10,0.9)]" style={cssVars({ "--sw": GLYPH_PALETTES[palette].a })} />
          </PickTile>
        ))}
      </div>
      <div role="group" aria-label={t("components.icon.glyphGroup")} className="ip-tiles">
        {GLYPH_NAMES.map((glyph) => (
          <PickTile key={glyph} label={t(`components.icon.glyph.${glyph}`)} pressed={glyph === icon.glyph} onClick={() => onChange({ ...icon, glyph })}>
            <Glyph name={glyph} pal={icon.palette} box={40} />
          </PickTile>
        ))}
      </div>
    </>
  );
}

function ImageChooser({ icon, onChange }: { icon: IconChoice | null; onChange: (icon: IconChoice) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  function choose(file: File | undefined) {
    if (!file) return;
    squareIcon(file)
      .then((src) => onChange({ type: "image", src }))
      .catch(() => toastError(new Error(t("components.icon.imageError"))));
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          // Dieselbe Datei soll sich erneut wählen lassen.
          e.target.value = "";
        }}
      />
      <div>
        <Button onClick={() => input.current?.click()}>
          {icon?.type === "image" ? t("components.icon.changeImage") : t("components.icon.pickImage")}
        </Button>
      </div>
      <Hint>{t("components.icon.imageHelp")}</Hint>
    </>
  );
}

/**
 * Auswahl des Instanz-Icons: automatisch (Icon des Modpacks, sonst Pixel-Icon), ein Pixel-Icon in einer Farbe oder ein eigenes Bild.
 * `value` null = automatisch. `preview` zeigt, wie das Icon aussieht (der Aufrufer entscheidet, was „automatisch“ zeigt).
 */
export function IconPicker({ value, onChange, preview }: { value: IconChoice | null; onChange: (icon: IconChoice | null) => void; preview: ReactNode }) {
  const { t } = useI18n();
  const [mode, setMode] = useState(modeOf(value));

  function chooseMode(next: Mode) {
    setMode(next);
    if (next === "auto") onChange(null);
    if (next === "glyph") onChange(value?.type === "glyph" ? value : DEFAULT_GLYPH);
  }

  return (
    <div className="ip">
      <ArtFrame className="size-[72px] [--icon-k:2]">{preview}</ArtFrame>
      <div className="ip-side">
        <Segmented
          label={t("components.icon.modeLabel")}
          value={mode}
          onChange={chooseMode}
          items={[
            { value: "auto", label: t("components.icon.auto") },
            { value: "glyph", label: t("components.icon.pixel") },
            { value: "image", label: t("components.icon.image") },
          ]}
        />
        {mode === "auto" && <Hint>{t("components.icon.autoHelp")}</Hint>}
        {mode === "glyph" && value?.type === "glyph" && <GlyphChooser icon={value} onChange={onChange} />}
        {mode === "image" && <ImageChooser icon={value} onChange={onChange} />}
      </div>
    </div>
  );
}
