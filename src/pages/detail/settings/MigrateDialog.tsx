import { useState } from "react";
import { Actions, Button, Checkbox, Dialog, DialogActions, Field, Hint, Segmented, Select, Skel, StatusPanel } from "@/ui";
import { useI18n } from "@/i18n";
import { useLoaderVersions, useVersions } from "@/hooks/useInstances";
import { useMigration, useMigrationCheck } from "@/hooks/useMigration";
import { ALL_LOADERS, LOADER_LABELS, type Instance, type MigrationCheck, type MigrationTarget, type ModChange, type ModLoader } from "@/lib/types";
import { useBusyReason } from "../guards";

const CONFIRM_BUTTON = "w-[130px]";
const CHECK_SKELETON = "h-24";

/** Gewählte Loader-Version „neueste stabile“: das Ziel trägt dann keine, die nächste Installation nimmt die neueste. */
const LATEST = "latest";

const LOADER_ITEMS = ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }));

/** Minecraft-Version, Loader und Loader-Version wählen; vorbelegt mit dem jetzigen Stand der Instanz. */
function useMigrationForm(instance: Instance) {
  const [snapshots, setSnapshots] = useState(false);
  const [version, setVersion] = useState(instance.minecraftVersion);
  const [loader, setLoader] = useState<ModLoader>(instance.loader);
  const [loaderVersion, setLoaderVersion] = useState(instance.loaderVersion ?? LATEST);
  const versions = useVersions();
  const listed = versions.data?.filter((v) => v.type === "release" || snapshots || v.id === instance.minecraftVersion) ?? [];
  const loaderVersions = useLoaderVersions(loader, version);
  const selectedLoaderVersion = loaderVersions.data?.some((v) => v.version === loaderVersion) ? loaderVersion : LATEST;
  const loaderPending = loader !== "vanilla" && loaderVersions.isPending;
  const loaderUnavailable = loader !== "vanilla" && (!!loaderVersions.error || loaderVersions.data?.length === 0);
  const target: MigrationTarget = {
    minecraftVersion: version,
    loader,
    loaderVersion: loader === "vanilla" || selectedLoaderVersion === LATEST ? null : selectedLoaderVersion,
  };
  const unchanged =
    target.minecraftVersion === instance.minecraftVersion && target.loader === instance.loader && target.loaderVersion === instance.loaderVersion;
  return {
    versions, listed, version, loader, loaderVersions, selectedLoaderVersion, loaderPending, loaderUnavailable, snapshots, target, unchanged,
    setVersion, setLoader, setLoaderVersion, setSnapshots,
  };
}

type MigrationForm = ReturnType<typeof useMigrationForm>;

/**
 * Minecraft-Version oder Loader wechseln: Wahl, Prüfung der Inhalte (was aktualisiert, ergänzt, ausgeschaltet wird)
 * und die beiden Wege: die Instanz selbst ändern oder eine Kopie anlegen und nur sie wechseln.
 */
export function MigrateDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const { t } = useI18n();
  const form = useMigrationForm(instance);
  const ready = !form.unchanged && !form.loaderPending && !form.loaderUnavailable && !!form.version;
  const check = useMigrationCheck(instance.id, ready ? form.target : null);
  const migration = useMigration(instance);
  const busy = useBusyReason(instance.id);
  const cannotStart = !ready || !check.data || !!busy || migration.isPending;

  function run(start: (target: MigrationTarget) => void) {
    start(form.target);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("detail.migrate.title")}
      sub={instance.name}
      height="l"
      footLeft={busy ?? undefined}
      footer={
        <>
          <Button icon="copy" disabled={cannotStart} onClick={() => run(migration.asCopy)}>
            {t("detail.migrate.asCopy")}
          </Button>
          <DialogActions
            cancel={t("common.cancel")}
            confirm={{
              label: t("detail.migrate.apply"),
              className: CONFIRM_BUTTON,
              disabled: cannotStart || !!check.data?.blocked,
              onClick: () => run(migration.inPlace),
            }}
          />
        </>
      }
    >
      <TargetFields form={form} />
      {ready ? (
        <CheckResult instance={instance} target={form.target} check={check} />
      ) : (
        form.unchanged && <Hint>{t("detail.migrate.same")}</Hint>
      )}
    </Dialog>
  );
}

