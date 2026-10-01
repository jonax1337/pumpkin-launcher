/**
 * Nur Entwicklung (/_kit): Vorschau des Pixel-Kits als Abnahme.
 * Jede Komponente × Größe × Variante × Ton × Zustand (normal, hover/press per data-force, aus, über Szene)
 * und alle Icons in s/m/l/xl. Oben die Pixelstufe (Einstellung pxSize) zum Vergleichen.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { useSettings, type PxSize } from "@/store/settings";
import { PixelScene } from "@/pixel/PixelScene";
import { BIOMES } from "@/pixel/scene";
import { onPxChange, PX } from "@/pixel/unit";
import { FormsSection } from "./kit/FormsSection";
import { CardsSection } from "./kit/CardsSection";
import { OverlaySection } from "./kit/OverlaySection";
import { BackLink, BarButton, Button, Chip, Count, Icon, IconButton, ICON_NAMES, Meta, PageHeader, type ButtonVariant, type IconSize, type Size } from "@/ui";

const SIZES: Size[] = ["s", "m", "l"];
const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const TONES = ["acc", "warn", "bad"] as const;
type State = "normal" | "hover" | "press" | "aus";
const STATES: State[] = ["normal", "hover", "press", "aus"];
const stateProps = (s: State) => (s === "hover" ? { "data-force": "hover" } : s === "press" ? { "data-force": "press" } : s === "aus" ? { disabled: true } : {});

const grid = (cols: string): CSSProperties => ({ display: "grid", gridTemplateColumns: cols, gap: "12px 16px", alignItems: "center", justifyItems: "start" });
const cap: CSSProperties = { fontSize: 12, color: "var(--fg-3)", fontWeight: 600 };
const sec: CSSProperties = { display: "flex", flexDirection: "column", gap: 14, padding: "22px 0", boxShadow: "inset 0 calc(var(--px) * -1) 0 var(--line)" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={sec}>
      <h2 className="vx-h">{title}</h2>
      {children}
    </section>
  );
}

/** Kopf einer Matrix: leere Ecke + Spaltentitel. */
function Head({ cols }: { cols: string[] }) {
  return (
    <>
      <span />
      {cols.map((c) => <span key={c} style={cap}>{c}</span>)}
    </>
  );
}

