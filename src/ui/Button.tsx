import type { ComponentProps, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Tip } from "./Tooltip";
import type { Compact, IconName, Size, Tone } from "./types";
import { flag, hasContent } from "./util";
import { Count } from "./Chip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonLook = {
  /** primary = Steinplatte in der Akzentfarbe, secondary = Steinplatte (Standard), ghost = flach (beim Überfahren ein Slot), danger = rote Steinplatte */
  variant?: ButtonVariant;
  /** Höhe 32 / 40 / 56 px; bestimmt Icon-Slot, Schrift, Innenabstand und Abstand im Knopf. */
  size?: Size;
  icon?: IconName;
  iconEnd?: IconName;
  /** Textfarbe für Geist/Sekundär; Geist-Hover wird leicht getönt. */
  tone?: Extract<Tone, "acc" | "warn" | "bad">;
  /** Zahl nach der Beschriftung (Pixelschrift). */
  count?: number;
  /** Unter dieser Fensterbreite nur Symbol + Zahl; die Beschriftung bleibt für Vorleser. */
  compactBelow?: Compact;
  /** Über einer Szene: Grundplatte dauerhaft, harter Schatten. `"strong"`: Sekundär mit deutlichen Zuständen (Hover heller Rand und Fläche, Druck eingedrückt), wo sich die Szenenfläche sonst kaum ändert. */
  onScene?: boolean | "strong";
  /** Innenabstand nach außen ziehen, damit Text/Symbol bündig mit der Kante darüber/darunter steht. */
  bleed?: "start" | "end";
  /** Die Beschriftung darf umbrechen: die Höhe wächst über das Maß der Größe hinaus, die Breite bleibt höchstens 100 % (lange Beschriftungen in schmalen Containern). */
  wrap?: boolean;
  /** Der Aufrufer legt den Inhalt selbst aus (Zeilen, Balken, Überlagerungen per Tailwind): `children` stehen roh in einer Hülle, die die Platte füllt; `icon`, `iconEnd`, `count` entfallen. Der Innenabstand kommt per `className`; ein gesperrter Knopf dämpft den Inhalt nicht. */
  fill?: boolean;
  /** Laufender Vorgang statt Bedienung (für einen Knopf, der nicht `disabled` ist): Fase dauerhaft umgekehrt wie gedrückt, kein Hover und Druck, Zeiger „Fortschritt“, `aria-busy`. Die Farben der Variante bleiben. */
  busy?: boolean;
  /** Sekundär mit `tone`: auch die helle Fase trägt zu 40 % die Tonfarbe (Statusknopf wie „Beenden“ oder „Erneut starten“). */
  tinted?: boolean;
};

/*
 * Layout (Tailwind). Alle Maße laufen über drei Variablen, die die Größe setzt: --b-h (Höhe), --b-ico (Symbolbox), --b-pad (Innenabstand).
 * Vollständige Klassennamen, damit Tailwind sie findet; ein `className` des Aufrufers (z. B. `w-48`, `px-8`) überstimmt sie.
 */
const BOX: Record<Size, string> = {
  s: "[--b-h:var(--lk-h-s)] [--b-ico:var(--lk-ico-s)] [--b-pad:12px] data-[variant=ghost]:[--b-pad:8px] text-ctl-s",
  m: "[--b-h:var(--lk-h-m)] [--b-ico:var(--lk-ico-m)] [--b-pad:16px] data-[variant=ghost]:[--b-pad:10px] text-ctl-m",
  l: "[--b-h:var(--lk-h-l)] [--b-ico:var(--lk-ico-l)] [--b-pad:24px] data-[variant=ghost]:[--b-pad:16px] text-ctl-l",
};
const GAP: Record<Size, string> = { s: "gap-1.5", m: "gap-2", l: "gap-3" };

/** Kompakt: der Innenabstand schrumpft auf (Höhe − Symbol) / 2 − 1 Einheit, die Beschriftung wird nur noch vorgelesen. */
const COMPACT_PAD = "[--b-pad:calc((var(--b-h)_-_var(--b-ico))_/_2_-_var(--px))]";
const COMPACT: Record<Compact, { box: string; label: string }> = {
  1180: { box: `le-1180:${COMPACT_PAD}`, label: "le-1180:sr-only" },
  1096: { box: `le-1096:${COMPACT_PAD}`, label: "le-1096:sr-only" },
  900: { box: `le-900:${COMPACT_PAD}`, label: "le-900:sr-only" },
};

const BASE = "lk-btn relative inline-flex shrink-0 items-center justify-center whitespace-nowrap h-(--b-h)";
const BLEED = "data-[bleed=start]:-ms-(--b-pad) data-[bleed=end]:-me-(--b-pad)";

/** Steinplatte (surface.css) für alles außer Geist; Geist ist flach und wird erst beim Überfahren zum Slot. */
const STONE = "lk-stone lk-text";

function data({ variant = "secondary", size = "m", icon, tone, onScene, bleed, fill, busy, tinted }: ButtonLook) {
  return {
    "data-variant": variant,
    "data-size": size,
    "data-tone": tone,
    "data-lead": flag(icon),
    "data-scene": onScene === "strong" ? "strong" : flag(onScene),
    "data-bleed": bleed,
    "data-fill": flag(fill),
    "data-busy": flag(busy),
    "data-tint": flag(tinted),
    "aria-busy": busy || undefined,
  };
}

