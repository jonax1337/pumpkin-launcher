import { useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Tooltip as T } from "radix-ui";
import { ContextMenu, type MenuEntry } from "./Overlay";
import { cn } from "@/lib/utils";
import { PixelScene } from "@/pixel/PixelScene";
import type { Biome } from "@/pixel/scene";
import { HitEl, type Hit } from "./Hit";
import { Icon } from "./Icon";
import type { IconName, Tone } from "./types";

export type { Hit } from "./Hit";

/** Aussehen einer Instanz: Biom, Seed der Szene, Akzent (--acc). */
export type SceneLook = { bio: Biome; seed: number; acc?: string };

export type SceneCardProps = {
  /** poster: 4:5 im Raster (Bibliothek) · mini: 184×104 (Start-Leiste) · thumb: 96×64 mit Namen darunter (Szenenwahl) */
  variant: "poster" | "mini" | "thumb";
  look: SceneLook;
  title: string;
  /** Unterzeile in der Bildunterschrift (nicht bei thumb). */
  sub?: string;
  /** Status-Chip oben links (nur Ausnahmen, siehe Statusmodell). */
  status?: ReactNode;
  /** Symbolknöpfe oben rechts, sichtbar bei Hover/Fokus (poster, mini). */
  actions?: ReactNode;
  /** Hauptaktion (Spielen): poster mittig über dem Titel, mini oben rechts; sichtbar bei Hover/Fokus. */
  primary?: ReactNode;
  hit: Hit;
  /** „aktuell“: Akzentbalken unten (mini), aria-current am Knopf. */
  current?: boolean;
  /** „gewählt“: Kupferring (thumb), aria-pressed am Knopf. */
  pressed?: boolean;
  /** Kontextmenü (Rechtsklick). */
  menu?: MenuEntry[];
  /** Position für die Einblend-Staffel (40 ms je Karte, höchstens 12). */
  index?: number;
  /** Bedienhinweis im Tooltip; der volle Titel erscheint dort nur, wenn er abgeschnitten ist. */
  tip?: ReactNode;
  className?: string;
  /** Nur Vorschau (/_kit): Zustand erzwingen. */
  "data-force"?: "hover" | "press" | "focus";
};

const over = (el: HTMLElement | null) => !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);

/**
 * Szenenkarte: Pixel-Szene mit Rahmenlicht, Bildunterschrift und einer Trefferfläche (`hit`, Link oder Knopf).
 * Hover: eine Hebung (1 Einheit) + helleres Rahmenlicht; Druck setzt ab. Fokus-/Auswahlring an der Karte
 * (über Rahmen und Bildunterschrift), Fokus auf Gewähltem = Doppelring.
 */
export function SceneCard({ variant, look, title, sub, status, actions, primary, hit, current, pressed, menu, index, tip, className, "data-force": force }: SceneCardProps) {
  const tRef = useRef<HTMLElement>(null);
  const sRef = useRef<HTMLElement>(null);
  const [tt, setTt] = useState<{ name: boolean; sub: boolean } | null>(null);
  const thumb = variant === "thumb";
  const onTip = (open: boolean) => {
    if (!open) return setTt(null);
    const name = over(tRef.current), s = over(sRef.current);
    if (name || s || tip != null) setTt({ name, sub: s });
  };
  const style = { "--acc": look.acc, "--i": index != null ? Math.min(index, 12) : undefined } as CSSProperties;

  const card = (
    <div
      className={cn("vx-card", className)}
      data-variant={variant}
      data-bio={look.bio}
      data-cur={current ? "" : undefined}
      data-pressed={pressed ? "" : undefined}
      data-rise={index != null ? "" : undefined}
      data-force={force}
      style={style}
    >
      <span className="vx-card-media">
        <PixelScene bio={look.bio} seed={look.seed} className="vx-art" />
        <span className="vx-card-frame" />
        {!thumb && (
          <span className="vx-card-cap">
            <b ref={tRef}>{title}</b>
            {sub && <span ref={sRef}>{sub}</span>}
          </span>
        )}
      </span>
      {thumb && <span className="vx-card-t" ref={tRef}>{title}</span>}
      {status && !thumb && <span className="vx-card-st">{status}</span>}
      <T.Root open={!!tt} onOpenChange={onTip} delayDuration={450}>
        <T.Trigger asChild>
          <HitEl hit={hit} fallbackLabel={title} current={current} pressed={thumb ? !!pressed : undefined} />
        </T.Trigger>
        <T.Portal>
          <T.Content className="rtip" side="top" sideOffset={8} collisionPadding={8}>
            {tt?.name && <span className="vx-tt">{title}</span>}
            {tt?.sub && <span className="vx-tt-s">{sub}</span>}
            {tip != null && <span className="vx-tt-h">{tip}</span>}
          </T.Content>
        </T.Portal>
      </T.Root>
      {variant === "poster" && primary && <div className="vx-card-mid">{primary}</div>}
      {!thumb && (actions || (variant === "mini" && primary)) && (
        <div className="vx-card-tr">
          {actions}
          {variant === "mini" && primary}
        </div>
      )}
    </div>
  );
  return menu ? <ContextMenu items={menu}>{card}</ContextMenu> : card;
}

