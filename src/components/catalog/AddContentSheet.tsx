import { useState } from "react";
import { useI18n } from "@/i18n";
import { Hint, SearchField, Select, Sheet, Switch, TabPanel, Tabs } from "@/ui";
import { SOURCES, type CatalogType, type ContentHit, type Source } from "@/lib/content-types";
import { LOADER_LABELS, type Instance, type World } from "@/lib/types";
import { useLook } from "@/store/look";
import { ContentDetail } from "./ContentDetail";
import { CompactContentResults } from "./ContentResults";
import { fitsLabel, kindsFor } from "./fit";
import { hasIris, irisSupported } from "./iris";
import { typeLabel } from "./labels";

const SOURCE_OPTIONS = (["modrinth", "curseforge"] as const).map((source) => ({ value: source, label: SOURCES[source].label }));

/** Was Shadern in der Instanz fehlt: Iris, oder die Unterstützung ganz (Forge, NeoForge); nichts, wenn Iris da ist. */
function ShaderHint({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  if (!irisSupported(instance))
    return <Hint tone="warn" className="mb-2">{t("components.sheet.shadersUnsupported", { loader: LOADER_LABELS[instance.loader] })}</Hint>;
  return hasIris(instance) ? null : <Hint tone="warn" className="mb-2">{t("components.sheet.shaderNeedsIris")}</Hint>;
}

/** Katalog im Seitenpanel einer Instanz; mit `world` nur Datenpakete für diese Welt. */
export function AddContentSheet({ instance, world, open, onOpenChange }: {
  instance: Instance; world?: World; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  // Datenpakete gibt es hier nur von Modrinth.
  const kinds: CatalogType[] = world ? ["datapack"] : kindsFor(instance);
  const [type, setType] = useState<CatalogType>(kinds[0]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hit, setHit] = useState<ContentHit | null>(null);
  const [query, setQuery] = useState("");
  const [fit, setFit] = useState(true);
  // Modrinth oder CurseForge; der Shader-Hinweis zu Iris gilt für beide.
  const [source, setSource] = useState<Source>("modrinth");
  const { acc } = useLook(instance.id);
  const kind = kinds.includes(type) ? type : kinds[0];
  const tabbed = kinds.length > 1;

  const results = (
    <>
      {kind === "shader" && <ShaderHint instance={instance} />}
      <CompactContentResults
        key={`${source}-${kind}`}
        source={source}
        type={kind}
        instance={instance}
        world={world}
        query={query}
        fit={fit}
        onReset={() => setQuery("")}
        onOpen={(id, h) => {
          setHit(h);
          setProjectId(id);
        }}
      />
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      acc={acc}
      title={world ? t("components.sheet.datapacksForWorld", { world: world.name }) : t("components.sheet.contentForInstance", { name: instance.name })}
      sub={t("components.sheet.autoVersion", { fits: fitsLabel(instance, world ? "datapack" : "mod") })}
      tools={
        projectId ? undefined : (
          <>
            {tabbed && (
              <Tabs variant="segment" size="s" idBase="sheet-art" label={t("components.sheet.kindLabel")} value={kind} onChange={setType} items={kinds.map((k) => ({ value: k, label: typeLabel(k) }))} />
            )}
            {!world && <Select size="s" label={t("components.sheet.sourceLabel")} value={source} onChange={(next) => setSource(next as Source)} options={SOURCE_OPTIONS} />}
            <SearchField size="s" value={query} onChange={setQuery} placeholder={t("components.sheet.searchPlaceholder")} autoFocus />
            <Switch checked={fit} onChange={setFit} label={t("components.sheet.onlyFitting", { fits: fitsLabel(instance, kind) })} visibleLabel />
          </>
        )
      }
    >
      {projectId && (
        <ContentDetail projectId={projectId} type={kind} source={source} instance={instance} world={world} hit={hit} backLabel={typeLabel(kind)} onBack={() => setProjectId(null)} />
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      {tabbed ? (
        <TabPanel idBase="sheet-art" value={kind} hidden={!!projectId}>{results}</TabPanel>
      ) : (
        <div hidden={!!projectId}>{results}</div>
      )}
    </Sheet>
  );
}
