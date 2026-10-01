/**
 * Nur Entwicklung (/_kit): Vorschau Tabs, Formular und Umschalter (Kit-Paket A2/1).
 * Zustände per data-force (hover/press), aus per disabled; Overlay-Kontext in einer Platte.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/i18n";
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
type W = "blank" | "pack" | "file";
type V = "grid" | "list";

function TabsDemo() {
  const { t } = useI18n();
  // Einträge erst hier, damit die Beschriftungen in der aktuellen Sprache entstehen.
  const TABS: TabItem<T>[] = [
    { value: "content", label: t("pages.instances.colContents"), count: 42, badge: <Icon name="warn" size="s" tone="warn" /> },
    { value: "console", label: t("components.log.ariaLabel") },
    { value: "settings", label: t("common.settings") },
    { value: "off", label: t("common.worlds"), disabled: true },
  ];
  const WAYS: TabItem<W>[] = [
    { value: "blank", label: t("ui.kit.wayBlank"), icon: "plus" },
    { value: "pack", label: t("components.catalog.one.modpack"), icon: "box" },
    { value: "file", label: t("ui.kit.wayFromFile"), icon: "file" },
  ];
  const VIEWS: TabItem<V>[] = [
    { value: "grid", label: t("pages.instances.viewPoster"), icon: "grid" },
    { value: "list", label: t("pages.instances.viewList"), icon: "list" },
  ];
  const [tab, setTab] = useState<T>("content");
  const [w, setW] = useState<W>("blank");
  const [v, setV] = useState<V>("grid");
  const [f, setF] = useState("all");
  const [px, setPx] = useState("m");
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={cap}>underline m · idBase + TabPanel · Zähler + Badge · aus</span>
        <Tabs label={t("pages.detail.tabsLabel")} items={TABS} value={tab} onChange={setTab} idBase="kit-dt" />
        <TabPanel idBase="kit-dt" value={tab} style={{ padding: "10px 0", color: "var(--fg-2)" }}>{t("ui.kit.tabPanelDemo", { value: tab })}</TabPanel>
        <span style={cap}>underline s mit Icons · erzwungen hover / press</span>
        <div style={row}>
          <Tabs size="s" label={t("ui.kit.waysSmall")} items={WAYS} value={w} onChange={setW} />
          <span className="vx-tabs" data-variant="underline" style={{ boxShadow: "none" }}>
            <button type="button" className="vx-tab fx" data-force="hover" tabIndex={-1}><span className="vx-tc">hover</span><i className="vx-tab-tick" /></button>
            <button type="button" className="vx-tab fx" data-force="press" tabIndex={-1}><span className="vx-tc">press</span><i className="vx-tab-tick" /></button>
          </span>
        </div>
        <span style={cap}>NavTabs (Links, aria-current)</span>
        <NavTabs items={[
          { to: "/_kit", label: "Kit", match: (p) => p.startsWith("/_kit"), shortcut: "Control+1" },
          { to: "/instances", label: t("ui.nav.library"), match: (p) => p.startsWith("/instances"), shortcut: "Control+2" },
          { to: "/discover", label: t("ui.nav.discover"), match: (p) => p.startsWith("/discover"), shortcut: "Control+3" },
        ]} />
      </div>
      <div style={{ ...row, alignItems: "flex-start" }}>
        <div style={{ width: 168 }} data-kit="vertical">
          <span style={cap}>vertical m</span>
          <Tabs variant="vertical" label={t("ui.kit.ways")} items={WAYS} value={w} onChange={setW} idBase="kit-ni" />
        </div>
        <div style={{ width: 168 }}>
          <span style={cap}>vertical s</span>
          <Tabs variant="vertical" size="s" label={t("ui.kit.waysSmall")} items={WAYS} value={w} onChange={setW} />
        </div>
        <div className="plate" style={{ width: 200, padding: 12 }}>
          <span style={cap}>vertical in Platte</span>
          <Tabs variant="vertical" label={t("ui.kit.waysPanel")} items={WAYS} value={w} onChange={setW} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-kit="segments">
          <span style={cap}>Segmented m · s · nur Symbole · tablist</span>
          <Segmented label={t("pages.instances.viewLabel")} items={VIEWS} value={v} onChange={setV} />
          <Segmented size="s" label={t("ui.kit.pxSize")} items={[{ value: "s", label: t("pages.settings.pxSizeSmall") }, { value: "m", label: t("pages.settings.pxSizeMedium") }, { value: "l", label: t("pages.settings.pxSizeLarge") }, { value: "x", label: t("ui.kit.pxHuge"), disabled: true }]} value={px} onChange={setPx} />
          <div style={row}>
            <Segmented iconsOnly label={t("ui.kit.viewIcons")} items={VIEWS} value={v} onChange={setV} />
            <Segmented iconsOnly size="s" label={t("ui.kit.viewIconsSmall")} items={VIEWS} value={v} onChange={setV} />
          </div>
          <Tabs variant="segment" label={t("components.log.filter")} items={[{ value: "all", label: t("common.all"), count: 42 }, { value: "mod", label: "Mods", count: 38 }, { value: "rp", label: t("ui.kit.packs"), count: 4 }]} value={f} onChange={setF} />
          <div className="plate" style={{ padding: 12 }}>
            <Segmented size="s" label={t("ui.kit.viewPlate")} items={VIEWS} value={v} onChange={setV} />
          </div>
        </div>
      </div>
    </>
  );
}

const OPTS = (t: (key: string) => string) => [
  { value: "1.21.4", label: `1.21.4 (${t("ui.kit.optLatest")})` },
  { value: "1.21.3", label: "1.21.3" },
  { value: "1.20.1", label: "1.20.1" },
  { value: "24w14a", label: `24w14a (${t("ui.kit.optSnapshot")})` },
  { value: "x", label: t("ui.kit.optUnavailable"), disabled: true },
];

function FormDemo() {
  const { t } = useI18n();
  const [name, setName] = useState("Survival");
  const [java, setJava] = useState<"auto" | "own">("auto");
  const [motion, setMotion] = useState(true);
  const [args, setArgs] = useState("");
  return (
    <div style={{ maxWidth: "var(--page-max)" }} data-kit="form">
      <FormSection title={t("detail.settings.generalSection")}>
        <FormRow label={t("common.name")} htmlFor="kit-name" aside={t("ui.kit.nameHelp")}>
          <TextField id="kit-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
        </FormRow>
        <FormRow label="Java" hint={t("pages.settings.javaHint")} group="radiogroup" aside={t("ui.kit.javaAside")}>
          <RadioGroup name="kit-java" value={java} onChange={setJava} options={[{ value: "auto", label: <>{t("components.memory.auto")} <span className="faint">{t("ui.kit.javaAutoDetail")}</span></> }, { value: "own", label: t("components.java.own") }]} />
          <TextField disabled={java === "auto"} aria-label={t("ui.kit.javaPath")} placeholder={t("ui.kit.javaPath")} />
        </FormRow>
        <FormRow label={t("ui.kit.motionLabel")} hint={t("ui.kit.motionHint")}>
          <Switch checked={motion} onChange={setMotion} label={t("ui.kit.motionLabel")} stateText={[t("ui.switch.on"), t("ui.switch.off")]} />
        </FormRow>
        <FormRow label={t("components.newInstance.advanced")}>
          <Disclosure summary={t("detail.settings.jvmOptionsLabel")}>
            <TextArea rows={3} aria-label={t("detail.settings.jvmOptionsLabel")} placeholder="-XX:+UseG1GC" value={args} onChange={(e) => setArgs(e.target.value)} />
          </Disclosure>
        </FormRow>
        <FormRow label={t("ui.kit.wide")} hint={t("ui.kit.wideHint")} wide>
          <div style={{ height: 40, background: "var(--panel)", clipPath: "var(--n1)" }} />
        </FormRow>
      </FormSection>
      <FormSection title={t("ui.kit.srOnly")} srOnlyTitle>
        <FormRow label={t("ui.kit.memory")} group="group" aside={<Hint tone="warn" live>{t("ui.kit.memoryWarn")}</Hint>}>
          <SegSlider value={12} max={14} onChange={() => undefined} />
        </FormRow>
      </FormSection>
    </div>
  );
}

function FieldsDemo() {
  const { t } = useI18n();
  const [n, setN] = useState("");
  const [q, setQ] = useState("sodium");
  const [qs, setQs] = useState("");
  const [ver, setVer] = useState("1.21.4");
  const [sort, setSort] = useState("dl");
  const [loader, setLoader] = useState("fabric");
  const [snap, setSnap] = useState(false);
  const options = OPTS(t);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "8px 40px", alignItems: "start" }} data-kit="fields">
      <div>
        <Field label={t("common.name")} help={t("ui.kit.nameSuggestion")} reserveLines={1}>
          <TextField value={n} onChange={(e) => setN(e.target.value)} placeholder="Fabric 1.21.4" />
        </Field>
        <Field label={t("ui.kit.nameErrorField")} error={n.length > 3 ? undefined : t("ui.kit.nameMinLength")} reserveLines={1}>
          <TextField value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        <Field label={t("common.server")} optional>
          <TextField size="s" width="m" placeholder="play.example.net" />
        </Field>
        <Field label={t("components.newInstance.mcVersion")} htmlFor="kit-mc">
          <div className="flex flex-wrap items-center gap-2">
            <Select id="kit-mc" value={ver} onChange={setVer} options={options} />
            <Checkbox checked={snap} onChange={setSnap}>{t("ui.kit.showSnapshots")}</Checkbox>
          </div>
        </Field>
        <Field label="Loader" group help={t("ui.kit.loaderHelp")}>
          <Segmented label="Loader" items={[{ value: "vanilla", label: "Vanilla" }, { value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "quilt", label: "Quilt" }]} value={loader} onChange={setLoader} />
        </Field>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("ui.kit.searchMods")} width="l" />
        <SearchField size="s" value={qs} onChange={setQs} placeholder={t("ui.kit.searchSmall")} width="m" />
        <div style={row}>
          <TextField width="s" placeholder="width s" />
          <TextField width={120} size="s" disabled placeholder={t("ui.kit.stateOff")} />
        </div>
        <div style={row}>
          <Select label={t("pages.instances.sortLabel")} value={sort} onChange={setSort} options={[{ value: "dl", label: t("pages.discover.sortDownloads") }, { value: "new", label: t("pages.discover.sortNewest") }, { value: "rel", label: t("pages.discover.sortRelevance") }]} />
          <Select size="s" ariaLabel={t("ui.kit.versionSmall")} value={ver} onChange={setVer} options={options} />
          <Select size="s" ariaLabel={t("ui.kit.wayBlank")} value="" onChange={() => undefined} options={[]} placeholder={t("components.version.none")} />
        </div>
        <TextArea rows={2} width="full" defaultValue={"-Xmx4G\n-XX:+UseG1GC"} aria-label={t("ui.kit.args")} />
        <Hint>{t("ui.kit.memHint")}</Hint>
        <Hint tone="ok">{t("ui.kit.javaFound")}</Hint>
        <Hint tone="warn">{t("ui.kit.memWarn")}</Hint>
        <Hint tone="bad">{t("ui.kit.noQuilt")}</Hint>
        <Hint icon="info">{t("ui.kit.customIcon")}</Hint>
        <Disclosure summary={t("ui.kit.advancedOpen")} open><span className="muted">{t("ui.kit.content")}</span></Disclosure>
      </div>
    </div>
  );
}

function TogglesDemo() {
  const { t } = useI18n();
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  const [c, setC] = useState(true);
  const [r, setR] = useState("a");
  const [gb, setGb] = useState(6);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-kit="toggles">
      <div style={row}>
        <Lab>Switch</Lab>
        <Switch checked={a} onChange={setA} label={t("ui.kit.switchA")} />
        <Switch checked={!a} onChange={(x) => setA(!x)} label={t("ui.kit.switchB")} stateText={[t("ui.switch.on"), t("ui.switch.off")]} />
        <Switch checked={b} onChange={setB} label={t("ui.kit.visibleName")} visibleLabel stateText={[t("ui.switch.on"), t("ui.switch.off")]} />
        <Switch checked={true} onChange={() => undefined} label={t("ui.kit.offOn")} disabled />
        <Switch checked={false} onChange={() => undefined} label={t("ui.kit.offOff")} disabled visibleLabel />
      </div>
      <div style={row}>
        <Lab>Checkbox</Lab>
        <Checkbox checked={c} onChange={setC} label={t("ui.kit.bare")} />
        <Checkbox checked={false} indeterminate onChange={() => undefined} label={t("ui.kit.indeterminate")} />
        <Checkbox checked={b} onChange={setB}>{t("ui.kit.showSnapshots")}</Checkbox>
        <Checkbox checked={true} onChange={() => undefined} disabled>{t("ui.kit.offOn")}</Checkbox>
        <Checkbox checked={false} onChange={() => undefined} disabled>{t("ui.kit.stateOff")}</Checkbox>
      </div>
      <div style={{ ...row, alignItems: "flex-start" }}>
        <Lab>Radio</Lab>
        <RadioGroup name="kit-r" label={t("ui.kit.radioGroup")} value={r} onChange={setR} options={[{ value: "a", label: t("components.memory.auto") }, { value: "b", label: t("components.memory.ownValue") }, { value: "c", label: t("ui.kit.locked"), disabled: true }]} />
        <Radio name="kit-r2" checked={false} onChange={() => undefined}>{t("ui.kit.single")}</Radio>
      </div>
      <div style={row}>
        <Lab>SegSlider</Lab>
        <SegSlider value={gb} max={12} onChange={setGb} />
        <span className="num" style={{ fontSize: 24 }}>{gb} GB</span>
        <SegSlider value={4} disabled onChange={() => undefined} label={t("ui.memory.disabledLabel")} />
      </div>
    </div>
  );
}

export function FormsSection() {
  const { t } = useI18n();
  return (
    <>
      <Sec title={t("ui.kit.secTabs")} id="tabs"><TabsDemo /></Sec>
      <Sec title={t("ui.kit.secForm")} id="formrow"><FormDemo /></Sec>
      <Sec title={t("ui.kit.secFields")} id="fields"><FieldsDemo /></Sec>
      <Sec title={t("ui.kit.secToggles")} id="toggles"><TogglesDemo /></Sec>
    </>
  );
}
