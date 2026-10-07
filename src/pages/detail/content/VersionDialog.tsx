import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, Chip, Dialog, ErrorBox, Hint, List, ListRow, RowTitle, Skel } from "@/ui";
import { fitFilter, fitsLabel } from "@/components/catalog/fit";
import { versionLoaders, versionTypeSuffix } from "@/components/catalog/labels";
import { catalogApi } from "@/lib/catalogApi";
import type { ContentVersion } from "@/lib/content-types";
import { formatDate } from "@/lib/format";
import { projectOf } from "@/lib/mods";
import type { Instance, Mod } from "@/lib/types";
import { ChangelogDisclosure } from "./Changelog";

/** So viele Versionen zeigt die Auswahl (neueste zuerst); Projekte wie die Fabric API haben über tausend. */
const SHOWN_VERSIONS = 100;

/** „Loader · Minecraft 1.21.4 · 3. Okt. 2026 · Vorabversion“, soweit bekannt. */
function versionSub(version: ContentVersion) {
  const published = version.date_published ? formatDate(Date.parse(version.date_published)) : "";
  const parts = [versionLoaders(version), version.game_versions.at(-1), published].filter(Boolean);
  return `${parts.join(" · ")}${versionTypeSuffix(version)}`;
}

/** Eine Version der Auswahl: Name, Stand, Knopf „Wechseln“ (bei der installierten ein Chip) und das Änderungsprotokoll auf Wunsch. */
function VersionItem({ instance, mod, version, current, locked, onPick }: {
  instance: Instance; mod: Mod; version: ContentVersion; current: boolean; locked: boolean; onPick: () => void;
}) {
  const { t } = useI18n();
  return (
    <ListRow>
      <RowTitle title={version.version_number} sub={versionSub(version)} />
      {current ? (
        <Chip size="s" tone="acc">{t("detail.content.versionCurrent")}</Chip>
      ) : (
        <Button size="s" disabled={locked} aria-label={t("detail.content.versionSwitchAria", { name: mod.name, version: version.version_number })} onClick={onPick}>
          {t("detail.content.versionSwitch")}
        </Button>
      )}
      <div className="col-span-full">
        <ChangelogDisclosure instance={instance} mod={mod} versionId={version.id} />
      </div>
    </ListRow>
  );
}

/** Version eines Modrinth-Inhalts wählen, neuer oder älter, die zu Minecraft-Version und Loader der Instanz passt. */
export function VersionDialog({ instance, mod, title, locked, onPick, onClose }: {
  instance: Instance; mod: Mod; title: string; locked: boolean; onPick: (version: ContentVersion) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const projectId = projectOf(mod) ?? "";
  const versions = useQuery(catalogApi("modrinth").versionsQuery(projectId, fitFilter(instance, mod.kind)));
  const currentId = mod.source.type === "modrinth" ? mod.source.versionId : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      width={620}
      height={560}
      title={t("detail.content.versionTitle", { name: title })}
      sub={t("detail.content.versionSub", { fits: fitsLabel(instance, mod.kind) })}
    >
      {versions.isPending && <Skel h={120} />}
      {versions.isError && <ErrorBox title={t("detail.content.versionLoadError")} error={versions.error} onRetry={() => void versions.refetch()} />}
      {versions.data && !versions.data.length && <p>{t("detail.content.versionNone")}</p>}
      {versions.data && versions.data.length > 0 && (
        <List variant="versions" aria-label={t("detail.content.versionTitle", { name: title })}>
          {versions.data.slice(0, SHOWN_VERSIONS).map((version) => (
            <VersionItem
              key={version.id}
              instance={instance}
              mod={mod}
              version={version}
              current={version.id === currentId}
              locked={locked}
              onPick={() => onPick(version)}
            />
          ))}
        </List>
      )}
      {versions.data && versions.data.length > SHOWN_VERSIONS && (
        <Hint icon="info" className="mt-2">{t("detail.content.versionsCapped", { n: SHOWN_VERSIONS })}</Hint>
      )}
    </Dialog>
  );
}
