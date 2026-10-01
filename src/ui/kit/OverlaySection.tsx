/**
 * Nur Entwicklung (/_kit): Vorschau Überlagerungen, Rückmeldungen und Seitengerüst (Kit-Paket A2/2).
 * Menü-Zustände zusätzlich als stehende Fläche (gleiche Klassen), Dialoge/Menüs/Toasts live zum Ausprobieren.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import {
  Actions, Button, ConfirmDialog, ContextMenu, Dialog, DialogActions, Empty, ErrorBox, Heading, Icon, IconButton, JobProgress, Menu, PageHeader,
  Popover, Progress, SearchField, SectionHeader, Sheet, Skel, Spacer, StatusPanel, TextField, Tip, Toolbar, Trunc, type IconName, type MenuEntry,
} from "@/ui";

const cap: CSSProperties = { fontSize: 12, color: "var(--fg-3)", fontWeight: 600 };
const sec: CSSProperties = { display: "flex", flexDirection: "column", gap: 14, padding: "22px 0", boxShadow: "inset 0 calc(var(--px) * -1) 0 var(--line)" };
const row: CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

function Sec({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section style={sec} data-kit={`sec-${id}`}>
      <h2 className="vx-h">{title}</h2>
      {children}
    </section>
  );
}

/** Stehende Menüfläche: gleiche Klassen wie Radix, Zustände erzwungen. */
function MenuStates() {
  const { t } = useI18n();
  const it = (text: string, icon: IconName, extra: Record<string, string> = {}, cls = "") => (
    <div className={`vx-mi ${cls}`} {...extra}>
      <Icon name={icon} size="s" />
      <span className="vx-trunc">{text}</span>
    </div>
  );
  return (
    <div className="vx-pop" data-ctx="overlay" style={{ width: 260, animation: "none" }}>
      <div className="vx-mlabel">{t("ui.kit.states")}</div>
      {it("Normal", "folder")}
      {it(t("ui.kit.highlighted"), "copy", { "data-highlighted": "" })}
      {it(t("ui.kit.stateOff"), "term", { "data-disabled": "" })}
      {it(t("ui.kit.danger"), "trash", { "data-tone": "bad" })}
      {it(t("ui.kit.dangerHighlighted"), "trash", { "data-tone": "bad", "data-highlighted": "" })}
      <div className="vx-msep" />
      <div className="vx-mi" data-tall="">
        <Icon name="user" size="l" tone="muted" />
        <span className="vx-mi-t2"><b className="vx-trunc">{t("ui.kit.twoLine")}</b><span className="vx-trunc">{t("ui.kit.subline")}</span></span>
        <Icon name="check" size="s" className="vx-mi-ck" />
      </div>
    </div>
  );
}

function Dialogs() {
  const { t } = useI18n();
  const [dlg, setDlg] = useState(false);
  const [del, setDel] = useState(false);
  const [ok, setOk] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("Survival");
  return (
    <div style={row}>
      <Button icon="plus" onClick={() => setDlg(true)}>{t("ui.kit.dialogWithField")}</Button>
      <Button variant="danger" icon="trash" onClick={() => setDel(true)}>{t("ui.kit.confirmDanger")}</Button>
      <Button onClick={() => setOk(true)}>{t("ui.kit.confirmNeutral")}</Button>
      <Button onClick={() => setSheet(true)}>{t("ui.kit.sheetDemo")}</Button>
      <Dialog
        open={dlg}
        onOpenChange={setDlg}
        title={t("components.instance.saveAsTemplate")}
        sub={t("ui.kit.templateSub")}
        width={480}
        footer={<DialogActions left={t("ui.kit.enterSaves")} cancel={t("common.cancel")} confirm={{ label: t("common.save"), width: 130, form: "kit-dlg-form" }} />}
      >
        <form id="kit-dlg-form" onSubmit={(e) => { e.preventDefault(); setDlg(false); toast.success(t("ui.kit.templateSaved", { name })); }}>
          <p style={{ marginBottom: 12 }}>{t("ui.kit.templateNameHint")}</p>
          <TextField id="kit-dlg-name" value={name} onChange={(e) => setName(e.target.value)} aria-label={t("common.name")} width="full" />
        </form>
      </Dialog>
      <ConfirmDialog open={del} onOpenChange={setDel} title={t("ui.kit.deleteTitle", { name: "Survival" })} text={t("ui.kit.deleteText")} onConfirm={() => setDel(false)} />
      <ConfirmDialog open={ok} onOpenChange={setOk} danger={false} title={t("components.game.stopTitle")} text={t("ui.kit.quitText")} confirmLabel={t("components.game.quit")} onConfirm={() => setOk(false)} />
      <Sheet open={sheet} onOpenChange={setSheet} title={t("ui.kit.addMods")} sub="Survival · Fabric 1.21.4" tools={<SearchField value="" onChange={() => undefined} placeholder={t("components.sheet.searchPlaceholder")} width="full" />}>
        <Empty size="pane" ill="search" title={t("components.search.nothingFound")}>{t("ui.kit.tryOtherTerms")}</Empty>
      </Sheet>
    </div>
  );
}

