/**
 * Nur Entwicklung (/_kit): Vorschau Überlagerungen, Rückmeldungen und Seitengerüst.
 * Menü-Zustände zusätzlich als stehende Fläche (gleiche Klassen), Dialoge/Menüs/Toasts live zum Ausprobieren.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Actions, Button, ConfirmDialog, ContextMenu, Dialog, DialogActions, Empty, ErrorBox, Glyph, Heading, Icon, IconButton, JobProgress, Menu,
  Popover, Progress, SearchField, SectionHeader, Sheet, Skel, Spacer, StatusPanel, TextField, Tip, Toolbar, Trunc, type IconName, type MenuEntry,
} from "@/ui";
import { cap, row as baseRow, Sec } from "./kit-ui";
import { WorkspaceDemo } from "./WorkspaceDemo";

const row = { ...baseRow, gap: 12 };

const ITEMS: MenuEntry[] = [
  { label: "Instanz" },
  { id: "play", text: "Spielen", icon: "play", onSelect: () => undefined },
  { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => undefined },
  { id: "log", text: "Protokoll", icon: "term", disabled: true, onSelect: () => undefined },
  { id: "acc", text: "Steve_42", sub: "Offline-Name", lead: <Icon name="user" size="l" tone="muted" />, checked: true, onSelect: () => undefined },
  "-",
  { id: "del", text: "Löschen", icon: "trash", bad: true, onSelect: () => undefined },
];

/** Stehende Menüzeile in einem erzwungenen Zustand: gleiche Klassen wie Radix. */
function menuRow(text: string, icon: IconName, extra: Record<string, string> = {}) {
  return (
    <div className="vx-mi" {...extra}>
      <Icon name={icon} size="s" />
      <span className="vx-trunc">{text}</span>
    </div>
  );
}

/** Stehende Menüfläche: gleiche Klassen wie Radix, Zustände erzwungen. */
function MenuStates() {
  return (
    <div className="vx-pop" data-ctx="overlay" style={{ width: 260, animation: "none" }}>
      <div className="vx-mlabel">Zustände</div>
      {menuRow("Normal", "folder")}
      {menuRow("Markiert", "copy", { "data-highlighted": "" })}
      {menuRow("aus", "term", { "data-disabled": "" })}
      {menuRow("Gefahr", "trash", { "data-tone": "bad" })}
      {menuRow("Gefahr markiert", "trash", { "data-tone": "bad", "data-highlighted": "" })}
      <div className="vx-msep" />
      <div className="vx-mi" data-tall="">
        <Icon name="user" size="l" tone="muted" />
        <span className="vx-mi-t2"><b className="vx-trunc">Zweizeilig</b><span className="vx-trunc">Unterzeile</span></span>
        <Icon name="check" size="s" className="vx-mi-ck" />
      </div>
    </div>
  );
}

function Dialogs() {
  const [dlg, setDlg] = useState(false);
  const [del, setDel] = useState(false);
  const [ok, setOk] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("Survival");
  return (
    <div style={row}>
      <Button icon="plus" onClick={() => setDlg(true)}>Dialog mit Feld</Button>
      <Button variant="danger" icon="trash" onClick={() => setDel(true)}>Rückfrage Gefahr</Button>
      <Button onClick={() => setOk(true)}>Rückfrage neutral</Button>
      <Button onClick={() => setSheet(true)}>Seitenpanel</Button>
      <Dialog
        open={dlg}
        onOpenChange={setDlg}
        title="Als Vorlage speichern"
        sub="Mods und Einstellungen werden übernommen."
        width={480}
        footLeft="Enter speichert"
        footer={<DialogActions cancel="Abbrechen" confirm={{ label: "Speichern", width: 130, form: "kit-dlg-form" }} />}
      >
        <form id="kit-dlg-form" onSubmit={(e) => { e.preventDefault(); setDlg(false); toast.success(`Vorlage „${name}“ gespeichert`); }}>
          <p style={{ marginBottom: 12 }}>Der Name erscheint unter Neu › Vorlage.</p>
          <TextField id="kit-dlg-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" width="full" />
        </form>
      </Dialog>
      <ConfirmDialog open={del} onOpenChange={setDel} title="Survival löschen?" text="Welten, Mods und Einstellungen dieser Instanz werden entfernt." onConfirm={() => setDel(false)} />
      <ConfirmDialog open={ok} onOpenChange={setOk} danger={false} title="Minecraft beenden?" text="Nicht gespeicherter Fortschritt geht verloren." confirmLabel="Beenden" onConfirm={() => setOk(false)} />
      <Sheet open={sheet} onOpenChange={setSheet} title="Mods hinzufügen" sub="Survival · Fabric 1.21.4" tools={<SearchField value="" onChange={() => undefined} placeholder="Im Katalog suchen" width="full" />}>
        <Empty size="pane" title="Nichts gefunden">Andere Suchbegriffe probieren.</Empty>
      </Sheet>
    </div>
  );
}

