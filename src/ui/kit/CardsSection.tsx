/**
 * Nur Entwicklung (/_kit): Vorschau Karten und Listen.
 * Glyphen/Projektbilder/Köpfe in allen Boxen (Raster gestrichelt), Szenenkarten, Auswahlkarten, Platten, alle Listenraster.
 * Zustände per data-force (hover/press/focus); Pixelstufe oben auf der Seite.
 */
import { useState } from "react";
import { IconView } from "@/components/InstanceIcon";
import { BIOMES, type Biome } from "@/pixel/scene";
import type { GlyphName, GlyphPalette } from "@/pixel/icons";
import {
  AddCard, Avatar, Button, CardGrid, Cell, Checkbox, Chip, Choice, Count, GhostRow, Glyph, Icon, IconButton, List, ListRow, Panel,
  ProjectIcon, RowTitle, SceneCard, SceneThumb, Switch, ThumbCard, type GlyphBox, type MenuEntry,
} from "@/ui";
import { cssVars } from "../util";
import { Cap, Frame, Lab, Sec } from "./kit-ui";

const MENU: MenuEntry[] = [
  { id: "open", text: "Öffnen", icon: "external", onSelect: () => undefined },
  { id: "folder", text: "Ordner öffnen", icon: "folder", onSelect: () => undefined },
  "-",
  { id: "del", text: "Löschen", icon: "trash", bad: true, onSelect: () => undefined },
];

/** Beispielinstanzen (Name, Loader, Biom, Seed) */
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

/** Zustand eines Beispiels per Instanz-Position erzwingen. */
const instanceStatus = (k: number) =>
  k === 1 ? <Chip size="s" tone="run" dot>Läuft</Chip> : k === 2 ? <Chip icon="update"><Count value={3} /> Updates</Chip> : null;

function IconAudit() {
  return (
    <div className="kit-stack" data-gap="12">
      {GLYPHS.slice(0, 2).map(([g, p]) => (
        <div key={g} className="kit-row">
          <Lab>Glyph {g}</Lab>
          {BOXES.map((b) => <Frame key={b} title={`box ${b}`}><Glyph name={g} pal={p} box={b} /></Frame>)}
        </div>
      ))}
      <div className="kit-row">
        <Lab>ProjectIcon</Lab>
        {BOXES.map((b) => <Frame key={b}><ProjectIcon url={IMG} seed="x" box={b} /></Frame>)}
        <Frame title="kaputt → Glyphe"><ProjectIcon url="/gibt-es-nicht.png" seed="sodium" box={52} /></Frame>
        <Frame title="ohne Bild"><ProjectIcon seed="lithium" box={72} /></Frame>
      </div>
      <div className="kit-row">
        <Lab>Avatar 28 · 32</Lab>
        {["Steve", "Alex", "Notch"].map((n) => (
          <span key={n} className="kit-avatars">
            <Frame><Avatar name={n} box={28} /></Frame>
            <Frame><Avatar name={n} box={32} /></Frame>
          </span>
        ))}
      </div>
    </div>
  );
}


function Minis() {
  const [cur, setCur] = useState("a");
  return (
    <div className="kit-row" data-gap="12" data-kit="minis">
      {INST.map((i, n) => (
        <SceneCard
          key={i.id}
          data-force={n === 2 ? "hover" : n === 3 ? "focus" : undefined}
          look={look(i)}
          art={<IconView icon={{ type: "glyph", glyph: GLYPHS[n][0], palette: GLYPHS[n][1] }} bio={i.bio} fallback={{ type: "glyph", glyph: "cube", palette: "copper" }} />}
          title={i.name}
          sub={i.sub}
          current={cur === i.id}
          status={i.id === "b" ? <Chip size="s" tone="run" dot>Läuft</Chip> : undefined}
          primary={<IconButton variant="primary" size="s" icon="play" label="Spielen" tip={false} />}
          hit={{ onClick: () => setCur(i.id), onDoubleClick: () => undefined }}
          tip="Klick zeigt sie oben, Doppelklick oder Enter öffnet sie."
          menu={MENU}
        />
      ))}
      <AddCard label="Neue Instanz" />
    </div>
  );
}

const BIOME_NAMES: Record<Biome, string> = { forest: "Wald am Abend", nether: "Nether", end: "End", snow: "Schneeberge", cave: "Höhle", sea: "Küste", plains: "Ebene" };

