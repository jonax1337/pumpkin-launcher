/**
 * Nur Entwicklung (/_kit): Vorschau Karten und Listen (Kit-Paket A2/3).
 * Glyphen/Projektbilder/Köpfe in allen Boxen (Raster gestrichelt), Szenenkarten, Auswahlkarten, Platten, alle Listenraster.
 * Zustände per data-force (hover/press/focus); Pixelstufe oben auf der Seite.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
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
      <h2 className="h-sec">{title}</h2>
      {children}
    </section>
  );
}
const Lab = ({ children }: { children: ReactNode }) => <span style={{ ...cap, width: 110, flex: "none" }}>{children}</span>;

/** Beispielinstanzen wie im Mock (Name, Loader, Biom, Seed). */
const INST: { id: string; name: string; sub: string; bio: Biome; seed: number; mods: number; last: string }[] = [
  { id: "a", name: "Überlebenswelt", sub: "Fabric 1.21.4 · vor 2 Std.", bio: "forest", seed: 7, mods: 42, last: "vor 2 Std." },
  { id: "b", name: "Nether-Expedition mit Freunden", sub: "NeoForge 1.21.1 · gestern", bio: "nether", seed: 3, mods: 118, last: "gestern" },
  { id: "c", name: "ÄÖÜ Größenwahn Übermäßig Lange Überschrift", sub: "Quilt 1.20.1 · vor 3 Tagen", bio: "snow", seed: 11, mods: 7, last: "vor 3 Tagen" },
  { id: "d", name: "Küste", sub: "Vanilla 1.21.4 · noch nie", bio: "sea", seed: 5, mods: 0, last: "noch nie" },
  { id: "e", name: "Endstadt", sub: "Fabric 1.21.4 · vor 1 Woche", bio: "end", seed: 2, mods: 64, last: "vor 1 Woche" },
];
const look = (i: (typeof INST)[number]) => ({ bio: i.bio, seed: i.seed, acc: BIOMES[i.bio].acc });
const MENU: MenuEntry[] = [
  { id: "open", text: "Öffnen", icon: "ext", onSelect: () => undefined },
  { id: "folder", text: "Ordner öffnen", icon: "folder", onSelect: () => undefined },
  "-",
  { id: "del", text: "Löschen", icon: "trash", bad: true, onSelect: () => undefined },
];

const GLYPHS: [GlyphName, GlyphPalette][] = [["cube", "copper"], ["chest", "sand"], ["compass", "ice"], ["rocket", "coral"], ["leaf", "teal"]];
const BOXES: GlyphBox[] = [40, 52, 64, 72, 104];
/** Projektbild ohne Netz: kleines SVG als Daten-URL */
const IMG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" shape-rendering="crispEdges"><rect width="4" height="4" fill="#376A7C"/><rect x="1" y="1" width="2" height="2" fill="#F3BD8B"/></svg>')}`;

function IconAudit() {
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
        <span style={cell} title="kaputt → Glyphe"><ProjectIcon url="/gibt-es-nicht.png" seed="sodium" box={52} /></span>
        <span style={cell} title="ohne Bild"><ProjectIcon seed="lithium" box={72} /></span>
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
  const primary = <Button variant="primary" icon="play" width={176}>Spielen</Button>;
  const actions = <IconButton onScene size="s" icon="more" label="Mehr" tip={false} />;
  const status = (k: number) => (k === 1 ? <Chip size="s" tone="run" dot>Läuft</Chip> : k === 2 ? <Chip icon="up"><Count value={3} /> Updates</Chip> : null);
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
          hit={{ to: "/_kit", label: `${i.name} öffnen` }}
          menu={MENU}
          index={k}
          data-force={force[k]}
        />
      ))}
      <AddCard variant="poster" label="Neue Instanz" />
    </CardGrid>
  );
}

