/**
 * Nur Entwicklung (/_kit): Vorschau des Kits. Das Layout dieser Seite ist reines Tailwind (keine eigene CSS-Datei);
 * die Bausteine bringen nur ihr Aussehen mit. Zeigt dieselben Bausteine in verschiedenen Layouts und wie `className` Komponenten-Layout ersetzt.
 */
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { Size } from "./types";
import {
  Actions, BackLink, BarButton, Button, ButtonLink, Cell, Checkbox, Chip, ChipButton, ConfirmDialog, Count, Dialog, DialogActions, Disclosure, Empty, Field, FormRow, FormSection,
  Heading, Hint, IconButton, Input, JobProgress, List, ListRow, Meta, Page, PageHeader, Panel, Progress, Radio, SearchField, SectionHeader,
  Segmented, Select, Skel, Spacer, StatusPanel, Switch, TabPanel, Tabs, TextArea, Toolbar, Workspace, WorkspaceContent, WorkspaceRail, RowTitle,
  ListHeader, AddCard, CardGrid, Choice, ContextMenu, GhostRow, Menu, PickCard, PickTile, Popover, SceneCard, SceneThumb,
  SegSlider, Sheet, SkelRow, ThumbCard, Tip, type ButtonVariant,
} from "./index";

const SIZES: Size[] = ["s", "m", "l"];
const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const STATES = ["normal", "hover", "press", "focus"] as const;
const force = (s: (typeof STATES)[number]) => (s === "normal" ? {} : { "data-force": s });

const LOADERS = [{ value: "fabric", label: "Fabric" }, { value: "forge", label: "Forge" }, { value: "quilt", label: "Quilt" }];
const TABS = [
  { value: "mods", label: "Mods", icon: "mod" as const, count: 42 },
  { value: "worlds", label: "Welten", icon: "folder" as const, count: 3 },
  { value: "log", label: "Protokoll" },
  { value: "off", label: "Aus", disabled: true },
];

/** Abschnitt der Vorschau: Überschrift + Inhalt. */
function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-pg-s">
      <SectionHeader title={title} />
      {children}
    </section>
  );
}

