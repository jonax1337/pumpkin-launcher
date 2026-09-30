import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router";
import { getVersion } from "@tauri-apps/api/app";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useView } from "@/app/Layout";
import { MemoryChooser } from "@/components/common";
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

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  const lab = (
    <>
      {label}
      {hint && <small>{hint}</small>}
    </>
  );
  return (
    <div className="frow">
      {htmlFor ? <label htmlFor={htmlFor}>{lab}</label> : <div className="fl">{lab}</div>}
      <div className="fc">{children}</div>
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
    <Row label="Java" hint="Standard für alle Instanzen">
      <Radio name="gjava" checked={!own} onChange={() => (setOwn(false), set({ javaPath: "" }))}>
        Automatisch <span className="faint">(Voxlet lädt die passende Version)</span>
      </Radio>
      <Radio name="gjava" checked={own} onChange={() => setOwn(true)}>Eigene Java-Installation</Radio>
      <div className="row" style={{ flexWrap: "nowrap", visibility: own ? "visible" : "hidden" }}>
        <TextField
          className="grow"
          aria-label="Pfad zu javaw.exe"
          value={javaPath}
          onChange={(e) => set({ javaPath: e.target.value })}
          placeholder="C:\Program Files\Java\jdk-21\bin\javaw.exe"
        />
        {!api.isMock && <Btn onClick={() => void browse().catch((e: Error) => toast.error(e.message))}>Durchsuchen</Btn>}
      </div>
    </Row>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const view = useView();
  const { hash } = useLocation();
  const [current, setCurrent] = useState<SectionId>("konten");
  const [version, setVersion] = useState<string>(pkg.version);
  const reduced = useSyncExternalStore(subscribeRm, () => matchMedia(RM).matches);

  useEffect(() => {
    if (!api.isMock) void getVersion().then(setVersion).catch(() => undefined);
  }, []);

  // #konten (aus dem Kontomenü) springt direkt zum Abschnitt.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  // Abschnitt links markieren, der gerade oben steht.
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    let raf = 0;
    const spy = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      let cur: SectionId = SECTIONS[0].id;
      for (const sec of SECTIONS) {
        const node = document.getElementById(sec.id);
        if (node && node.getBoundingClientRect().top - top <= 80) cur = sec.id;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
      setCurrent(cur);
    };
    const onScroll = () => (raf ||= requestAnimationFrame(spy));
    el.addEventListener("scroll", onScroll, { passive: true });
    spy();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [view]);

  const go = (id: SectionId) => document.getElementById(id)?.scrollIntoView({ behavior: reduced || !s.motion ? "auto" : "smooth" });

  return (
    <section className="set">
      <nav className="setnav" aria-label="Abschnitte">
        <h1 className="h-page">Einstellungen</h1>
        {SECTIONS.map((sec) => (
          <button key={sec.id} type="button" className="ptab fx" aria-selected={current === sec.id} aria-current={current === sec.id ? "true" : undefined} onClick={() => go(sec.id)}>
            {sec.label}
            <i className="tick" />
          </button>
        ))}
      </nav>

      <div className="form" style={{ paddingTop: 0 }}>
        <div className="fsec" id="konten">
          <h3>Konten</h3>
          <AccountsSection />
        </div>

        <div className="fsec" id="spiel">
          <h3>Spiel</h3>
          <Row label="Arbeitsspeicher" hint="Standard für Instanzen ohne eigenen Wert">
            <MemoryChooser name="gram" value={s.memoryMb} onChange={(mb) => s.set({ memoryMb: mb })} />
          </Row>
          <JavaRow />
        </div>

        <div className="fsec" id="darstellung">
          <h3>Darstellung</h3>
          <Row label="Bewegte Szenen" hint="Sterne, Wolken, Glut. Pausiert, solange Minecraft läuft.">
            <div className="row">
              <Switch checked={s.motion} onChange={(motion) => s.set({ motion })} label="Bewegte Szenen" />
              <span className="muted">{reduced ? "Dein System wünscht weniger Bewegung, Szenen stehen still." : s.motion ? "An" : "Aus"}</span>
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
        </div>

        <div className="fsec" id="erweitert">
          <h3>Erweitert</h3>
          <Row label="Microsoft-Client-ID" hint="Optional" htmlFor="ms-client-id">
            <TextField
              id="ms-client-id"
              value={s.msClientId}
              onChange={(e) => s.set({ msClientId: e.target.value })}
              placeholder="Eingebaute Kennung verwenden"
              aria-describedby="ms-client-id-hint"
            />
            <span id="ms-client-id-hint" className="help">
              Für die Microsoft-Anmeldung braucht Voxlet eine App-Kennung. Leer lassen, dann gilt die eingebaute. Wie du eine eigene bekommst,
              steht in der Anleitung „ACCOUNT-SETUP“ im Ordner docs.
            </span>
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
        </div>

        <div className="fsec" id="ueber">
          <h3>Über Voxlet</h3>
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
        </div>
      </div>
    </section>
  );
}
