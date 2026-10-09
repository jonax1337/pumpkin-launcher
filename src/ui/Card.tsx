import { useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Tooltip as T } from "radix-ui";
import { ContextMenu, type MenuEntry } from "./Menu";
import { TIP_DELAY_MS } from "./Tip";
import { cn } from "@/lib/utils";
import { Chip } from "./Chip";
import { PixelScene } from "@/pixel/PixelScene";
import type { Biome } from "@/pixel/scene";
import { HitEl, type Hit } from "./Hit";
import { Icon } from "./Icon";
import { cssVars, flag, isOverflowing } from "./util";

/** Aussehen einer Instanz: Biom, Seed der Szene, Akzent (--acc). */
export type SceneLook = { bio: Biome; seed: number; acc?: string };

/** Nur Vorschau (/_kit): Zustand erzwingen. */
type ForcedState = "hover" | "press" | "focus";


export type SceneCardProps = {
  look: SceneLook;
  /** Quadratisches Instanz-Icon neben der Beschriftung; die Landschaft bleibt unabhängig davon sichtbar. */
  art?: ReactNode;
  title: string;
  /** Unterzeile in der Bildunterschrift. */
  sub?: string;
  /** Status-Chip oben links (nur Ausnahmen, siehe Statusmodell). */
  status?: ReactNode;
  /** Hauptaktion (Spielen) oben rechts, sichtbar bei Hover/Fokus. */
  primary?: ReactNode;
  hit: Hit;
  /** „aktuell“: Akzentbalken unten (mini), aria-current am Knopf. */
  current?: boolean;
  /** Kontextmenü (Rechtsklick). */
  menu?: MenuEntry[];
  /** Bedienhinweis im Tooltip; der volle Titel erscheint dort nur, wenn er abgeschnitten ist. */
  tip?: ReactNode;
  /** Seite des Tooltips (Standard oben); der Hinweis fängt nie den Zeiger ab. */
  tipSide?: "top" | "bottom";
  className?: string;
  "data-force"?: ForcedState;
};

const cardStyle = (look: SceneLook) => cssVars({ "--acc": look.acc });

/** Landschaft mit Rahmenlicht; das Instanz-Icon bleibt in der Beschriftung unverzerrt. */
function SceneMedia({ look }: { look: SceneLook }) {
  return (
    <span className="vx-card-media">
      <PixelScene bio={look.bio} seed={look.seed} className="vx-art" />
      <span className="vx-card-frame" />
    </span>
  );
}

/**
 * Trefferfläche der Karte mit Tooltip: voller Titel und Unterzeile nur, wenn sie abgeschnitten sind;
 * der Bedienhinweis `tip` immer.
 */
