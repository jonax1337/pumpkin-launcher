/**
 * Nur Entwicklung (/_kit): Bausteine des Inventar-Stils im Überblick: Flächen (surface.css), Filter-Chips, Spielen-Knopf in allen Zuständen,
 * Protokollzeilen, stehende Advancement-Toasts, Dialog und Seitenpanel als stehende Flächen (gleiche Klassen wie die Radix-Inhalte).
 */
import { useState, type ReactNode } from "react";
import { PlayPlate } from "@/components/play/PlayPlate";
import type { PlayState } from "@/components/play/playState";
import { LogRow } from "@/components/log/LogRow";
import { BIOMES } from "@/pixel/scene";
import type { LogLine } from "@/store/game";
import { Button, buttonClass, ChipButton, Icon, IconButton, Tip, type IconName } from "@/ui";
import { cn } from "@/lib/utils";
import { cssVars } from "../util";
import { Cap, Sec } from "./kit-ui";

// ---------- Flächen ----------

/** Beispielfläche mit Klassenname darunter. */
function Swatch({ className, name, children, ...props }: { className: string; name: string; children?: ReactNode } & { [name: `data-${string}`]: string | undefined }) {
  return (
    <div className={cn("kit-swatch", className)} {...props}>
      <b className="vx-text">{name}</b>
      <code>{children ?? className}</code>
    </div>
  );
}

function Surfaces() {
  return (
    <>
      <div className="kit-grid" data-cols="swatches" data-kit="surfaces">
        <Swatch className="vx-slot" name="Slot">.vx-slot · eingelassen, bedienbar</Swatch>
        <Swatch className="vx-pit" name="Pit">.vx-pit · eingelassen, ruhig</Swatch>
        <Swatch className="vx-stone vx-text" name="Stein">.vx-stone · erhaben</Swatch>
        <Swatch className="vx-stone vx-text" name="Stein gedrückt" data-force="press">.vx-stone[data-force=press]</Swatch>
        <Swatch className="plate" name="Platte">.plate · Fläche der Seite</Swatch>
      </div>
      <div className="kit-row" data-align="start">
        <div className="vx-tip" data-kit="tip-static">
          <div className="tn">Survival 1.21</div>
          <div className="tv">Fabric · 42 Mods</div>
          <div className="tu">2 Updates</div>
          <div className="td">zuletzt vor 2 Tagen gespielt</div>
        </div>
        <Tip label="Tooltip live"><Button variant="ghost" icon="question">Hover für Tooltip</Button></Tip>
      </div>
    </>
  );
}

// ---------- Filter-Chips ----------

const FILTERS: { id: string; label: string; icon: IconName }[] = [
  { id: "mod", label: "Mods", icon: "mod" },
  { id: "shader", label: "Shader", icon: "shader" },
  { id: "resourcepack", label: "Ressourcenpakete", icon: "resourcepack" },
  { id: "datapack", label: "Datenpakete", icon: "datapack" },
];

