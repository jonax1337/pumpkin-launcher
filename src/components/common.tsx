import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LOADER_LABELS, type ModLoader } from "@/lib/types";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

const LOADER_TINT: Record<ModLoader, string> = {
  vanilla: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  fabric: "bg-amber-300/10 text-amber-200 ring-amber-300/20",
  quilt: "bg-violet-300/10 text-violet-200 ring-violet-300/20",
  forge: "bg-sky-300/10 text-sky-200 ring-sky-300/20",
  neoforge: "bg-orange-300/10 text-orange-200 ring-orange-300/20",
};

export function LoaderBadge({ loader, className }: { loader: ModLoader; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-0 ring-1", LOADER_TINT[loader], className)}>
      {LOADER_LABELS[loader]}
    </Badge>
  );
}

// Deterministische "Block"-Kachel als Instanz-Icon
const TILE_HUES = [158, 78, 200, 130, 40, 180];

export function BlockTile({ seed, size = "md" }: { seed: string; size?: "sm" | "md" | "lg" }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = TILE_HUES[h % TILE_HUES.length];
  const cells = Array.from({ length: 16 }, (_, i) => ((h >> i) & 3) / 3);
  return (
    <div
      aria-hidden
      className={cn(
        "grid shrink-0 grid-cols-4 overflow-hidden rounded-lg ring-1 ring-white/10",
        size === "sm" && "size-9",
        size === "md" && "size-12",
        size === "lg" && "size-20 rounded-xl",
      )}
    >
      {cells.map((v, i) => (
        <span key={i} style={{ background: `oklch(${0.42 + v * 0.22} ${0.08 + v * 0.05} ${hue})` }} />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Löschen",
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: unknown;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {error ? <ErrorNote error={error} /> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