/** Kachel „Neu …“ in Kartengröße (mini 184×104 oder poster 4:5): Platte, Icon über der Beschriftung. */
export function AddCard({ label, icon = "plus", variant = "mini", className, type = "button", ...props }: { label: string; icon?: IconName; variant?: "mini" | "poster" } & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type={type} className={cn("vx-add fx", className)} data-variant={variant} {...props}>
      <span className="vx-add-in">
        <Icon name={icon} size="m" />
        {label}
      </span>
    </button>
  );
}

/** Raster für Karten: poster (auto-fill ab 188 px, Lücke 14) oder thumb (umbrechende Reihe, Lücke 12). */
export function CardGrid({ variant = "poster", className, children, ...props }: { variant?: "poster" | "thumb" } & ComponentProps<"div">) {
  return (
    <div className={cn("vx-cards", className)} data-variant={variant} {...props}>
      {children}
    </div>
  );
}

/** Kleine Szene als Bild (Listenzeile 44, Menüeintrag 28): Kerbe, keine Fläche. */
export function SceneThumb({ bio, seed, size = 44, className }: { bio: Biome; seed: number; size?: 28 | 44; className?: string }) {
  return (
    <span className={cn("vx-sthumb", className)} data-size={size} aria-hidden>
      <PixelScene bio={bio} seed={seed} className="vx-art" />
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
 * Auswahlzeile/-karte (ersetzt .pk und .start). Hover-Platte --hv-row, gewählt = Kupferrahmen 1 Einheit + 10 % Tönung,
 * Druck: Fläche eingelassen, Inhalt 1 Einheit tiefer. Fokus auf Gewähltem: Doppelring.
 */
export function Choice({ size = "m", media, title, sub, trail, selected, role = "button", className, type = "button", ...props }: ChoiceProps) {
  const sel = role === "radio" ? { role: "radio" as const, "aria-checked": selected } : { "aria-pressed": selected };
  return (
    <button type={type} className={cn("vx-choice fx", className)} data-size={size} data-selected={selected ? "" : undefined} {...sel} {...props}>
      <span className="vx-choice-m">{media}</span>
      <span className="vx-choice-t">
        <b>{title}</b>
        {sub != null && <span>{sub}</span>}
      </span>
      {trail != null && <span className="vx-choice-r">{trail}</span>}
    </button>
  );
}

export type PanelProps = {
  /** Rahmen und leichte Tönung in der Statusfarbe (copper = Marke). */
  tone?: Tone | "copper";
  /** plate: Grund --panel (Standard) · raised: --panel-2, Licht · sunk: eingelassen */
  level?: "plate" | "raised" | "sunk";
  /** Kerbe: 1 Stufe (Standard) oder 2 (große Flächen) */
  notch?: 1 | 2;
  /** Innenabstand 12 / 16 / 24 px; ohne Angabe keiner. */
  pad?: "s" | "m" | "l";
  /** gewählt: Kupferrahmen 1 Einheit + 10 % Tönung */
  selected?: boolean;
  as?: "div" | "section" | "article" | "aside" | "li";
} & ComponentProps<"div">;

/**
 * Platte mit Bevel und Kerbe. Setzt den Overlay-Kontext (Hover/Auswahl darin eine Stufe heller, tokens.css).
 */
export function Panel({ tone, level = "plate", notch = 1, pad, selected, as: Tag = "div", className, children, ...props }: PanelProps) {
  const El = Tag as "div";
  return (
    <El
      className={cn("vx-panel", className)}
      data-level={level}
      data-notch={notch}
      data-pad={pad}
      data-tone={tone && tone !== "neutral" ? tone : undefined}
      data-selected={selected ? "" : undefined}
      {...props}
    >
      {children}
    </El>
  );
}