function Toasts() {
  return (
    <div style={row}>
      <Button size="s" onClick={() => toast.success("Survival ist bereit", { description: "Bereit zum Spielen" })}>Erfolg</Button>
      <Button size="s" onClick={() => toast.error("Survival ist abgestürzt", { action: { label: "Protokoll zeigen", onClick: () => undefined } })}>Fehler + Aktion</Button>
      <Button size="s" onClick={() => toast.warning("Wenig Arbeitsspeicher")}>Warnung</Button>
      <Button size="s" onClick={() => toast("1:24 gespielt")}>Ohne Icon</Button>
    </div>
  );
}

function Toolbars() {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  return (
    <>
      <Toolbar search="m">
        <SearchField value={q} onChange={setQ} placeholder="Instanzen durchsuchen" />
        <Button variant="ghost" icon="list">Sortieren</Button>
        <Spacer />
        <Button variant="primary" icon="plus">Neue Instanz</Button>
      </Toolbar>
      <Toolbar
        height={56}
        search="s"
        altActive={picking}
        alt={
          <>
            <b style={{ minWidth: "12ch" }}>3 gewählt</b>
            <Button size="s" icon="up">Aktualisieren</Button>
            <Button size="s" variant="ghost" tone="bad" icon="trash">Entfernen</Button>
            <Spacer />
            <Button size="s" variant="ghost" onClick={() => setPicking(false)}>Fertig</Button>
          </>
        }
      >
        <SearchField value="" onChange={() => undefined} placeholder="Mods suchen" size="s" />
        <Spacer />
        <Button size="s" onClick={() => setPicking(true)}>Auswählen</Button>
      </Toolbar>
    </>
  );
}

