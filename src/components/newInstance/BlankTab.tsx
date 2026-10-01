import { useState } from "react";
import { useI18n, type TKey } from "@/i18n";
import { Actions, Checkbox, Disclosure, Field, Segmented, Select, Skel, TextField } from "@/ui";
import { MemoryChooser } from "@/components/common";
import { useCreateInstance, useLoaderVersions, useVersions } from "@/hooks/useInstances";
import { ALL_LOADERS, LOADER_LABELS, type ModLoader } from "@/lib/types";
import type { TabContext, TabModel } from "./tab";

// Kurze Erklärung je Loader, steht als Hilfe unter der Wahl.
const LOADER_HELP: Record<ModLoader, TKey> = {
  vanilla: "components.loader.help.vanilla",
  fabric: "components.loader.help.fabric",
  quilt: "components.loader.help.quilt",
  forge: "components.loader.help.forge",
  neoforge: "components.loader.help.neoforge",
};

const LOADER_ITEMS = ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }));

// Leerer Wert steht für loaderVersion = null („neueste stabile“).
const LATEST = "latest";

/** Zustand der eigenen Instanz: Name, Minecraft-Version, Loader samt Version und Arbeitsspeicher. */
function useBlankForm() {
  // null = der Vorschlag aus Loader und Version, bis der Nutzer selbst einen Namen tippt
  const [customName, setCustomName] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState(false);
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState<ModLoader>("fabric");
  const [loaderVersion, setLoaderVersion] = useState(LATEST);
  const [memory, setMemory] = useState<number | null>(null);
  const versions = useVersions();
  const filtered = versions.data?.filter((v) => v.type === "release" || snapshots) ?? [];
  // Neueste Version vorauswählen, bis der Nutzer selbst wählt
  const selectedVersion = filtered.some((v) => v.id === version) ? version : (filtered[0]?.id ?? "");
  const loaderVersions = useLoaderVersions(loader, selectedVersion);
  // Gewählte Loader-Version verfällt, wenn es sie für die neue Minecraft-Version nicht gibt
  const selectedLoader = loaderVersions.data?.some((v) => v.version === loaderVersion) ? loaderVersion : LATEST;
  const loaderUnavailable = loader !== "vanilla" && (!!loaderVersions.error || loaderVersions.data?.length === 0);
  const suggestion = `${loader === "vanilla" ? "Minecraft" : LOADER_LABELS[loader]} ${selectedVersion}`.trim();
  return {
    versions, filtered, selectedVersion, loaderVersions, selectedLoader, loaderUnavailable, suggestion,
    customName, snapshots, loader, memory,
    setCustomName, setSnapshots, setVersion, setLoader, setLoaderVersion, setMemory,
  };
}

type BlankForm = ReturnType<typeof useBlankForm>;

function BlankPane({ form }: { form: BlankForm }) {
  const { t } = useI18n();
  const { versions, filtered, selectedVersion, loaderVersions, selectedLoader, loaderUnavailable, loader } = form;
  return (
    <>
      <Field label={t("common.name")} help={t("components.newInstance.nameHelp")}>
        <TextField value={form.customName ?? form.suggestion} maxLength={64} onChange={(e) => form.setCustomName(e.target.value)} />
      </Field>
      <Field label={t("components.newInstance.mcVersion")}>
        <Actions gap={12} wrap>
          {versions.isPending ? (
            <Skel w={220} h={40} />
          ) : (
            <Select
              value={selectedVersion}
              onChange={form.setVersion}
              disabled={!filtered.length}
              options={
                filtered.length
                  ? filtered.map((v, k) => ({ value: v.id, label: `${v.id}${v.type !== "release" ? t("components.version.prereleaseSuffix") : k === 0 ? t("components.version.newestSuffix") : ""}` }))
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
        help={t(LOADER_HELP[loader])}
        error={
          loaderUnavailable
            ? loaderVersions.error ? t("components.loader.unreachable", { loader: LOADER_LABELS[loader] }) : t("components.loader.notYetFor", { version: selectedVersion, loader: LOADER_LABELS[loader] })
            : undefined
        }
      >
        <Segmented label={t("components.common.loader")} value={loader} onChange={form.setLoader} items={LOADER_ITEMS} />
      </Field>
      <Disclosure summary={t("components.newInstance.advanced")}>
        <Field label={t("components.newInstance.loaderVersion")} group={loader === "vanilla"}>
          {loader === "vanilla" ? (
            <span className="text-fg-2">{t("components.loader.notNeededVanilla")}</span>
          ) : (
            <Select
              value={selectedLoader}
              onChange={form.setLoaderVersion}
              disabled={loaderUnavailable || loaderVersions.isPending}
              options={[
                { value: LATEST, label: t("components.loader.latestStable") },
                ...(loaderVersions.data ?? []).map((v) => ({ value: v.version, label: `${v.version}${v.stable ? "" : t("components.version.prereleaseSuffix")}` })),
              ]}
            />
          )}
        </Field>
        <Field label={t("ui.memory.label")} group>
          <MemoryChooser name="ni-ram" value={form.memory} onChange={form.setMemory} autoText={t("components.memory.autoFromSettings")} />
        </Field>
      </Disclosure>
    </>
  );
}

/** Reiter „Eigene“: Instanz mit Minecraft-Version und Loader nach Wahl. */
export function useBlankTab(ctx: TabContext): TabModel {
  const { t } = useI18n();
  const form = useBlankForm();
  const create = useCreateInstance();

  function submit() {
    create.mutate(
      {
        name: form.customName?.trim() || form.suggestion,
        minecraftVersion: form.selectedVersion,
        loader: form.loader,
        loaderVersion: form.selectedLoader === LATEST ? null : form.selectedLoader,
        memoryMb: form.memory,
      },
      { onSuccess: ctx.onCreated },
    );
  }

  return {
    valid: !!form.selectedVersion && !form.loaderUnavailable,
    label: create.isPending ? t("components.newInstance.creating") : t("components.newInstance.create"),
    hint: t("components.newInstance.gameOnFirstStart"),
    queues: false,
    busy: create.isPending,
    submit,
    renderPane: () => <BlankPane form={form} />,
  };
}
