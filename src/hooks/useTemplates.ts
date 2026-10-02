import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { revealLocalPath } from "@/lib/links";
import { packFileName } from "@/lib/mods";
import type { Instance, Template } from "@/lib/types";
import { templateKeys } from "./queryKeys";

export function useTemplates() {
  return useQuery({ queryKey: templateKeys.all, queryFn: api.templateList });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instance, name }: { instance: Instance; name: string }) => api.templateSave(instance.id, name),
    onSuccess: (tpl) => {
      toast.success(t("hooks.template.saved", { name: tpl.name }), { description: t("hooks.template.savedHint") });
      return qc.invalidateQueries({ queryKey: templateKeys.all });
    },
  });
}

/** Fragt nach einer `.mrpack`-Datei und nimmt sie als Vorlage auf; ohne Auswahl passiert nichts. */
export function useImportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const [path] = await api.pickPaths({ filters: [{ name: t(TYPE_ONE_KEYS.modpack), extensions: ["mrpack"] }] });
      return path ? api.templateImport(path) : null;
    },
    onSuccess: (tpl) => {
      if (!tpl) return;
      toast.success(t("hooks.template.imported", { name: tpl.name }));
      return qc.invalidateQueries({ queryKey: templateKeys.all });
    },
  });
}

/** Fragt nach einem Speicherort und legt die Vorlage dort als `.mrpack` ab; der Toast führt zur Datei. */
export function useExportTemplate() {
  return useMutation({
    mutationFn: async (template: Template) => {
      const path = await api.pickSavePath({
        defaultPath: packFileName(template.name, t("components.newInstance.tab.template")),
        filters: [{ name: t("components.export.fileFilter"), extensions: ["mrpack"] }],
      });
      if (!path) return null;
      await api.templateExport(template.id, path);
      return { template, path };
    },
    onSuccess: (exported) => {
      if (!exported) return;
      toast.success(t("components.template.exportedQuoted", { name: exported.template.name }), {
        description: exported.path,
        action: { label: t("components.instance.revealInFolder"), onClick: () => revealLocalPath(exported.path) },
      });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.templateDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.all }),
  });
}