function Minis() {
  const [cur, setCur] = useState("a");
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

function Thumbs() {
  const [bio, setBio] = useState<Biome>("forest");
  return (
    <CardGrid variant="thumb" role="group" aria-label="Szene wählen" data-kit="thumbs">
      {(Object.keys(BIOMES) as Biome[]).map((b) => (
        <SceneCard key={b} variant="thumb" look={{ bio: b, seed: 7 }} title={BIOMES[b].n} pressed={bio === b} hit={{ onClick: () => setBio(b) }} data-force={b === "snow" ? "hover" : b === "sea" ? "focus" : undefined} />
      ))}
      <SceneCard variant="thumb" look={{ bio: "plains", seed: 3 }} title="Gewählt + Fokus" pressed hit={{ onClick: () => undefined }} data-force="focus" />
    </CardGrid>
  );
}

function Choices() {
  const [pk, setPk] = useState("fab");
  const [st, setSt] = useState("blank");
  const PACKS = [
    { id: "fab", t: "Fabulously Optimized", s: "von robotkoer · Schnell und schön, fertig eingerichtet", n: "12,4 Mio.", f: undefined },
    { id: "aof", t: "All of Fabric 7", s: "von Pyrofab · Große Sammlung", n: "3,1 Mio.", f: "hover" },
    { id: "sky", t: "SkyFactory One", s: "von Bacon_Donut · Himmelsinsel", n: "812.000", f: "press" },
    { id: "foc", t: "Fokus-Beispiel", s: "data-force=focus", n: "1.200", f: "focus" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 520px) minmax(0, 420px)", gap: 24, alignItems: "start" }}>
      <Panel level="raised" notch={2} pad="s" data-kit="choice-m">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {PACKS.map((p) => (
            <Choice
              key={p.id}
              media={<ProjectIcon seed={p.id} box={40} />}
              title={p.t}
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
      <div role="radiogroup" aria-label="Start" style={{ display: "flex", flexDirection: "column", gap: 8 }} data-kit="choice-l">
        {[
          { id: "blank", g: "cube" as GlyphName, p: "copper" as GlyphPalette, t: "Leere Instanz", s: "Vanilla oder mit Loader, du wählst die Version." },
          { id: "pack", g: "chest" as GlyphName, p: "sand" as GlyphPalette, t: "Modpack", s: "Fertige Sammlung von Modrinth." },
          { id: "file", g: "compass" as GlyphName, p: "ice" as GlyphPalette, t: "Aus Datei", s: ".mrpack oder Ordner importieren." },
        ].map((s) => (
          <Choice key={s.id} size="l" role="radio" media={<Glyph name={s.g} pal={s.p} />} title={s.t} sub={s.s} selected={st === s.id} onClick={() => setSt(s.id)} />
        ))}
        <Choice size="l" media={<Glyph name="rocket" pal="coral" />} title="Hover (erzwungen)" sub="Platte heller, Umriss" selected={false} data-force="hover" />
      </div>
    </div>
  );
}

function Panels() {
  return (
    <div style={row} data-kit="panels">
      {(["plate", "raised", "sunk"] as const).map((l) => (
        <Panel key={l} level={l} pad="m" style={{ width: 170 }}><b>{l}</b><p className="faint" style={{ fontSize: 12 }}>notch 1, pad m</p></Panel>
      ))}
      <Panel notch={2} pad="l" style={{ width: 170 }}><b>notch 2</b><p className="faint" style={{ fontSize: 12 }}>pad l</p></Panel>
      {(["copper", "warn", "bad", "run"] as const).map((t) => (
        <Panel key={t} tone={t} pad="s" style={{ width: 130 }}><b>{t}</b></Panel>
      ))}
      <Panel selected pad="m" style={{ width: 170 }}><b>selected</b><p className="faint" style={{ fontSize: 12 }}>Kupfer + 10 %</p></Panel>
      <Panel pad="s" style={{ width: 240 }}>
        <span style={cap}>Overlay-Kontext: Hover eine Stufe heller</span>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button variant="ghost" icon="copy" data-force="hover">Kopieren</Button>
          <IconButton icon="x" label="Schließen" tip={false} data-force="hover" />
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
        <ListRow key={i.id} hit={{ to: "/_kit", label: `${i.name} öffnen` }} menu={MENU} index={k} style={{ "--acc": BIOMES[i.bio].acc } as CSSProperties} {...(k === 1 ? { "data-force": "hover" } : {})}>
          <SceneThumb bio={i.bio} seed={i.seed} />
          <RowTitle title={i.name} sub="erstellt 12.03.2026" />
          <Cell>{i.sub.split(" · ")[0]}</Cell>
          <Cell hide={1040}><Count value={i.mods} /></Cell>
          <Cell hide={1040}>{i.last}</Cell>
          <Cell flex>{k === 1 ? <Chip size="s" tone="run" dot>Läuft</Chip> : k === 2 ? <Chip icon="up"><Count value={3} /> Updates</Chip> : null}</Cell>
          <IconButton variant="secondary" icon="play" label="Spielen" tip={false} />
          <IconButton icon="more" label={`Mehr zu ${i.name}`} tip={false} />
        </ListRow>
      ))}
    </List>
  );
}

const MODS = [
  { id: "sodium", t: "Sodium", s: "Mod · 0.6.5", on: true, dep: false, warn: "" },
  { id: "fabric-api", t: "Fabric API", s: "benötigt von Sodium", on: true, dep: true, warn: "" },
  { id: "iris", t: "Iris Shaders mit einem sehr langen Namen, der abgeschnitten wird", s: "Mod · 1.8.1", on: false, dep: false, warn: "" },
  { id: "lithium", t: "Lithium", s: "Mod · 0.14.3", on: true, dep: false, warn: "Nicht für 1.21.4" },
];

function ContentLists() {
  const [picked, setPicked] = useState<Set<string>>(new Set(["lithium"]));
  const [gone, setGone] = useState(true);
  const pick = (id: string, v: boolean) => setPicked((p) => { const n = new Set(p); if (v) n.add(id); else n.delete(id); return n; });
  const head = (nw: boolean) => (
    <>
      <span><Checkbox checked={false} indeterminate={picked.size > 0} onChange={() => undefined} label="Alle auswählen" /></span>
      <span />
      <Cell>Name</Cell>
      {!nw && <Cell>Hinweise</Cell>}
      <Cell align="end">Update</Cell>
      <Cell align="end">An</Cell>
      <span />
    </>
  );
  const rows = (nw: boolean) => (
    <>
      {MODS.map((m) => (
        <ListRow key={m.id} selected={picked.has(m.id)} off={!m.on} dep={m.dep}>
          <Checkbox checked={picked.has(m.id)} onChange={(v) => pick(m.id, v)} label={`${m.t} auswählen`} />
          <ProjectIcon seed={m.id} />
          <RowTitle title={m.t} sub={m.s} />
          {!nw && <Cell flex>{m.warn && <><Chip size="s" tone="warn" dot data-hide="1040">{m.warn}</Chip><Button variant="ghost" size="s" tone="warn">Beheben</Button></>}</Cell>}
          <Cell flex align="end">{m.id === "sodium" ? <Button size="s" icon="up" width={96}>0.6.6</Button> : null}</Cell>
          <Cell flex align="end"><Switch checked={m.on} onChange={() => undefined} label={`${m.t} eingeschaltet`} /></Cell>
          <IconButton size="s" icon="more" label={`Mehr zu ${m.t}`} tip={false} />
        </ListRow>
      ))}
      {gone ? <GhostRow variant="content" text="Mod Menu entfernt" media={<ProjectIcon seed="modmenu" />} undoId="g1" onUndo={() => setGone(false)} /> : null}
      <GhostRow variant="content" text="Cloth Config entfernt (mit Mod Menu)" media={<ProjectIcon seed="cloth" />} />
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
            <RowTitle title={m.t} />
            <span><Switch checked={m.on} onChange={() => undefined} label={`${m.t} eingeschaltet`} /><IconButton size="s" icon="more" label={`Mehr zu ${m.t}`} tip={false} /></span>
            <span>{m.warn ? <Chip size="s" tone="warn" dot>{m.warn}</Chip> : <span className="ell">{m.s}</span>}</span>
            <span>{m.id === "sodium" ? <Button size="s" icon="up" width={96}>0.6.6</Button> : null}</span>
          </ListRow>
        ))}
        <GhostRow variant="tile" text="Mod Menu entfernt" undoId="g1" onUndo={() => undefined} />
      </List>
    </>
  );
}