function ButtonMatrix({ size }: { size: Size }) {
  const { t } = useI18n();
  return (
    <div style={grid("110px repeat(4, max-content)")}>
      <Head cols={STATES} />
      {VARIANTS.map((v) => (
        <Row key={v} label={v}>
          {STATES.map((s) => <Button key={s} variant={v} size={size} icon="plus" {...stateProps(s)}>{t("components.newInstance.create")}</Button>)}
        </Row>
      ))}
      {TONES.map((tone) => (
        <Row key={tone} label={`ghost ${tone}`}>
          {STATES.map((s) => <Button key={s} variant="ghost" tone={tone} size={size} icon={tone === "acc" ? "up" : tone === "warn" ? "warn" : "trash"} {...stateProps(s)}>{tone === "bad" ? t("common.delete") : t("common.refresh")}</Button>)}
        </Row>
      ))}
      <Row label="secondary warn">
        {STATES.map((s) => <Button key={s} tone="warn" size={size} icon="warn" {...stateProps(s)}>{t("ui.kit.buttonCheck")}</Button>)}
      </Row>
      <Row label="IconButton">
        {STATES.map((s) => (
          <span key={s} style={{ display: "flex", gap: 6 }}>
            {VARIANTS.map((v) => <IconButton key={v} variant={v} size={size} icon={v === "danger" ? "trash" : v === "primary" ? "play" : "more"} label={`${v} ${s}`} tip={false} {...stateProps(s)} />)}
          </span>
        ))}
      </Row>
      <Row label="count / iconEnd">
        {STATES.map((s) => (
          <span key={s} style={{ display: "flex", gap: 6 }}>
            <Button size={size} icon="up" count={12} {...stateProps(s)}>{t("common.all")}</Button>
            <Button variant="ghost" size={size} iconEnd="chevd" {...stateProps(s)}>{t("ui.kit.more")}</Button>
          </span>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span style={cap}>{label}</span>
      {children}
    </>
  );
}

const ICON_SIZES: IconSize[] = ["s", "m", "l", "xl"];

function IconTable() {
  const cell: CSSProperties = { outline: "1px dashed #33415C", outlineOffset: 0, display: "inline-grid" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
      {ICON_NAMES.map((n) => (
        <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, height: 64 }}>
          <span style={{ ...cap, width: 44 }}>{n}</span>
          {ICON_SIZES.map((s) => (
            <span key={s} style={cell} title={`${n} ${s}`}><Icon name={n} size={s} /></span>
          ))}
        </div>
      ))}
    </div>
  );
}

function PxSwitch() {
  const { t } = useI18n();
  const px = useSettings((s) => s.pxSize);
  const set = useSettings((s) => s.set);
  const [, bump] = useState(0);
  useEffect(() => onPxChange(() => bump((n) => n + 1)), []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={cap}>{t("ui.kit.pxSize")}</span>
      {(["s", "m", "l"] as PxSize[]).map((p) => (
        <Button key={p} size="s" variant={p === px ? "primary" : "secondary"} onClick={() => set({ pxSize: p })} aria-pressed={p === px}>
          {p}
        </Button>
      ))}
      <span style={cap} data-kit-px>
        --px <Count value={PX.css.toFixed(3)} size={16} /> · DPR <Count value={PX.eff} size={16} /> · ico-m <Count value={document.documentElement.dataset.icoM ?? "?"} size={16} />
      </span>
    </div>
  );
}

export function KitPage() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader title="Pixel-Kit">
        <PxSwitch />
      </PageHeader>

      {SIZES.map((s) => (
        <Section key={s} title={t("ui.kit.buttonMatrix", { size: s })}>
          <ButtonMatrix size={s} />
        </Section>
      ))}

      <Section title={t("ui.kit.widthRow")}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="primary" width={160}>{t("common.save")}</Button>
          <Button width={160}>{t("common.cancel")}</Button>
          <Button icon="up" count={3} compactBelow={1180}>{t("detail.content.updateAll")}</Button>
          <BackLink onClick={() => undefined}>{t("ui.nav.library")}</BackLink>
          <span style={{ width: 240 }}><Button variant="primary" icon="play" width="full">{t("ui.kit.fullWidth")}</Button></span>
        </div>
      </Section>

      <Section title={t("ui.window.bar")}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", height: 48, padding: "0 8px", background: "var(--bg-2)" }}>
          <BarButton><Icon name="tasks" /></BarButton>
          <BarButton data-force="hover"><Icon name="gear" /> hover</BarButton>
          <BarButton current><Icon name="gear" /> {t("ui.kit.current")}</BarButton>
          <BarButton expanded><Icon name="user" /> {t("ui.kit.openState")}</BarButton>
          <BarButton data-force="press"><Icon name="gear" /> press</BarButton>
        </div>
      </Section>

      <Section title={t("ui.kit.onScene")}>
        <div style={{ position: "relative", height: 220, overflow: "hidden" }}>
          <PixelScene bio="forest" seed={7} className="scene" />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, padding: 16, ["--acc" as string]: BIOMES.forest.acc }}>
            <BackLink onScene onClick={() => undefined}>{t("ui.nav.library")}</BackLink>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {STATES.map((st) => <Button key={st} variant="ghost" onScene icon="folder" {...stateProps(st)}>{t("ui.kit.folderState", { state: st })}</Button>)}
              <Button variant="ghost" tone="warn" onScene icon="warn">{t("ui.kit.warning")}</Button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {STATES.map((st) => <Button key={st} onScene icon="up" {...stateProps(st)}>{t("ui.kit.secState", { state: st })}</Button>)}
              {STATES.map((st) => <IconButton key={st} onScene icon="more" label={t("ui.kit.moreState", { state: st })} tip={false} {...stateProps(st)} />)}
              <Button variant="primary" size="l" icon="play">{t("common.play")}</Button>
            </div>
            <Meta onScene items={[<><Count value="1.21.4" /></>, "Fabric", <><Icon name="clock" size="s" /> vor 2 Std.</>, <><Count value={42} /> Mods</>]} />
          </div>
        </div>
      </Section>

      <Section title={t("ui.kit.overlayContext")}>
        <div className="plate" style={{ display: "flex", gap: 8, padding: 16, alignItems: "center" }}>
          {STATES.map((st) => <Button key={st} variant="ghost" icon="copy" {...stateProps(st)}>{t("ui.kit.copyState", { state: st })}</Button>)}
          {STATES.map((st) => <IconButton key={st} icon="x" label={t("ui.kit.closeState", { state: st })} tip={false} {...stateProps(st)} />)}
        </div>
      </Section>

      <Section title={t("ui.kit.chips")}>
        <div style={grid("110px repeat(6, max-content)")}>
          <Head cols={["neutral", "acc", "warn", "bad", "run", t("ui.kit.fixedCol")]} />
          <Row label="m">
            <Chip>Fabric</Chip>
            <Chip tone="acc" icon="play">{t("components.game.running")}</Chip>
            <Chip tone="warn" icon="warn">{t("ui.kit.warnings")}</Chip>
            <Chip tone="bad" dot>{t("common.error")}</Chip>
            <Chip tone="run" dot>{t("components.game.installing")} <Count value={7} minDigits={3} /></Chip>
            <Chip fixed={120} tone="run" dot>{t("ui.kit.installingLong")}</Chip>
          </Row>
          <Row label="s">
            <Chip size="s">Fabric</Chip>
            <Chip size="s" tone="acc" dot>{t("ui.kit.chipCurrent")}</Chip>
            <Chip size="s" tone="warn" dot>{t("ui.kit.chipOutdated")}</Chip>
            <Chip size="s" tone="bad" dot>{t("ui.kit.chipBroken")}</Chip>
            <Chip size="s" tone="run" dot>{t("ui.kit.loading")} <Count value={42} minDigits={3} /></Chip>
            <Chip size="s" fixed={120}>{t("ui.kit.neutralFixed")}</Chip>
          </Row>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {([16, 18, 20, 26] as const).map((n) => <Count key={n} value={1234} size={n} />)}
          <Count value={5} minDigits={3} muted />
        </div>
        <Meta items={["Minecraft 1.21.4", <><Icon name="plug" size="s" /> <Count value={42} /> Mods</>, "vor 2 Std."]} />
        <Meta size="l" items={[t("pages.settings.pxSizeLarge"), <><Count value={3} /> {t("common.worlds")}</>, null, t("ui.kit.end")]} />
      </Section>

      <FormsSection />
      <CardsSection />
      <OverlaySection />

      <Section title="Icons (s · m · l · xl)">
        <IconTable />
      </Section>
    </div>
  );
}
