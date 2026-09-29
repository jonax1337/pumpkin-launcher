import type { ReactElement, ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMemory } from "@/hooks/useInstances";
import { formatMemory, memoryTooHigh } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LOADER_LABELS, type ModLoader } from "@/lib/types";

/** Tooltip nur in der schmalen Leiste, dann ist das Label unsichtbar. */
export function Tip({ show, label, children }: { show: boolean; label: string; children: ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

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
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Loader als ruhiger Chip; Farbe gibt es nur für Status, nicht für die Variante. */
export function LoaderBadge({ loader, className }: { loader: ModLoader; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs font-medium text-foreground/80", className)}>
      {LOADER_LABELS[loader]}
    </span>
  );
}

// Deterministische "Block"-Kachel als Instanz-Icon; der Farbton färbt auch den Hero.
const TILE_HUES = [158, 78, 200, 130, 40, 180];

function seedHash(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export const tileHue = (seed: string) => TILE_HUES[seedHash(seed) % TILE_HUES.length];

const TILE_SIZE = { sm: "size-9 rounded-md", md: "size-12 rounded-lg", lg: "size-16 rounded-xl", xl: "size-20 rounded-xl" };

export function BlockTile({ seed, size = "md", className }: { seed: string; size?: keyof typeof TILE_SIZE; className?: string }) {
  const h = seedHash(seed);
  const hue = TILE_HUES[h % TILE_HUES.length];
  const cells = Array.from({ length: 16 }, (_, i) => ((h >> i) & 3) / 3);
  return (
    <div aria-hidden className={cn("grid shrink-0 grid-cols-4 overflow-hidden", TILE_SIZE[size], className)}>
      {cells.map((v, i) => (
        <span key={i} style={{ background: `oklch(${0.42 + v * 0.22} ${0.08 + v * 0.05} ${hue})` }} />
      ))}
    </div>
  );
}

/** Leerzustand: Icon, ein Satz, eine Aktion. */
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Fehler in Alltagssprache. Mit `title` ist die Backend-Meldung das Detail (einklappbar), sonst die Meldung selbst.
 * `onRetry` zeigt „Erneut versuchen“.
 */
export function ErrorNote({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm", className)}>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">{title ?? message(error)}</p>
        {title && (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Details
            </summary>
            <p className="mt-1 break-words">{message(error)}</p>
          </details>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden /> Erneut versuchen
        </Button>
      )}
    </div>
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
      <DialogContent showCloseButton={false} className="w-[min(24rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="pr-0">{title}</DialogTitle>
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

/** Regler für Arbeitsspeicher: bis „PC minus 2 GB“, Warnung ab drei Vierteln des PCs. */
export function MemorySlider({ id, value, onChange, disabled }: { id?: string; value: number; onChange: (mb: number) => void; disabled?: boolean }) {
  const { max, total } = useMemory();
  const shown = Math.min(value, max);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <Slider
          id={id}
          aria-label="Arbeitsspeicher"
          aria-valuetext={formatMemory(shown)}
          min={1024}
          max={max}
          step={512}
          value={[shown]}
          onValueChange={([v]) => onChange(v)}
          disabled={disabled}
          className="flex-1"
        />
        <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums">{formatMemory(shown)}</span>
      </div>
      <div className="flex justify-between pr-18 text-xs text-muted-foreground tabular-nums">
        <span>1 GB</span>
        <span>{formatMemory(max)}</span>
      </div>
      {!disabled && total != null && memoryTooHigh(shown, total) && (
        <p className="text-xs text-gold">
          Das ist mehr als drei Viertel deines Arbeitsspeichers ({formatMemory(total)}). Windows und andere Programme können dann stocken.
        </p>
      )}
    </div>
  );
}