function Toasts() {
  const { t } = useI18n();
  return (
    <div style={row}>
      <Button size="s" onClick={() => toast.success(t("hooks.install.readyToast", { name: "Survival" }), { description: t("hooks.install.readySub") })}>{t("ui.kit.success")}</Button>
      <Button size="s" onClick={() => toast.error(t("hooks.game.crashed", { name: "Survival" }), { action: { label: t("ui.kit.showLog"), onClick: () => undefined } })}>{t("ui.kit.errorAction")}</Button>
      <Button size="s" onClick={() => toast.warning(t("ui.kit.memoryLow"))}>{t("ui.kit.warning")}</Button>
      <Button size="s" onClick={() => toast(t("components.playtime.played", { time: "1:24" }))}>{t("ui.kit.noIcon")}</Button>
    </div>
  );
}

function Toolbars() {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  return (
    <>
      <Toolbar search="m" wrapBelow={1096}>
        <SearchField value={q} onChange={setQ} placeholder={t("ui.kit.searchInstances")} />
        <Button variant="ghost" icon="list">{t("pages.instances.sortLabel")}</Button>
        <Spacer />
        <Button variant="primary" icon="plus">{t("components.newInstance.title")}</Button>
      </Toolbar>
      <Toolbar
        height={56}
        search="s"
        wrapBelow={800}
        altActive={picking}
        alt={
          <>
            <b style={{ minWidth: "12ch" }}>{t("ui.kit.selectedCount", { n: 3 })}</b>
            <Button size="s" icon="up">{t("common.refresh")}</Button>
            <Button size="s" variant="ghost" tone="bad" icon="trash">{t("common.remove")}</Button>
            <Spacer />
            <Button size="s" variant="ghost" onClick={() => setPicking(false)}>{t("common.done")}</Button>
          </>
        }
      >
        <SearchField value="" onChange={() => undefined} placeholder={t("ui.kit.searchMods")} size="s" />
        <Spacer />
        <Button size="s" onClick={() => setPicking(true)}>{t("ui.kit.select")}</Button>
      </Toolbar>
    </>
  );
}

