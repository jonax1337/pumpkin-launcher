import { useState } from "react";
import { Dialog, DialogActions, Field, Hint, Select, Skel } from "@/ui";
import { Description } from "@/components/Description";
import { useI18n } from "@/i18n";
import { useVersions } from "@/hooks/useInstances";
import { installedPackVersion, usePackChangelog, usePackUpdate, type PackStatus } from "@/hooks/usePackUpdate";
import type { ContentVersion } from "@/lib/content-types";
import { LOADER_LABELS, type Instance, type ModLoader } from "@/lib/types";

/** Feste Maße des Dialogs: das Änderungsprotokoll scrollt im Körper, nichts springt beim Wechsel der Version. */
const DIALOG_WIDTH = 620;
const DIALOG_HEIGHT = 640;
const CONFIRM_WIDTH = 150;
const CHANGELOG_SKELETON_HEIGHT = 160;

const loaderLabel = (loader: string | undefined) => LOADER_LABELS[loader as ModLoader] ?? loader ?? "";

/** Wahl einer Pack-Version mit Änderungsprotokoll; das Update selbst läuft danach im Aufgaben-Menü. */
export function PackUpdateDialog({ instance, status, onClose }: { instance: Instance; status: PackStatus; onClose: () => void }) {
  const { t } = useI18n();
  const installedId = installedPackVersion(instance.modpack);
  const [picked, setPicked] = useState(status.latest?.id ?? status.versions[0]?.id ?? "");
  const update = usePackUpdate(instance);
  const version = status.versions.find((v) => v.id === picked);
  const at = (id: string | null) => status.versions.findIndex((v) => v.id === id);
  // Neueste zuerst: weiter vorn als die installierte heißt neuer; ist die installierte unbekannt, gilt jede als Update.
  const newer = at(installedId) < 0 || at(picked) < at(installedId);
  const suffix = (v: ContentVersion) =>
    v.id === installedId ? t("detail.pack.installedSuffix") : v.version_type !== "release" ? t("components.version.prereleaseSuffix") : "";
  const options = status.versions.map((v) => ({
    value: v.id,
    label: [v.version_number, v.game_versions[0]].filter(Boolean).join(" · ") + suffix(v),
  }));

  function confirm() {
    update.start({ type: "version", versionId: picked });
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("detail.pack.dialogTitle")}
      sub={status.name ?? instance.name}
      width={DIALOG_WIDTH}
      height={DIALOG_HEIGHT}
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{
            label: newer ? t("detail.pack.apply") : t("detail.pack.switch"),
            width: CONFIRM_WIDTH,
            disabled: !version || picked === installedId || update.isPending,
            onClick: confirm,
          }}
        />
      }
    >
      <Field label={t("detail.pack.versionLabel")} help={picked === installedId ? t("detail.pack.installed") : undefined} reserveLines={1}>
        <Select value={picked} onChange={setPicked} options={options} />
      </Field>
      <div className="mb-5 flex flex-col gap-2">
        {version && <GameChange instance={instance} version={version} />}
        <Hint>{t("detail.pack.safety")}</Hint>
      </div>
      <Field label={t("detail.pack.changelog")} group>
        <Changelog instanceId={instance.id} versionId={picked} />
      </Field>
    </Dialog>
  );
}

/** Hinweis, wenn die gewählte Version Minecraft oder den Loader wechselt; bei einer älteren Minecraft-Version als Warnung. */
function GameChange({ instance, version }: { instance: Instance; version: ContentVersion }) {
  const { t } = useI18n();
  const releases = useVersions().data ?? [];
  const to = version.game_versions[0];
  const loader = version.loaders[0];
  const sameGame = !to || (version.game_versions.includes(instance.minecraftVersion) && (!loader || loader === instance.loader));
  if (sameGame) return null;
  const position = (id: string) => releases.findIndex((v) => v.id === id);
  const older = position(instance.minecraftVersion) >= 0 && position(to) > position(instance.minecraftVersion);
  return (
    <Hint tone="warn">
      {t("detail.pack.gameChange", { to, loader: loaderLabel(loader), from: instance.minecraftVersion })}
      {older && ` ${t("detail.pack.olderGame")}`}
    </Hint>
  );
}

function Changelog({ instanceId, versionId }: { instanceId: string; versionId: string }) {
  const { t } = useI18n();
  const changelog = usePackChangelog(instanceId, versionId || null);
  if (changelog.isPending) return <Skel h={CHANGELOG_SKELETON_HEIGHT} />;
  if (changelog.error) return <Hint tone="bad">{t("detail.pack.changelogError")}</Hint>;
  if (!changelog.data) return <Hint>{t("detail.pack.noChangelog")}</Hint>;
  return <Description body={changelog.data} />;
}
