import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Blocks, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, LoaderBadge } from "@/components/common";
import { LogConsole, PlayControl, StatusBadge } from "@/components/game";
import { instanceKeys, useDeleteInstance, useInstance, useUpdateInstance, useUpdateMods } from "@/hooks/useInstances";
import { formatDate, formatMemory, relativeTime } from "@/lib/format";
import { SOURCE_LABELS, type Instance, type Mod } from "@/lib/types";
import { useSettings } from "@/store/settings";

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "mt-1 font-mono text-lg" : "mt-1 text-lg font-medium"}>{value}</p>
    </div>
  );
}

function OverviewTab({ instance }: { instance: Instance }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Minecraft" value={instance.minecraftVersion} mono />
        <Stat label="Loader-Version" value={instance.loaderVersion ?? "–"} mono />
        <Stat label="Mods" value={`${instance.mods.filter((m) => m.enabled).length} / ${instance.mods.length} aktiv`} />
        <Stat label="Arbeitsspeicher" value={formatMemory(instance.memoryMb)} />
      </div>
      <Card className="bg-card/60">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[160px_1fr] gap-y-3 text-sm">
            <dt className="text-muted-foreground">Erstellt</dt>
            <dd>{formatDate(instance.createdAt)}</dd>
            <dt className="text-muted-foreground">Zuletzt gespielt</dt>
            <dd>{relativeTime(instance.lastPlayedAt)}</dd>
            <dt className="text-muted-foreground">JVM-Argumente</dt>
            <dd className="font-mono text-xs break-all">{instance.jvmArgs.join(" ") || "–"}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function ModsTab({ instance }: { instance: Instance }) {
  const qc = useQueryClient();
  const update = useUpdateMods(instance.id);

  function remove(mod: Mod) {
    const index = instance.mods.findIndex((m) => m.id === mod.id);
    update.mutate({ ...instance, mods: instance.mods.filter((m) => m.id !== mod.id) });
    toast(`${mod.name} entfernt`, {
      duration: 6000,
      action: {
        label: "Rückgängig",
        onClick: () => {
          // Aktuellen Stand nehmen: in den 6 s können weitere Änderungen passiert sein.
          const current = qc.getQueryData<Instance>(instanceKeys.detail(instance.id));
          if (!current || current.mods.some((m) => m.id === mod.id)) return;
          const mods = [...current.mods];
          mods.splice(index, 0, mod);
          update.mutate({ ...current, mods });
        },
      },
    });
  }

  if (instance.mods.length === 0) {
    return (
      <EmptyState icon={<Blocks className="size-5" />} title="Keine Mods installiert">
        Durchsuche den{" "}
        <Link to="/mods" className="text-primary underline-offset-4 hover:underline">
          Mod-Browser
        </Link>
        .
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card/60">
      {instance.mods.map((mod) => (
        <li key={mod.id} className="flex items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{mod.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{mod.fileName}</p>
          </div>
          <Badge variant="secondary">{SOURCE_LABELS[mod.source.type]}</Badge>
          <span className="w-20 text-right font-mono text-xs text-muted-foreground">{mod.version}</span>
          <Switch
            checked={mod.enabled}
            aria-label={`${mod.name} ${mod.enabled ? "deaktivieren" : "aktivieren"}`}
            onCheckedChange={(enabled) =>
              update.mutate({
                ...instance,
                mods: instance.mods.map((m) => (m.id === mod.id ? { ...m, enabled } : m)),
              })
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${mod.name} entfernen`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => remove(mod)}
          >
            <Trash2 aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SettingsTab({ instance }: { instance: Instance }) {
  const defaultMemory = useSettings((s) => s.memoryMb);
  const [name, setName] = useState(instance.name);
  const [customMemory, setCustomMemory] = useState(instance.memoryMb != null);
  const [memory, setMemory] = useState(instance.memoryMb ?? defaultMemory);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs.join(" "));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateInstance();
  const del = useDeleteInstance();
  const navigate = useNavigate();

  function save() {
    update.mutate({
      ...instance,
      name: name.trim() || instance.name,
      memoryMb: customMemory ? memory : null,
      jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
    });
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card/60">
        <CardHeader>
          <CardTitle>Allgemein</CardTitle>
          <CardDescription>Einstellungen gelten nur für diese Instanz.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="inst-edit-name">Name</Label>
            <Input id="inst-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="inst-custom-mem">Eigener Arbeitsspeicher</Label>
              <Switch id="inst-custom-mem" checked={customMemory} onCheckedChange={setCustomMemory} />
            </div>
            <div className="flex items-center gap-4">
              <Slider
                aria-label="Arbeitsspeicher in MB"
                min={1024}
                max={16384}
                step={512}
                value={[customMemory ? memory : defaultMemory]}
                onValueChange={([v]) => setMemory(v)}
                disabled={!customMemory}
              />
              <span className="w-20 text-right font-mono text-sm">
                {formatMemory(customMemory ? memory : defaultMemory)}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-jvm">JVM-Argumente</Label>
            <Textarea
              id="inst-jvm"
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              className="font-mono text-xs"
              placeholder="-XX:+UseG1GC"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={update.isPending}>
              {update.isSuccess && !update.isPending ? <Check aria-hidden /> : null}
              {update.isPending ? "Speichert…" : "Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30 bg-destructive/5 ring-destructive/20">
        <CardHeader>
          <CardTitle>Instanz löschen</CardTitle>
          <CardDescription>Entfernt die Instanz inklusive Mods und Welten.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Löschen
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`„${instance.name}" löschen?`}
        description="Das lässt sich nicht rückgängig machen."
        pending={del.isPending}
        onConfirm={() => del.mutate(instance.id, { onSuccess: () => navigate("/instances") })}
      />
    </div>
  );
}

export function InstanceDetailPage() {
  const { id } = useParams();
  const { data: instance, isLoading, error } = useInstance(id);
  // Tab in der URL, damit z. B. der Absturz-Toast direkt die Konsole öffnen kann.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const setTab = (value: string) => setParams({ tab: value }, { replace: true });

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2 text-muted-foreground">
        <Link to="/instances">
          <ArrowLeft aria-hidden /> Instanzen
        </Link>
      </Button>

      {isLoading && (
        <div className="mb-8 flex items-center gap-5">
          <Skeleton className="size-20 rounded-xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-5 w-40" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
      )}
      {error && <ErrorNote error={error} />}

      {instance && (
        <>
          <header className="mb-8 flex flex-wrap items-center gap-5">
            <BlockTile seed={instance.id} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-3xl font-semibold">{instance.name}</h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                <StatusBadge instanceId={instance.id} />
                <LoaderBadge loader={instance.loader} />
                <span className="font-mono">{instance.minecraftVersion}</span>
              </div>
            </div>
            <PlayControl instance={instance} onLaunched={() => setTab("console")} />
          </header>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="overview">Übersicht</TabsTrigger>
              <TabsTrigger value="mods">Mods ({instance.mods.length})</TabsTrigger>
              <TabsTrigger value="console">Konsole</TabsTrigger>
              <TabsTrigger value="settings">Einstellungen</TabsTrigger>
            </TabsList>
            <TabsContent value="console">
              <LogConsole instanceId={instance.id} />
            </TabsContent>
            <TabsContent value="overview">
              <OverviewTab instance={instance} />
            </TabsContent>
            <TabsContent value="mods">
              <ModsTab instance={instance} />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsTab key={`${instance.presetId}-${instance.memoryMb}-${instance.jvmArgs.join()}`} instance={instance} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
