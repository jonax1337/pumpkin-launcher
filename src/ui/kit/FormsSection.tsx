/**
 * Nur Entwicklung (/_kit): Vorschau Tabs, Formular und Umschalter.
 * Zustände per data-force (hover/press), aus per disabled; Overlay-Kontext in einer Platte.
 */
import { useState } from "react";
import {
  Checkbox, Disclosure, Field, FormRow, FormSection, Hint, Icon, Radio, SearchField, SegSlider, Segmented, Select, Switch,
  TabPanel, Tabs, TextArea, TextField, type TabItem,
} from "@/ui";
import { Cap, Lab, Sec } from "./kit-ui";

type T = "content" | "console" | "settings" | "off";
type W = "blank" | "pack" | "file" | "locked";
type V = "grid" | "list";

const TABS: TabItem<T>[] = [
  { value: "content", label: "Inhalte", count: 42, badge: <Icon name="warn" size="s" tone="warn" /> },
  { value: "console", label: "Protokoll" },
  { value: "settings", label: "Einstellungen" },
  { value: "off", label: "Welten", disabled: true },
];
const WAYS: TabItem<W>[] = [
  { value: "blank", label: "Leer", icon: "plus" },
  { value: "pack", label: "Modpack", icon: "box" },
  { value: "file", label: "Aus Datei", icon: "file" },
];
const PLATE_WAYS: TabItem<W>[] = [
  ...WAYS,
  { value: "locked", label: "Gesperrt", icon: "folder", disabled: true },
];
const VIEWS: TabItem<V>[] = [
  { value: "grid", label: "Poster", icon: "grid" },
  { value: "list", label: "Liste", icon: "list" },
];

function TabsDemo() {
  const [tab, setTab] = useState<T>("content");
  const [w, setW] = useState<W>("blank");
  const [v, setV] = useState<V>("grid");
  const [f, setF] = useState("all");
  const [px, setPx] = useState("m");
  return (
    <>
      <div className="kit-stack">
        <Cap>underline m · idBase + TabPanel · Zähler + Badge · aus</Cap>
        <Tabs label="Bereiche der Instanz" items={TABS} value={tab} onChange={setTab} idBase="kit-dt" />
        <TabPanel idBase="kit-dt" value={tab} className="vx-pit kit-tabpanel">Inhalt von „{tab}“</TabPanel>
        <Cap>underline s mit Icons · erzwungen hover / press / Fokus · gewählt · aus</Cap>
        <div className="kit-row">
          <Tabs size="s" label="Weg klein" items={WAYS} value={w} onChange={setW} />
          <div className="vx-tabs" data-variant="underline" data-kit="tab-states">
            <button type="button" className="vx-tab fx" data-force="hover" tabIndex={-1}><span className="vx-tc">hover</span></button>
            <button type="button" className="vx-tab fx" data-force="press" tabIndex={-1}><span className="vx-tc">press</span></button>
            <button type="button" className="vx-tab fx" data-force="focus" tabIndex={-1}><span className="vx-tc">Fokus</span></button>
            <button type="button" className="vx-tab fx" aria-selected="true" tabIndex={-1}><span className="vx-tc">gewählt</span></button>
            <button type="button" className="vx-tab fx" disabled><span className="vx-tc">aus</span></button>
          </div>
        </div>
      </div>
      <div className="kit-row" data-align="start">
        <div className="kit-col" data-kit="vertical">
          <Cap>Reiter senkrecht</Cap>
          <Tabs variant="vertical" label="Weg" items={PLATE_WAYS} value={w} onChange={setW} />
        </div>
        <div className="kit-col">
          <Cap>Reiter senkrecht · s</Cap>
          <Tabs variant="vertical" size="s" label="Weg klein" items={PLATE_WAYS} value={w} onChange={setW} />
        </div>
        <div className="plate kit-col" data-plate="">
          <Cap>Reiter senkrecht · in Platte</Cap>
          <Tabs variant="vertical" label="Weg (Platte)" items={PLATE_WAYS} value={w} onChange={setW} />
        </div>
        <div className="kit-stack" data-gap="12" data-kit="segments">
          <Cap>Segmented m · s · nur Symbole · radiogroup</Cap>
          <Segmented label="Ansicht" items={VIEWS} value={v} onChange={setV} />
          <Segmented size="s" label="Pixelstufe" items={[{ value: "s", label: "Klein" }, { value: "m", label: "Mittel" }, { value: "l", label: "Groß" }, { value: "x", label: "Riesig", disabled: true }]} value={px} onChange={setPx} />
          <div className="kit-row">
            <Segmented iconsOnly label="Ansicht (Symbole)" items={VIEWS} value={v} onChange={setV} />
            <Segmented iconsOnly size="s" label="Ansicht (Symbole, klein)" items={VIEWS} value={v} onChange={setV} />
          </div>
          <Tabs variant="segment" label="Filter" items={[{ value: "all", label: "Alle", count: 42 }, { value: "mod", label: "Mods", count: 38 }, { value: "rp", label: "Ressourcenpakete", count: 4 }]} value={f} onChange={setF} />
          <div className="plate kit-plate-pad">
            <Segmented size="s" label="Ansicht (Platte)" items={VIEWS} value={v} onChange={setV} />
          </div>
        </div>
      </div>
    </>
  );
}

const MC_VERSIONS = [
  { value: "1.21.4", label: "1.21.4 (neueste Version)" },
  { value: "1.21.3", label: "1.21.3" },
  { value: "1.20.1", label: "1.20.1" },
  { value: "24w14a", label: "24w14a (Snapshot)" },
  { value: "x", label: "nicht verfügbar", disabled: true },
];