export function KitPage() {
  const [filters, setFilters] = useState<Record<string, boolean>>({ Fabric: true, Forge: false });
  const [tab, setTab] = useState("mods");
  const [seg, setSeg] = useState("grid");
  const [loader, setLoader] = useState("fabric");
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState(true);
  const [radio, setRadio] = useState("a");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sl, setSl] = useState(6);
  return (
    <Page className="mx-auto max-w-6xl">
      <PageHeader title="Kit" count={4}>
        <Button size="s" variant="ghost" icon="copy">Link kopieren</Button>
        <Button variant="primary" icon="play">Spielen</Button>
      </PageHeader>

      <Toolbar>
        <Input icon="search" type="search" placeholder="Suchen" aria-label="Suchen" className="w-full sm:w-64" />
        {Object.entries(filters).map(([name, active]) => (
          <ChipButton key={name} pressed={active} onClick={() => setFilters((f) => ({ ...f, [name]: !f[name] }))}>{name}</ChipButton>
        ))}
        <Spacer />
        <IconButton icon="more" label="Mehr" />
      </Toolbar>

      <Workspace rail={
        <WorkspaceRail>
          <Heading level="card" className="mb-pg-s">Layout</Heading>
          <p className="text-ctl-s text-(--fg-3)">Aussehen aus <code>look.css</code>, Maße und Anordnung aus Tailwind-Klassen. Diese Seite hat kein eigenes Stylesheet.</p>
        </WorkspaceRail>
      }>
        <WorkspaceContent className="flex flex-col gap-pg-l">
          {SIZES.map((s) => (
            <Sec key={s} title={`Knopf ${s}`}>
              <div className="grid grid-cols-[auto_repeat(4,max-content)] items-center justify-items-start gap-x-pg-m gap-y-pg-s overflow-x-auto pb-1">
                {STATES.map((st) => (
                  <div key={st} className="contents">
                    <span className="text-ctl-s text-(--fg-3) uppercase">{st}</span>
                    {VARIANTS.map((v) => (
                      <Button key={v} size={s} variant={v} icon="folder" {...force(st)}>{v}</Button>
                    ))}
                  </div>
                ))}
              </div>
            </Sec>
          ))}

          <Sec title="Dasselbe Aussehen, anderes Layout">
            <div className="flex flex-col gap-pg-s">
              <Actions><Button variant="primary">Speichern</Button><Button>Abbrechen</Button></Actions>
              <Actions align="end" gap={12}><Button>Abbrechen</Button><Button variant="primary">Speichern</Button></Actions>
              <div className="grid grid-cols-3 gap-pg-s le-960:grid-cols-1">
                <Button className="w-full">Volle Zelle</Button>
                <Button variant="ghost" tone="warn" icon="warn" className="w-full justify-start">Links ausgerichtet</Button>
                <Button variant="danger" className="w-full" compactBelow={1180} icon="trash" count={3}>Löschen</Button>
              </div>
              <Button className="h-20 w-80 text-2xl">Eigene Höhe per className</Button>
            </div>
          </Sec>

          <Sec title="Link-, Zurück- und Leistenknöpfe">
            <div className="flex flex-wrap items-center gap-pg-s">
              <ButtonLink to="/" icon="play" variant="primary">Link-Knopf</ButtonLink>
              <BackLink to="/">Bibliothek</BackLink>
              <BarButton aria-label="Start" current><Icon name="play" /></BarButton>
              <BarButton aria-label="Konto" label="Spielername fehlt" tone="warn" iconEnd="chev-down"><Icon name="user" /></BarButton>
              <BarButton aria-label="Aufgaben" activity={{ count: 3, p: 0.4 }}><Icon name="update" /></BarButton>
              <BarButton aria-label="Seitenleiste" side badge={2}><Icon name="mod" size="l" /></BarButton>
            </div>
          </Sec>

          <Sec title="Chips, Zähler, Meta">
            <div className="flex flex-wrap items-center gap-pg-s">
              <Chip>Fabric</Chip>
              <Chip tone="acc" icon="play">Läuft</Chip>
              <Chip tone="warn" icon="warn">2 Warnungen</Chip>
              <Chip tone="bad">Fehler</Chip>
              <Chip tone="run">Lädt <Count value={7} minDigits={3} /></Chip>
              <Chip size="s">Fabric</Chip>
              <Chip size="s" tone="acc">Aktuell</Chip>
            </div>
            <Meta items={["Minecraft 1.21.4", <><Icon name="mod" size="s" /> <Count value={42} /> Mods</>, "vor 2 Std."]} />
          </Sec>

          <Sec title="Tabs und Segmente">
            <Tabs idBase="mk" label="Inhalte" items={TABS} value={tab} onChange={setTab} />
            <TabPanel idBase="mk" value={tab} className="py-pg-s text-ctl-s text-(--fg-2)">Inhalt von „{tab}“.</TabPanel>
            <div className="flex flex-wrap items-start gap-pg-m">
              <Segmented label="Ansicht" value={seg} onChange={setSeg} items={[{ value: "grid", label: "Raster" }, { value: "list", label: "Liste" }]} />
              <Segmented label="Ansicht (Symbole)" size="s" iconsOnly value={seg} onChange={setSeg} items={[{ value: "grid", label: "Raster", icon: "mod" }, { value: "list", label: "Liste", icon: "folder" }]} />
              <Tabs variant="vertical" label="Bereiche" idBase="mkv" value={tab} onChange={setTab} items={TABS.slice(0, 3)} className="w-56" />
            </div>
          </Sec>

          <Sec title="Schalter, Kästchen, Radio">
            <div className="flex flex-wrap items-start gap-x-pg-l gap-y-pg-s">
              <Switch label="Mods aktiv" visibleLabel stateText={["AN", "AUS"]} checked={on} onChange={setOn} />
              <Switch label="Aus" visibleLabel checked={false} disabled onChange={setOn} />
              <Checkbox checked={check} onChange={setCheck}>Automatisch aktualisieren</Checkbox>
              <Checkbox checked indeterminate onChange={setCheck}>Teilweise</Checkbox>
              <div className="flex flex-col" role="radiogroup" aria-label="Wahl">
                <Radio name="mk-r" checked={radio === "a"} onChange={() => setRadio("a")}>Option A</Radio>
                <Radio name="mk-r" checked={radio === "b"} onChange={() => setRadio("b")}>Option B</Radio>
              </div>
            </div>
          </Sec>

          <Sec title="Formular">
            <FormSection title="Allgemein" plate>
              <FormRow label="Name" hint="Sichtbar in der Bibliothek" htmlFor="mk-name" aside="Der Name darf Leerzeichen enthalten.">
                <Input id="mk-name" placeholder="Meine Instanz" className="w-full" />
              </FormRow>
              <FormRow label="Loader" htmlFor="mk-loader">
                <Select id="mk-loader" value={loader} onChange={setLoader} options={LOADERS} />
              </FormRow>
              <FormRow label="Automatisch" group="group">
                <Switch label="Automatisch starten" checked={on} onChange={setOn} />
              </FormRow>
              <FormRow label="Notiz" htmlFor="mk-note" wide>
                <TextArea id="mk-note" placeholder="Freitext" className="w-full" />
              </FormRow>
            </FormSection>
            <div className="grid grid-cols-2 gap-pg-m le-960:grid-cols-1">
              <Field label="Mit Fehler" error="Name fehlt" optional><Input placeholder="Pflicht" className="w-full" /></Field>
              <Field label="Mit Hilfe" help="Höchstens 32 Zeichen"><SearchField value={query} onChange={setQuery} placeholder="Suchen" className="w-full" /></Field>
            </div>
            <Disclosure summary="Erweitert"><Hint tone="warn">Nur ändern, wenn du weißt, was du tust.</Hint></Disclosure>
          </Sec>

          <Sec title="Rückmeldungen">
            <StatusPanel tone="warn" title="Java fehlt" actions={<Button size="s">Installieren</Button>}>Es wurde keine passende Java-Version gefunden.</StatusPanel>
            <StatusPanel tone="bad" size="s" title="Fehler">Verbindung getrennt.</StatusPanel>
            <div className="flex flex-wrap items-center gap-pg-m">
              <Progress p={0.62} className="w-64" label="Download" />
              <Progress p={0.3} thin tone="run" className="w-40" decorative />
              <Progress className="w-40" label="Suche" />
              <JobProgress label="Mods herunterladen" sub="12 von 30" p={0.4} className="w-56" full onCancel={() => undefined} />
              <Skel className="h-8 w-40" />
            </div>
            <Empty size="pane" ill={false} title="Nichts hier" actions={<Button size="s">Hinzufügen</Button>}>Es gibt noch keine Einträge.</Empty>
          </Sec>

          <Sec title="Liste (Spalten, Abstand, Höhe als Eigenschaften)">
            <List
              divided
              aria-label="Instanzen"
              cols={{ base: "minmax(0,1fr) 120px 96px", 900: "minmax(0,1fr) 96px" }}
              head={<><span>Name</span><Cell hide={900}>Loader</Cell><Cell align="end">Mods</Cell></>}
            >
              {["Survival", "Creative", "Modpack"].map((n, i) => (
                <ListRow key={n} index={i} selected={i === 1} hit={{ onClick: () => undefined, label: `${n} öffnen` }}>
                  <RowTitle title={n} sub="erstellt 12.03.2026" />
                  <Cell hide={900}>Fabric</Cell>
                  <Cell align="end"><Count value={10 * (i + 1)} /></Cell>
                </ListRow>
              ))}
            </List>
            <ListHeader cols="80px 1fr"><span>Allein</span><span>Kopf</span></ListHeader>
            <Panel className="p-0">
              <List feed aria-label="Beiträge">
                {["Neue Version", "Wartung"].map((n, i) => (
                  <ListRow key={n} selected={i === 0} current={i === 0} hit={{ onClick: () => undefined, label: n }}>
                    <RowTitle size="display" eyebrow={<><time>12.03.2026</time><Chip size="s" tone="acc">Neu</Chip></>} title={n} sub="von Pumpkin" />
                  </ListRow>
                ))}
              </List>
            </Panel>
          </Sec>

          <Sec title="Platten und Eingabe">
            <div className="grid grid-cols-3 gap-pg-m le-960:grid-cols-1">
              <Panel><Heading level="card">Flach</Heading></Panel>
              <Panel level="raised"><Heading level="card">Erhaben</Heading></Panel>
              <Panel level="sunk" className="p-pg-s"><Heading level="card">Eingelassen, eng</Heading></Panel>
            </div>
            <div className="flex flex-wrap items-center gap-pg-s">
              <Input placeholder="Normal" aria-label="Normal" className="w-56" />
              <Input size="s" placeholder="Klein" aria-label="Klein" className="w-40" />
              <Input placeholder="Aus" aria-label="Aus" disabled className="w-40" />
              <Input placeholder="Ungültig" aria-label="Ungültig" aria-invalid="true" className="w-40" />
            </div>
          </Sec>

          <Sec title="Karten">
            <CardGrid>
              <SceneCard look={{ bio: "forest", seed: 7 }} title="Survival" sub="1.21.4 · Fabric" status={<Chip tone="warn" size="s">Update</Chip>} hit={{ onClick: () => undefined, label: "Survival öffnen" }} primary={<Button size="s" variant="primary" icon="play">Spielen</Button>} />
              <SceneCard look={{ bio: "nether", seed: 3 }} title="Nether" sub="aktuell" current hit={{ onClick: () => undefined, label: "Nether öffnen" }} />
              <AddCard label="Neue Instanz" />
            </CardGrid>
            <div className="flex flex-wrap items-center gap-pg-m">
              <ThumbCard look={{ bio: "snow", seed: 1 }} title="Schnee" hit={{ onClick: () => undefined, label: "Schnee" }} />
              <SceneThumb bio="sea" seed={2} />
              <PickTile label="Gras" pressed size={32} onClick={() => undefined}><Icon name="mod" size="s" /></PickTile>
              <PickTile label="Stein" pressed={false} onClick={() => undefined}><Icon name="folder" size="m" /></PickTile>
            </div>
            <div className="grid grid-cols-2 gap-pg-s le-960:grid-cols-1">
              <Choice selected title="Gewählt" sub="mit Zusatz" role="radio" />
              <Choice selected={false} title="Nicht gewählt" trail={<Count value={3} />} role="radio" />
              <PickCard media={<span className="block h-20" />} title="Karte" sub="gewählt" flag="Aktiv" selected />
              <PickCard media={<span className="block h-20" />} title="Karte" selected={false} />
            </div>
          </Sec>

          <Sec title="Regler, Platzhalter, Menüs">
            <SegSlider label="Arbeitsspeicher" unit="GB" max={16} value={sl} onChange={setSl} />
            <List aria-label="Platzhalter" cols="28px 40px minmax(0,1fr) auto">
              <GhostRow variant="content" text="Entfernter Mod" onUndo={() => undefined} />
              <SkelRow className="grid-cols-[64px_minmax(0,1fr)_120px]" />
            </List>
            <Actions>
              <Menu trigger={<Button icon="more">Menü</Button>} items={[{ id: "a", text: "Umbenennen", icon: "edit", onSelect: () => undefined }, "-", { id: "b", text: "Löschen", icon: "trash", bad: true, onSelect: () => undefined }]} />
              <ContextMenu items={[{ id: "c", text: "Kopieren", icon: "copy", onSelect: () => undefined }]}><span className="px-3 py-2 text-ctl-s text-(--fg-3)">Rechtsklick hier</span></ContextMenu>
              <Popover label="Details" trigger={<Button>Popover</Button>}><p className="text-ctl-s">Inhalt des Popovers.</p></Popover>
              <Tip label="Ein Tooltip"><Button variant="ghost">Tooltip</Button></Tip>
              <Button onClick={() => setSheet(true)}>Seitenpanel</Button>
            </Actions>
          </Sec>

          <Sec title="Dialoge">
            <Actions>
              <Button onClick={() => setDialog(true)}>Dialog öffnen</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>Rückfrage öffnen</Button>
            </Actions>
          </Sec>
        </WorkspaceContent>
      </Workspace>

      <Dialog open={dialog} onOpenChange={setDialog} title="Neue Instanz" sub="Name und Loader wählen" height="s" footLeft="Schritt 1 von 1"
        footer={<DialogActions cancel="Abbrechen" confirm={{ label: "Erstellen", onClick: () => setDialog(false) }} />}>
        <Field label="Name"><Input placeholder="Meine Instanz" className="w-full" /></Field>
      </Dialog>
      <Sheet open={sheet} onOpenChange={setSheet} title="Seitenpanel" sub="nicht modal"><p className="text-ctl-s">Inhalt.</p></Sheet>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Instanz löschen?" text="Alle Welten dieser Instanz gehen verloren." onConfirm={() => setConfirm(false)} />
    </Page>
  );
}
