import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, Chip, DescriptionList, Dialog, DialogActions, Field, Hint, IconButton, Input, JobProgress, Menu, Skel } from "@/ui";
import { ErrorBox } from "@/components/ErrorBox";
import { useInstallPack } from "@/hooks/usePackInstall";
import { catalogApi } from "@/lib/catalogApi";
import type { ContentVersion, ProjectRef, Source } from "@/lib/content-types";
import { isPackVersionSupported, pickPackVersion } from "@/lib/mods";
import { JOB } from "./jobProgress";
import { versionLoadersOrVanilla, versionTypeSuffix } from "./labels";

/** So viele weitere Versionen bietet „Andere Version“ an. */
const MAX_OTHER_VERSIONS = 30;

/** Die Pack-Version, die Pumpkin Launcher wählt, oder der Grund, warum keine passt. */
type PickedPack = { version: ContentVersion | null; reason: string | null };

/** Inhalt der Bestätigung; wird beim Schließen verworfen, der Name beginnt also immer beim Pack-Titel. */
function PackConfirmBody({ title, source, versions, picked, onConfirm }: {
  title: string; source: Source; versions: UseQueryResult<ContentVersion[]>; picked: PickedPack | null; onConfirm: (versionId: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(title);
  const v = picked?.version ?? null;
  // Platzhalter rechtsbündig in der Wertspalte (Zeile bleibt 19 px hoch)
  const val = (text: ReactNode) => (v ? text : versions.isPending ? <Skel className="mt-1 ml-auto h-3 w-[90px]" /> : "–");
  const submit = () => v && onConfirm(v.id, name.trim() || title);
  return (
    <form
      id="pack-confirm"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label={t("components.instance.nameField")}>
        <Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </Field>
      <DescriptionList
        size="s"
        end
        className="mt-1 mb-4"
        items={[
          { label: t("components.pack.versionLabel"), value: val(v?.version_number), valueClassName: "min-h-[19px] truncate" },
          { label: "Minecraft", value: val(v?.game_versions.at(-1)), valueClassName: "min-h-[19px]" },
          { label: t("components.common.loader"), value: val(v && versionLoadersOrVanilla(v)), valueClassName: "min-h-[19px]" },
        ]}
      />
      {versions.error ? (
        <ErrorBox className="mt-3" title={t("components.version.loadFailed")} error={versions.error} onRetry={() => void versions.refetch()} />
      ) : picked && !v ? (
        <Hint tone="bad" live>{picked.reason}</Hint>
      ) : (
        <Hint>{t("components.pack.confirmHint")}</Hint>
      )}
      {source === "technic" && <Hint icon="info" className="mt-2">{t("components.security.technicHosts")}</Hint>}
    </form>
  );
}

/**
 * Bestätigung vor „Als neue Instanz anlegen“: zeigt Version, Minecraft und Loader, die Pumpkin Launcher wählt,
 * und lässt den Namen ändern. `ask()` öffnet sie (optional für eine bestimmte Version), `dialog` gehört ins Markup.
 */
export function usePackConfirm(pack: ProjectRef, source: Source) {
  const { t } = useI18n();
  const install = useInstallPack({ pack, source });
  const [ask, setAsk] = useState<{ versionId?: string } | null>(null);
  const versions = useQuery({ ...catalogApi(source).versionsQuery(pack.id), enabled: !!ask });
  const picked: PickedPack | null = versions.data
    ? ask?.versionId
      ? { version: versions.data.find((v) => v.id === ask.versionId) ?? null, reason: t("components.version.gone") }
      : pickPackVersion(versions.data)
    : null;
  const dialog = (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && setAsk(null)}
      title={t("components.pack.newInstanceTitle")}
      sub={pack.title}
      size="s"
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: t("components.instance.createAction"), className: "w-[170px]", form: "pack-confirm", disabled: !picked?.version || install.blocked }} />}
    >
      <PackConfirmBody
        title={pack.title}
        source={source}
        versions={versions}
        picked={picked}
        onConfirm={(versionId, name) => {
          setAsk(null);
          void install.run({ versionId, name });
        }}
      />
    </Dialog>
  );
  return { install, ask: (versionId?: string) => setAsk({ versionId }), dialog };
}

/** Zeilenaktion für Modpacks: erst bestätigen, dann anlegen. */
export function PackInstallButton({ project, source }: { project: ProjectRef; source: Source }) {
  const { t } = useI18n();
  const { install, ask, dialog } = usePackConfirm(project, source);
  return (
    <>
      {install.busy ? (
        <JobProgress label={install.busy} p={install.p} {...JOB.row} onCancel={install.cancel} cancelLabel={t("components.pack.cancelInstallPack", { name: project.title })} />
      ) : install.queued ? (
        <Chip icon="clock">{t("components.pack.queuedChip")}</Chip>
      ) : (
        <Button size="s" icon="plus" disabled={install.blocked} aria-label={t("components.pack.createAria", { name: project.title })} onClick={() => ask()}>
          {t("components.newInstance.create")}
        </Button>
      )}
      {dialog}
    </>
  );
}

/** Aktion in den Pack-Details: „Als neue Instanz anlegen“, daneben im Menü „Andere Version“; beides mit Bestätigung. */
export function PackActions({ project, source }: { project: ProjectRef; source: Source }) {
  const { t } = useI18n();
  const { install, ask, dialog } = usePackConfirm(project, source);
  const versions = useQuery(catalogApi(source).versionsQuery(project.id));
  const { version, reason } = versions.data ? pickPackVersion(versions.data) : { version: null, reason: null };
  const fitting = versions.data?.filter(isPackVersionSupported) ?? [];

  if (install.busy) {
    return <JobProgress label={install.busy} p={install.p} {...JOB.head} onCancel={install.cancel} cancelLabel={t("components.pack.cancelInstallPack", { name: project.title })} />;
  }
  if (install.queued) return <Chip icon="clock">{t("components.pack.queuedChip")}</Chip>;
  return (
    <>
      <div className="inline-flex gap-(--px)">
        <Button variant="primary" size="l" icon="plus" disabled={!version || install.blocked} onClick={() => ask(version?.id)}>
          {reason ?? t("components.pack.createAsInstance")}
        </Button>
        {fitting.length > 1 && (
          <Menu
            trigger={<IconButton variant="primary" size="l" icon="chev-down" label={t("components.pack.otherVersion")} disabled={install.blocked} />}
            items={[
              { label: t("components.pack.otherVersion") },
              ...fitting.slice(0, MAX_OTHER_VERSIONS).map((v) => ({
                id: v.id,
                text: v.version_number,
                sub: `${versionLoadersOrVanilla(v)} ${v.game_versions.at(-1) ?? ""}${versionTypeSuffix(v)}`,
                icon: "plus" as const,
                onSelect: () => ask(v.id),
              })),
            ]}
          />
        )}
      </div>
      {dialog}
    </>
  );
}
