/**
 * Leistenknopf des Kits (Fensterleiste 36 px, Seitenleiste 44 px). Aussehen: look/bar.css (lk-bar), Layout: Tailwind hier.
 */
import type { ComponentProps, ReactNode, Ref } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import type { IconName, Tone } from "./types";
import { flag } from "./util";
import { Progress } from "./Feedback";

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

type BarLinkProps = { to: string } & Omit<LinkProps, "to" | "children" | "className"> & { ref?: Ref<HTMLAnchorElement> };
type BarPlainProps = { to?: undefined } & Omit<ComponentProps<"button">, "children" | "className">;

/** Größte Zahl in der Zähler-Plakette; darüber steht „9+“. */
const MAX_BADGE_COUNT = 9;

const BASE = "lk-bar relative isolate inline-flex h-9 min-w-10 flex-none items-center justify-center px-2";
const BAR_SIDE = "size-11 min-w-0 p-0";
const BAR_ACTIVITY = "w-14 justify-start pr-0 pl-1.5";
const BAR_SIDE_ACTIVITY = "justify-center p-0";

const CONTENT = "lk-bc relative inline-flex min-w-0 items-center gap-2";
const CONTENT_ACTIVITY = "-top-[3px]";
const CONTENT_SIDE_ACTIVITY = "top-0";

const LABEL = "lk-bar-lab max-w-[124px] truncate";
const BADGE = "lk-bar-badge absolute top-1/2 right-1 -mt-[9px] box-content grid h-[18px] min-w-[18px] place-items-center px-[3px] text-[16px] leading-none";
const BADGE_SIDE = "-top-1.5 -right-1.5 mt-0 h-4 min-w-3.5 px-0.5";
const METER = "absolute bottom-1 left-[9px] h-(--px) w-[22px]";
const METER_SIDE = "bottom-0.5 left-2.5 w-6";

const badgeText = (count: number) => (count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : count);
const shown = (visible: boolean) => (visible ? "visible" : "invisible");

/**
 * Knopf in der Fensterleiste (36 px) oder Seitenleiste (`side`, 44 px): Hover-Platte, `current` = Slot + Kupfersymbol (aktueller Bereich),
 * `expanded` = offen (Menü). Mit `to` ein Link. `label`/`tone`/`iconEnd`: Konto-Knopf; `activity`: Aufgaben.
 */
export function BarButton(props: BarLook & (BarLinkProps | BarPlainProps)) {
  const { current, expanded, className, children, label, tone, iconEnd, activity, side, badge, ...target } = props;
  const busy = activity != null && activity.count > 0;
  const common = {
    className: cn(BASE, side && BAR_SIDE, activity && (side ? BAR_SIDE_ACTIVITY : BAR_ACTIVITY), className),
    "data-side": flag(side),
    "data-tone": label != null ? tone : undefined,
    "data-activity": activity ? (busy ? "busy" : "") : undefined,
    "aria-current": current ? ("page" as const) : undefined,
    "aria-expanded": expanded,
  };
  const inner = (
    <>
      <span className={cn(CONTENT, activity && (side ? CONTENT_SIDE_ACTIVITY : CONTENT_ACTIVITY))}>
        {children}
        {label != null && <span className={LABEL}>{label}</span>}
        {iconEnd && <Icon name={iconEnd} size="s" />}
      </span>
      {activity && (
        <>
          <span className={cn(BADGE, side && BADGE_SIDE, shown(busy))} aria-hidden>{badgeText(activity.count)}</span>
          <Progress thin p={activity.p} decorative className={cn(METER, side && METER_SIDE, shown(busy))} />
        </>
      )}
      {badge != null && badge > 0 && <span className={cn(BADGE, side && BADGE_SIDE)} aria-hidden>{badgeText(badge)}</span>}
    </>
  );
  return target.to != null ? (
    <Link {...common} {...target}>{inner}</Link>
  ) : (
    <button type="button" {...common} {...target}>{inner}</button>
  );
}