function Thumbs() {
  const [bio, setBio] = useState<Biome>("forest");
  return (
    <CardGrid variant="thumb" role="group" aria-label="Szene wählen" data-kit="thumbs">
      {(Object.keys(BIOMES) as Biome[]).map((b) => (
        <ThumbCard key={b} look={{ bio: b, seed: 7 }} title={BIOME_NAMES[b]} pressed={bio === b} hit={{ onClick: () => setBio(b) }} data-force={b === "snow" ? "hover" : b === "sea" ? "focus" : undefined} />
      ))}
      <ThumbCard look={{ bio: "plains", seed: 3 }} title="Gewählt + Fokus" pressed hit={{ onClick: () => undefined }} data-force="focus" />
    </CardGrid>
  );
}

const PACKS = [
  { id: "fab", name: "Fabulously Optimized", s: "von robotkoer · Schnell und schön, fertig eingerichtet", n: "12,4 Mio.", f: undefined },
  { id: "aof", name: "All of Fabric 7", s: "von Pyrofab · Große Sammlung", n: "3,1 Mio.", f: "hover" },
  { id: "sky", name: "SkyFactory One", s: "von Bacon_Donut · Himmelsinsel", n: "812.000", f: "press" },
  { id: "foc", name: "Fokus-Beispiel", s: "data-force=focus", n: "1.200", f: "focus" },
];

const STARTS: { id: string; g: GlyphName; p: GlyphPalette; t: string; s: string }[] = [
  { id: "blank", g: "cube", p: "copper", t: "Leere Instanz", s: "Vanilla oder mit Loader, du wählst die Version." },
  { id: "pack", g: "chest", p: "sand", t: "Modpack", s: "Fertige Sammlung von Modrinth." },
  { id: "file", g: "compass", p: "ice", t: "Aus Datei", s: ".mrpack oder Ordner importieren." },
];

function Choices() {
  const [pk, setPk] = useState("fab");
  const [st, setSt] = useState("blank");
  return (
    <div className="kit-grid" data-cols="choices">
      <Panel level="raised" notch={2} pad="s" data-kit="choice-m">
        <div className="kit-stack" data-gap="2">
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
          <Choice media={<Glyph name="chest" pal="sand" />} title="Aus (disabled)" sub="Vorlage nicht verfügbar" selected={false} disabled />
          <Choice media={<Glyph name="chest" pal="copper" />} title="Gewählt + Fokus" sub="Doppelring" selected data-force="focus" />
        </div>
      </Panel>
      <div role="radiogroup" aria-label="Start" className="kit-stack" data-gap="8" data-kit="choice-l">
        {STARTS.map((s) => (
          <Choice key={s.id} size="l" role="radio" media={<Glyph name={s.g} pal={s.p} />} title={s.t} sub={s.s} selected={st === s.id} onClick={() => setSt(s.id)} />
        ))}
        <Choice size="l" media={<Glyph name="rocket" pal="coral" />} title="Hover (erzwungen)" sub="Platte heller, Umriss" selected={false} data-force="hover" />
      </div>
    </div>
  );
}

function Panels() {
  return (
    <div className="kit-row" data-kit="panels">
      {(["plate", "raised", "sunk"] as const).map((l) => (
        <Panel key={l} level={l} pad="m" className="kit-panel-w"><b>{l}</b><p className="faint kit-panel-note">notch 1, pad m</p></Panel>
      ))}
      <Panel notch={2} pad="l" className="kit-panel-w"><b>notch 2</b><p className="faint kit-panel-note">pad l</p></Panel>
      <Panel pad="s" className="kit-panel-w" data-wide="">
        <Cap>Überlagerungs-Kontext</Cap>
        <div className="kit-panel-actions">
          <Button variant="ghost" icon="copy" data-force="hover">Kopieren</Button>
          <IconButton icon="close" label="Schließen" tip={false} data-force="hover" />
        </div>
      </Panel>
    </div>
  );
}

function InstanceList() {
  const head = (
    <>
      <span />
      <Cell>Name</Cell>
      <Cell>Version</Cell>
      <Cell hide={1040}>Inhalte</Cell>
      <Cell hide={1040}>Zuletzt gespielt</Cell>
      <Cell>Status</Cell>
      <span />
      <span />
    </>
  );
  return (
    <List variant="instances" head={head} divided data-kit="list-instances">
      {INST.map((i, k) => (
        <ListRow key={i.id} hit={{ to: "/_kit", label: `${i.name} öffnen` }} menu={MENU} index={k} style={cssVars({ "--acc": BIOMES[i.bio].acc })} {...(k === 1 ? { "data-force": "hover" } : {})}>
          <SceneThumb bio={i.bio} seed={i.seed} />
          <RowTitle title={i.name} sub="erstellt 12.03.2026" />
          <Cell>{i.sub.split(" · ")[0]}</Cell>
          <Cell hide={1040}><Count value={i.mods} /></Cell>
          <Cell hide={1040}>{i.last}</Cell>
          <Cell flex>{instanceStatus(k)}</Cell>
          <IconButton variant="secondary" icon="play" label="Spielen" tip={false} />
          <IconButton icon="more" label={`Mehr zu ${i.name}`} tip={false} />
        </ListRow>
      ))}
    </List>
  );
}