function Inner({ size = "m", icon, iconEnd, count, compactBelow, wrap, fill, children }: ButtonLook & { children?: ReactNode }) {
  // `fill`: der Aufrufer gestaltet den Inhalt selbst; die Hülle füllt die Platte (und trägt den Versatz beim Drücken).
  if (fill) return <span className="lk-bc flex size-full min-w-0 items-center">{children}</span>;
  return (
    <span className={cn("lk-bc inline-flex min-w-0 items-center", GAP[size], wrap && "whitespace-normal [overflow-wrap:anywhere]")}>
      {icon && <Icon name={icon} size={size} />}
      {hasContent(children) && <span className={cn("lk-lab", compactBelow && COMPACT[compactBelow].label)}>{children}</span>}
      {count != null && <Count value={count} />}
      {iconEnd && <Icon name={iconEnd} size={size} edge="end" />}
    </span>
  );
}

/** Klassen der Knopf-Fläche (Maße aus der Größe, Steinplatte außer bei Geist); gemeinsam für `Button` und `ButtonLink`. */
function buttonBox({ variant = "secondary", size = "m", compactBelow, wrap }: ButtonLook) {
  return cn(BASE, BOX[size], BLEED, "px-(--b-pad) data-[lead]:pl-[calc(var(--b-pad)_-_2px)]", compactBelow && COMPACT[compactBelow].box, variant !== "ghost" && STONE, wrap && "h-auto min-h-(--b-h) max-w-full whitespace-normal");
}

/**
 * Knopf: Aussehen aus look.css (`lk-btn`), Layout aus Tailwind. Props und ref gehen an das <button>.
 * Die Breite regelt der Aufrufer per Klasse (`w-full`, `w-40`).
 */
export function Button({ variant = "secondary", size = "m", icon, iconEnd, tone, count, compactBelow, onScene, bleed, wrap, fill, busy, tinted, className, type = "button", children, ...props }: ButtonLook & ComponentProps<"button">) {
  const look = { variant, size, icon, iconEnd, tone, count, compactBelow, onScene, bleed, wrap, fill, busy, tinted };
  return (
    <button type={type} className={cn(buttonBox(look), className)} {...data(look)} {...props}>
      <Inner {...look}>{children}</Inner>
    </button>
  );
}

/** Knopf-Optik als Link (react-router): dieselben Props wie `Button`, dazu die von `Link`. */
export function ButtonLink({ variant = "secondary", size = "m", icon, iconEnd, tone, count, compactBelow, onScene, bleed, wrap, fill, busy, tinted, className, children, ...props }: ButtonLook & LinkProps & { ref?: Ref<HTMLAnchorElement> }) {
  const look = { variant, size, icon, iconEnd, tone, count, compactBelow, onScene, bleed, wrap, fill, busy, tinted };
  return (
    <Link className={cn(buttonBox(look), className)} {...data(look)} {...props}>
      <Inner {...look}>{children as ReactNode}</Inner>
    </Link>
  );
}

/**
 * Zurück-Link über einer Überschrift („‹ Bibliothek“): Geist s mit führendem Pfeil. Auf Seiten bündig mit der Überschrift (`bleed`),
 * über Szenen (`onScene`) steht die Platte selbst. Mit `to` ein Link, mit `onClick` ein Knopf.
 */
export function BackLink({ children, onScene, to, onClick, className }: { children: ReactNode; onScene?: boolean; className?: string } & ({ to: string; onClick?: never } | { to?: never; onClick: () => void })) {
  const look: ButtonLook = { variant: "ghost", size: "s", icon: "chev-left", onScene, bleed: onScene ? undefined : "start" };
  const props = { className: cn(buttonBox(look), className), ...data(look) };
  const inner = <Inner {...look}>{children}</Inner>;
  return to != null ? <Link to={to} {...props}>{inner}</Link> : <button type="button" onClick={onClick} {...props}>{inner}</button>;
}

/**
 * Quadratischer Symbolknopf (32/40/56), Standard Geist. `label` ist der zugängliche Name;
 * der Tooltip zeigt `tip` (Standard: label), `tip={false}` schaltet ihn ab.
 * `solid="bad"`: Geist, dessen Hover und Druck die volle rote Fläche sind (Fenster schließen); in Ruhe bleibt er neutral.
 */
export function IconButton({ icon, label, tip, variant = "ghost", size = "m", tone, onScene, solid, className, type = "button", ...props }: Pick<ButtonLook, "variant" | "size" | "tone" | "onScene"> & {
  icon: IconName;
  label: string;
  tip?: string | false;
  solid?: "bad";
} & Omit<ComponentProps<"button">, "aria-label" | "children">) {
  const btn = (
    <button
      type={type}
      className={cn(BASE, BOX[size], "w-(--b-h) p-0", variant !== "ghost" && STONE, className)}
      {...data({ variant, size, tone, onScene })}
      data-solid={solid}
      aria-label={label}
      {...props}
    >
      <Inner size={size} icon={icon} />
    </button>
  );
  return tip === false ? btn : <Tip label={tip ?? label}>{btn}</Tip>;
}
