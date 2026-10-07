import type { ComponentProps, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";
import { Icon } from "./Icon";
import { Count } from "./Chip";
import { Progress } from "./Feedback";
import { flag, hasContent, widthStyle } from "./util";
import type { Compact, IconName, Size, Tone } from "./types";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonLook = {
  /** primary = Akzentblock, secondary = Platte (Standard), ghost = nur Text (Hover-Platte), danger = roter Block */
  variant?: ButtonVariant;
  /** Höhe 32 / 40 / 56 px; bestimmt Icon-Slot (s/m/l), Schrift und Innenabstand. */
  size?: Size;
  icon?: IconName;
  iconEnd?: IconName;
  /** Textfarbe für Geist/Sekundär; Geist-Hover wird leicht getönt. */
  tone?: Extract<Tone, "acc" | "warn" | "bad">;
  /** Feste Breite in px (Inhalt zentriert) oder volle Breite. */
  width?: number | "full";
  /** Zahl nach der Beschriftung (Pixelschrift). */
  count?: number;
  /** Unter dieser Fensterbreite nur Symbol + Zahl; die Beschriftung bleibt für Vorleser. */
  compactBelow?: Compact;
  /** Über einer Szene: Grundplatte dauerhaft, harter Schatten. */
  onScene?: boolean;
  /** Innenabstand nach außen ziehen, damit Text/Symbol bündig mit der Kante darüber/darunter steht. */
  bleed?: "start" | "end";
};

const isBlock = (v: ButtonVariant) => v === "primary" || v === "danger";

/** Trennt die Look-Props von den übrigen Props des Elements. */
function splitLook<P extends ButtonLook>({ variant, size, icon, iconEnd, tone, width, count, compactBelow, onScene, bleed, ...rest }: P): [ButtonLook, Omit<P, keyof ButtonLook>] {
  return [{ variant, size, icon, iconEnd, tone, width, count, compactBelow, onScene, bleed }, rest];
}

/** data-* des Aussehens; Größe/Variante stehen immer da (CSS rechnet nicht mit Vorgaben). */
function lookData({ variant = "secondary", size = "m", icon, tone, width, compactBelow, onScene, bleed }: ButtonLook) {
  return {
    "data-variant": variant,
    "data-size": size,
    "data-tone": tone,
    "data-lead": flag(icon),
    "data-w": width === "full" ? "full" : undefined,
    "data-compact": compactBelow,
    "data-scene": flag(onScene),
    "data-bleed": bleed,
  };
}

function Inner({ variant = "secondary", size = "m", icon, iconEnd, count, compactBelow, children }: ButtonLook & { children?: ReactNode }) {
  return (
    <>
      {isBlock(variant) && <span className="vx-bf" aria-hidden />}
      <span className="vx-bc">
        {icon && <Icon name={icon} size={size} />}
        {hasContent(children) && (compactBelow ? <span className="vx-lab">{children}</span> : children)}
        {count != null && <Count value={count} />}
        {iconEnd && <Icon name={iconEnd} size={size} edge="end" />}
      </span>
    </>
  );
}

/**
 * Knopf des Kits. Sockel + Fläche mit Bevel (primär/Gefahr), Platte (sekundär) oder Hover-Platte (Geist).
 * Props und ref gehen an das <button> (Radix asChild).
 */
export function Button({ className, style, type = "button", children, ...props }: ButtonLook & ComponentProps<"button">) {
  const [look, rest] = splitLook(props);
  return (
    <button type={type} className={cn("vx-btn fx", className)} {...lookData(look)} style={widthStyle(look.width, style)} {...rest}>
      <Inner {...look}>{children}</Inner>
    </button>
  );
}

/** Knopf-Optik als Link (react-router). */
export function ButtonLink({ className, style, children, ...props }: ButtonLook & LinkProps & { ref?: Ref<HTMLAnchorElement> }) {
  const [look, rest] = splitLook(props);
  return (
    <Link className={cn("vx-btn fx", className)} {...lookData(look)} style={widthStyle(look.width, style)} {...rest}>
      <Inner {...look}>{children as ReactNode}</Inner>
    </Link>
  );
}

type IconButtonLook = Omit<ButtonLook, "icon" | "iconEnd" | "width" | "count" | "compactBelow" | "bleed">;

/**
 * Quadratischer Symbolknopf (32/40/56), Standard Geist. `label` ist der zugängliche Name;
 * der Tooltip zeigt `tip` (Standard: label), `tip={false}` schaltet ihn ab.
 */
export function IconButton({ icon, label, tip, variant = "ghost", size, tone, onScene, className, type = "button", ...props }: IconButtonLook & {
  icon: IconName;
  label: string;
  tip?: string | false;
} & Omit<ComponentProps<"button">, "aria-label" | "children">) {
  const look = { variant, size, icon, tone, onScene };
  // Der Symbolknopf ist quadratisch: ohne die Einrückung für ein führendes Icon (data-lead)
  const btn = (
    <button type={type} className={cn("vx-btn vx-ib fx", className)} {...lookData(look)} data-lead={undefined} aria-label={label} {...props}>
      <Inner {...look} />
    </button>
  );
  return tip === false ? btn : <Tip label={tip ?? label}>{btn}</Tip>;
}

/** Zurück-Link über einer Überschrift („‹ Bibliothek“): Geist s, bündig mit der Überschrift. */
export function BackLink({ children, onScene, to, onClick }: { children: ReactNode; onScene?: boolean } & ({ to: string; onClick?: never } | { to?: never; onClick: () => void })) {
  const data = lookData({ variant: "ghost", size: "s", icon: "chev", onScene, bleed: "start" });
  const inner = (
    <span className="vx-bc">
      <Icon name="chev" size="s" flip="x" />
      {children}
    </span>
  );
  return to != null ? (
    <Link to={to} className="vx-btn fx" {...data}>{inner}</Link>
  ) : (
    <button type="button" onClick={onClick} className="vx-btn fx" {...data}>{inner}</button>
  );
}

type BarLook = {
  current?: boolean;
  expanded?: boolean;
  children: ReactNode;
  className?: string;
  /** Sichtbare Beschriftung nach dem Inhalt (höchstens 124 px, Auslassung); der Name gehört ins aria-label. */
  label?: ReactNode;
  /** Beschriftung in Warnfarbe (z. B. „Spielername fehlt“). */
  tone?: Extract<Tone, "warn">;
  /** Symbol nach der Beschriftung (Icon s, z. B. Menüpfeil). */
  iconEnd?: IconName;
  /**
   * Laufende Arbeit (Aufgaben): feste Breite 56, Symbol links. Bei `count` > 0 Zähler-Plakette rechts und Mini-Balken
   * unter dem Symbol (`p` 0–1, null = unbestimmt); der Platz bleibt immer, nichts verschiebt sich.
   */
  activity?: { count: number; p: number | null };
  /** Für die Seitenleiste: 44 px quadratisch, nur Symbol; aktiv durch Fläche und Iconfarbe. */
  side?: boolean;
  /** Zähler-Plakette an der Ecke, nur bei mehr als 0. Sie ist stumm: die Zahl gehört in den zugänglichen Namen (aria-label). */
  badge?: number;
};

function barData({ label, tone, activity, side }: Pick<BarLook, "label" | "tone" | "activity" | "side">) {
  return {
    "data-side": flag(side),
    "data-tone": label != null ? tone : undefined,
    "data-activity": activity ? (activity.count > 0 ? "busy" : "") : undefined,
  };
}

/** Größte Zahl in der Zähler-Plakette; darüber steht „9+“. */
const MAX_BADGE_COUNT = 9;

const badgeText = (count: number) => (count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : count);

function BarInner({ children, label, iconEnd, activity, badge, side }: Pick<BarLook, "children" | "label" | "iconEnd" | "activity" | "badge" | "side">) {
  return (
    <>
      <span className="vx-bc">
        {children}
        {label != null && <span className="vx-bar-lab">{label}</span>}
        {iconEnd && <Icon name={iconEnd} size="s" />}
      </span>
      {!side && <span className="vx-tick" aria-hidden />}
      {activity && (
        <>
          <span className="vx-bar-badge" aria-hidden>{badgeText(activity.count)}</span>
          <Progress thin p={activity.p} decorative className="vx-bar-meter" />
        </>
      )}
      {badge != null && badge > 0 && <span className="vx-bar-badge" data-always aria-hidden>{badgeText(badge)}</span>}
    </>
  );
}

type BarLinkProps = { to: string } & Omit<LinkProps, "to" | "children" | "className"> & { ref?: Ref<HTMLAnchorElement> };
type BarPlainProps = { to?: undefined } & Omit<ComponentProps<"button">, "children" | "className">;

/**
 * Knopf in der Fensterleiste (36 px): Hover-Platte, `current` = Platte + Kupferstrich (aktueller Bereich),
 * `expanded` = offen (Menü). Mit `to` ein Link. `label`/`tone`/`iconEnd`: Konto-Knopf; `activity`: Aufgaben.
 */
export function BarButton(props: BarLook & (BarLinkProps | BarPlainProps)) {
  const { current, expanded, className, children, label, tone, iconEnd, activity, side, badge, ...target } = props;
  const common = {
    className: cn("vx-bar fx", className),
    ...barData({ label, tone, activity, side }),
    "aria-current": current ? ("page" as const) : undefined,
    "aria-expanded": expanded,
  };
  const inner = <BarInner label={label} iconEnd={iconEnd} activity={activity} badge={badge} side={side}>{children}</BarInner>;
  return target.to != null ? (
    <Link {...common} {...target}>{inner}</Link>
  ) : (
    <button type="button" {...common} {...target}>{inner}</button>
  );
}

/**
 * Nur die Klassen (für Fremdbausteine, die keine Props durchreichen, z. B. Sonner-Aktionsknöpfe).
 * Nur Geist/Sekundär: primär braucht die Fläche als eigenes Element (Button).
 */
export function buttonClass({ variant = "secondary", size = "m", tone, onScene }: Pick<ButtonLook, "size" | "tone" | "onScene"> & { variant?: "secondary" | "ghost" } = {}) {
  return cn("vx-btn fx", `vx-btn--${variant}`, size !== "m" && `vx-btn--${size}`, tone && `vx-btn--${tone}`, onScene && "vx-btn--scene");
}