function FilterChips() {
  const [on, setOn] = useState<Set<string>>(new Set(["mod"]));
  const toggle = (id: string) => setOn((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  return (
    <div className="kit-row" data-gap="8" data-kit="filter-chips">
      {FILTERS.map((f) => <ChipButton key={f.id} icon={f.icon} pressed={on.has(f.id)} onClick={() => toggle(f.id)}>{f.label}</ChipButton>)}
      <ChipButton size="s" disabled>aus</ChipButton>
    </div>
  );
}

// ---------- Spielen-Knopf ----------

/** Texte wie in play/playState.tsx; hier fest, damit die Vorschau ohne Store und Instanz auskommt. */
const PLAY: PlayState[] = [
  { state: "idle", icon: "play", label: "Spielen", compactLabel: "Spielen", detail: "Spielt als Steve_42", progress: 0, ariaLabel: "Spielen" },
  { state: "prep", icon: "download", label: "Wird installiert", compactLabel: "Installiert", detail: "", progress: 0.42, percentText: "42%", disabled: true, ariaLabel: "Wird installiert, 42 %" },
  { state: "start", icon: "hourglass", label: "Startet", compactLabel: "Startet", detail: "", progress: null, disabled: true, ariaLabel: "Startet" },
  { state: "run", icon: "stop", label: "Beenden", compactLabel: "Beenden", detail: "Läuft seit 12:04", progress: 0, ariaLabel: "Beenden" },
  { state: "error", icon: "refresh", label: "Erneut starten", compactLabel: "Nochmal", detail: "Abgestürzt (Code 1)", progress: 0, ariaLabel: "Erneut starten" },
];
/** Aus mit Grund (kein Spielername) und der längste Hinweis unter „Spielen“. */
const PLAY_OFF: PlayState = { ...PLAY[0], detail: "Erst Spielernamen festlegen", disabled: true, ariaLabel: "Spielen, erst Spielernamen festlegen" };
const PLAY_LONG: PlayState = { ...PLAY[0], detail: "Installiert beim ersten Start" };

function PlayStates() {
  const first = PLAY[0];
  return (
    <div className="kit-stack" data-gap="12" style={cssVars({ "--acc": BIOMES.forest.acc })} data-kit="play">
      <Cap>l 272×56 · idle · prep · start · run · error</Cap>
      <div className="kit-play-states">
        {PLAY.map((state) => <PlayPlate key={state.state} state={state} tabIndex={-1} />)}
      </div>
      <Cap>l: aus mit Grund · längster Hinweis · erzwungen: hover · press · Fokus</Cap>
      <div className="kit-play-states">
        <PlayPlate state={PLAY_OFF} tabIndex={-1} />
        <PlayPlate state={PLAY_LONG} tabIndex={-1} />
        <PlayPlate state={first} force="hover" tabIndex={-1} />
        <PlayPlate state={first} force="press" tabIndex={-1} />
        <PlayPlate state={first} force="focus" tabIndex={-1} />
      </div>
      <Cap>m 176×40 und i 32×32</Cap>
      <div className="kit-row" data-gap="12">
        {PLAY.map((state) => <PlayPlate key={state.state} state={state} size="m" tabIndex={-1} />)}
        <PlayPlate state={PLAY_OFF} size="m" tabIndex={-1} />
      </div>
      <div className="kit-row" data-gap="12">
        {PLAY.map((state) => <PlayPlate key={state.state} state={state} size="i" tabIndex={-1} />)}
        <PlayPlate state={PLAY_OFF} size="i" tabIndex={-1} />
        <PlayPlate state={first} size="i" force="hover" tabIndex={-1} />
      </div>
    </div>
  );
}

// ---------- Protokoll ----------

const LOG: LogLine[] = [
  { id: 1, stream: "stdout", tone: "normal", line: "[12:04:01] [main/INFO]: Loading Minecraft 1.21.4 with Fabric Loader 0.16.9" },
  { id: 2, stream: "stdout", tone: "normal", line: "[12:04:03] [main/INFO]: Sodium 0.6.5 initialisiert" },
  { id: 3, stream: "stdout", tone: "warn", line: "[12:04:04] [Render thread/WARN]: Shader-Cache veraltet, wird neu gebaut" },
  { id: 4, stream: "stderr", tone: "error", line: "[12:04:05] [Render thread/ERROR]: Mod „lithium“ ist nicht für 1.21.4 gebaut" },
  { id: 5, stream: "stdout", tone: "normal", line: "[12:04:07] [main/INFO]: Spiel bereit" },
];
const SODIUM = /(Sodium)/i;

function ConsoleRows() {
  return (
    <div className="console kit-console" data-kit="console">
      <div className="cbody" tabIndex={0} role="log" aria-label="Beispielprotokoll">
        {LOG.map((line) => <LogRow key={line.id} line={line} highlight={line.id === 2 ? SODIUM : null} />)}
      </div>
    </div>
  );
}

// ---------- Toasts und stehende Überlagerungen ----------

type ToastSpec = { type: "success" | "warning" | "error"; icon: IconName; title: string; text: string; action?: string };
const TOASTS: ToastSpec[] = [
  { type: "success", icon: "success", title: "Survival ist bereit", text: "Bereit zum Spielen" },
  { type: "warning", icon: "warn", title: "Wenig Arbeitsspeicher", text: "Mehr als 8 GB lassen dem System zu wenig übrig." },
  { type: "error", icon: "warn", title: "Survival ist abgestürzt", text: "Code 1", action: "Protokoll zeigen" },
];

/** Stehende Advancement-Platte: gleiche Klassen und data-Attribute wie der Sonner-Toast (feedback.css). */
function ToastStatic({ spec }: { spec: ToastSpec }) {
  return (
    <div className="vx-toast kit-toast-static" data-type={spec.type} role="status">
      <div data-icon=""><Icon name={spec.icon} /></div>
      <div data-content="">
        <div data-title="">{spec.title}</div>
        <div data-description="">{spec.text}</div>
      </div>
      {spec.action && <button type="button" data-button="" data-action="" className={buttonClass({ variant: "ghost", size: "s", tone: "acc" })}>{spec.action}</button>}
      <button type="button" data-close-button="" className={cn(buttonClass({ variant: "ghost", size: "s" }), "vx-ib")} aria-label="Schließen"><Icon name="close" size="s" /></button>
    </div>
  );
}

function StaticOverlays() {
  return (
    <>
      <div className="kit-grid" data-cols="toasts" data-kit="toasts-static">
        {TOASTS.map((spec) => <ToastStatic key={spec.type} spec={spec} />)}
      </div>
      <div className="kit-row" data-gap="12" data-align="start">
        <div className="vx-dlg kit-dlg-static" data-size="s" data-ctx="overlay" data-kit="dialog-static">
          <div className="vx-ov-col">
            <div className="vx-dlg-h">
              <div className="vx-dlg-ht">
                <h2>Survival löschen?</h2>
                <p className="vx-dlg-sub">Mods und Einstellungen werden entfernt.</p>
              </div>
              <IconButton icon="close" label="Schließen" size="s" tip={false} tabIndex={-1} />
            </div>
            <div className="vx-dlg-b vx-pit"><p>Die Welten bleiben erhalten, wenn du sie behältst.</p></div>
            <div className="vx-dlg-f">
              <Button tabIndex={-1}>Abbrechen</Button>
              <Button variant="danger" icon="trash" tabIndex={-1}>Löschen</Button>
            </div>
          </div>
        </div>
        <div className="vx-sheet kit-sheet-static" data-ctx="overlay" data-kit="sheet-static">
          <div className="vx-ov-col">
            <div className="vx-sheet-h">
              <div className="vx-sheet-ht">
                <h2>Mods hinzufügen</h2>
                <p className="vx-sheet-sub">Survival · Fabric 1.21.4</p>
              </div>
              <IconButton icon="close" label="Schließen" tip={false} tabIndex={-1} />
            </div>
            <div className="vx-sheet-b vx-pit"><Cap>Seitenpanel (stehend)</Cap></div>
          </div>
        </div>
      </div>
    </>
  );
}

export function InventarSection() {
  return (
    <>
      <Sec title="Inventar: Flächen und Tooltip" id="surfaces"><Surfaces /></Sec>
      <Sec title="Filter-Chips (ChipButton)" id="filter-chips"><FilterChips /></Sec>
      <Sec title="Spielen-Knopf (Zustände)" id="play"><PlayStates /></Sec>
      <Sec title="Protokollzeilen" id="console"><ConsoleRows /></Sec>
      <Sec title="Advancement-Toast, Dialog, Seitenpanel (stehend)" id="static-overlays"><StaticOverlays /></Sec>
    </>
  );
}