function CardHit({ hit, title, sub, tip, tipSide = "top", current, pressed, titleRef, subRef }: {
  hit: Hit; title: string; sub?: string; tip?: ReactNode; tipSide?: "top" | "bottom"; current?: boolean; pressed?: boolean;
  titleRef: RefObject<HTMLElement | null>; subRef?: RefObject<HTMLElement | null>;
}) {
  const [truncated, setTruncated] = useState<{ title: boolean; sub: boolean } | null>(null);
  const onOpenChange = (open: boolean) => {
    if (!open) return setTruncated(null);
    const state = { title: isOverflowing(titleRef.current), sub: isOverflowing(subRef?.current ?? null) };
    if (state.title || state.sub || tip != null) setTruncated(state);
  };
  return (
    <T.Root open={!!truncated} onOpenChange={onOpenChange} delayDuration={TIP_DELAY_MS}>
      <T.Trigger asChild>
        <HitEl hit={hit} fallbackLabel={title} current={current} pressed={pressed} />
      </T.Trigger>
      <T.Portal>
        <T.Content className="vx-tip" data-pass="" side={tipSide} sideOffset={8} collisionPadding={8}>
          {truncated?.title && <span className="vx-tt">{title}</span>}
          {truncated?.sub && <span className="vx-tt-s">{sub}</span>}
          {tip != null && <span className="vx-tt-h">{tip}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/**
 * Szenenkarte: breite Pixel-Landschaft, Instanz-Icon und Bildunterschrift, und eine
 * Trefferfläche (`hit`, Link oder Knopf) über allem. Platte mit Bildrahmen (Slot) und Namensschild; Hover hellt den Rand auf, „aktuell“ färbt die Platte in der Akzentfarbe.
 * Fokusring an der Karte (über Rahmen und Bildunterschrift).
 */
export function SceneCard({ look, art, title, sub, status, primary, hit, current, menu, tip, tipSide = "top", className, "data-force": force }: SceneCardProps) {
  const titleRef = useRef<HTMLElement>(null);
  const subRef = useRef<HTMLElement>(null);
  const card = (
    <div
      className={cn("vx-card", className)}
      data-variant="mini"
      data-bio={look.bio}
      data-cur={flag(current)}
      data-force={force}
      style={cardStyle(look)}
    >
      <SceneMedia look={look} />
      <span className="vx-card-cap vx-stone">
        {art && <span className="vx-card-icon" aria-hidden>{art}</span>}
        <span className="vx-card-copy">
          <b ref={titleRef}>{title}</b>
          {sub && <span ref={subRef}>{sub}</span>}
        </span>
      </span>
      {status && <span className="vx-card-st">{status}</span>}
      <CardHit hit={hit} title={title} sub={sub} tip={tip} tipSide={tipSide} current={current} titleRef={titleRef} subRef={subRef} />
      {primary && <div className="vx-card-tr">{primary}</div>}
    </div>
  );
  return menu ? <ContextMenu items={menu}>{card}</ContextMenu> : card;
}

/**
 * Szenenwahl-Karte 96×64 mit dem Namen darunter. „gewählt“ (`pressed`): Akzentring, aria-pressed am Knopf.
 * Fokus auf Gewähltem = Doppelring.
 */
export function ThumbCard({ look, title, pressed, hit, className, "data-force": force }: {
  look: SceneLook; title: string; pressed?: boolean; hit: Hit; className?: string; "data-force"?: ForcedState;
}) {
  const titleRef = useRef<HTMLElement>(null);
  return (
    <div className={cn("vx-card", className)} data-variant="thumb" data-bio={look.bio} data-pressed={flag(pressed)} data-force={force} style={cardStyle(look)}>
      <SceneMedia look={look} />
      <span className="vx-card-t" ref={titleRef}>{title}</span>
      <CardHit hit={hit} title={title} pressed={!!pressed} titleRef={titleRef} />
    </div>
  );
}

/** Kachel „Neu …“ in Wallpaper-Größe (256×144): Platte, Icon über der Beschriftung. */
export function AddCard({ label, className, type = "button", ...props }: { label: string } & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type={type} className={cn("vx-add fx", className)} {...props}>
      <span className="vx-add-in">
        <Icon name="plus" size="m" />
        {label}
      </span>
    </button>
  );
}

/** Quadratische Auswahlkachel (Pixel-Icon, Farbe): Platte, „gewählt“ mit Akzentrahmen. Der Name ist Pflicht, er steht als aria-label und Tooltip am Knopf. */
export function PickTile({ label, pressed, size = 48, onClick, children }: {
  label: string; pressed: boolean; size?: 32 | 48; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" className="vx-pick fx" data-size={size} aria-pressed={pressed} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** Raster für Bildkarten (auto-fill ab 188 px, Lücke 14), thumb (umbrechende Reihe, Lücke 12) oder pick (Auswahlkarten 160–200 px, Lücke 16). */
export function CardGrid({ variant = "poster", className, children, ...props }: { variant?: "poster" | "thumb" | "pick" } & ComponentProps<"div">) {
  return (
    <div className={cn("vx-cards", className)} data-variant={variant} {...props}>
      {children}
    </div>
  );
}

/** Kleine Szene als Bild (Listenzeile 44, Menüeintrag 28): Slot-Rand um das Bild. */
export function SceneThumb({ bio, seed, size = 44, art, className }: {
  bio: Biome; seed: number; size?: 28 | 44; art?: ReactNode; className?: string;
}) {
  return (
    <span className={cn("vx-sthumb", className)} data-size={size} aria-hidden>
      {art ? <span className="vx-art">{art}</span> : <PixelScene bio={bio} seed={seed} className="vx-art" />}
    </span>
  );
}

export type ChoiceProps = {
  /** m: 56 px (Listen im Dialog) · l: 72 px, Platte (Onboarding) */
  size?: "m" | "l";
  /** Glyphe/Projektbild links (m: Spalte 40, l: 48). */
  media?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** Rechts: Zahl, Chip o. Ä. */
  trail?: ReactNode;
  selected: boolean;
  /** radio: in einer radiogroup (aria-checked) · button: Umschalter (aria-pressed) */
  role?: "radio" | "button";
} & Omit<ComponentProps<"button">, "title" | "role">;

/**
 * Auswahlzeile/-karte. Hover-Platte --hv-row, gewählt = Akzentrahmen (2 Einheiten) + Tönung + ▶,
 * Druck: Fläche eingelassen, Inhalt 1 Einheit tiefer. Fokus auf Gewähltem: Doppelring.
 */
export function Choice({ size = "m", media, title, sub, trail, selected, role = "button", className, type = "button", ...props }: ChoiceProps) {
  const sel = role === "radio" ? { role: "radio" as const, "aria-checked": selected } : { "aria-pressed": selected };
  return (
    <button type={type} className={cn("vx-choice fx", className)} data-size={size} data-selected={flag(selected)} {...sel} {...props}>
      <span className="vx-choice-m">{media}</span>
      <span className="vx-choice-t">
        <b>{title}</b>
        {sub != null && <span>{sub}</span>}
      </span>
      {trail != null && <span className="vx-choice-r">{trail}</span>}
    </button>
  );
}

export type PickCardProps = {
  /** Bild oben im Slot (Umhang, Skin …). */
  media: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** Marke oben links im Bild, solange die Karte gewählt ist (z. B. „Aktiv“). */
  flag?: ReactNode;
  selected: boolean;
} & Omit<ComponentProps<"button">, "title" | "role">;

/**
 * Auswahlkarte für radiogroups: Bild im eingelassenen Slot, darunter Name und Zusatz. Gewählt = Akzentrahmen + Tönung + Marke
 * mit Haken (`flag`), Fokus auf Gewähltem = Doppelring. Pfeiltasten legt der Container fest (`useRovingItems`, `item=".vx-pickcard"`).
 */
export function PickCard({ media, title, sub, flag: flagText, selected, className, type = "button", ...props }: PickCardProps) {
  return (
    <button type={type} role="radio" aria-checked={selected} className={cn("vx-pickcard fx", className)} data-selected={flag(selected)} {...props}>
      <span className="vx-pickcard-pic vx-pit">
        {media}
        {selected && flagText != null && <Chip className="vx-pickcard-flag" tone="acc" icon="check" size="s">{flagText}</Chip>}
      </span>
      <b>{title}</b>
      {sub != null && <small>{sub}</small>}
    </button>
  );
}

export type PanelProps = {
  /** plate: Grund --panel (Standard) · raised: --panel-2, Licht · sunk: eingelassen */
  level?: "plate" | "raised" | "sunk";
  /** Kerbe: 1 Stufe (Standard) oder 2 (große Flächen) */
  notch?: 1 | 2;
  /** Innenabstand 12 / 16 / 24 px; ohne Angabe keiner. */
  pad?: "s" | "m" | "l";
  as?: "div" | "section" | "article" | "aside" | "li";
} & ComponentProps<"div">;

/**
 * Platte mit Bevel und Kerbe. Setzt den Overlay-Kontext (Hover/Auswahl darin eine Stufe heller, tokens.css).
 */
export function Panel({ level = "plate", notch = 1, pad, as: Tag = "div", className, children, ...props }: PanelProps) {
  const El = Tag as "div";
  return (
    <El className={cn("vx-panel", className)} data-level={level} data-notch={notch} data-pad={pad} {...props}>
      {children}
    </El>
  );
}
