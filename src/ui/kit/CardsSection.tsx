/**
 * Nur Entwicklung (/_kit): Vorschau Karten und Listen (Kit-Paket A2/3).
 * Glyphen/Projektbilder/Köpfe in allen Boxen (Raster gestrichelt), Szenenkarten, Auswahlkarten, Platten, alle Listenraster.
 * Zustände per data-force (hover/press/focus); Pixelstufe oben auf der Seite.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { useI18n, type TKey } from "@/i18n";
import type { MenuEntry } from "../Overlay";
import { BIOMES, type Biome } from "@/pixel/scene";
import type { GlyphName, GlyphPalette } from "@/pixel/icons";
import {
  AddCard, Avatar, Button, CardGrid, Cell, Checkbox, Chip, Choice, Count, GhostRow, Glyph, Icon, IconButton, List, ListRow, Panel,
  ProjectIcon, RowTitle, SceneCard, SceneThumb, Switch, type GlyphBox,
} from "@/ui";

const cap: CSSProperties = { fontSize: 12, color: "var(--fg-3)", fontWeight: 600 };
const sec: CSSProperties = { display: "flex", flexDirection: "column", gap: 14, padding: "22px 0", boxShadow: "inset 0 calc(var(--px) * -1) 0 var(--line)" };
const row: CSSProperties = { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" };
const cell: CSSProperties = { outline: "1px dashed #33415C", display: "inline-grid" };

function Sec({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section style={sec} data-kit={id}>
      <h2 className="vx-h">{title}</h2>
      {children}
    </section>
  );
}
const Lab = ({ children }: { children: ReactNode }) => <span style={{ ...cap, width: 110, flex: "none" }}>{children}</span>;

/** Einträge des Beispielmenüs; `t` übersetzt die Texte zur Renderzeit (nicht auf Modulebene). */
const menuOf = (t: (key: TKey) => string): MenuEntry[] => [
  { id: "open", text: t("common.open"), icon: "ext", onSelect: () => undefined },
  { id: "folder", text: t("components.instance.openFolder"), icon: "folder", onSelect: () => undefined },
  "-",
  { id: "del", text: t("common.delete"), icon: "trash", bad: true, onSelect: () => undefined },
];

/** Beispielinstanzen wie im Mock (Name, Loader, Biom, Seed) – Demodaten, bleiben unübersetzt. */
const INST: { id: string; name: string; sub: string; bio: Biome; seed: number; mods: number; last: string }[] = [
  { id: "a", name: "Überlebenswelt", sub: "Fabric 1.21.4 · vor 2 Std.", bio: "forest", seed: 7, mods: 42, last: "vor 2 Std." },
  { id: "b", name: "Nether-Expedition mit Freunden", sub: "NeoForge 1.21.1 · gestern", bio: "nether", seed: 3, mods: 118, last: "gestern" },
  { id: "c", name: "ÄÖÜ Größenwahn Übermäßig Lange Überschrift", sub: "Quilt 1.20.1 · vor 3 Tagen", bio: "snow", seed: 11, mods: 7, last: "vor 3 Tagen" },
  { id: "d", name: "Küste", sub: "Vanilla 1.21.4 · noch nie", bio: "sea", seed: 5, mods: 0, last: "noch nie" },
  { id: "e", name: "Endstadt", sub: "Fabric 1.21.4 · vor 1 Woche", bio: "end", seed: 2, mods: 64, last: "vor 1 Woche" },
];
const look = (i: (typeof INST)[number]) => ({ bio: i.bio, seed: i.seed, acc: BIOMES[i.bio].acc });

const GLYPHS: [GlyphName, GlyphPalette][] = [["cube", "copper"], ["chest", "sand"], ["compass", "ice"], ["rocket", "coral"], ["leaf", "teal"]];
const BOXES: GlyphBox[] = [40, 52, 64, 72, 104];
/** Projektbild ohne Netz: kleines SVG als Daten-URL */
const IMG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" shape-rendering="crispEdges"><rect width="4" height="4" fill="#376A7C"/><rect x="1" y="1" width="2" height="2" fill="#F3BD8B"/></svg>')}`;

