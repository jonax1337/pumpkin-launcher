import { useState, type ComponentProps } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { Button, Icon, Menu, MenuItem, MenuLabel, MenuNote, MenuScroll, MenuSep, SceneThumb, type MenuEntry } from "@/ui";
import { useContentState } from "@/store/contentState";
import { useInstances } from "@/hooks/useInstances";
import { worldsQuery } from "@/hooks/useWorlds";
import { catalogApi } from "@/lib/catalogApi";
import { projectKey, type ProjectRef, type Source } from "@/lib/content-types";
import { ownerKey } from "@/lib/mods";
import { newInstanceUrl } from "@/lib/routes";
import type { Instance, ModKind, World } from "@/lib/types";
import { lookOf, useLookStore } from "@/store/look";
import { fitsLabel, kindsFor, versionFits } from "./fit";
import { jobWidthOf, useJobProgressFor } from "./jobProgress";
import { useAddContent, type AddRequest } from "./useAddContent";

/** Auslöser für „Hinzufügen zu …“: groß im Projektkopf, klein in der Katalogzeile. `target` ist das Ziel („Instanz“, „Welt“). */
function AddMenuTrigger({ title, target, large, ...props }: { title: string; target: string; large?: boolean } & ComponentProps<"button">) {
  const { t } = useI18n();
  return (
    <Button {...props} variant={large ? "primary" : "secondary"} size={large ? "l" : "s"} icon="plus" iconEnd="chevd" aria-label={large ? undefined : t("components.content.addToOne", { name: title, target })}>
      {large ? t("components.content.addTo", { target }) : t("common.add")}
    </Button>
  );
}

/** Fügt hinzu und zeigt „Ansehen“; fehlt zum Projekt eine Version für die Instanz, meldet es das. */
function useAddFromMenu() {
  const { t } = useI18n();
  const addContent = useAddContent();
  return (request: Omit<AddRequest, "openAction">) =>
    void addContent({ ...request, openAction: true }).then(
      (result) => result === "missing" && toast.error(t("components.content.notForMc", { name: request.project.title, version: request.instance.minecraftVersion })),
    );
}

/** Ohne Instanz-Kontext: Menü mit allen Instanzen; unpassende ausgegraut mit Grund, sonst „Neue Instanz anlegen…“. */
export function AddToInstanceMenu({ project, type, large, source }: { project: ProjectRef; type: ModKind; large?: boolean; source: Source }) {
  const { t } = useI18n();
  const instances = useInstances();
  const looks = useLookStore((s) => s.looks);
  const addFromMenu = useAddFromMenu();
  const navigate = useNavigate();
  const active = useContentState((s) => !!s.active);
  const job = useJobProgressFor(project.id, jobWidthOf(large));
  const [open, setOpen] = useState(false);
  // Alle Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({ ...catalogApi(source).versionsQuery(project.id), enabled: open });
  const reasonFor = (i: Instance): string | null => {
    if (!kindsFor(i).includes(type)) return t("components.content.needsLoader");
    if (i.mods.some((m) => ownerKey(m) === projectKey(source, project.id))) return t("components.content.alreadyIn");
    return all.data && !all.data.some((v) => versionFits(v, i, type)) ? t("components.content.noVersionFor", { version: i.minecraftVersion }) : null;
  };
  const rows = (instances.data ?? []).map((i) => ({ i, reason: reasonFor(i) }));
  const usable = rows.some((r) => !r.reason);

  if (job) return job;
  return (
    <Menu open={open} onOpenChange={setOpen} width={300} trigger={<AddMenuTrigger title={project.title} target={t("common.instance")} disabled={active} large={large} />}>
      <MenuLabel>{t("components.content.addToMenu")}</MenuLabel>
      <MenuScroll>
        {rows.map(({ i, reason }) => {
          const look = lookOf(looks, i.id);
          return (
            <MenuItem
              key={i.id}
              disabled={!!reason}
              lead={<SceneThumb bio={look.bio} seed={look.seed} size={28} />}
              sub={reason ?? fitsLabel(i, type)}
              onSelect={() => addFromMenu({ instance: i, project, type, source })}
            >
              {i.name}
            </MenuItem>
          );
        })}
        {rows.length === 0 && !instances.isPending && <MenuNote>{t("components.content.noInstancesYet")}</MenuNote>}
      </MenuScroll>
      {all.isPending && rows.length > 0 && <MenuNote>{t("components.content.checkingVersions")}</MenuNote>}
      {!usable && !all.isPending && (
        <>
          <MenuSep />
          <MenuItem onSelect={() => navigate(newInstanceUrl())}>
            <Icon name="plus" size="s" />
            <span className="vx-trunc">{type === "resourcepack" ? t("components.content.newInstancePlain") : t("components.content.newInstanceFabric")}</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** Datenpaket ohne Instanz-Kontext: je Instanz ein Untermenü mit ihren Welten. Datenpakete gibt es nur auf Modrinth. */
export function AddToWorldMenu({ project, large }: { project: ProjectRef; large?: boolean }) {
  const { t } = useI18n();
  const instances = useInstances();
  const addFromMenu = useAddFromMenu();
  const active = useContentState((s) => !!s.active);
  const job = useJobProgressFor(project.id, jobWidthOf(large));
  const [open, setOpen] = useState(false);
  const list = instances.data ?? [];
  const worlds = useQueries({ queries: list.map((i) => ({ ...worldsQuery(i.id), enabled: open })) });
  // Wie im Menü für Instanzen: Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({ ...catalogApi("modrinth").versionsQuery(project.id), enabled: open });
  const add = (instance: Instance, world: World) => addFromMenu({ instance, project, type: "datapack", source: "modrinth", world });
  const items: MenuEntry[] = list.map((i, k) => {
    const found = worlds[k].data;
    const reason = all.data && !all.data.some((v) => versionFits(v, i, "datapack")) ? t("components.content.noVersionForLower", { version: i.minecraftVersion }) : found?.length === 0 ? t("components.content.noWorldsLower") : null;
    return {
      id: i.id,
      text: reason ? `${i.name} (${reason})` : i.name,
      disabled: !!reason || !found?.length,
      items: (found ?? []).map((w) => ({ id: w.id, text: w.name, onSelect: () => add(i, w) })),
    };
  });

  if (job) return job;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      width={300}
      trigger={<AddMenuTrigger title={project.title} target={t("components.common.world")} disabled={active} large={large} />}
      items={[{ label: t("components.content.addToMenu") }, ...items]}
    >
      {list.length === 0 && !instances.isPending && <MenuNote>{t("components.content.noInstancesYet")}</MenuNote>}
      {worlds.some((q) => q.isPending) && <MenuNote>{t("components.content.searchingWorlds")}</MenuNote>}
    </Menu>
  );
}