export function OverlaySection() {
  return (
    <>
      <Sec title="Tooltip, Trunc" id="tip">
        <div style={row}>
          <Tip label="Einfacher Tooltip"><Button variant="ghost">Hover</Button></Tip>
          <Tip label={<><div className="tn">Survival 1.21</div><div className="tv">Fabric · 42 Mods</div><div className="tu">2 Updates</div><div className="td">zuletzt vor 2 Tagen gespielt</div></>} describe>
            <Button variant="ghost" icon="info">Reich</Button>
          </Tip>
          <IconButton icon="gear" label="Einstellungen" />
          <button type="button" className="fx" style={{ width: 140, padding: "6px 8px", background: "var(--panel)" }}>
            <Trunc text="Ein sehr langer Instanzname, der abgeschnitten wird" style={{ display: "block" }} />
          </button>
        </div>
      </Sec>

      <Sec title="Menü, Kontextmenü, Popover" id="menu">
        <div style={{ ...row, alignItems: "flex-start" }}>
          <MenuStates />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Menu items={ITEMS} align="start" trigger={<IconButton icon="more" label="Weitere Aktionen" variant="secondary" />} />
            <ContextMenu items={ITEMS}>
              <div tabIndex={0} className="fx" style={{ width: 220, height: 64, display: "grid", placeItems: "center", background: "var(--panel)", ...cap }}>Rechtsklick hier</div>
            </ContextMenu>
            <Popover label="Aufgaben" tip="Aufgaben" width={400} trigger={<IconButton icon="tasks" label="Aufgaben" tip={false} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SectionHeader title="Aufgaben" size="card" actions={<Button variant="ghost" size="s">Fertige entfernen</Button>} />
                <JobProgress label="Survival wird installiert" sub="Bibliotheken laden" p={0.42} onCancel={() => undefined} />
                <JobProgress label="Inhalte laden" sub="Wird geprüft" p={null} />
              </div>
            </Popover>
          </div>
        </div>
      </Sec>

      <Sec title="Dialog, Rückfrage, Seitenpanel, Toasts" id="dlg">
        <Dialogs />
        <Toasts />
      </Sec>

      <Sec title="Statusplatte, Fehler" id="status">
        <StatusPanel tone="bad" icon="warn" title="Survival ist abgestürzt" actions={<Button size="s" icon="term">Protokoll</Button>}>Code 1 · Absturzbericht liegt im Ordner crash-reports</StatusPanel>
        <StatusPanel tone="warn" title="Wenig Arbeitsspeicher">Mehr als 8 GB lassen dem System zu wenig übrig.</StatusPanel>
        <StatusPanel tone="run" size="s" title="Läuft">seit 12:04 · 1.824 Zeilen</StatusPanel>
        <StatusPanel size="s" icon="info" title="Kein Protokoll">Starte die Instanz, um hier etwas zu sehen.</StatusPanel>
        <StatusPanel tone="bad" icon="trash" title="Instanz löschen" actions={<Button variant="danger" size="s">Löschen</Button>}>Entfernt Welten, Mods und Einstellungen.</StatusPanel>
        <ErrorBox title="Modrinth ist gerade nicht erreichbar" error={new Error("fetch failed: 503")} onRetry={() => undefined} />
      </Sec>

      <Sec title="Fortschritt, Vorgang, Laden" id="prog">
        <div style={{ display: "grid", gridTemplateColumns: "110px 240px 240px", gap: "12px 16px", alignItems: "center" }}>
          <span style={cap}>normal</span><Progress p={0.37} /><Progress p={null} label="Lädt" />
          <span style={cap}>thin</span><Progress thin p={0.62} /><Progress thin tone="bad" p={0.8} />
          <span style={cap}>Job 112</span><JobProgress label="Lädt" p={0.3} width={112} /><JobProgress label="Wird geprüft" p={null} width={120} onCancel={() => undefined} />
          <span style={cap}>Job 230</span><div style={{ gridColumn: "span 2" }}><JobProgress label="Modpack wird installiert" p={0.55} width={230} onCancel={() => undefined} /></div>
          <span style={cap}>Skel</span><Skel h={40} /><Skel w={160} h={16} />
        </div>
      </Sec>

      <Sec title="Leerzustand" id="empty">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
          <div className="plate"><Empty size="page" title="Noch keine Instanz" actions={<Button variant="primary" icon="plus">Neue Instanz</Button>}>Leg eine an oder zieh eine Datei hierher.</Empty></div>
          <div className="plate"><Empty mood="sleep" title="Nichts gefunden">Andere Suchbegriffe probieren.</Empty></div>
          <div className="plate"><Empty size="pane" ill={<Glyph name="chest" pal="sand" box={64} />} title="Nur in der App" /></div>
        </div>
      </Sec>

      <Sec title="Seitengerüst" id="layout">
        <WorkspaceDemo />
        <Toolbars />
        <SectionHeader title="Weiterspielen" actions={<Button variant="ghost" size="s" iconEnd="chev" bleed="end">Alle</Button>} />
        <SectionHeader title="Unterabschnitt" size="sub" as="h3" />
        <div style={row}>
          {(["page", "dialog", "section", "sub", "card"] as const).map((l) => <Heading key={l} level={l} as="h3">{l}</Heading>)}
        </div>
        <Actions align="between"><Button variant="ghost">Links</Button><Actions><Button>Abbrechen</Button><Button variant="primary">Speichern</Button></Actions></Actions>
        <Actions align="end" gap={4}><IconButton icon="list" label="Liste" /><IconButton icon="grid" label="Raster" /></Actions>
      </Sec>
    </>
  );
}
