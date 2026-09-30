import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router";
import { getVersion } from "@tauri-apps/api/app";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useView } from "@/app/Layout";
import { MemoryChooser, MemoryHelp } from "@/components/common";
import { AccountsSection } from "@/components/PlayerNames";
import { Btn, Radio, Seg, Switch, TextField } from "@/components/px";
import { api } from "@/lib/api";
import { Mark } from "@/pixel/icons";
import { useSettings, type PxSize } from "@/store/settings";
import pkg from "../../package.json";

const SECTIONS = [
  { id: "konten", label: "Konten" },
  { id: "spiel", label: "Spiel" },
  { id: "darstellung", label: "Darstellung" },
  { id: "erweitert", label: "Erweitert" },
  { id: "ueber", label: "Über Voxlet" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRm = (cb: () => void) => {
  const mq = matchMedia(RM);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * Formularzeile: Label | Steuerelement | Hilfe (`aside`, rechte Spalte; bei wenig Platz unter dem Steuerelement).
 * `group` = Auswahlgruppe (Radios), die ihr Label als Gruppennamen bekommt.
 */
function Row({ label, hint, htmlFor, group, aside, children }: { label: string; hint?: string; htmlFor?: string; group?: boolean; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  const lab = (
    <>
      <span id={`${id}-l`}>{label}</span>
      {hint && <small id={`${id}-h`}>{hint}</small>}
    </>
  );
  return (
    <div className="frow">
      {htmlFor ? <label htmlFor={htmlFor}>{lab}</label> : <div className="fl">{lab}</div>}
      <div
        className="fc"
        role={group ? "radiogroup" : undefined}
        aria-labelledby={group ? `${id}-l` : undefined}
        aria-describedby={group && hint ? `${id}-h` : undefined}
      >
        {children}
      </div>
      {aside && <div className="fh">{aside}</div>}
    </div>
  );
}

/** Java: automatisch (mitgelieferte Runtime) oder eigene javaw.exe. */
function JavaRow() {
  const javaPath = useSettings((s) => s.javaPath);
  const set = useSettings((s) => s.set);
  const [own, setOwn] = useState(javaPath !== "");
  async function browse() {
    const picked = await openFile({ multiple: false, directory: false, filters: [{ name: "Java", extensions: ["exe"] }] });
    if (typeof picked === "string") set({ javaPath: picked });
  }
  return (
    <Row
      label="Java"
      hint="Standard für alle Instanzen"
      group
      aside="Automatisch passt fast immer: Voxlet lädt für jede Minecraft-Version die richtige Java-Version. Eine eigene Installation brauchst du nur, wenn eine Anleitung es verlangt."
    >
      <Radio name="gjava" checked={!own} onChange={() => (setOwn(false), set({ javaPath: "" }))}>
        Automatisch <span className="faint">(Voxlet lädt die passende Version)</span>
      </Radio>
      <Radio name="gjava" checked={own} onChange={() => setOwn(true)}>Eigene Java-Installation</Radio>
      {/* Bleibt stehen und ist nur gesperrt, wie der Regler bei „Automatisch“: kein Sprung, keine Lücke.
          Gesperrt ohne Beispielpfad, sonst wirkt es, als wäre schon ein Pfad gesetzt. */}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <TextField
          className="grow"
          disabled={!own}
          aria-label="Pfad zu javaw.exe"
          value={javaPath}
          onChange={(e) => set({ javaPath: e.target.value })}
          placeholder={own ? "z. B. C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe" : "Pfad zu javaw.exe"}
        />
        {!api.isMock && <Btn disabled={!own} onClick={() => void browse().catch((e: Error) => toast.error(e.message))}>Durchsuchen</Btn>}
      </div>
    </Row>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const view = useView();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const nav = useRef<HTMLDivElement>(null);
  // ?tab=… gewinnt; #konten (aus dem Kontomenü) und die anderen Abschnitts-Anker öffnen ihren Tab.
  const fromHash = decodeURIComponent(hash.slice(1));
  const tab: SectionId = SECTIONS.find((t) => t.id === params.get("tab"))?.id ?? SECTIONS.find((t) => t.id === fromHash)?.id ?? "konten";
  const [version, setVersion] = useState<string>(pkg.version);
  const reduced = useSyncExternalStore(subscribeRm, () => matchMedia(RM).matches);

  useEffect(() => {
    if (!api.isMock) void getVersion().then(setVersion).catch(() => undefined);
  }, []);

  // Tabwechsel: klebt die Leiste oben, geht die Seite auf deren Ruhelage zurück, damit der neue Inhalt direkt darunter beginnt.
  function select(id: SectionId) {
    setParams({ tab: id }, { replace: true });
    const el = view.current, bar = nav.current;
    const head = bar?.previousElementSibling;
    if (!el || !bar || !head) return;
    const rest = head.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + parseFloat(getComputedStyle(bar).marginTop);
    if (el.scrollTop > rest) el.scrollTop = rest;
  }

  // Pfeiltasten, Home und End wechseln den Tab (Roving-Tabindex wie in der Instanzansicht).
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = SECTIONS.findIndex((t) => t.id === tab);
    const n = SECTIONS.length;
    const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    select(SECTIONS[j].id);
    document.getElementById(`st-${SECTIONS[j].id}`)?.focus();
  }

  const label = SECTIONS.find((t) => t.id === tab)!.label;

  return (
    <section className="page set">
      <div className="page-h">
        <h1 className="h-page">Einstellungen</h1>
      </div>
      <div ref={nav} className="setnav" role="tablist" aria-label="Bereiche der Einstellungen" onKeyDown={onKey}>
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            id={`st-${sec.id}`}
            type="button"
            role="tab"
            className="ptab fx"
            aria-selected={tab === sec.id}
            aria-controls="set-panel"
            tabIndex={tab === sec.id ? 0 : -1}
            onClick={() => select(sec.id)}
          >
            {sec.label}
            <i className="tick" />
          </button>
        ))}
      </div>

      {/* Nur der gewählte Tab. Der Tab-Name ist die Überschrift; das h2 bleibt für Vorleser und Überschriften-Sprünge. */}
      <div className="form" id="set-panel" role="tabpanel" aria-labelledby={`st-${tab}`}>
        <div className="fsec" key={tab}>
          <h2 className="sr">{label}</h2>

          {tab === "konten" && (
            <div className="set-acc">
              <AccountsSection />
            </div>
          )}

          {tab === "spiel" && (
            <>
              <Row label="Arbeitsspeicher" hint="Standard für Instanzen ohne eigenen Wert" group aside={<MemoryHelp value={s.memoryMb} />}>
                <MemoryChooser name="gram" value={s.memoryMb} onChange={(mb) => s.set({ memoryMb: mb })} help={false} />
              </Row>
              <JavaRow />
            </>
          )}

          {tab === "darstellung" && (
            <>
              <Row label="Bewegte Szenen" hint="Sterne, Wolken, Glut. Pausiert, solange Minecraft läuft.">
                {/* Wünscht das System weniger Bewegung, gewinnt das: Schalter aus und gesperrt, mit Grund daneben. */}
                <div className="row">
                  <Switch checked={s.motion && !reduced} disabled={reduced} onChange={(motion) => s.set({ motion })} label="Bewegte Szenen" />
                  <span className={reduced ? "help" : "muted"}>{reduced ? "Dein System wünscht weniger Bewegung – Szenen stehen still." : s.motion ? "An" : "Aus"}</span>
                </div>
              </Row>
              <Row label="Pixelgröße" hint="Größe der Pixel in Szenen, Ecken und Symbolen">
                <div className="row">
                  <Seg<PxSize>
                    small
                    label="Pixelgröße"
                    value={s.pxSize}
                    onChange={(pxSize) => s.set({ pxSize })}
                    options={[{ value: "s", label: "Klein" }, { value: "m", label: "Mittel" }, { value: "l", label: "Groß" }]}
                  />
                </div>
              </Row>
            </>
          )}

          {tab === "erweitert" && (
            <>
              <Row
                label="Microsoft-Client-ID"
                hint="Optional"
                htmlFor="ms-client-id"
                aside={
                  <span id="ms-client-id-hint">
                    Nur für eigene, von Microsoft für Minecraft freigeschaltete Apps (Azure-Client-ID). Leer lassen, dann nutzt Voxlet seine eingebaute
                    Kennung.
                  </span>
                }
              >
                <TextField
                  id="ms-client-id"
                  value={s.msClientId}
                  onChange={(e) => s.set({ msClientId: e.target.value })}
                  placeholder="Eingebaute Kennung verwenden"
                  aria-describedby="ms-client-id-hint"
                />
              </Row>
              <Row label="Zurücksetzen" hint="Einstellungen für Java und Arbeitsspeicher">
                <div className="row">
                  <Btn
                    icon="redo"
                    onClick={() => {
                      s.reset();
                      toast.success("Java und Arbeitsspeicher stehen wieder auf Standard");
                    }}
                  >
                    Auf Standard zurücksetzen
                  </Btn>
                </div>
              </Row>
            </>
          )}

          {tab === "ueber" && (
            <>
              <div className="about">
                <span className="mark" style={{ width: 40, height: 40, display: "grid", placeItems: "center" }}><Mark /></span>
                <div>
                  <div className="wmbig">VOXLET</div>
                  <div className="muted">
                    Version <span className="num">{version}</span> · Minecraft-Launcher für Windows
                  </div>
                </div>
              </div>
              <p className="help" style={{ marginTop: 14 }}>Inhalte und Modpacks kommen von Modrinth. Minecraft ist eine Marke von Mojang.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