export function OverlaySection() {
  const { t } = useI18n();
  const ITEMS: MenuEntry[] = [
    { label: t("common.instance") },
    { id: "play", text: t("common.play"), icon: "play", onSelect: () => undefined },
    { id: "dir", text: t("components.instance.openFolder"), icon: "folder", onSelect: () => undefined },
    { id: "log", text: t("components.log.ariaLabel"), icon: "term", disabled: true, onSelect: () => undefined },
    { id: "acc", text: "Steve_42", sub: t("ui.kit.offlineName"), lead: <Icon name="user" size="l" tone="muted" />, checked: true, onSelect: () => undefined },
    "-",
    { id: "del", text: t("common.delete"), icon: "trash", bad: true, onSelect: () => undefined },
  ];
  return (
    <>
      <Sec title={t("ui.kit.secTooltip")} id="tip">
        <div style={row}>
          <Tip label={t("ui.kit.simpleTip")}><Button variant="ghost">Hover</Button></Tip>
          <Tip label={<><div className="tn">Survival 1.21</div><div className="tv">Fabric · 42 Mods</div><div className="tu">2 Updates</div><div className="td">{t("ui.kit.lastPlayedAgo", { n: 2 })}</div></>} describe>
            <Button variant="ghost" icon="info">{t("ui.kit.richTip")}</Button>
          </Tip>
          <IconButton icon="gear" label={t("common.settings")} />
          <button type="button" className="fx" style={{ width: 140, padding: "6px 8px", background: "var(--panel)" }}>
            <Trunc text={t("ui.kit.longName")} style={{ display: "block" }} />
          </button>
        </div>
      </Sec>

      <Sec title={t("ui.kit.secMenu")} id="menu">
        <div style={{ ...row, alignItems: "flex-start" }}>
          <MenuStates />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Menu items={ITEMS} align="start" trigger={<IconButton icon="more" label={t("components.instance.moreActions")} variant="secondary" />} />
            <ContextMenu items={ITEMS}>
              <div tabIndex={0} className="fx" style={{ width: 220, height: 64, display: "grid", placeItems: "center", background: "var(--panel)", ...cap }}>{t("ui.kit.rightClickHere")}</div>
            </ContextMenu>
            <Popover label={t("ui.tasks.title")} tip={t("ui.tasks.title")} width={400} trigger={<IconButton icon="tasks" label={t("ui.tasks.title")} tip={false} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SectionHeader title={t("ui.tasks.title")} size="card" actions={<Button variant="ghost" size="s">{t("ui.tasks.clearDone")}</Button>} />
                <JobProgress label={t("ui.tasks.installing", { name: "Survival" })} sub={t("ui.kit.loadingLibs")} p={0.42} onCancel={() => undefined} />
                <JobProgress label={t("ui.tasks.loadingContents")} sub={t("components.common.checking")} p={null} />
              </div>
            </Popover>
          </div>
        </div>
      </Sec>

      <Sec title={t("ui.kit.secDialog")} id="dlg">
        <Dialogs />
        <Toasts />
      </Sec>

      <Sec title={t("ui.kit.secStatus")} id="status">
        <StatusPanel tone="bad" icon="warn" title={t("hooks.game.crashed", { name: "Survival" })} actions={<Button size="s" icon="term">{t("components.log.ariaLabel")}</Button>}>{t("ui.kit.crashLine")}</StatusPanel>
        <StatusPanel tone="warn" title={t("ui.kit.memoryLow")}>{t("ui.kit.memoryLowDetail")}</StatusPanel>
        <StatusPanel tone="run" size="s" title={t("components.game.running")}>{t("ui.kit.runningSince", { time: "12:04", lines: "1.824" })}</StatusPanel>
        <StatusPanel size="s" icon="info" title={t("ui.kit.noLog")}>{t("ui.kit.noLogHint")}</StatusPanel>
        <StatusPanel tone="bad" icon="trash" title={t("detail.settings.deleteInstance")} actions={<Button variant="danger" size="s">{t("common.delete")}</Button>}>{t("ui.kit.deleteInstanceText")}</StatusPanel>
        <ErrorBox title={t("ui.kit.modrinthDown")} error={new Error("fetch failed: 503")} onRetry={() => undefined} />
      </Sec>

      <Sec title={t("ui.kit.secProgress")} id="prog">
        <div style={{ display: "grid", gridTemplateColumns: "110px 240px 240px", gap: "12px 16px", alignItems: "center" }}>
          <span style={cap}>normal</span><Progress p={0.37} /><Progress p={null} label={t("ui.kit.loading")} />
          <span style={cap}>thin</span><Progress thin p={0.62} /><Progress thin tone="bad" p={0.8} />
          <span style={cap}>Job 112</span><JobProgress label={t("ui.kit.loading")} p={0.3} width={112} /><JobProgress label={t("components.common.checking")} p={null} width={120} onCancel={() => undefined} />
          <span style={cap}>Job 230</span><div style={{ gridColumn: "span 2" }}><JobProgress label={t("ui.tasks.installing", { name: t("components.catalog.one.modpack") })} p={0.55} width={230} onCancel={() => undefined} /></div>
          <span style={cap}>Skel</span><Skel h={40} /><Skel w={160} h={16} />
        </div>
      </Sec>

      <Sec title={t("ui.kit.secEmpty")} id="empty">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
          <div className="plate"><Empty size="page" ill="box" title={t("ui.kit.noInstances")} actions={<Button variant="primary" icon="plus">{t("components.newInstance.title")}</Button>}>{t("ui.kit.noInstancesBody")}</Empty></div>
          <div className="plate"><Empty ill="search" title={t("components.search.nothingFound")}>{t("ui.kit.tryOtherTerms")}</Empty></div>
          <div className="plate"><Empty size="pane" ill="file" title={t("ui.kit.appOnly")} /></div>
        </div>
      </Sec>

      <Sec title={t("ui.kit.secLayout")} id="layout">
        <PageHeader title={t("ui.nav.library")} count={12}><Button variant="primary" icon="plus">{t("components.newInstance.title")}</Button></PageHeader>
        <Toolbars />
        <SectionHeader title={t("ui.kit.continue")} actions={<Button variant="ghost" size="s" iconEnd="chev" bleed="end">{t("common.all")}</Button>} />
        <SectionHeader title={t("ui.kit.subsection")} size="sub" as="h3" />
        <div style={row}>
          {(["page", "dialog", "section", "sub", "card"] as const).map((l) => <Heading key={l} level={l} as="h3">{l}</Heading>)}
        </div>
        <Actions align="between"><Button variant="ghost">{t("ui.kit.left")}</Button><Actions><Button>{t("common.cancel")}</Button><Button variant="primary">{t("common.save")}</Button></Actions></Actions>
        <Actions align="end" gap={4}><IconButton icon="list" label={t("pages.instances.viewList")} /><IconButton icon="grid" label={t("detail.content.viewGrid")} /></Actions>
      </Sec>
    </>
  );
}