function FormDemo() {
  const [name, setName] = useState("Survival");
  const [java, setJava] = useState<"auto" | "own">("auto");
  const [motion, setMotion] = useState(true);
  const [args, setArgs] = useState("");
  return (
    <div data-kit="form">
      <FormSection title="Allgemein">
        <FormRow label="Name" htmlFor="kit-name" aside="Erscheint auf Start, Poster und Kopf. Höchstens 64 Zeichen.">
          <TextField id="kit-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label="Java" hint="Standard für alle Instanzen" group="radiogroup" aside="Automatisch passt fast immer.">
          <Radio name="kit-java" checked={java === "auto"} onChange={() => setJava("auto")}>Automatisch <span className="faint">(Pumpkin Launcher lädt die passende Version)</span></Radio>
          <Radio name="kit-java" checked={java === "own"} onChange={() => setJava("own")}>Eigene Java-Installation</Radio>
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
          <div className="kit-wide-fill" />
        </FormRow>
      </FormSection>
      <FormSection title="Nur für Vorleser" srOnlyTitle>
        <FormRow label="Speicher" group="group" aside={<Hint tone="warn" live>Mehr als drei Viertel deines Arbeitsspeichers.</Hint>}>
          <SegSlider value={12} max={14} onChange={() => undefined} label="Arbeitsspeicher" unit="GB" />
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
    <div className="kit-grid" data-cols="fields" data-kit="fields">
      <div>
        <Field label="Name" help="Zum Beispiel „Fabric 1.21.4“" reserveLines={1}>
          <TextField value={n} onChange={(e) => setN(e.target.value)} placeholder="Fabric 1.21.4" />
        </Field>
        <Field label="Name (mit Fehler)" error={n.length > 3 ? undefined : "Mindestens 4 Zeichen"} reserveLines={1}>
          <TextField value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Field label="Server" optional>
          <TextField size="s" width="m" placeholder="play.example.net" />
        </Field>
        <Field label="Minecraft-Version" htmlFor="kit-mc">
          <div className="kit-row" data-gap="8">
            <Select id="kit-mc" value={ver} onChange={setVer} options={MC_VERSIONS} />
            <Checkbox checked={snap} onChange={setSnap}>Vorabversionen zeigen</Checkbox>
          </div>
        </Field>
        <Field label="Loader" group help="Fabric: leicht und schnell, die meisten neuen Mods.">
          <Segmented label="Loader" items={[{ value: "vanilla", label: "Vanilla" }, { value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "quilt", label: "Quilt" }]} value={loader} onChange={setLoader} />
        </Field>
      </div>
      <div className="kit-stack" data-gap="12" data-align="start">
        <SearchField value={q} onChange={setQ} placeholder="Mods suchen" width="l" />
        <SearchField size="s" value={qs} onChange={setQs} placeholder="Suchen (s)" width="m" />
        <div className="kit-row">
          <TextField width="s" placeholder="width s" />
          <TextField width={120} size="s" disabled placeholder="aus" />
        </div>
        <div className="kit-row">
          <Select label="Sortieren" value={sort} onChange={setSort} options={[{ value: "dl", label: "Downloads" }, { value: "new", label: "Neueste" }, { value: "rel", label: "Relevanz" }]} />
          <Select size="s" ariaLabel="Version klein" value={ver} onChange={setVer} options={MC_VERSIONS} />
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
    <div className="kit-stack" data-kit="toggles">
      <div className="kit-row">
        <Lab>Switch</Lab>
        <Switch checked={a} onChange={setA} label="Schalter A" />
        <Switch checked={!a} onChange={(x) => setA(!x)} label="Schalter B" stateText={["An", "Aus"]} />
        <Switch checked={b} onChange={setB} label="Mit sichtbarem Namen" visibleLabel stateText={["An", "Aus"]} />
        <Switch checked={true} onChange={() => undefined} label="aus (an)" disabled />
        <Switch checked={false} onChange={() => undefined} label="aus (aus)" disabled visibleLabel />
      </div>
      <div className="kit-row">
        <Lab>Checkbox</Lab>
        <Checkbox checked={c} onChange={setC} label="Nackt" />
        <Checkbox checked={false} indeterminate onChange={() => undefined} label="Teilweise" />
        <Checkbox checked={b} onChange={setB}>Vorabversionen zeigen</Checkbox>
        <Checkbox checked={true} onChange={() => undefined} disabled>aus (an)</Checkbox>
        <Checkbox checked={false} onChange={() => undefined} disabled>aus</Checkbox>
      </div>
      <div className="kit-row" data-align="start">
        <Lab>Radio</Lab>
        <div role="radiogroup" aria-label="Radio-Gruppe">
          <Radio name="kit-r" checked={r === "a"} onChange={() => setR("a")}>Automatisch</Radio>
          <Radio name="kit-r" checked={r === "b"} onChange={() => setR("b")}>Eigener Wert</Radio>
          <Radio name="kit-r" checked={false} onChange={() => undefined} disabled>Gesperrt</Radio>
        </div>
        <Radio name="kit-r2" checked={false} onChange={() => undefined}>Einzeln</Radio>
      </div>
      <div className="kit-row">
        <Lab>SegSlider</Lab>
        <SegSlider value={gb} max={12} onChange={setGb} label="Arbeitsspeicher" unit="GB" />
        <span className="num kit-big-num">{gb} GB</span>
        <SegSlider value={4} disabled onChange={() => undefined} label="Arbeitsspeicher (aus)" unit="GB" />
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
