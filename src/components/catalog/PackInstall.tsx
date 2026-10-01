import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, Dialog, DialogActions, ErrorBox, Field, Hint, JobProgress, Menu, Skel, TextField } from "@/ui";
import { useInstallPack } from "@/hooks/usePackInstall";
import { catalogApi } from "@/lib/catalogApi";
import type { ContentVersion, ProjectRef, Source } from "@/lib/content-types";
import { isPackVersionSupported, pickPackVersion } from "@/lib/mods";
import { HEAD_JOB_WIDTH, ROW_JOB_WIDTH } from "./jobProgress";
import { versionLoadersOrVanilla, versionTypeSuffix } from "./labels";

/** So viele weitere Versionen bietet „Andere Version“ an. */
const MAX_OTHER_VERSIONS = 30;

/** Die Pack-Version, die Pumpkin Launcher wählt, oder der Grund, warum keine passt. */
type PickedPack = { version: ContentVersion | null; reason: string | null };

/** Inhalt der Bestätigung; wird beim Schließen verworfen, der Name beginnt also immer beim Pack-Titel. */
function PackConfirmBody({ title, versions, picked, onConfirm }: {
  title: string; versions: UseQueryResult<ContentVersion[]>; picked: PickedPack | null; onConfirm: (versionId: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(title);
  const v = picked?.version ?? null;
  // Platzhalter rechtsbündig in der Wertspalte (Zeile bleibt 19 px hoch)
  const val = (text: ReactNode) => (v ? text : versions.isPending ? <Skel w={90} h={12} className="ml-auto mt-1" /> : "–");
  const submit = () => v && onConfirm(v.id, name.trim() || title);
  return (
    <form
      id="pack-confirm"
      className="pcf"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label={t("components.instance.nameField")}>
        <TextField value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </Field>
      <dl className="kv">
        <dt>{t("components.pack.versionLabel")}</dt>
        <dd className="vx-trunc">{val(v?.version_number)}</dd>
        <dt>Minecraft</dt>
        <dd>{val(v?.game_versions.at(-1))}</dd>
        <dt>{t("components.common.loader")}</dt>
        <dd>{val(v && versionLoadersOrVanilla(v))}</dd>
      </dl>
      {versions.error ? (
        <ErrorBox className="mt-3" title={t("components.version.loadFailed")} error={versions.error} onRetry={() => void versions.refetch()} />
      ) : picked && !v ? (
        <Hint tone="bad" live>{picked.reason}</Hint>
      ) : (
        <Hint>{t("components.pack.confirmHint")}</Hint>
      )}
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
      width={480}
      height={380}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: t("components.instance.createAction"), width: 170, form: "pack-confirm", disabled: !picked?.version || install.blocked }} />}
    >
      <PackConfirmBody
        title={pack.title}
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
        <JobProgress label={install.busy} p={install.p} width={ROW_JOB_WIDTH} onCancel={install.cancel} cancelLabel={t("components.pack.cancelInstallPack", { name: project.title })} />
      ) : (
        <Button size="s" icon="plus" disabled={install.blocked} aria-label={t("components.pack.createAria", { name: project.title })} onClick={() => ask()}>
          {t("components.newInstance.create")}
        </Button>
      )}
      {dialog}
    </>
  );
}

/** Aktionen in den Pack-Details: „Als neue Instanz anlegen“ plus „Andere Version“, beide mit Bestätigung. */
export function PackActions({ project, source }: { project: ProjectRef; source: Source }) {
  const { t } = useI18n();
  const { install, ask, dialog } = usePackConfirm(project, source);
  const versions = useQuery(catalogApi(source).versionsQuery(project.id));
  const { version, reason } = versions.data ? pickPackVersion(versions.data) : { version: null, reason: null };
  const fitting = versions.data?.filter(isPackVersionSupported) ?? [];

  if (install.busy) {
    return <JobProgress label={install.busy} p={install.p} width={HEAD_JOB_WIDTH} onCancel={install.cancel} cancelLabel={t("components.pack.cancelInstallPack", { name: project.title })} />;
  }
  return (
    <>
      <Button variant="primary" size="l" icon="plus" disabled={!version || install.blocked} onClick={() => ask(version?.id)}>
        {reason ?? t("components.pack.createAsInstance")}
      </Button>
      {fitting.length > 1 && (
        <Menu
          trigger={<Button iconEnd="chevd" disabled={install.blocked}>{t("components.pack.otherVersion")}</Button>}
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
      {dialog}
    </>
  );
}
