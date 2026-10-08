import { useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, Disclosure, Hint, Skel } from "@/ui";
import { Description } from "@/components/Description";
import { fitFilter } from "@/components/catalog/fit";
import { catalogApi } from "@/lib/catalogApi";
import { openPage } from "@/lib/links";
import { projectOf } from "@/lib/mods";
import type { Instance, Mod } from "@/lib/types";

/** Die Seite einer Version bei Modrinth. */
const versionPage = (projectId: string, versionId: string) => `https://modrinth.com/project/${projectId}/version/${versionId}`;

/** Änderungsprotokoll der Modrinth-Version `versionId` des Inhalts; ohne Protokoll der Weg zur Seite der Version. */
export function Changelog({ instance, mod, versionId }: { instance: Instance; mod: Mod; versionId: string }) {
  const { t } = useI18n();
  const projectId = projectOf(mod);
  const versions = useQuery({ ...catalogApi("modrinth").versionsQuery(projectId ?? "", fitFilter(instance, mod.kind)), enabled: !!projectId });
  const changelog = versions.data?.find((v) => v.id === versionId)?.changelog?.trim();

  if (versions.isPending) return <Skel h={48} />;
  if (changelog) return <Description body={changelog} className="dc-changelog" />;
  return (
    <div className="dc-changelog-miss">
      <Hint icon="info">{versions.isError ? t("detail.content.changesLoadError") : t("detail.content.changesNone")}</Hint>
      {projectId && (
        <Button variant="ghost" size="s" icon="external" onClick={() => openPage(versionPage(projectId, versionId))}>
          {t("detail.content.viewVersionOnModrinth")}
        </Button>
      )}
    </div>
  );
}

export function ChangelogDisclosure(props: ComponentProps<typeof Changelog>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Disclosure summary={t("detail.content.changes")} open={open} onToggle={setOpen}>
      {open && <Changelog {...props} />}
    </Disclosure>
  );
}
