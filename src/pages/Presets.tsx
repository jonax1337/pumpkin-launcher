import { useState, type FormEvent } from "react";
import { Cpu, Layers, Plus, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { useCreatePreset, useDeletePreset, usePresets } from "@/hooks/usePresets";
import { MOCK_MODS } from "@/lib/mock";
import { formatMemory } from "@/lib/format";
import type { Preset } from "@/lib/types";

/** "key=value" pro Zeile → Record */
function parseSettings(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.split("="))
      .filter(([k, v]) => k?.trim() && v !== undefined)
      .map(([k, ...rest]) => [k.trim(), rest.join("=").trim()]),
  );
}

function CreatePresetDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modIds, setModIds] = useState<string[]>([]);
  const [jvmArgs, setJvmArgs] = useState("");
  const [withMemory, setWithMemory] = useState(false);
  const [memory, setMemory] = useState(4096);
  const [settings, setSettings] = useState("");
  const [parentId, setParentId] = useState("none");
  const { data: presets } = usePresets();
  const create = useCreatePreset();

  function reset() {
    setName("");
    setDescription("");
    setModIds([]);
    setJvmArgs("");
    setWithMemory(false);
    setSettings("");
    setParentId("none");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        inheritsFrom: parentId === "none" ? null : parentId,
        excludeMods: [],
        mods: MOCK_MODS.filter((m) => modIds.includes(m.id)),
        jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
        memoryMb: withMemory ? memory : null,
        gameSettings: parseSettings(settings),
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Neues Preset
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Neues Preset</DialogTitle>
            <DialogDescription>Mods, Einstellungen, JVM-Argumente und RAM als Vorlage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="preset-name">Name</Label>
            <Input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preset-desc">Beschreibung</Label>
            <Input id="preset-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preset-parent">Erbt von</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="preset-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Kein Basis-Preset</SelectItem>
                {presets?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Übernimmt Mods, Einstellungen, JVM-Args und RAM; eigene Angaben haben Vorrang.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Mods</legend>
            <div className="flex flex-wrap gap-2">
              {MOCK_MODS.map((m) => {
                const selected = modIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setModIds((ids) => (selected ? ids.filter((i) => i !== m.id) : [...ids, m.id]))}
                    className={
                      "rounded-full border px-3 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (selected
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground")
                    }
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="preset-mem">Arbeitsspeicher festlegen</Label>
              <Switch id="preset-mem" checked={withMemory} onCheckedChange={setWithMemory} />
            </div>
            {withMemory && (
              <div className="flex items-center gap-4">
                <Slider
                  aria-label="Arbeitsspeicher in MB"
                  min={1024}
                  max={16384}
                  step={512}
                  value={[memory]}
                  onValueChange={([v]) => setMemory(v)}
                />
                <span className="w-16 text-right font-mono text-sm">{formatMemory(memory)}</span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="preset-jvm">JVM-Argumente</Label>
            <Input id="preset-jvm" value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} className="font-mono text-xs" placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="preset-settings">Spieleinstellungen</Label>
            <Textarea id="preset-settings" value={settings} onChange={(e) => setSettings(e.target.value)} className="font-mono text-xs" placeholder={"renderDistance=12\nmaxFps=144"} />
            <p className="text-xs text-muted-foreground">Eine Einstellung pro Zeile als schlüssel=wert.</p>
          </div>
          {create.error && <ErrorNote error={create.error} />}
          <DialogFooter className="sticky -bottom-4 bg-popover">
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Speichert…" : "Preset anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PresetsPage() {
  const { data: presets, isLoading, error } = usePresets();
  const del = useDeletePreset();
  const [toDelete, setToDelete] = useState<Preset | null>(null);

  return (
    <>
      <PageHeader
        title="Presets"
        description="Wiederverwendbare Setups – auf jede Instanz anwendbar."
        actions={<CreatePresetDialog />}
      />
      {error && <ErrorNote error={error} />}
      {isLoading && <div className="h-40 animate-pulse rounded-xl bg-card/60" />}
      {presets?.length === 0 && (
        <EmptyState icon={<Layers className="size-5" />} title="Noch keine Presets">
          Lege ein Preset an und wende es in der Instanz-Ansicht an.
        </EmptyState>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {presets?.map((p) => (
          <Card key={p.id} className="bg-card/60">
            <CardHeader>
              <CardTitle className="font-heading text-base">{p.name}</CardTitle>
              <CardDescription>{p.description || "Keine Beschreibung"}</CardDescription>
              {p.inheritsFrom && (
                <p className="text-xs text-muted-foreground">
                  Erbt von {presets?.find((x) => x.id === p.inheritsFrom)?.name ?? "unbekanntem Preset"}
                </p>
              )}
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Preset ${p.name} löschen`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setToDelete(p)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {p.mods.length === 0 && <span className="text-muted-foreground">Keine Mods</span>}
                {p.mods.map((m) => (
                  <Badge key={m.id} variant="secondary">
                    {m.name}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Cpu className="size-3.5" aria-hidden /> {formatMemory(p.memoryMb)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Terminal className="size-3.5" aria-hidden /> {p.jvmArgs.length} JVM-Args
                </span>
                <span>{Object.keys(p.gameSettings).length} Einstellungen</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o) {
            setToDelete(null);
            del.reset();
          }
        }}
        title={`Preset „${toDelete?.name}" löschen?`}
        description="Instanzen behalten ihre Mods und Einstellungen."
        pending={del.isPending}
        error={del.error}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}
      />
    </>
  );
}