const HITS = [
  { id: "sodium", t: "Sodium", a: "von jellysquid3", d: "Die schnellste Rendering-Engine für Minecraft, verbessert die Bildrate deutlich und behebt viele Grafikfehler. Läuft mit fast allen Mods zusammen.", n: "48,1 Mio." },
  { id: "iris", t: "Iris Shaders", a: "von coderbot", d: "Shader-Unterstützung für Fabric, kompatibel mit OptiFine-Shaderpaketen.", n: "22,3 Mio." },
  { id: "lithium", t: "Lithium", a: "von CaffeineMC", d: "Optimiert Spiellogik, Physik und KI, ohne das Verhalten zu ändern.", n: "19,8 Mio." },
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
          <ListRow key={h.id} feature={k === 0} index={k} hit={{ onClick: () => undefined, label: `${h.t} ansehen` }} {...(k === 2 ? { "data-force": "hover" } : {})}>
            <ProjectIcon seed={h.id} box={k === 0 ? 104 : 72} />
            <RowTitle size={k === 0 ? "feature" : "l"} title={h.t} aside={h.a} sub={h.d} meta={meta(h.n)} />
            <Cell flex align="end"><Button size="s" icon="plus">Hinzufügen</Button></Cell>
          </ListRow>
        ))}
      </List>
      <span style={cap}>catalog-compact (Seitenpanel)</span>
      <Panel pad="s" style={{ maxWidth: 520 }}>
        <List variant="catalog-compact" data-kit="list-compact">
          {HITS.map((h) => (
            <ListRow key={h.id} hit={{ onClick: () => undefined, label: `${h.t} ansehen` }}>
              <ProjectIcon seed={h.id} box={40} />
              <RowTitle size="l" title={h.t} sub={h.d} meta={<span><Count value={h.n} /> Downloads</span>} />
              <Cell flex align="end"><Button size="s" icon="plus">Hinzufügen</Button></Cell>
            </ListRow>
          ))}
        </List>
      </Panel>
    </>
  );
}

function SmallLists() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 360px))", gap: 24, alignItems: "start" }}>
      <Panel pad="m" data-kit="list-versions">
        <h3 style={{ ...cap, marginBottom: 6 }}>Versionen</h3>
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
          {[
            { t: "Sodium wird installiert", s: "3 von 7 Dateien", p: "42 %", i: "dl" as const, c: "var(--copper)" },
            { t: "Überlebenswelt angelegt", s: "vor 2 Min.", p: "", i: "check" as const, c: "var(--run)" },
            { t: "Download fehlgeschlagen", s: "Keine Verbindung", p: "", i: "warn" as const, c: "var(--bad)" },
          ].map((t) => (
            <ListRow key={t.t}>
              <span style={{ color: t.c }}><Icon name={t.i} /></span>
              <RowTitle title={t.t} sub={t.s} />
              <Cell align="end"><Count value={t.p} size={18} /></Cell>
              {t.p ? <IconButton size="s" icon="x" label="Abbrechen" tip={false} /> : <span />}
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
      <Sec title="Poster" id="poster"><Posters /></Sec>
      <Sec title="Miniaturen und Szenen-Thumbs" id="mini">
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
