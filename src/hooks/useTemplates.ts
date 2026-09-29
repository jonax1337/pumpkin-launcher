import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";

const templateKeys = { all: ["templates"] as const };

export function useTemplates() {
  return useQuery({ queryKey: templateKeys.all, queryFn: api.templateList });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instance, name }: { instance: Instance; name: string }) => api.templateSave(instance.id, name),
    onSuccess: (t) => {
      toast.success(`Vorlage „${t.name}“ gespeichert`, { description: "Du findest sie unter Neu › Vorlage." });
      return qc.invalidateQueries({ queryKey: templateKeys.all });
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
