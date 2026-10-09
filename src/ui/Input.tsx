import type { ComponentProps, Ref } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName, Size } from "./types";
import { flag } from "./util";
import { IconButton } from "./Button";
import { useFieldProps } from "./Field";

type FieldSize = Extract<Size, "s" | "m">;

/** Höhe und Abstand je Größe (Tailwind); ein `className` am Feld (z. B. `w-64`, `flex-1`) überstimmt sie. `--in-h` = Feldhöhe für den Leeren-Knopf. */
const BOX: Record<FieldSize, string> = {
  s: "h-ctl-s px-2.5 text-ctl-m [--in-h:var(--lk-h-s)]",
  m: "h-ctl-m px-3 text-ctl-m [--in-h:var(--lk-h-m)]",
};
const SLOT = "lk-input lk-slot relative flex items-center gap-1.5";
const FIELD = "h-full min-w-0 flex-1 p-0";

/**
 * Eingabefeld: eingelassener Slot (`lk-slot`) mit optionalem führendem Symbol, Aussehen aus look.css (`lk-input`).
 * `className` geht an den Slot, alle übrigen Props und `ref` an das <input>. Die Breite regelt der Aufrufer (`w-full`, `w-64`).
 * In einem Field/FormRow bekommt es id, aria-describedby und aria-invalid automatisch.
 */
export function Input({ size = "m", icon, className, ref, ...props }: {
  size?: FieldSize;
  icon?: IconName;
  ref?: Ref<HTMLInputElement>;
} & Omit<ComponentProps<"input">, "size" | "ref">) {
  const input = useFieldProps(props);
  return (
    <label className={cn(SLOT, BOX[size], icon && "gap-1 pl-2", className)} data-lead={flag(icon)}>
      {icon && <Icon name={icon} size="s" />}
      <input ref={ref} autoComplete="off" spellCheck={false} className={FIELD} {...input} />
    </label>
  );
}

/** Mehrzeilig (Konsole-Schrift), ohne Größenziehen. */
export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  const input = useFieldProps(props);
  return (
    <label className={cn(SLOT, "items-stretch p-2.5", className)}>
      <textarea spellCheck={false} className="min-h-[84px] min-w-0 flex-1 resize-none font-mono text-[calc(13px*var(--tz))] leading-normal" {...input} />
    </label>
  );
}

/** Suchfeld mit Lupe und Leeren-Knopf (Symbolknopf s, nur bei Inhalt sichtbar; Platz bleibt). Esc leert. */
export function SearchField({ value, onChange, placeholder, size = "m", autoFocus, label, id, className }: {
  value: string; onChange: (v: string) => void; placeholder: string; size?: FieldSize; autoFocus?: boolean; label?: string; id?: string; className?: string;
}) {
  const { t } = useI18n();
  const f = useFieldProps({ id });
  return (
    <label className={cn(SLOT, BOX[size], "gap-1 pl-2", className)} data-lead="">
      <Icon name="search" size="s" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        className={FIELD}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
        {...f}
      />
      {/* Kante = Höhe − 4 Einheiten (1 Einheit Luft zum Rand); Platz bleibt, auch wenn der Knopf verborgen ist */}
      <IconButton
        icon="close"
        label={t("ui.search.clearAria")}
        tip={false}
        size="s"
        tabIndex={-1}
        className={cn("size-[calc(var(--in-h)-var(--px)*4)] -mr-[calc(12px-var(--px))] [--b-h:calc(var(--in-h)-var(--px)*4)]", !value && "invisible")}
        onClick={() => onChange("")}
      />
    </label>
  );
}