const MODS = [
  { id: "sodium", name: "Sodium", s: "Mod · 0.6.5", on: true, dep: false, warn: "" },
  { id: "fabric-api", name: "Fabric API", s: "benötigt von Sodium", on: true, dep: true, warn: "" },
  { id: "iris", name: "Iris Shaders mit einem sehr langen Namen, der abgeschnitten wird", s: "Mod · 1.8.1", on: false, dep: false, warn: "" },
  { id: "lithium", name: "Lithium", s: "Mod · 0.14.3", on: true, dep: false, warn: "Nicht für 1.21.4" },
];

function ContentLists() {
  const [picked, setPicked] = useState<Set<string>>(new Set(["lithium"]));
  const [gone, setGone] = useState(true);
  const pick = (id: string, v: boolean) => setPicked((p) => { const n = new Set(p); if (v) n.add(id); else n.delete(id); return n; });
  const head = (noWarnCol: boolean) => (
    <>
      <span><Checkbox checked={false} indeterminate={picked.size > 0} onChange={() => undefined} label="Alle auswählen" /></span>
      <span />
      <Cell>Name</Cell>
      {!noWarnCol && <Cell>Hinweise</Cell>}
      <Cell align="end">Update</Cell>
      <Cell align="end">An</Cell>
      <span />
    </>
  );
  const rows = (noWarnCol: boolean) => (
    <>
      {MODS.map((m) => (
        <ListRow key={m.id} selected={picked.has(m.id)} off={!m.on} dep={m.dep}>
          <Checkbox checked={picked.has(m.id)} onChange={(v) => pick(m.id, v)} label={`${m.name} auswählen`} />
          <ProjectIcon seed={m.id} />
          <RowTitle title={m.name} sub={m.s} />
          {!noWarnCol && <Cell flex>{m.warn && <><Chip size="s" tone="warn" dot data-hide="1040">{m.warn}</Chip><Button variant="ghost" size="s" tone="warn">Beheben</Button></>}</Cell>}
          <Cell flex align="end">{m.id === "sodium" ? <Button size="s" icon="update" width={96}>0.6.6</Button> : null}</Cell>
          <Cell flex align="end"><Switch checked={m.on} onChange={() => undefined} label={`${m.name} eingeschaltet`} /></Cell>
          <IconButton size="s" icon="more" label={`Mehr zu ${m.name}`} tip={false} />
        </ListRow>
      ))}
      {gone ? <GhostRow variant="content" text="Mod Menu entfernt" media={<ProjectIcon seed="modmenu" />} undoId="g1" onUndo={() => setGone(false)} /> : null}
      <GhostRow variant="content" text="Cloth Config entfernt (mit Mod Menu)" media={<ProjectIcon seed="cloth" />} />
    </>
  );
  return (
    <>
      <List variant="content" head={head(false)} divided data-kit="list-content">{rows(false)}</List>
      <Cap>noWarnCol</Cap>
      <List variant="content" noWarnCol head={head(true)} divided data-kit="list-content-nw">{rows(true)}</List>
      <Cap>tiles (Kacheln)</Cap>
      <List variant="tiles" data-kit="list-tiles">
        {MODS.map((m) => (
          <ListRow key={m.id} selected={picked.has(m.id)} off={!m.on}>
            <ProjectIcon seed={m.id} box={52} />
            <RowTitle title={m.name} />
            <span><Switch checked={m.on} onChange={() => undefined} label={`${m.name} eingeschaltet`} /><IconButton size="s" icon="more" label={`Mehr zu ${m.name}`} tip={false} /></span>
            <span>{m.warn ? <Chip size="s" tone="warn" dot>{m.warn}</Chip> : <span className="ell">{m.s}</span>}</span>
            <span>{m.id === "sodium" ? <Button size="s" icon="update" width={96}>0.6.6</Button> : null}</span>
          </ListRow>
        ))}
        <GhostRow variant="tile" text="Mod Menu entfernt" undoId="g1" onUndo={() => undefined} />
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
  const meta = (n: string) => (
    <>
      <span><Count value={n} /> Downloads</span>
      <Chip size="s" data-hide="900">Optimierung</Chip>
      <Chip size="s" data-hide="900">Client</Chip>
    </>
  );
  return (
    <>
      <List variant="catalog" data-kit="list-catalog">
        {HITS.map((h, k) => (
          <ListRow key={h.id} feature={k === 0} index={k} hit={{ onClick: () => undefined, label: `${h.name} ansehen` }} {...(k === 2 ? { "data-force": "hover" } : {})}>
            <ProjectIcon seed={h.id} box={k === 0 ? 104 : 72} />
            <RowTitle size="l" title={h.name} aside={h.a} sub={h.d} meta={meta(h.n)} />
            <Cell flex align="end"><Button size="s" icon="plus">Hinzufügen</Button></Cell>
          </ListRow>
        ))}
      </List>
      <Cap>Katalog in der Platte</Cap>
      <Panel pad="s" className="kit-max-520">
        <List variant="catalog-compact" data-kit="list-compact">
          {HITS.map((h) => (
            <ListRow key={h.id} hit={{ onClick: () => undefined, label: `${h.name} ansehen` }}>
              <ProjectIcon seed={h.id} box={40} />
              <RowTitle size="l" title={h.name} sub={h.d} meta={<span><Count value={h.n} /> Downloads</span>} />
              <Cell flex align="end"><Button size="s" icon="plus">Hinzufügen</Button></Cell>
            </ListRow>
          ))}
        </List>
      </Panel>
    </>
  );
}

const TASKS = [
  { title: "Sodium wird installiert", sub: "3 von 7 Dateien", p: "42 %", icon: "download", tone: "acc" },
  { title: "Überlebenswelt angelegt", sub: "vor 2 Min.", p: "", icon: "check", tone: "run" },
  { title: "Download fehlgeschlagen", sub: "Keine Verbindung", p: "", icon: "warn", tone: "bad" },
] as const;

function SmallLists() {
  return (
    <div className="kit-grid" data-cols="lists">
      <Panel pad="m" data-kit="list-versions">
        <h3 className="kit-cap kit-h3">Versionen</h3>
        <List variant="versions">
          {["mc1.21.4-0.6.5", "mc1.21.4-0.6.4-beta", "mc1.21.1-0.6.0"].map((v, k) => (
            <ListRow key={v}>
              <RowTitle title={v} sub={`Fabric, Quilt · 1.21.4${k === 1 ? " · Beta" : ""}`} />
              <IconButton size="s" icon="plus" label={`${v} hinzufügen`} tip={false} />
            </ListRow>
          ))}
        </List>
      </Panel>
      <Panel notch={2} pad="s" data-kit="list-tasks">
        <List variant="tasks" divided>
          {TASKS.map((task) => (
            <ListRow key={task.title}>
              <span className="kit-task-icon" data-tone={task.tone}><Icon name={task.icon} /></span>
              <RowTitle title={task.title} sub={task.sub} />
              <Cell align="end"><Count value={task.p} size={18} /></Cell>
              {task.p ? <IconButton size="s" icon="close" label="Abbrechen" tip={false} /> : <span />}
            </ListRow>
          ))}
        </List>
      </Panel>
      <div data-kit="list-accounts">
        <List variant="accounts">
          {["Steve", "Alex_der_Große"].map((n, k) => (
            <ListRow key={n} selected={k === 0}>
              <Avatar name={n} />
              <RowTitle title={n} sub={k === 0 ? "Microsoft · aktiv" : "Offline"} />
              {k > 0 && <Button size="s">Wechseln</Button>}
              <Button variant="ghost" size="s">{k === 0 ? "Abmelden" : "Entfernen"}</Button>
            </ListRow>
          ))}
        </List>
      </div>
    </div>
  );
}

export function CardsSection() {
  return (
    <>
      <Sec title="Glyphen, Projektbilder, Köpfe" id="glyphs"><IconAudit /></Sec>
      <Sec title="Wallpaper und Szenen-Thumbs" id="mini">
        <Minis />
        <Thumbs />
      </Sec>
      <Sec title="Auswahl (Choice)" id="choice"><Choices /></Sec>
      <Sec title="Platten (Panel)" id="panel"><Panels /></Sec>
      <Sec title="Liste Bibliothek" id="l-inst"><InstanceList /></Sec>
      <Sec title="Liste Inhalte" id="l-content"><ContentLists /></Sec>
      <Sec title="Liste Katalog" id="l-cat"><CatalogLists /></Sec>
      <Sec title="Versionen, Aufgaben, Konten" id="l-small"><SmallLists /></Sec>
    </>
  );
}