function TargetFields({ form }: { form: MigrationForm }) {
  const { t } = useI18n();
  const { versions, listed, loader, loaderVersions } = form;
  return (
    <>
      <Field label={t("components.newInstance.mcVersion")}>
        <Actions gap={12} wrap>
          {versions.isPending ? (
            <Skel className="h-10 w-55" />
          ) : (
            <Select
              value={form.version}
              onChange={form.setVersion}
              disabled={!listed.length}
              options={
                listed.length
                  ? listed.map((v) => ({ value: v.id, label: `${v.id}${v.type !== "release" ? t("components.version.prereleaseSuffix") : ""}` }))
                  : [{ value: "", label: versions.error ? t("components.version.unreachable") : t("components.version.none") }]
              }
            />
          )}
          <Checkbox checked={form.snapshots} onChange={form.setSnapshots}>{t("components.version.showPrereleases")}</Checkbox>
        </Actions>
      </Field>
      <Field
        label={t("components.common.loader")}
        group
        reserveLines={1}
        error={
          form.loaderUnavailable
            ? loaderVersions.error
              ? t("components.loader.unreachable", { loader: LOADER_LABELS[loader] })
              : t("components.loader.notYetFor", { version: form.version, loader: LOADER_LABELS[loader] })
            : undefined
        }
      >
        <Segmented label={t("components.common.loader")} value={loader} onChange={form.setLoader} items={LOADER_ITEMS} />
      </Field>
      {loader !== "vanilla" && (
        <Field label={t("components.newInstance.loaderVersion")}>
          <Select
            value={form.selectedLoaderVersion}
            onChange={form.setLoaderVersion}
            disabled={form.loaderUnavailable || form.loaderPending}
            options={[
              { value: LATEST, label: t("components.loader.latestStable") },
              ...(loaderVersions.data ?? []).map((v) => ({ value: v.version, label: `${v.version}${v.stable ? "" : t("components.version.prereleaseSuffix")}` })),
            ]}
          />
        </Field>
      )}
    </>
  );
}

/** Ergebnis der Prüfung: was mit den Inhalten passiert, Sicherung der Welten, Warnungen und ob es nur als Kopie geht. */
function CheckResult({ instance, target, check }: {
  instance: Instance; target: MigrationTarget; check: ReturnType<typeof useMigrationCheck>;
}) {
  const { t } = useI18n();
  if (check.isPending) {
    return (
      <div className="mg-check" aria-busy>
        <Hint>{t("detail.migrate.checking")}</Hint>
        <Skel className={CHECK_SKELETON} />
      </div>
    );
  }
  if (check.error) return <StatusPanel tone="bad" title={t("detail.migrate.checkError")}>{check.error.message}</StatusPanel>;
  const sameGame = target.minecraftVersion === instance.minecraftVersion && target.loader === instance.loader;
  if (sameGame) return <Hint>{t("detail.migrate.loaderOnly")}</Hint>;
  return <GameSwitch check={check.data} />;
}

function GameSwitch({ check }: { check: MigrationCheck }) {
  const { t } = useI18n();
  const of = (outcome: ModChange["outcome"]) => check.changes.filter((c) => c.outcome === outcome);
  const [updates, adds, disables] = [of("update"), of("add"), of("disable")];
  return (
    <div className="mg-changes">
      {check.blocked && (
        <StatusPanel tone="warn" title={t("detail.migrate.blockedTitle")}>
          {t(`errors.game.migrate.${check.blocked}`)} {t("detail.migrate.copyHint")}
        </StatusPanel>
      )}
      {check.downgrade && <Hint tone="warn">{t("detail.migrate.downgrade")}</Hint>}
      {check.worlds > 0 && !check.blocked && <Hint>{t("detail.migrate.backupNote", { n: check.worlds })}</Hint>}
      {check.changes.length === 0 && <Hint tone="ok">{t("detail.migrate.allFine")}</Hint>}
      <ChangeList title={t("detail.migrate.disables", { n: disables.length })} changes={disables} hint={t("detail.migrate.disablesHint")} />
      <ChangeList title={t("detail.migrate.updates", { n: updates.length })} changes={updates} />
      <ChangeList title={t("detail.migrate.adds", { n: adds.length })} changes={adds} />
    </div>
  );
}

function ChangeList({ title, changes, hint }: { title: string; changes: ModChange[]; hint?: string }) {
  if (!changes.length) return null;
  return (
    <Field label={title} group help={hint}>
      <ul className="mg-list">
        {changes.map((c) => (
          <li key={c.modId}>{c.version ? `${c.name} → ${c.version}` : c.name}</li>
        ))}
      </ul>
    </Field>
  );
}
