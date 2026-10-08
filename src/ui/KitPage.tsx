/**
 * Nur Entwicklung (/_kit): Vorschau des Pixel-Kits (Inventar) als Abnahme. Texte stehen im Klartext (Deutsch), die Seite gibt es nur im Dev-Build.
 * Jede Komponente × Größe × Variante × Ton × Zustand (normal, hover/press/fokus per data-force, aus, über Szene)
 * und alle Icons in s/m/l/xl. Oben die Pixelstufe (Einstellung pxSize) zum Vergleichen. Stile des Gerüsts: kit/kit.css.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useSettings, type PxSize } from "@/store/settings";
import { PixelScene } from "@/pixel/PixelScene";
import { BIOMES } from "@/pixel/scene";
import { onPxChange, PX } from "@/pixel/unit";
import { FormsSection } from "./kit/FormsSection";
import { CardsSection } from "./kit/CardsSection";
import { InventarSection } from "./kit/InventarSection";
import { OverlaySection } from "./kit/OverlaySection";
import { Cap, Frame, Sec } from "./kit/kit-ui";
import { cssVars } from "./util";
import { BackLink, BarButton, Button, Chip, Count, Icon, IconButton, ICON_NAMES, Meta, Page, PageHeader, type ButtonVariant, type IconSize, type Size } from "@/ui";

const SIZES: Size[] = ["s", "m", "l"];
const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const TONES = ["acc", "warn", "bad"] as const;
const ICON_SIZES: IconSize[] = ["s", "m", "l", "xl"];
type State = "normal" | "hover" | "press" | "fokus" | "aus";
const STATES: State[] = ["normal", "hover", "press", "fokus", "aus"];
const stateProps = (s: State) =>
  s === "hover" ? { "data-force": "hover" }
    : s === "press" ? { "data-force": "press" }
      : s === "fokus" ? { "data-force": "focus" }
        : s === "aus" ? { disabled: true }
          : {};

/** Kopf einer Matrix: leere Ecke + Spaltentitel. */
function Head({ cols }: { cols: string[] }) {
  return (
    <>
      <span />
      {cols.map((c) => <Cap key={c}>{c}</Cap>)}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Cap>{label}</Cap>
      {children}
    </>
  );
}

function ButtonMatrix({ size }: { size: Size }) {
  return (
    <div className="kit-matrix" data-cols="buttons">
      <Head cols={STATES} />
      {VARIANTS.map((v) => (
        <Row key={v} label={v}>
          {STATES.map((s) => <Button key={s} variant={v} size={size} icon="plus" {...stateProps(s)}>Anlegen</Button>)}
        </Row>
      ))}
      {TONES.map((tone) => (
        <Row key={tone} label={`ghost ${tone}`}>
          {STATES.map((s) => <Button key={s} variant="ghost" tone={tone} size={size} icon={tone === "acc" ? "update" : tone === "warn" ? "warn" : "trash"} {...stateProps(s)}>{tone === "bad" ? "Löschen" : "Aktualisieren"}</Button>)}
        </Row>
      ))}
      <Row label="secondary warn">
        {STATES.map((s) => <Button key={s} tone="warn" size={size} icon="warn" {...stateProps(s)}>Prüfen</Button>)}
      </Row>
      <Row label="IconButton">
        {STATES.map((s) => (
          <span key={s} className="kit-row" data-gap="6">
            {VARIANTS.map((v) => <IconButton key={v} variant={v} size={size} icon={v === "danger" ? "trash" : v === "primary" ? "play" : "more"} label={`${v} ${s}`} tip={false} {...stateProps(s)} />)}
          </span>
        ))}
      </Row>
      <Row label="count / iconEnd">
        {STATES.map((s) => (
          <span key={s} className="kit-row" data-gap="6">
            <Button size={size} icon="update" count={12} {...stateProps(s)}>Alle</Button>
            <Button variant="ghost" size={size} iconEnd="chev-down" {...stateProps(s)}>Mehr</Button>
          </span>
        ))}
      </Row>
    </div>
  );
}

function IconTable() {
  return (
    <div className="kit-grid" data-cols="icons">
      {ICON_NAMES.map((n) => (
        <div key={n} className="kit-icon-item">
          <Cap className="kit-icon-name">{n}</Cap>
          {ICON_SIZES.map((s) => (
            <Frame key={s} title={`${n} ${s}`}><Icon name={n} size={s} /></Frame>
          ))}
        </div>
      ))}
    </div>
  );
}

function PxSwitch() {
  const px = useSettings((s) => s.pxSize);
  const set = useSettings((s) => s.set);
  const [, bump] = useState(0);
  useEffect(() => onPxChange(() => bump((n) => n + 1)), []);
  return (
    <div className="kit-row" data-gap="8">
      <Cap>Pixelstufe</Cap>
      {(["s", "m", "l"] as PxSize[]).map((p) => (
        <Button key={p} size="s" variant={p === px ? "primary" : "secondary"} onClick={() => set({ pxSize: p })} aria-pressed={p === px}>
          {p}
        </Button>
      ))}
      <Cap data-kit-px="">
        --px <Count value={PX.css.toFixed(3)} size={16} /> · DPR <Count value={PX.eff} size={16} /> · Icon-Zelle m <Count value={document.documentElement.style.getPropertyValue("--ic-m") || "?"} size={16} />
      </Cap>
    </div>
  );
}

