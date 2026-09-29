import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveTemplate } from "@/hooks/useTemplates";
import type { Instance } from "@/lib/types";

/** „Als Vorlage speichern“: Schnappschuss von Version, Inhalten und Einstellungen, ohne Welten. */
export function SaveTemplateDialog({ instance, onClose }: { instance: Instance | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const save = useSaveTemplate();
  // Beim Schließen noch den letzten Namen zeigen, bis die Animation vorbei ist.
  const [last, setLast] = useState(instance);
  if (instance && instance !== last) setLast(instance);
  const shown = instance ?? last;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!instance) return;
    save.mutate({ instance, name: name.trim() || instance.name }, { onSuccess: close });
  }

  function close() {
    setName("");
    onClose();
  }

  return (
    <Dialog open={!!instance} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Als Vorlage speichern</DialogTitle>
            <DialogDescription>
              Merkt sich Version, Mods und Einstellungen von „{shown?.name}“. Welten kommen nicht mit. Aus der Vorlage kannst du später unter
              Neu › Vorlage neue Instanzen anlegen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="template-name">Name der Vorlage</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={shown?.name} maxLength={100} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Wird gespeichert…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
