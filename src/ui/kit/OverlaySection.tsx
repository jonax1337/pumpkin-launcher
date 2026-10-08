/**
 * Nur Entwicklung (/_kit): Vorschau Überlagerungen, Rückmeldungen und Seitengerüst.
 * Menü-Zustände zusätzlich als stehende Fläche (gleiche Klassen), Dialoge/Menüs/Toasts live zum Ausprobieren.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Actions, Avatar, Button, ConfirmDialog, ContextMenu, Dialog, DialogActions, Empty, ErrorBox, Glyph, Heading, Icon, IconButton, JobProgress, Menu, MenuHead,
  MenuItem, MenuSep, Popover, Progress, SearchField, SectionHeader, Sheet, Skel, Spacer, StatusPanel, TextField, Tip, Toolbar, Trunc, type IconName, type MenuEntry,
} from "@/ui";
import { Cap, Sec } from "./kit-ui";
import { WorkspaceDemo } from "./WorkspaceDemo";

const ITEMS: MenuEntry[] = [
  { label: "Instanz" },
  { id: "play", text: "Spielen", icon: "play", onSelect: () => undefined },
  { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => undefined },
  { id: "log", text: "Protokoll", icon: "terminal", disabled: true, onSelect: () => undefined },
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
    <div className="vx-pop kit-menu-static" data-ctx="overlay">
      <div className="vx-mhead">
        <Icon name="user" size="l" tone="muted" />
        <span className="vx-mhead-t"><b>Kopfzeile</b><small>MenuHead: Name und Zusatz</small></span>
      </div>
      <div className="vx-msep" />
      <div className="vx-mlabel">Zustände</div>
      {menuRow("Normal", "folder")}
      {menuRow("Markiert", "copy", { "data-highlighted": "" })}
      {menuRow("aus", "terminal", { "data-disabled": "" })}
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
    <div className="kit-row" data-gap="12">
      <Button icon="plus" onClick={() => setDlg(true)}>Dialog mit Feld</Button>
      <Button variant="danger" icon="trash" onClick={() => setDel(true)}>Rückfrage Gefahr</Button>
      <Button onClick={() => setOk(true)}>Rückfrage neutral</Button>
      <Button onClick={() => setSheet(true)}>Seitenpanel</Button>
      <Dialog
        open={dlg}
        onOpenChange={setDlg}
        title="Als Vorlage speichern"
        sub="Mods und Einstellungen werden übernommen."
        size="s"
        footLeft="Enter speichert"
        footer={<DialogActions cancel="Abbrechen" confirm={{ label: "Speichern", width: 130, form: "kit-dlg-form" }} />}
      >
        <form id="kit-dlg-form" onSubmit={(e) => { e.preventDefault(); setDlg(false); toast.success(`Vorlage „${name}“ gespeichert`); }}>
          <p className="kit-form-mb">Der Name erscheint unter Neu › Vorlage.</p>
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
    <div className="kit-row" data-gap="12">
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
            <b className="kit-bulk-label">3 gewählt</b>
            <Button size="s" icon="update">Aktualisieren</Button>
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
        <div className="kit-row" data-gap="12">
          <Tip label="Einfacher Tooltip"><Button variant="ghost">Hover</Button></Tip>
          <Tip label={<><div className="tn">Survival 1.21</div><div className="tv">Fabric · 42 Mods</div><div className="tu">2 Updates</div><div className="td">zuletzt vor 2 Tagen gespielt</div></>} describe>
            <Button variant="ghost" icon="info">Reich</Button>
          </Tip>
          <IconButton icon="settings" label="Einstellungen" />
          <button type="button" className="fx kit-trunc-box">
            <Trunc text="Ein sehr langer Instanzname, der abgeschnitten wird" />
          </button>
        </div>
      </Sec>

      <Sec title="Menü, Kontextmenü, Popover" id="menu">
        <div className="kit-row" data-gap="12" data-align="start">
          <MenuStates />
          <div className="kit-stack" data-gap="12">
            <Menu items={ITEMS} align="start" trigger={<IconButton icon="more" label="Weitere Aktionen" variant="secondary" />} />
            <Menu align="start" trigger={<Button variant="ghost" icon="user" iconEnd="chev-down">Kontomenü (MenuHead)</Button>}>
              <MenuHead lead={<Avatar name="Steve" box={32} />} title="Steve_42" sub="Microsoft · aktiv" />
              <MenuSep />
              <MenuItem icon="skins">Skins</MenuItem>
              <MenuItem icon="swap">Konto wechseln</MenuItem>
              <MenuSep />
              <MenuItem icon="logout" bad>Abmelden</MenuItem>
            </Menu>
            <ContextMenu items={ITEMS}>
              <div tabIndex={0} className="fx kit-ctx-box kit-cap">Rechtsklick hier</div>
            </ContextMenu>
            <Popover label="Aufgaben" tip="Aufgaben" trigger={<IconButton icon="tasks" label="Aufgaben" tip={false} />}>
              <div className="kit-stack" data-gap="12">
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
        <StatusPanel tone="bad" icon="warn" title="Survival ist abgestürzt" actions={<Button size="s" icon="terminal">Protokoll</Button>}>Code 1 · Absturzbericht liegt im Ordner crash-reports</StatusPanel>
        <StatusPanel tone="warn" title="Wenig Arbeitsspeicher">Mehr als 8 GB lassen dem System zu wenig übrig.</StatusPanel>
        <StatusPanel tone="run" size="s" title="Läuft">seit 12:04 · 1.824 Zeilen</StatusPanel>
        <StatusPanel size="s" icon="info" title="Kein Protokoll">Starte die Instanz, um hier etwas zu sehen.</StatusPanel>
        <StatusPanel tone="bad" icon="trash" title="Instanz löschen" actions={<Button variant="danger" size="s">Löschen</Button>}>Entfernt Welten, Mods und Einstellungen.</StatusPanel>
        <ErrorBox title="Modrinth ist gerade nicht erreichbar" error={new Error("fetch failed: 503")} onRetry={() => undefined} />
      </Sec>

      <Sec title="Fortschritt, Vorgang, Laden" id="prog">
        <div className="kit-matrix" data-cols="progress">
          <Cap>XP 0 · 18 %</Cap><Progress p={0} label="Leer" /><Progress p={0.18} label="Lädt" />
          <Cap>XP 64 · 100 %</Cap><Progress p={0.64} label="Wird installiert" /><Progress p={1} label="Fertig" />
          <Cap>normal</Cap><Progress p={0.37} /><Progress p={null} label="Lädt" />
          <Cap>thin</Cap><Progress thin p={0.62} /><Progress thin tone="bad" p={0.8} />
          <Cap>Ton run · warn</Cap><Progress tone="run" p={0.5} label="Ton run" /><Progress tone="warn" p={0.5} label="Ton warn" />
          <Cap>Job 112</Cap><JobProgress label="Lädt" p={0.3} width={112} /><JobProgress label="Wird geprüft" p={null} width={120} onCancel={() => undefined} />
          <Cap>Job 230</Cap><div data-span="2"><JobProgress label="Modpack wird installiert" p={0.55} width={230} onCancel={() => undefined} /></div>
          <Cap>Skel</Cap><Skel h={40} /><Skel w={160} h={16} />
        </div>
      </Sec>

      <Sec title="Leerzustand" id="empty">
        <div className="kit-grid" data-cols="three">
          <div className="plate"><Empty size="page" title="Noch keine Instanz" actions={<Button variant="primary" icon="plus">Neue Instanz</Button>}>Leg eine an oder zieh eine Datei hierher.</Empty></div>
          <div className="plate"><Empty mood="sleep" title="Nichts gefunden">Andere Suchbegriffe probieren.</Empty></div>
          <div className="plate"><Empty size="pane" ill={<Glyph name="chest" pal="sand" box={64} />} title="Nur in der App" /></div>
        </div>
      </Sec>

      <Sec title="Seitengerüst" id="layout">
        <WorkspaceDemo />
        <Toolbars />
        <SectionHeader title="Weiterspielen" actions={<Button variant="ghost" size="s" iconEnd="chev-right" bleed="end">Alle</Button>} />
        <SectionHeader title="Unterabschnitt" size="sub" as="h3" />
        <div className="kit-row" data-gap="12">
          {(["page", "dialog", "section", "sub", "card"] as const).map((l) => <Heading key={l} level={l} as="h3">{l}</Heading>)}
        </div>
        <Actions align="between"><Button variant="ghost">Links</Button><Actions><Button>Abbrechen</Button><Button variant="primary">Speichern</Button></Actions></Actions>
        <Actions align="end" gap={4}><IconButton icon="list" label="Liste" /><IconButton icon="grid" label="Raster" /></Actions>
      </Sec>
    </>
  );
}
