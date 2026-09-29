import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MemorySlider, PageHeader } from "@/components/common";
import { AccountsSection } from "@/components/PlayerNames";
import { useMemory } from "@/hooks/useInstances";
import { formatMemory } from "@/lib/format";
import { useSettings } from "@/store/settings";

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-xl border bg-card p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const memory = useMemory();

  return (
    <div className="max-w-3xl">
      <PageHeader title="Einstellungen" description="Gilt für alle Instanzen, solange eine Instanz nichts Eigenes festlegt." />
      <div className="space-y-10">
        <AccountsSection />

        <Section id="leistung-title" title="Arbeitsspeicher" description="Wie viel Arbeitsspeicher Minecraft bekommt.">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="memory-auto">Automatisch (empfohlen)</Label>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {memory.total == null
                    ? `${formatMemory(memory.auto)} für jede Instanz.`
                    : `${formatMemory(memory.auto)}: die Hälfte deiner ${formatMemory(memory.total)}, höchstens 8 GB.`}
                </p>
              </div>
              <Switch
                id="memory-auto"
                checked={memory.isAuto}
                onCheckedChange={(auto) => s.set({ memoryMb: auto ? null : memory.value })}
              />
            </div>
            {!memory.isAuto && <MemorySlider id="memory" value={memory.value} onChange={(v) => s.set({ memoryMb: v })} />}
          </div>
        </Section>

        <details className="group space-y-4">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-base font-semibold outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-90" aria-hidden /> Erweitert
          </summary>
          <div className="mt-4 divide-y rounded-xl border bg-card">
            <div className="space-y-2 p-4 sm:p-5">
              <Label htmlFor="java-path">
                Eigenes Java <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="java-path" value={s.javaPath} onChange={(e) => s.set({ javaPath: e.target.value })} placeholder="C:\Program Files\Java\jdk-21\bin\javaw.exe" />
              <p className="text-xs text-muted-foreground">Leer lassen: Voxlet lädt das passende Java selbst.</p>
            </div>
            <div className="space-y-2 p-4 sm:p-5">
              <Label htmlFor="ms-client-id">
                Microsoft-Client-ID <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="ms-client-id"
                value={s.msClientId}
                onChange={(e) => s.set({ msClientId: e.target.value })}
                placeholder="Eingebaute Kennung verwenden"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="ms-client-id-hint"
              />
              <p id="ms-client-id-hint" className="text-xs text-muted-foreground">
                Für die Microsoft-Anmeldung wird eine eigene App-Kennung benötigt. Leer lassen, dann nutzt Voxlet die eingebaute. Wie du eine
                eigene bekommst, steht in der Anleitung „ACCOUNT-SETUP“ im Ordner docs.
              </p>
            </div>
          </div>
        </details>
        <p className="text-xs text-muted-foreground">
          <button type="button" onClick={s.reset} className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Java und Arbeitsspeicher auf Standard zurücksetzen
          </button>
        </p>
      </div>
    </div>
  );
}