export function KitPage() {
  return (
    <Page>
      <PageHeader title="Pixel-Kit">
        <PxSwitch />
      </PageHeader>

      {SIZES.map((s) => (
        <Sec key={s} title={`Knopf ${s}`} id={`button-${s}`}>
          <ButtonMatrix size={s} />
        </Sec>
      ))}

      <Sec title="Breiten" id="widths">
        <div className="kit-row" data-gap="12">
          <Button variant="primary" width={160}>Speichern</Button>
          <Button width={160}>Abbrechen</Button>
          <Button icon="update" count={3} compactBelow={1180}>Alle aktualisieren</Button>
          <BackLink onClick={() => undefined}>Bibliothek</BackLink>
          <span className="kit-width-240"><Button variant="primary" icon="play" width="full">Volle Breite</Button></span>
        </div>
      </Sec>

      <Sec title="Fensterleiste" id="bar">
        <div className="kit-bar">
          <BarButton><Icon name="tasks" /></BarButton>
          <BarButton data-force="hover"><Icon name="settings" /> hover</BarButton>
          <BarButton current><Icon name="settings" /> aktuell</BarButton>
          <BarButton expanded><Icon name="skins" /> offen</BarButton>
          <BarButton data-force="press"><Icon name="settings" /> press</BarButton>
        </div>
      </Sec>

      <Sec title="Über Szene" id="scene">
        <div className="kit-scene">
          <PixelScene bio="forest" seed={7} className="scene" />
          <div className="kit-scene-body" style={cssVars({ "--acc": BIOMES.forest.acc })}>
            <BackLink onScene onClick={() => undefined}>Bibliothek</BackLink>
            <div className="kit-scene-row">
              {STATES.map((st) => <Button key={st} variant="ghost" onScene icon="folder" {...stateProps(st)}>Ordner {st}</Button>)}
              <Button variant="ghost" tone="warn" onScene icon="warn">Warnung</Button>
            </div>
            <div className="kit-scene-row">
              {STATES.map((st) => <Button key={st} onScene icon="update" {...stateProps(st)}>Sek. {st}</Button>)}
              {STATES.map((st) => <IconButton key={st} onScene icon="more" label={`Mehr ${st}`} tip={false} {...stateProps(st)} />)}
              <Button variant="primary" size="l" icon="play">Spielen</Button>
            </div>
            <Meta onScene items={[<Count value="1.21.4" />, "Fabric", <><Icon name="clock" size="s" /> vor 2 Std.</>, <><Count value={42} /> Mods</>]} />
          </div>
        </div>
      </Sec>

      <Sec title="Überlagerungs-Kontext" id="overlay-context">
        <div className="plate kit-plate-row">
          {STATES.map((st) => <Button key={st} variant="ghost" icon="copy" {...stateProps(st)}>Kopieren {st}</Button>)}
          {STATES.map((st) => <IconButton key={st} icon="close" label={`Schließen ${st}`} tip={false} {...stateProps(st)} />)}
        </div>
      </Sec>

      <Sec title="Chips" id="chips">
        <div className="kit-matrix" data-cols="chips">
          <Head cols={["neutral", "acc", "warn", "bad", "run"]} />
          <Row label="m">
            <Chip>Fabric</Chip>
            <Chip tone="acc" icon="play">Läuft</Chip>
            <Chip tone="warn" icon="warn">2 Warnungen</Chip>
            <Chip tone="bad" dot>Fehler</Chip>
            <Chip tone="run" dot>Wird installiert <Count value={7} minDigits={3} /></Chip>
          </Row>
          <Row label="s">
            <Chip size="s">Fabric</Chip>
            <Chip size="s" tone="acc" dot>Aktuell</Chip>
            <Chip size="s" tone="warn" dot>Alt</Chip>
            <Chip size="s" tone="bad" dot>Kaputt</Chip>
            <Chip size="s" tone="run" dot>Lädt <Count value={42} minDigits={3} /></Chip>
          </Row>
        </div>
        <div className="kit-count-row">
          {([16, 18, 20, 26] as const).map((n) => <Count key={n} value={1234} size={n} />)}
          <Count value={5} minDigits={3} muted />
        </div>
        <Meta items={["Minecraft 1.21.4", <><Icon name="mod" size="s" /> <Count value={42} /> Mods</>, "vor 2 Std."]} />
        <Meta size="l" items={["Groß", <><Count value={3} /> Welten</>, null, "Ende"]} />
      </Sec>

      <InventarSection />
      <FormsSection />
      <CardsSection />
      <OverlaySection />

      <Sec title="Icons (s · m · l · xl)" id="icons">
        <IconTable />
      </Sec>
    </Page>
  );
}
