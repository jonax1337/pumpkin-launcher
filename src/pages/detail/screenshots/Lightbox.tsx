import type { KeyboardEvent } from "react";
import { Dialog as D } from "radix-ui";
import { Actions, Button, Count, IconButton } from "@/ui";
import { copyScreenshot, useTrashScreenshots } from "@/hooks/useScreenshots";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { formatDateTime, formatSize } from "@/lib/format";
import { openLocalPath, revealLocalPath } from "@/lib/links";
import type { Screenshot } from "@/lib/types";
import { cssVars } from "@/ui/util";
import { useZoom } from "./useZoom";

/** Toasts erscheinen oben in der Mitte: unten säßen sie auf den Knöpfen der großen Ansicht. */
const TOAST_ABOVE_VIEWER = { position: "top-center" } as const;

/** Unter dieser Fensterbreite zeigen die Knöpfe der Leiste nur Symbole. */
const COMPACT_BELOW = 1096;

/**
 * Große Ansicht im ganzen Fenster: das Bild angepasst oder mit Zoom (Knöpfe, + − 0 1, Strg+Mausrad, Ziehen, Doppelklick),
 * Blättern (← →, solange das Bild angepasst ist), Kopieren, Öffnen im Bildbetrachter, Zeigen im Ordner und Löschen
 * mit „Rückgängig“.
 */
export function Lightbox({ instanceId, shots, current, onShow, onClose, onClosed }: {
  instanceId: string;
  shots: Screenshot[];
  current: Screenshot;
  /** Zeigt dieses Bild; null schließt die Ansicht. */
  onShow: (fileName: string | null) => void;
  onClose: () => void;
  /** Der Fokus gehört danach der Kachel dieses Bilds. */
  onClosed: (fileName: string) => void;
}) {
  const { t } = useI18n();
  const trash = useTrashScreenshots(instanceId);
  const zoom = useZoom(current.fileName);
  const index = shots.indexOf(current);
  const prev = shots[index - 1]?.fileName ?? null;
  const next = shots[index + 1]?.fileName ?? null;
  const title = formatDateTime(current.takenAt);

  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const actions: Record<string, () => void> = {
      "+": zoom.zoomIn,
      "=": zoom.zoomIn,
      "-": zoom.zoomOut,
      "0": zoom.fit,
      "1": zoom.actualSize,
      // Ist das Bild vergrößert, scrollen die Pfeiltasten es.
      ArrowLeft: () => zoom.isFit && prev && onShow(prev),
      ArrowRight: () => zoom.isFit && next && onShow(next),
    };
    const action = actions[e.key];
    if (!action) return;
    if (zoom.isFit || !e.key.startsWith("Arrow")) e.preventDefault();
    action();
  }

  function remove() {
    onShow(next ?? prev);
    trash([current], TOAST_ABOVE_VIEWER);
  }

  return (
    <D.Root open onOpenChange={(open) => !open && onClose()}>
      <D.Portal>
        <D.Overlay className="vx-scrim" />
        <D.Content
          className="shot-lb"
          data-ctx="overlay"
          aria-describedby="shot-zoom-hint"
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onClosed(current.fileName);
          }}
        >
          <header className="shot-lb-bar">
            <div className="shot-lb-title">
              <D.Title asChild><h2>{title}</h2></D.Title>
              <p>{`${current.fileName} · ${formatSize(current.size)}`}</p>
            </div>
            <D.Close asChild>
              <IconButton icon="close" label={t("common.close")} tip={false} />
            </D.Close>
          </header>
          <p id="shot-zoom-hint" className="sr">{t("detail.screenshots.zoomHint")}</p>
          <div
            ref={zoom.stageRef}
            className="shot-stage"
            data-pan={zoom.canPan ? "" : undefined}
            tabIndex={0}
            onDoubleClick={() => (zoom.isFit ? zoom.actualSize() : zoom.fit())}
            {...zoom.panProps}
          >
            <img
              ref={zoom.image}
              src={api.screenshotSrc(current)}
              alt={t("detail.screenshots.shotAria", { date: title })}
              draggable={false}
              data-ready={zoom.size ? "" : undefined}
              style={zoom.size ? cssVars({ "--w": `${zoom.size.width}px`, "--h": `${zoom.size.height}px` }) : undefined}
              onLoad={zoom.onLoad}
            />
          </div>
          <footer className="shot-lb-bar">
            <Actions>
              <IconButton icon="chev-left" label={t("detail.screenshots.prevAria")} disabled={!prev} onClick={() => onShow(prev)} />
              <Count value={`${index + 1} / ${shots.length}`} size={16} />
              <IconButton icon="chev-right" label={t("detail.screenshots.nextAria")} disabled={!next} onClick={() => onShow(next)} />
            </Actions>
            <div className="shot-zoom" role="group" aria-label={t("detail.screenshots.zoomGroup")}>
              <IconButton icon="minus" label={t("detail.screenshots.zoomOut")} disabled={!zoom.canZoomOut} onClick={zoom.zoomOut} />
              <Count value={`${zoom.percent} %`} size={16} className="shot-zoom-n" />
              <IconButton icon="plus" label={t("detail.screenshots.zoomIn")} disabled={!zoom.canZoomIn} onClick={zoom.zoomIn} />
              <Button variant="ghost" size="s" aria-pressed={zoom.isFit} onClick={zoom.fit}>{t("detail.screenshots.zoomFit")}</Button>
              <Button variant="ghost" size="s" aria-label={`1:1 (${t("detail.screenshots.zoomActual")})`} onClick={zoom.actualSize}>1:1</Button>
            </div>
            <Actions>
              {/* Ohne Rückfrage: „Rückgängig“ und der Papierkorb machen das Löschen umkehrbar. */}
              <Button variant="ghost" tone="bad" icon="trash" compactBelow={COMPACT_BELOW} onClick={remove}>
                {t("common.delete")}
              </Button>
              <Button icon="copy" compactBelow={COMPACT_BELOW} aria-label={t("detail.screenshots.copyAria")} onClick={() => void copyScreenshot(instanceId, current, TOAST_ABOVE_VIEWER)}>
                {t("detail.screenshots.copy")}
              </Button>
              <Button icon="folder" compactBelow={COMPACT_BELOW} onClick={() => revealLocalPath(current.path)}>{t("components.instance.revealInFolder")}</Button>
              <Button variant="primary" icon="external" compactBelow={COMPACT_BELOW} onClick={() => openLocalPath(current.path)}>{t("common.open")}</Button>
            </Actions>
          </footer>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
