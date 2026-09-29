import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common";
import { api } from "@/lib/api";
import { isAbsoluteMrpack, modCompatibility, progressLabel } from "@/lib/modrinth";
import { useInstances } from "@/hooks/useInstances";
import { useContentInstall, useContentState } from "@/hooks/useContent";
import type { Instance } from "@/lib/types";

export function ContentCatalog({ type }: { type: "mod" | "modpack" }) {
  const [query, setQuery] = useState("");
  const [mc, setMc] = useState("");
  const [loader, setLoader] = useState("all");
  const [search, setSearch] = useState({ query: "", mc: "", loader: "all" });
  const [projectId, setProjectId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [name, setName] = useState("");
  const [localName, setLocalName] = useState("");
  const [path, setPath] = useState("");
  const instances = useInstances();
  const operation = useContentState();
  const install = useContentInstall();
  const navigate = useNavigate();
  // Nach einem Pack-Import direkt zur neuen Instanz: dort installiert „Spielen“ bei Bedarf selbst.
  const openInstance = { onSuccess: (inst: Instance | null) => inst && navigate(`/instances/${inst.id}`) };
  const results = useQuery({
    queryKey: ["modrinth-search", type, search],
    queryFn: () => api.modrinthSearch(search.query, type, search.mc || null, search.loader === "all" ? null : search.loader),
    enabled: !api.isMock, retry: false,
  });
  const project = useQuery({
    queryKey: ["modrinth-project", projectId], queryFn: () => api.modrinthProject(projectId),
    enabled: !!projectId && !api.isMock, retry: false,
  });
  const versions = useQuery({
    queryKey: ["modrinth-versions", projectId, search.mc, search.loader],
    queryFn: () => api.modrinthVersions(projectId, search.mc || null, search.loader === "all" ? null : search.loader),
    enabled: !!projectId && !api.isMock, retry: false,
  });
  const version = versions.data?.find((v) => v.id === versionId);
  const instance = instances.data?.find((i) => i.id === instanceId);
  const reason = project.isPending ? "Projektdetails laden noch." : project.error ? "Projektdetails konnten nicht geladen werden."
    : project.data.project_type !== type ? "Projektdetails müssen zum Inhaltstyp passen."
    : type === "mod" && project.data.client_side === "unsupported" ? "Dieser Mod unterstützt keine Clients und kann nicht in eine Launcher-Instanz installiert werden."
    : !version || version.project_id !== projectId ? "Wähle eine Version."
    : type === "mod" ? modCompatibility(instance, version)
    : !version.loaders.some((l) => l === "fabric" || l === "minecraft" || l === "vanilla") ? "Dieser Pack-Loader wird noch nicht unterstützt."
    : !name.trim() ? "Gib der neuen Instanz einen Namen." : null;
  const busy = !!operation.active;

  return <>
    <PageHeader title={type === "mod" ? "Mods" : "Modpacks"} description="Modrinth durchsuchen, Version auswählen und installieren." />
    {api.isMock && <p role="status" className="mb-5 rounded-xl border border-gold/25 bg-gold/5 p-4 text-sm text-gold">Modrinth benötigt die Tauri-App. Im Browser gibt es für diese Funktionen keine Demo-Ergebnisse und keine Installation.</p>}
    <form className="mb-6 grid gap-3" onSubmit={(e) => { e.preventDefault(); setProjectId(""); setVersionId(""); if (search.query === query.trim() && search.mc === mc.trim() && search.loader === loader) void results.refetch(); else setSearch({ query: query.trim(), mc: mc.trim(), loader }); }}>
      <div className="flex gap-2"><Input aria-label="Modrinth durchsuchen" placeholder="Modrinth durchsuchen…" value={query} onChange={(e) => setQuery(e.target.value)} /><Button disabled={api.isMock} type="submit">Suchen</Button></div>
      <div className="flex flex-wrap gap-3">
        <Input className="w-48" aria-label="Minecraft-Version filtern" placeholder="Minecraft, z. B. 1.21.1" value={mc} onChange={(e) => setMc(e.target.value)} />
        <Select value={loader} onValueChange={setLoader}><SelectTrigger aria-label="Loader filtern" className="w-52"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">Alle Loader</SelectItem><SelectItem value="fabric">Fabric</SelectItem><SelectItem value="vanilla">Vanilla (keine Mods)</SelectItem><SelectItem value="quilt">Quilt (nicht unterstützt)</SelectItem><SelectItem value="forge">Forge (nicht unterstützt)</SelectItem><SelectItem value="neoforge">NeoForge (nicht unterstützt)</SelectItem>
        </SelectContent></Select>
      </div>
    </form>
    {!api.isMock && results.isPending && <p role="status">Suche läuft…</p>}
    {results.error && <div role="alert" className="mb-4 text-sm text-destructive">{results.error.message} <Button variant="outline" onClick={() => void results.refetch()}>Erneut versuchen</Button></div>}
    {results.data && <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{results.data.total_hits} Treffer · erste {results.data.hits.length} angezeigt. Suche eingrenzen für weitere Treffer.</p>}
    <ul className="grid gap-3 md:grid-cols-2">
      {results.data?.hits.map((hit) => <li key={hit.project_id} className="rounded-xl border bg-card/60 p-4">
        <h2 className="font-medium">{hit.title}</h2><p className="mt-1 text-sm text-muted-foreground">{hit.description}</p>
        <p className="my-3 text-xs text-muted-foreground">{hit.author} · {hit.downloads.toLocaleString("de-DE")} Downloads · {hit.project_type}</p>
        <Button variant="outline" aria-pressed={projectId === hit.project_id} onClick={() => { setProjectId(hit.project_id); setVersionId(""); setName(hit.title); }}>Details und Versionen</Button>
      </li>)}
    </ul>
    {projectId && <section className="mt-6 space-y-4 rounded-xl border bg-card/60 p-5" aria-label="Projektdetails">
      {project.isPending && <p role="status">Details laden…</p>}
      {project.error && <p role="alert">{project.error.message} <Button variant="outline" onClick={() => void project.refetch()}>Details erneut laden</Button></p>}
      {project.data && <><h2 className="font-heading text-xl">{project.data.title}</h2><p>{project.data.description}</p><p className="text-xs text-muted-foreground">Client: {project.data.client_side} · Server: {project.data.server_side}</p><details><summary className="cursor-pointer text-sm">Projektbeschreibung (Originaltext)</summary><div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">{project.data.body}</div></details></>}
      {versions.isPending && <p role="status">Versionen laden…</p>}
      {versions.error && <p role="alert">{versions.error.message} <Button variant="outline" onClick={() => void versions.refetch()}>Versionen erneut laden</Button></p>}
      {versions.data?.length === 0 && <p>Keine Versionen für diese Filter. Ändere die Suche.</p>}
      <Select value={versionId} onValueChange={setVersionId}><SelectTrigger aria-label="Version auswählen" className="w-full"><SelectValue placeholder="Version auswählen" /></SelectTrigger><SelectContent>{versions.data?.map((v) => <SelectItem key={v.id} value={v.id}>{v.name} · {v.version_number} · {v.loaders.join(", ")} · MC {v.game_versions.join(", ")}</SelectItem>)}</SelectContent></Select>
      {type === "mod" ? <>
        <Select value={instanceId} onValueChange={setInstanceId}><SelectTrigger aria-label="Zielinstanz" className="w-full"><SelectValue placeholder="Zielinstanz auswählen" /></SelectTrigger><SelectContent>{instances.data?.map((i) => <SelectItem key={i.id} value={i.id} disabled={i.loader !== "fabric"}>{i.name} · {i.minecraftVersion} · {i.loader}{i.loader !== "fabric" ? " – nicht unterstützt" : ""}</SelectItem>)}</SelectContent></Select>
        {instances.error && <p role="alert">{instances.error.message} <Button onClick={() => void instances.refetch()}>Instanzen erneut laden</Button></p>}
        <p className="text-xs text-muted-foreground">Nur Fabric mit passender Minecraft-Version. Erforderliche Dependencies werden vom Backend mitinstalliert; Konflikte werden nicht überschrieben.</p>
      </> : <><Label htmlFor="pack-name">Name der neuen Instanz</Label><Input id="pack-name" value={name} onChange={(e) => setName(e.target.value)} /></>}
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      <Button disabled={api.isMock || busy || !!reason} onClick={() => { if (!version || reason) return; if (type === "mod") install.mutate((id) => api.modrinthInstallMod(instanceId, version.id, id)); else install.mutate((id) => api.modrinthInstallPack(version.id, name.trim(), id), openInstance); }}> {type === "mod" ? "Mod + Dependencies installieren" : "Neue Instanz aus Pack erstellen"}</Button>
    </section>}
    {type === "modpack" && <section className="mt-6 space-y-3 rounded-xl border bg-card/60 p-5" aria-label="Lokaler Packimport">
      <h2 className="font-heading text-lg">Lokale .mrpack importieren</h2>
      <Label htmlFor="mrpack-path">Absoluter Dateipfad</Label><Input id="mrpack-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\\Downloads\\pack.mrpack" />
      <Label htmlFor="local-pack-name">Name der neuen Instanz</Label><Input id="local-pack-name" value={localName} onChange={(e) => setLocalName(e.target.value)} />
      <p className="text-xs text-muted-foreground">Nur unterstützte Vanilla-/Fabric-Packs. Das Backend prüft Archiv, Loader und Downloads.</p>
      <Button disabled={api.isMock || busy || !localName.trim() || !isAbsoluteMrpack(path.trim())} onClick={() => install.mutate((id) => api.modrinthImportPack(path.trim(), localName.trim(), id), openInstance)}>Pack importieren</Button>
    </section>}
    <div className="mt-5 space-y-3" aria-live="polite">
      {busy && <p role="status">Wird installiert: {progressLabel(operation.progress)}</p>}
      {!busy && operation.result && <p>Inhalte für <Link className="underline" to={`/instances/${operation.result.id}`}>{operation.result.name}</Link> gespeichert.</p>}
    </div>
  </>;
}