function IconAudit() {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {GLYPHS.slice(0, 2).map(([g, p]) => (
        <div key={g} style={row}>
          <Lab>Glyph {g}</Lab>
          {BOXES.map((b) => <span key={b} style={cell} title={`box ${b}`}><Glyph name={g} pal={p} box={b} /></span>)}
        </div>
      ))}
      <div style={row}>
        <Lab>ProjectIcon</Lab>
        {BOXES.map((b) => <span key={b} style={cell}><ProjectIcon url={IMG} seed="x" box={b} /></span>)}
        <span style={cell} title={t("ui.kit.brokenGlyph")}><ProjectIcon url="/gibt-es-nicht.png" seed="sodium" box={52} /></span>
        <span style={cell} title={t("ui.kit.noImage")}><ProjectIcon seed="lithium" box={72} /></span>
      </div>
      <div style={row}>
        <Lab>Avatar 28 · 32</Lab>
        {["Steve", "Alex", "Notch"].map((n) => (
          <span key={n} style={{ display: "flex", gap: 8 }}>
            <span style={cell}><Avatar name={n} box={28} /></span>
            <span style={cell}><Avatar name={n} box={32} /></span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Posters() {
  const { t } = useI18n();
  const menu = menuOf(t);
  const primary = <Button variant="primary" icon="play" width={176}>{t("common.play")}</Button>;
  const actions = <IconButton onScene size="s" icon="more" label={t("ui.kit.more")} tip={false} />;
  const status = (k: number) => (k === 1 ? <Chip size="s" tone="run" dot>{t("components.game.running")}</Chip> : k === 2 ? <Chip icon="up"><Count value={3} /> {t("common.updates")}</Chip> : null);
  const force = [undefined, "hover", "focus", "press", undefined] as const;
  return (
    <CardGrid data-kit="posters">
      {INST.map((i, k) => (
        <SceneCard
          key={i.id}
          variant="poster"
          look={look(i)}
          title={i.name}
          sub={i.sub}
          status={status(k)}
          actions={actions}
          primary={primary}
          hit={{ to: "/_kit", label: t("pages.instances.openInstance", { name: i.name }) }}
          menu={menu}
          index={k}
          data-force={force[k]}
        />
      ))}
      <AddCard variant="poster" label={t("components.newInstance.title")} />
    </CardGrid>
  );
}

function Minis() {
  const { t } = useI18n();
  const [cur, setCur] = useState("a");
  const menu = menuOf(t);
  return (
    <div style={{ ...row, gap: 12 }} data-kit="minis">
      {INST.map((i, n) => (
        <SceneCard
          key={i.id}
          data-force={n === 2 ? "hover" : n === 3 ? "focus" : undefined}
          variant="mini"
          look={look(i)}
          title={i.name}
          sub={i.sub}
          current={cur === i.id}
          status={i.id === "b" ? <Chip size="s" tone="run" dot>{t("components.game.running")}</Chip> : undefined}
          primary={<IconButton variant="primary" size="s" icon="play" label={t("common.play")} tip={false} />}
          hit={{ onClick: () => setCur(i.id), onDoubleClick: () => undefined }}
          tip={t("ui.kit.miniTip")}
          menu={menu}
        />
      ))}
      <AddCard label={t("components.newInstance.title")} />
    </div>
  );
}

function Thumbs() {
  const { t } = useI18n();
  const [bio, setBio] = useState<Biome>("forest");
  return (
    <CardGrid variant="thumb" role="group" aria-label={t("detail.settings.sceneAria")} data-kit="thumbs">
      {(Object.keys(BIOMES) as Biome[]).map((b) => (
        <SceneCard key={b} variant="thumb" look={{ bio: b, seed: 7 }} title={t(`ui.biome.${b}`)} pressed={bio === b} hit={{ onClick: () => setBio(b) }} data-force={b === "snow" ? "hover" : b === "sea" ? "focus" : undefined} />
      ))}
      <SceneCard variant="thumb" look={{ bio: "plains", seed: 3 }} title={t("ui.kit.selectedFocus")} pressed hit={{ onClick: () => undefined }} data-force="focus" />
    </CardGrid>
  );
}

function Choices() {
  const { t } = useI18n();
  const [pk, setPk] = useState("fab");
  const [st, setSt] = useState("blank");
  const PACKS = [
    { id: "fab", name: "Fabulously Optimized", s: t("ui.kit.packFab"), n: "12,4 Mio.", f: undefined },
    { id: "aof", name: "All of Fabric 7", s: t("ui.kit.packAof"), n: "3,1 Mio.", f: "hover" },
    { id: "sky", name: "SkyFactory One", s: t("ui.kit.packSky"), n: "812.000", f: "press" },
    { id: "foc", name: t("ui.kit.focusExample"), s: "data-force=focus", n: "1.200", f: "focus" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 520px) minmax(0, 420px)", gap: 24, alignItems: "start" }}>
      <Panel level="raised" notch={2} pad="s" data-kit="choice-m">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {PACKS.map((p) => (
            <Choice
              key={p.id}
              media={<ProjectIcon seed={p.id} box={40} />}
              title={p.name}
              sub={p.s}
              trail={<Count value={p.n} size={18} />}
              selected={pk === p.id}
              onClick={() => setPk(p.id)}
              {...(p.f ? { "data-force": p.f } : {})}
            />
          ))}
          <Choice media={<Glyph name="chest" pal="sand" />} title={t("ui.kit.offDisabled")} sub={t("ui.kit.templateUnavailable")} selected={false} disabled />
          <Choice media={<Glyph name="chest" pal="copper" />} title={t("ui.kit.selectedFocus")} sub={t("ui.kit.doubleRing")} selected data-force="focus" />
        </div>
      </Panel>
      <div role="radiogroup" aria-label={t("ui.nav.home")} style={{ display: "flex", flexDirection: "column", gap: 8 }} data-kit="choice-l">
        {[
          { id: "blank", g: "cube" as GlyphName, p: "copper" as GlyphPalette, t: t("ui.kit.blankInstance"), s: t("ui.kit.blankSub") },
          { id: "pack", g: "chest" as GlyphName, p: "sand" as GlyphPalette, t: t("components.catalog.one.modpack"), s: t("ui.kit.modpackSub") },
          { id: "file", g: "compass" as GlyphName, p: "ice" as GlyphPalette, t: t("ui.kit.wayFromFile"), s: t("ui.kit.fromFileSub") },
        ].map((s) => (
          <Choice key={s.id} size="l" role="radio" media={<Glyph name={s.g} pal={s.p} />} title={s.t} sub={s.s} selected={st === s.id} onClick={() => setSt(s.id)} />
        ))}
        <Choice size="l" media={<Glyph name="rocket" pal="coral" />} title={t("ui.kit.hoverForced")} sub={t("ui.kit.hoverSub")} selected={false} data-force="hover" />
      </div>
    </div>
  );
}

function Panels() {
  const { t } = useI18n();
  return (
    <div style={row} data-kit="panels">
      {(["plate", "raised", "sunk"] as const).map((l) => (
        <Panel key={l} level={l} pad="m" style={{ width: 170 }}><b>{l}</b><p className="faint" style={{ fontSize: 12 }}>notch 1, pad m</p></Panel>
      ))}
      <Panel notch={2} pad="l" style={{ width: 170 }}><b>notch 2</b><p className="faint" style={{ fontSize: 12 }}>pad l</p></Panel>
      {(["copper", "warn", "bad", "run"] as const).map((tn) => (
        <Panel key={tn} tone={tn} pad="s" style={{ width: 130 }}><b>{tn}</b></Panel>
      ))}
      <Panel selected pad="m" style={{ width: 170 }}><b>selected</b><p className="faint" style={{ fontSize: 12 }}>{t("ui.kit.copperTint")}</p></Panel>
      <Panel pad="s" style={{ width: 240 }}>
        <span style={cap}>{t("ui.kit.overlayContext")}</span>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button variant="ghost" icon="copy" data-force="hover">{t("common.copy")}</Button>
          <IconButton icon="x" label={t("common.close")} tip={false} data-force="hover" />
        </div>
      </Panel>
    </div>
  );
}

function InstanceList() {
  const { t } = useI18n();
  const menu = menuOf(t);
  const head = (
    <>
      <span />
      <Cell>{t("common.name")}</Cell>
      <Cell>{t("common.version")}</Cell>
      <Cell hide={1040}>{t("pages.instances.colContents")}</Cell>
      <Cell hide={1040}>{t("pages.instances.colLastPlayed")}</Cell>
      <Cell>{t("common.status")}</Cell>
      <span />
      <span />
    </>
  );
  return (
    <List variant="instances" head={head} divided data-kit="list-instances">
      {INST.map((i, k) => (
        <ListRow key={i.id} hit={{ to: "/_kit", label: t("pages.instances.openInstance", { name: i.name }) }} menu={menu} index={k} style={{ "--acc": BIOMES[i.bio].acc } as CSSProperties} {...(k === 1 ? { "data-force": "hover" } : {})}>
          <SceneThumb bio={i.bio} seed={i.seed} />
          <RowTitle title={i.name} sub={t("ui.kit.createdSub", { date: "12.03.2026" })} />
          <Cell>{i.sub.split(" · ")[0]}</Cell>
          <Cell hide={1040}><Count value={i.mods} /></Cell>
          <Cell hide={1040}>{i.last}</Cell>
          <Cell flex>{k === 1 ? <Chip size="s" tone="run" dot>{t("components.game.running")}</Chip> : k === 2 ? <Chip icon="up"><Count value={3} /> {t("common.updates")}</Chip> : null}</Cell>
          <IconButton variant="secondary" icon="play" label={t("common.play")} tip={false} />
          <IconButton icon="more" label={t("ui.kit.moreAbout", { name: i.name })} tip={false} />
        </ListRow>
      ))}
    </List>
  );
}

function ContentLists() {
  const { t } = useI18n();
  // Beispiel-Mods wie im Mock – die Hinweise entstehen hier in der aktuellen Sprache.
  const MODS = [
    { id: "sodium", name: "Sodium", s: "Mod · 0.6.5", on: true, dep: false, warn: "" },
    { id: "fabric-api", name: "Fabric API", s: t("ui.kit.requiredBy"), on: true, dep: true, warn: "" },
    { id: "iris", name: "Iris Shaders mit einem sehr langen Namen, der abgeschnitten wird", s: "Mod · 1.8.1", on: false, dep: false, warn: "" },
    { id: "lithium", name: "Lithium", s: "Mod · 0.14.3", on: true, dep: false, warn: t("ui.kit.notFor") },
  ];
  const [picked, setPicked] = useState<Set<string>>(new Set(["lithium"]));
  const [gone, setGone] = useState(true);
  const pick = (id: string, v: boolean) => setPicked((p) => { const n = new Set(p); if (v) n.add(id); else n.delete(id); return n; });
  const head = (nw: boolean) => (
    <>
      <span><Checkbox checked={false} indeterminate={picked.size > 0} onChange={() => undefined} label={t("detail.content.selectAll")} /></span>
      <span />
      <Cell>{t("common.name")}</Cell>
      {!nw && <Cell>{t("ui.kit.notesCol")}</Cell>}
      <Cell align="end">{t("common.update")}</Cell>
      <Cell align="end">{t("ui.switch.on")}</Cell>
      <span />
    </>
  );
  const rows = (nw: boolean) => (
    <>
      {MODS.map((m) => (
        <ListRow key={m.id} selected={picked.has(m.id)} off={!m.on} dep={m.dep}>
          <Checkbox checked={picked.has(m.id)} onChange={(v) => pick(m.id, v)} label={t("detail.content.selectItem", { name: m.name })} />
          <ProjectIcon seed={m.id} />
          <RowTitle title={m.name} sub={m.s} />
          {!nw && <Cell flex>{m.warn && <><Chip size="s" tone="warn" dot data-hide="1040">{m.warn}</Chip><Button variant="ghost" size="s" tone="warn">{t("ui.kit.fix")}</Button></>}</Cell>}
          <Cell flex align="end">{m.id === "sodium" ? <Button size="s" icon="up" width={96}>0.6.6</Button> : null}</Cell>
          <Cell flex align="end"><Switch checked={m.on} onChange={() => undefined} label={t("detail.content.enabledLabel", { name: m.name })} /></Cell>
          <IconButton size="s" icon="more" label={t("ui.kit.moreAbout", { name: m.name })} tip={false} />
        </ListRow>
      ))}
      {gone ? <GhostRow variant="content" text={t("ui.kit.removedModMenu")} media={<ProjectIcon seed="modmenu" />} undoId="g1" onUndo={() => setGone(false)} /> : null}
      <GhostRow variant="content" text={t("ui.kit.removedClothConfig")} media={<ProjectIcon seed="cloth" />} />
    </>
  );
  return (
    <>
      <List variant="content" head={head(false)} divided data-kit="list-content">{rows(false)}</List>
      <span style={cap}>noWarnCol</span>
      <List variant="content" noWarnCol head={head(true)} divided data-kit="list-content-nw">{rows(true)}</List>
      <span style={cap}>tiles (Kacheln)</span>
      <List variant="tiles" data-kit="list-tiles">
        {MODS.map((m) => (
          <ListRow key={m.id} selected={picked.has(m.id)} off={!m.on}>
            <ProjectIcon seed={m.id} box={52} />
            <RowTitle title={m.name} />
            <span><Switch checked={m.on} onChange={() => undefined} label={t("detail.content.enabledLabel", { name: m.name })} /><IconButton size="s" icon="more" label={t("ui.kit.moreAbout", { name: m.name })} tip={false} /></span>
            <span>{m.warn ? <Chip size="s" tone="warn" dot>{m.warn}</Chip> : <span className="ell">{m.s}</span>}</span>
            <span>{m.id === "sodium" ? <Button size="s" icon="up" width={96}>0.6.6</Button> : null}</span>
          </ListRow>
        ))}
        <GhostRow variant="tile" text={t("ui.kit.removedModMenu")} undoId="g1" onUndo={() => undefined} />
      </List>
    </>
  );
}

const HITS = [
  { id: "sodium", name: "Sodium", a: "von jellysquid3", d: "Die schnellste Rendering-Engine für Minecraft, verbessert die Bildrate deutlich und behebt viele Grafikfehler. Läuft mit fast allen Mods zusammen.", n: "48,1 Mio." },
  { id: "iris", name: "Iris Shaders", a: "von coderbot", d: "Shader-Unterstützung für Fabric, kompatibel mit OptiFine-Shaderpaketen.", n: "22,3 Mio." },
  { id: "lithium", name: "Lithium", a: "von CaffeineMC", d: "Optimiert Spiellogik, Physik und KI, ohne das Verhalten zu ändern.", n: "19,8 Mio." },
];

function CatalogLists() {
  const { t } = useI18n();
  const meta = (n: string) => (
    <>
      <span><Count value={n} /> Downloads</span>
      <Chip size="s" data-hide="900">{t("components.category.optimization")}</Chip>
      <Chip size="s" data-hide="900">Client</Chip>
    </>
  );
  return (
    <>
      <List variant="catalog" data-kit="list-catalog">
        {HITS.map((h, k) => (
          <ListRow key={h.id} feature={k === 0} index={k} hit={{ onClick: () => undefined, label: t("components.search.viewProject", { name: h.name }) }} {...(k === 2 ? { "data-force": "hover" } : {})}>
            <ProjectIcon seed={h.id} box={k === 0 ? 104 : 72} />
            <RowTitle size={k === 0 ? "feature" : "l"} title={h.name} aside={h.a} sub={h.d} meta={meta(h.n)} />
            <Cell flex align="end"><Button size="s" icon="plus">{t("common.add")}</Button></Cell>
          </ListRow>
        ))}
      </List>
      <span style={cap}>{t("ui.kit.secSheetCatalog")}</span>
      <Panel pad="s" style={{ maxWidth: 520 }}>
        <List variant="catalog-compact" data-kit="list-compact">
          {HITS.map((h) => (
            <ListRow key={h.id} hit={{ onClick: () => undefined, label: t("components.search.viewProject", { name: h.name }) }}>
              <ProjectIcon seed={h.id} box={40} />
              <RowTitle size="l" title={h.name} sub={h.d} meta={<span><Count value={h.n} /> Downloads</span>} />
              <Cell flex align="end"><Button size="s" icon="plus">{t("common.add")}</Button></Cell>
            </ListRow>
          ))}
        </List>
      </Panel>
    </>
  );
}

function SmallLists() {
  const { t } = useI18n();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 360px))", gap: 24, alignItems: "start" }}>
      <Panel pad="m" data-kit="list-versions">
        <h3 style={{ ...cap, marginBottom: 6 }}>{t("components.detail.versions")}</h3>
        <List variant="versions">
          {["mc1.21.4-0.6.5", "mc1.21.4-0.6.4-beta", "mc1.21.1-0.6.0"].map((v, k) => (
            <ListRow key={v}>
              <RowTitle title={v} sub={`Fabric, Quilt · 1.21.4${k === 1 ? " · Beta" : ""}`} />
              <IconButton size="s" icon="plus" label={t("ui.kit.addVersion", { version: v })} tip={false} />
            </ListRow>
          ))}
        </List>
      </Panel>
      <Panel notch={2} pad="s" data-kit="list-tasks">
        <List variant="tasks" divided>
          {[
            { t: t("ui.tasks.installing", { name: "Sodium" }), s: t("ui.kit.filesProgress", { done: 3, total: 7 }), p: "42 %", i: "dl" as const, c: "var(--copper)" },
            { t: t("ui.kit.instanceCreated", { name: "Überlebenswelt" }), s: t("ui.kit.minutesAgo"), p: "", i: "check" as const, c: "var(--run)" },
            { t: t("ui.kit.downloadFailed"), s: t("components.offline.title"), p: "", i: "warn" as const, c: "var(--bad)" },
          ].map((task) => (
            <ListRow key={task.t}>
              <span style={{ color: task.c }}><Icon name={task.i} /></span>
              <RowTitle title={task.t} sub={task.s} />
              <Cell align="end"><Count value={task.p} size={18} /></Cell>
              {task.p ? <IconButton size="s" icon="x" label={t("common.cancel")} tip={false} /> : <span />}
            </ListRow>
          ))}
        </List>
      </Panel>
      <div data-kit="list-accounts">
        <List variant="accounts">
          {["Steve", "Alex_der_Große"].map((n, k) => (
            <ListRow key={n} selected={k === 0}>
              <Avatar name={n} />
              <RowTitle title={n} sub={k === 0 ? t("ui.kit.msActive") : t("ui.offline.label")} />
              {k > 0 && <Button size="s">{t("components.account.switch")}</Button>}
              <Button variant="ghost" size="s">{k === 0 ? t("components.account.signOutPlain") : t("common.remove")}</Button>
            </ListRow>
          ))}
        </List>
      </div>
    </div>
  );
}

export function CardsSection() {
  const { t } = useI18n();
  return (
    <>
      <Sec title={t("ui.kit.secGlyphs")} id="glyphs"><IconAudit /></Sec>
      <Sec title={t("ui.kit.secPosters")} id="poster"><Posters /></Sec>
      <Sec title={t("ui.kit.secMinis")} id="mini">
        <Minis />
        <Thumbs />
      </Sec>
      <Sec title={t("ui.kit.secChoice")} id="choice"><Choices /></Sec>
      <Sec title={t("ui.kit.secPanels")} id="panel"><Panels /></Sec>
      <Sec title={t("ui.kit.secLibraryList")} id="l-inst"><InstanceList /></Sec>
      <Sec title={t("ui.kit.secContentList")} id="l-content"><ContentLists /></Sec>
      <Sec title={t("ui.kit.secCatalogList")} id="l-cat"><CatalogLists /></Sec>
      <Sec title={t("ui.kit.secSmallLists")} id="l-small"><SmallLists /></Sec>
    </>
  );
}
