import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { useView } from "@/app/Layout";
import { UpdateRow } from "@/components/AppUpdate";
import { JavaChooser, MemoryChooser, MemoryHelp } from "@/components/common";
import { AccountsSection } from "@/components/PlayerNames";
import { SupportSection } from "@/components/support";
import { Actions, Button, Count, FormRow, FormSection, Hint, PageHeader, Segmented, Select, Switch, TabPanel, Tabs, TextField } from "@/ui";
import { api } from "@/lib/api";
import { Buddy, BrandWordmark, useBrand } from "@/branding/Brand";
import { SEASONS, type PumpkinChoice } from "@/branding/calendar";
import { useSettings, type PxSize } from "@/store/settings";
import pkg from "../../package.json";

const SECTIONS = [
  { value: "konten", label: "Konten" },
  { value: "spiel", label: "Spiel" },
  { value: "darstellung", label: "Darstellung" },
  { value: "erweitert", label: "Erweitert" },
  { value: "support", label: "Support" },
  { value: "ueber", label: "Über Pumpkin Launcher" },
] as const;
type SectionId = (typeof SECTIONS)[number]["value"];

const PX_SIZES: { value: PxSize; label: string }[] = [{ value: "s", label: "Klein" }, { value: "m", label: "Mittel" }, { value: "l", label: "Groß" }];
const PUMPKINS = [
  { value: "auto", label: "Automatisch · nach Jahreszeit" },
  ...SEASONS.map((season) => ({ value: season.id, label: `${season.name} · ${season.label}` })),
];

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRm = (cb: () => void) => {
  const mq = matchMedia(RM);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Java: automatisch (mitgelieferte Runtime) oder eigene javaw.exe. */
function JavaRow() {
  const javaPath = useSettings((s) => s.javaPath);
  const set = useSettings((s) => s.set);
  return (
    <FormRow
      label="Java"
      hint="Standard für alle Instanzen"
      group="radiogroup"
      aside="Automatisch passt fast immer: Pumpkin Launcher lädt für jede Minecraft-Version die richtige Java-Version. Eine eigene Installation brauchst du nur, wenn eine Anleitung es verlangt."
    >
      <JavaChooser
        name="gjava"
        value={javaPath}
        onChange={(path) => set({ javaPath: path })}
        fallback={<>Automatisch <span className="text-fg-3">(Pumpkin Launcher lädt die passende Version)</span></>}
      />
    </FormRow>
  );
}

export function SettingsPage() {
  const { season } = useBrand();
  const s = useSettings();
  const view = useView();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  // ?tab=… gewinnt; #konten (aus dem Kontomenü) und die anderen Abschnitts-Anker öffnen ihren Tab.
  const fromHash = decodeURIComponent(hash.slice(1));
  const tab: SectionId = SECTIONS.find((t) => t.value === params.get("tab"))?.value ?? SECTIONS.find((t) => t.value === fromHash)?.value ?? "konten";
  const [version, setVersion] = useState<string>(pkg.version);
  const reduced = useSyncExternalStore(subscribeRm, () => matchMedia(RM).matches);

  useEffect(() => {
    if (!api.isMock) void getVersion().then(setVersion).catch(() => undefined);
  }, []);

  // Tabwechsel: klebt die Leiste oben, geht die Seite auf deren Ruhelage zurück, damit der neue Inhalt direkt darunter beginnt.
  function settle(tabEl: HTMLElement) {
    const el = view.current, bar = tabEl.closest<HTMLElement>("[role=tablist]");
    const head = bar?.previousElementSibling;
    if (!el || !bar || !head) return;
    const rest = head.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + parseFloat(getComputedStyle(bar).marginTop);
    if (el.scrollTop > rest) el.scrollTop = rest;
  }

  const label = SECTIONS.find((t) => t.value === tab)!.label;

  return (
    <section className="page set">
      <PageHeader title="Einstellungen" />
      <Tabs
        idBase="st"
        sticky
        className="mt-3"
        label="Bereiche der Einstellungen"
        items={[...SECTIONS]}
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        onActivate={(_, el) => settle(el)}
      />

      {/* Nur der gewählte Tab. Der Tab-Name ist die Überschrift; das h2 bleibt für Vorleser und Überschriften-Sprünge. */}
      <TabPanel idBase="st" value={tab}>
        <FormSection key={tab} title={label} srOnlyTitle>
          {tab === "konten" && (
            <div className="set-acc">
              <AccountsSection />
            </div>
          )}

          {tab === "spiel" && (
            <>
              <FormRow label="Arbeitsspeicher" hint="Standard für Instanzen ohne eigenen Wert" group="radiogroup" aside={<MemoryHelp value={s.memoryMb} />}>
                <MemoryChooser name="gram" value={s.memoryMb} onChange={(mb) => s.set({ memoryMb: mb })} help={false} />
              </FormRow>
              <JavaRow />
            </>
          )}

          {tab === "darstellung" && (
            <>
              <FormRow label="Dein Pumpkin" htmlFor="pumpkin-choice" hint="Wähle eine feste Variante für Buddy, Farben und App-Icon oder lass sie mit den Jahreszeiten wechseln.">
                <Select
                  id="pumpkin-choice"
                  value={s.pumpkin}
                  options={PUMPKINS}
                  onChange={(value) => s.set({ pumpkin: value as PumpkinChoice })}
                />
                <Actions gap={12}>
                  <Buddy size={72} />
                  <div><b>{season.name}</b><Hint>{s.pumpkin === 'auto' ? `Automatisch · ${season.id === 'standard' ? 'Zwischen den Jahreszeiten' : season.period}` : 'Fest gewählt · bleibt bis zu deiner nächsten Auswahl'}</Hint></div>
                </Actions>
              </FormRow>
              <FormRow label="Bewegte Szenen & Buddy" hint="Sterne, Wolken, Glut und Buddy. Pausiert, solange Minecraft läuft.">
                {/* Wünscht das System weniger Bewegung, gewinnt das: Schalter aus und gesperrt, mit Grund daneben. */}
                <Actions gap={12}>
                  <Switch
                    checked={s.motion && !reduced}
                    disabled={reduced}
                    onChange={(motion) => s.set({ motion })}
                    label="Bewegte Szenen & Buddy"
                    stateText={reduced ? undefined : ["An", "Aus"]}
                  />
                  {reduced && <Hint icon="info">Dein System wünscht weniger Bewegung – Szenen und Buddy stehen still.</Hint>}
                </Actions>
              </FormRow>
              <FormRow label="Pixelgröße" hint="Größe der Pixel in Szenen, Ecken und Symbolen">
                <Segmented<PxSize> size="s" label="Pixelgröße" value={s.pxSize} onChange={(pxSize) => s.set({ pxSize })} items={PX_SIZES} />
              </FormRow>
            </>
          )}

          {tab === "erweitert" && (
            <>
              <FormRow
                label="Microsoft-Client-ID"
                hint="Optional"
                htmlFor="ms-client-id"
                aside="Nur für eigene, von Microsoft für Minecraft freigeschaltete Apps (Azure-Client-ID). Leer lassen, dann nutzt Pumpkin Launcher seine eingebaute Kennung."
              >
                <TextField id="ms-client-id" value={s.msClientId} onChange={(e) => s.set({ msClientId: e.target.value })} placeholder="Eingebaute Kennung verwenden" />
              </FormRow>
              <FormRow label="Zurücksetzen" hint="Einstellungen für Java und Arbeitsspeicher">
                <Actions>
                  <Button
                    icon="redo"
                    onClick={() => {
                      s.reset();
                      toast.success("Java und Arbeitsspeicher stehen wieder auf Standard");
                    }}
                  >
                    Auf Standard zurücksetzen
                  </Button>
                </Actions>
              </FormRow>
            </>
          )}

          {tab === "support" && <SupportSection />}

          {tab === "ueber" && (
            <>
              <div className="brand-about">
                <Buddy mood="hello" size={96} />
                <div>
                  <BrandWordmark />
                  <div className="text-fg-2">
                    Version <Count value={version} /> · Minecraft-Launcher für Windows
                  </div>
                </div>
              </div>
              <UpdateRow />
              <Hint className="mt-3.5">Inhalte und Modpacks kommen von Modrinth, CurseForge, FTB und Technic. Minecraft ist eine Marke von Mojang.</Hint>
            </>
          )}
        </FormSection>
      </TabPanel>
    </section>
  );
}
