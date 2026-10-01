/**
 * Nur Entwicklung (/_kit): Vorschau Tabs, Formular und Umschalter (Kit-Paket A2/1).
 * Zustände per data-force (hover/press), aus per disabled; Overlay-Kontext in einer Platte.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Checkbox, Disclosure, Field, FormRow, FormSection, Hint, Icon, NavTabs, Radio, RadioGroup, SearchField, SegSlider, Segmented, Select, Switch,
  TabPanel, Tabs, TextArea, TextField, type TabItem,
} from "@/ui";

const cap: CSSProperties = { fontSize: 12, color: "var(--fg-3)", fontWeight: 600 };
const sec: CSSProperties = { display: "flex", flexDirection: "column", gap: 14, padding: "22px 0", boxShadow: "inset 0 calc(var(--px) * -1) 0 var(--line)" };
const row: CSSProperties = { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" };

function Sec({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section style={sec} data-kit={`sec-${id}`}>
      <h2 className="vx-h">{title}</h2>
      {children}
    </section>
  );
}

function Lab({ children }: { children: ReactNode }) {
  return <span style={{ ...cap, width: 110, flex: "none" }}>{children}</span>;
}

type T = "content" | "console" | "settings" | "off";
const TABS: TabItem<T>[] = [
  { value: "content", label: "Inhalte", count: 42, badge: <Icon name="warn" size="s" tone="warn" /> },
  { value: "console", label: "Protokoll" },
  { value: "settings", label: "Einstellungen" },
  { value: "off", label: "Welten", disabled: true },
];
type W = "blank" | "pack" | "file";
const WAYS: TabItem<W>[] = [
  { value: "blank", label: "Leer", icon: "plus" },
  { value: "pack", label: "Modpack", icon: "box" },
  { value: "file", label: "Aus Datei", icon: "file" },
];
type V = "grid" | "list";
const VIEWS: TabItem<V>[] = [
  { value: "grid", label: "Poster", icon: "grid" },
  { value: "list", label: "Liste", icon: "list" },
];

function TabsDemo() {
  const [t, setT] = useState<T>("content");
  const [w, setW] = useState<W>("blank");
  const [v, setV] = useState<V>("grid");
  const [f, setF] = useState("all");
  const [px, setPx] = useState("m");
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={cap}>underline m · idBase + TabPanel · Zähler + Badge · aus</span>
        <Tabs label="Bereiche der Instanz" items={TABS} value={t} onChange={setT} idBase="kit-dt" />
        <TabPanel idBase="kit-dt" value={t} style={{ padding: "10px 0", color: "var(--fg-2)" }}>Inhalt von „{t}“</TabPanel>
        <span style={cap}>underline s mit Icons · erzwungen hover / press</span>
        <div style={row}>
          <Tabs size="s" label="Weg klein" items={WAYS} value={w} onChange={setW} />
          <span className="vx-tabs" data-variant="underline" style={{ boxShadow: "none" }}>
            <button type="button" className="vx-tab fx" data-force="hover" tabIndex={-1}><span className="vx-tc">hover</span><i className="vx-tab-tick" /></button>
            <button type="button" className="vx-tab fx" data-force="press" tabIndex={-1}><span className="vx-tc">press</span><i className="vx-tab-tick" /></button>
          </span>
        </div>
        <span style={cap}>NavTabs (Links, aria-current)</span>
        <NavTabs items={[
          { to: "/_kit", label: "Kit", match: (p) => p.startsWith("/_kit"), shortcut: "Control+1" },
          { to: "/instances", label: "Bibliothek", match: (p) => p.startsWith("/instances"), shortcut: "Control+2" },
          { to: "/discover", label: "Entdecken", match: (p) => p.startsWith("/discover"), shortcut: "Control+3" },
        ]} />
      </div>
      <div style={{ ...row, alignItems: "flex-start" }}>
        <div style={{ width: 168 }} data-kit="vertical">
          <span style={cap}>vertical m</span>
          <Tabs variant="vertical" label="Weg" items={WAYS} value={w} onChange={setW} idBase="kit-ni" />
        </div>
        <div style={{ width: 168 }}>
          <span style={cap}>vertical s</span>
          <Tabs variant="vertical" size="s" label="Weg (klein)" items={WAYS} value={w} onChange={setW} />
        </div>
        <div className="plate" style={{ width: 200, padding: 12 }}>
          <span style={cap}>vertical in Platte</span>
          <Tabs variant="vertical" label="Weg (Platte)" items={WAYS} value={w} onChange={setW} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-kit="segments">
          <span style={cap}>Segmented m · s · nur Symbole · tablist</span>
          <Segmented label="Ansicht" items={VIEWS} value={v} onChange={setV} />
          <Segmented size="s" label="Pixelgröße" items={[{ value: "s", label: "Klein" }, { value: "m", label: "Mittel" }, { value: "l", label: "Groß" }, { value: "x", label: "Riesig", disabled: true }]} value={px} onChange={setPx} />
          <div style={row}>
            <Segmented iconsOnly label="Ansicht (Symbole)" items={VIEWS} value={v} onChange={setV} />
            <Segmented iconsOnly size="s" label="Ansicht (Symbole, klein)" items={VIEWS} value={v} onChange={setV} />
          </div>
          <Tabs variant="segment" label="Filter" items={[{ value: "all", label: "Alle", count: 42 }, { value: "mod", label: "Mods", count: 38 }, { value: "rp", label: "Pakete", count: 4 }]} value={f} onChange={setF} />
          <div className="plate" style={{ padding: 12 }}>
            <Segmented size="s" label="Ansicht (Platte)" items={VIEWS} value={v} onChange={setV} />
          </div>
        </div>
      </div>
    </>
  );
}

const OPTS = [
  { value: "1.21.4", label: "1.21.4 (neueste)" },
  { value: "1.21.3", label: "1.21.3" },
  { value: "1.20.1", label: "1.20.1" },
  { value: "24w14a", label: "24w14a (Vorabversion)" },
  { value: "x", label: "Nicht verfügbar", disabled: true },
];

function FormDemo() {
  const [name, setName] = useState("Survival");
  const [java, setJava] = useState<"auto" | "own">("auto");
  const [motion, setMotion] = useState(true);
  const [args, setArgs] = useState("");
  return (
    <div style={{ maxWidth: "var(--page-max)" }} data-kit="form">
      <FormSection title="Allgemein">
        <FormRow label="Name" htmlFor="kit-name" aside="Erscheint auf Start, Poster und Kopf. Höchstens 64 Zeichen.">
          <TextField id="kit-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label="Java" hint="Standard für alle Instanzen" group="radiogroup" aside="Automatisch passt fast immer.">
          <RadioGroup name="kit-java" value={java} onChange={setJava} options={[{ value: "auto", label: <>Automatisch <span className="faint">(Pumpkin Launcher lädt die passende Version)</span></> }, { value: "own", label: "Eigene Java-Installation" }]} />
          <TextField disabled={java === "auto"} aria-label="Pfad zu Java" placeholder="Pfad zu Java" />
        </FormRow>
        <FormRow label="Bewegte Szenen" hint="Sterne, Wolken, Glut.">
          <Switch checked={motion} onChange={setMotion} label="Bewegte Szenen" stateText={["An", "Aus"]} />
        </FormRow>
        <FormRow label="Erweitert">
          <Disclosure summary="Java-Startoptionen">
            <TextArea rows={3} aria-label="Java-Startoptionen" placeholder="-XX:+UseG1GC" value={args} onChange={(e) => setArgs(e.target.value)} />
          </Disclosure>
        </FormRow>
        <FormRow label="Breit" hint="wide: über Steuer- und Hilfespalte" wide>
          <div style={{ height: 40, background: "var(--panel)", clipPath: "var(--n1)" }} />
        </FormRow>
      </FormSection>
      <FormSection title="Nur für Vorleser" srOnlyTitle>
        <FormRow label="Speicher" group="group" aside={<Hint tone="warn" live>Mehr als drei Viertel deines Arbeitsspeichers.</Hint>}>
          <SegSlider value={12} max={14} onChange={() => undefined} />
        </FormRow>
      </FormSection>
    </div>
  );
}

function FieldsDemo() {
  const [n, setN] = useState("");
  const [q, setQ] = useState("sodium");
  const [qs, setQs] = useState("");
  const [ver, setVer] = useState("1.21.4");
  const [sort, setSort] = useState("dl");
  const [loader, setLoader] = useState("fabric");
  const [snap, setSnap] = useState(false);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "8px 40px", alignItems: "start" }} data-kit="fields">
      <div>
        <Field label="Name" help="Vorschlag aus Version und Loader. Du kannst ihn später ändern." reserveLines={1}>
          <TextField value={n} onChange={(e) => setN(e.target.value)} placeholder="Fabric 1.21.4" />
        </Field>
        <Field label="Name (Fehler)" error={n.length > 3 ? undefined : "Mindestens 4 Zeichen."} reserveLines={1}>
          <TextField value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Field label="Server" optional>
          <TextField size="s" width="m" placeholder="play.example.net" />
        </Field>
        <Field label="Minecraft-Version" htmlFor="kit-mc">
          <div className="flex flex-wrap items-center gap-2">
            <Select id="kit-mc" value={ver} onChange={setVer} options={OPTS} />
            <Checkbox checked={snap} onChange={setSnap}>Vorabversionen zeigen</Checkbox>
          </div>
        </Field>
        <Field label="Loader" group help="Fabric: leicht und schnell, die meisten neuen Mods.">
          <Segmented label="Loader" items={[{ value: "vanilla", label: "Vanilla" }, { value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "quilt", label: "Quilt" }]} value={loader} onChange={setLoader} />
        </Field>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <SearchField value={q} onChange={setQ} placeholder="Mods suchen" width="l" />
        <SearchField size="s" value={qs} onChange={setQs} placeholder="Suchen (s)" width="m" />
        <div style={row}>
          <TextField width="s" placeholder="width s" />
          <TextField width={120} size="s" disabled placeholder="aus" />
        </div>
        <div style={row}>
          <Select label="Sortieren" value={sort} onChange={setSort} options={[{ value: "dl", label: "Downloads" }, { value: "new", label: "Neueste" }, { value: "rel", label: "Relevanz" }]} />
          <Select size="s" ariaLabel="Version klein" value={ver} onChange={setVer} options={OPTS} />
          <Select size="s" ariaLabel="Leer" value="" onChange={() => undefined} options={[]} placeholder="Keine Versionen" />
        </div>
        <TextArea rows={2} width="full" defaultValue={"-Xmx4G\n-XX:+UseG1GC"} aria-label="Argumente" />
        <Hint>Neutral: Mehr als 8 GB bringt selten etwas.</Hint>
        <Hint tone="ok">Java 21 gefunden.</Hint>
        <Hint tone="warn">Das ist mehr als drei Viertel deines Arbeitsspeichers.</Hint>
        <Hint tone="bad">Für Minecraft 1.21.4 gibt es noch kein Quilt.</Hint>
        <Hint icon="info">Mit eigenem Icon (info).</Hint>
        <Disclosure summary="Erweitert (offen)" open><span className="muted">Inhalt</span></Disclosure>
      </div>
    </div>
  );
}

function TogglesDemo() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  const [c, setC] = useState(true);
  const [r, setR] = useState("a");
  const [gb, setGb] = useState(6);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-kit="toggles">
      <div style={row}>
        <Lab>Switch</Lab>
        <Switch checked={a} onChange={setA} label="Schalter A" />
        <Switch checked={!a} onChange={(x) => setA(!x)} label="Schalter B" stateText={["An", "Aus"]} />
        <Switch checked={b} onChange={setB} label="Mit sichtbarem Namen" visibleLabel stateText={["An", "Aus"]} />
        <Switch checked={true} onChange={() => undefined} label="aus (an)" disabled />
        <Switch checked={false} onChange={() => undefined} label="aus (aus)" disabled visibleLabel />
      </div>
      <div style={row}>
        <Lab>Checkbox</Lab>
        <Checkbox checked={c} onChange={setC} label="Nackt" />
        <Checkbox checked={false} indeterminate onChange={() => undefined} label="Teilweise" />
        <Checkbox checked={b} onChange={setB}>Vorabversionen zeigen</Checkbox>
        <Checkbox checked={true} onChange={() => undefined} disabled>aus (an)</Checkbox>
        <Checkbox checked={false} onChange={() => undefined} disabled>aus</Checkbox>
      </div>
      <div style={{ ...row, alignItems: "flex-start" }}>
        <Lab>Radio</Lab>
        <RadioGroup name="kit-r" label="Radio-Gruppe" value={r} onChange={setR} options={[{ value: "a", label: "Automatisch" }, { value: "b", label: "Eigener Wert" }, { value: "c", label: "Gesperrt", disabled: true }]} />
        <Radio name="kit-r2" checked={false} onChange={() => undefined}>Einzeln</Radio>
      </div>
      <div style={row}>
        <Lab>SegSlider</Lab>
        <SegSlider value={gb} max={12} onChange={setGb} />
        <span className="num" style={{ fontSize: 24 }}>{gb} GB</span>
        <SegSlider value={4} disabled onChange={() => undefined} label="Arbeitsspeicher (aus)" />
      </div>
    </div>
  );
}

export function FormsSection() {
  return (
    <>
      <Sec title="Tabs" id="tabs"><TabsDemo /></Sec>
      <Sec title="Formular (FormSection · FormRow)" id="formrow"><FormDemo /></Sec>
      <Sec title="Felder, Auswahl, Hinweise" id="fields"><FieldsDemo /></Sec>
      <Sec title="Umschalter" id="toggles"><TogglesDemo /></Sec>
    </>
  );
}
