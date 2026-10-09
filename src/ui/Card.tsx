import { useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";
import { PixelScene } from "@/pixel/PixelScene";
import type { Biome } from "@/pixel/scene";
import { HitEl, type Hit } from "./Hit";
import { Icon } from "./Icon";
import { ContextMenu, type MenuEntry } from "./Menu";
import { TIP_DELAY_MS } from "./tipBase";
import { TIP_BOX } from "./Tooltip";
import { cssVars, flag, isOverflowing } from "./util";
import { Chip } from "./Chip";
import { ART } from "./Art";
import { Skel } from "./Feedback";

/** Aussehen einer Instanz: Biom, Seed der Szene, Akzent (--acc). */
export type SceneLook = { bio: Biome; seed: number; acc?: string };

/** Nur Vorschau (/_kit): Zustand erzwingen. */
type ForcedState = "hover" | "press" | "focus";

/* Layout (Tailwind), gemeinsam: Szene als Bild füllt ihren Rahmen (ART, Art.tsx); die Leinwand darin wird von scene.ts platziert. */
/** Einzeilige Beschriftung mit Auslassung. */
const LINE = "block min-w-0 truncate";

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
  /** „aktuell“: Akzentplatte (mini), aria-current am Knopf. */
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

/** Landschaft mit Rahmenlicht; das Instanz-Icon bleibt in der Beschriftung unverzerrt. `className` setzt die Maße (Standard 16 : 9). */
function SceneMedia({ look, className }: { look: SceneLook; className?: string }) {
  return (
    <span className={cn("lk-card-media block aspect-video", className)}>
      <PixelScene bio={look.bio} seed={look.seed} className={ART} />
      <span className="lk-card-frame absolute inset-0 z-2" />
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
        <HitEl hit={hit} fallbackLabel={title} current={current} pressed={pressed} className="absolute inset-0 z-1 block" />
      </T.Trigger>
      <T.Portal>
        <T.Content className={TIP_BOX} data-pass="" side={tipSide} sideOffset={8} collisionPadding={8}>
          {truncated?.title && <span className="lk-tt block">{title}</span>}
          {truncated?.sub && <span className="lk-tt-s block">{sub}</span>}
          {tip != null && <span className="lk-tt-h block [.lk-tt+&]:mt-1 [.lk-tt-s+&]:mt-1">{tip}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/** Breite der Szenenkarte und der Neu-Kachel: gemeinsam über `--mini` (Standard 256 px) einstellbar. */
const MINI_W = "w-(--mini,256px)";
/** Platte der Szenenkarte, Namensschild, Titel und Unterzeile (gemeinsam mit dem Platzhalter). */
const MINI = "lk-card @container grid flex-none content-start gap-1.5 min-w-0 p-(--u3)";
const CARD_CAP = "lk-card-cap lk-stone flex min-w-0 items-center gap-3 px-[9px] py-1.5";
const CARD_TITLE = "truncate text-[calc(15px*var(--tz))] leading-[1.2]";
const CARD_SUB = "mt-0.5 text-ctl-s leading-[calc(18px*var(--tz))]";

/**
 * Szenenkarte: breite Pixel-Landschaft, Instanz-Icon und Bildunterschrift, und eine
 * Trefferfläche (`hit`, Link oder Knopf) über allem. Platte mit Bildrahmen (Slot) und Namensschild; Hover hellt den Rand auf, „aktuell“ färbt die Platte in der Akzentfarbe.
 * Fokusring an der Karte (über Rahmen und Bildunterschrift). Breite: `className="w-80"` oder `[--mini:320px]`.
 */
export function SceneCard({ look, art, title, sub, status, primary, hit, current, menu, tip, tipSide = "top", className, "data-force": force }: SceneCardProps) {
  const titleRef = useRef<HTMLElement>(null);
  const subRef = useRef<HTMLElement>(null);
  const card = (
    <div
      className={cn(MINI, MINI_W, className)}
      data-kit-item="card"
      data-variant="mini"
      data-bio={look.bio}
      data-cur={flag(current)}
      data-force={force}
      style={cardStyle(look)}
    >
      <SceneMedia look={look} />
      <span className={CARD_CAP}>
        {art && <span className="lk-card-icon block size-10 flex-none overflow-hidden" aria-hidden>{art}</span>}
        <span className="block min-w-0 flex-1">
          <b ref={titleRef} className={cn("lk-card-title", CARD_TITLE, LINE)}>{title}</b>
          {sub && <span ref={subRef} className={cn("lk-card-sub", CARD_SUB, LINE)}>{sub}</span>}
        </span>
      </span>
      {status && <span className="lk-card-st absolute z-2 top-[calc(var(--u3)_+_6px)] left-[calc(var(--u3)_+_6px)]">{status}</span>}
      <CardHit hit={hit} title={title} sub={sub} tip={tip} tipSide={tipSide} current={current} titleRef={titleRef} subRef={subRef} />
      {primary && <div className="lk-card-tr absolute z-3 flex gap-1 top-[calc(var(--u3)_+_6px)] right-[calc(var(--u3)_+_6px)]">{primary}</div>}
    </div>
  );
  return menu ? <ContextMenu items={menu}>{card}</ContextMenu> : card;
}

/** Platzhalter einer Szenenkarte beim Laden: dieselbe Platte (Bild, Namensschild) und Breite, damit die Seite nicht springt. Dekorativ (`aria-hidden` setzt der Aufrufer). */
export function SceneCardSkel({ className }: { className?: string }) {
  return (
    <div className={cn(MINI, MINI_W, className)} data-variant="mini">
      <Skel className="lk-card-media aspect-video" />
      <span className={CARD_CAP}>
        <Skel className="size-10 flex-none" />
        <span className="block min-w-0 flex-1">
          <b className={cn(CARD_TITLE, LINE)}>&nbsp;</b>
          <span className={cn(CARD_SUB, LINE)}>&nbsp;</span>
        </span>
      </span>
    </div>
  );
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
    <div className={cn("lk-card @container flex w-24 flex-none min-w-0 flex-col gap-[5px] pb-0.5", className)} data-kit-item="card" data-variant="thumb" data-bio={look.bio} data-pressed={flag(pressed)} data-force={force} style={cardStyle(look)}>
      <SceneMedia look={look} className="h-16 w-24 aspect-auto" />
      <span className={cn("lk-card-t text-center text-ctl-s leading-[calc(16px*var(--tz))]", LINE)} ref={titleRef}>{title}</span>
      <CardHit hit={hit} title={title} pressed={!!pressed} titleRef={titleRef} />
    </div>
  );
}

/** Kachel „Neu …“ in Wallpaper-Größe (Breite wie die Szenenkarte, Mindesthöhe 176; die Höhe folgt der Reihe): leerer Slot, Icon über der Beschriftung. */
export function AddCard({ label, className, type = "button", ...props }: { label: string } & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type={type} className={cn("lk-add fx grid flex-none place-items-center self-stretch min-h-44", MINI_W, className)} {...props}>
      <span className="lk-add-in flex max-w-full flex-col items-center gap-1 px-1 text-center text-ctl-s">
        <Icon name="plus" size="m" />
        {label}
      </span>
    </button>
  );
}

/** Quadratische Auswahlkachel (Pixel-Icon, Farbe): Platte, „gewählt“ mit Akzentrahmen. Der Name ist Pflicht, er steht als aria-label und Tooltip am Knopf. */
export function PickTile({ label, pressed, size = 48, onClick, className, children }: {
  label: string; pressed: boolean; size?: 32 | 48; onClick: () => void; className?: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn("lk-pick fx grid flex-none place-items-center", size === 32 ? "size-8" : "size-12", className)}
      data-size={size}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Rastervarianten: Spalten- und Lückenmaße als Tailwind, Mindestbreite über `--card-min` (und `--card-max` bei pick) einstellbar. */
const GRID = {
  poster: "grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,188px),1fr))] gap-3.5",
  thumb: "flex flex-wrap gap-3 p-1.5",
  pick: "grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),var(--card-max,200px)))] gap-4",
};

/**
 * Raster für Bildkarten: poster (auto-fill ab 188 px, Lücke 14), thumb (umbrechende Reihe, Lücke 12) oder pick (Auswahlkarten 160–200 px, Lücke 16).
 * Anpassen: `className="[--card-min:220px] gap-5"` oder eigene `grid-cols-*`.
 */
export function CardGrid({ variant = "poster", className, children, ...props }: { variant?: "poster" | "thumb" | "pick" } & ComponentProps<"div">) {
  return (
    <div className={cn(GRID[variant], className)} data-variant={variant} {...props}>
      {children}
    </div>
  );
}

/** Kleine Szene als Bild (Listenzeile 44, Menüeintrag 28): Slot-Rand um das Bild. */
export function SceneThumb({ bio, seed, size = 44, art, className }: {
  bio: Biome; seed: number; size?: 28 | 44; art?: ReactNode; className?: string;
}) {
  return (
    <span className={cn("lk-sthumb block flex-none", size === 28 ? "size-7 [--iu:2px]" : "size-11", className)} data-size={size} aria-hidden>
      {art ? <span className={ART}>{art}</span> : <PixelScene bio={bio} seed={seed} className={ART} />}
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

/* Layout der Größen: Spalten, Abstand, Höhe und Innenabstand (links Platz für ▶), Schrift von Name und Zusatz. */
const CHOICE = {
  m: { box: "grid-cols-[40px_minmax(0,1fr)_auto] gap-2.5 h-14 pr-2.5 pl-[22px]", title: "text-[calc(15px*var(--tz))]" },
  l: { box: "grid-cols-[48px_minmax(0,1fr)_auto] gap-3 h-[72px] pr-3.5 pl-[30px]", title: "text-[calc(16px*var(--tz))]" },
};

/**
 * Auswahlzeile/-karte. Hover-Platte --hv-row, gewählt = Akzentrahmen (1 Einheit) + Tönung + ▶,
 * Druck: Fläche eingelassen, Inhalt 1 Einheit tiefer. Fokus auf Gewähltem: Doppelring.
 */
export function Choice({ size = "m", media, title, sub, trail, selected, role = "button", className, type = "button", ...props }: ChoiceProps) {
  const sel = role === "radio" ? { role: "radio" as const, "aria-checked": selected } : { "aria-pressed": selected };
  return (
    <button type={type} className={cn("lk-choice fx grid w-full items-center", CHOICE[size].box, className)} data-size={size} data-selected={flag(selected)} {...sel} {...props}>
      <span className="lk-choice-m relative grid min-w-0 place-items-center">{media}</span>
      <span className="lk-choice-t min-w-0">
        <b className={cn(LINE, CHOICE[size].title)}>{title}</b>
        {sub != null && <span className={cn(LINE, "text-[calc(13px*var(--tz))]")}>{sub}</span>}
      </span>
      {trail != null && <span className="lk-choice-r flex items-center gap-1.5">{trail}</span>}
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
 * mit Haken (`flag`), Fokus auf Gewähltem = Doppelring. Pfeiltasten legt der Container fest (`useRovingItems`, `item=".lk-pickcard"`).
 * Bildhöhe: `[&_.lk-pickcard-pic]:h-32` am `className`.
 */
export function PickCard({ media, title, sub, flag: flagText, selected, className, type = "button", ...props }: PickCardProps) {
  return (
    <button
      type={type}
      role="radio"
      aria-checked={selected}
      className={cn("lk-pickcard fx grid w-full min-w-0 content-start justify-items-start gap-1 p-3", className)}
      data-kit-item="pick"
      data-selected={flag(selected)}
      {...props}
    >
      <span className="lk-pickcard-pic lk-pit relative mb-1.5 grid h-28 w-full place-items-center">
        {media}
        {selected && flagText != null && <Chip className="absolute top-(--u4) left-(--u4) z-2" tone="acc" icon="check" size="s">{flagText}</Chip>}
      </span>
      <b className={cn("lk-pickcard-t max-w-full truncate text-[calc(15px*var(--tz))] leading-[1.2]")}>{title}</b>
      {sub != null && <small className="lk-pickcard-s max-w-full truncate text-ctl-s">{sub}</small>}
    </button>
  );
}
