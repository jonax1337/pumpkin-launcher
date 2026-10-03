import { useState } from "react";
import { Link } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n, type TKey } from "@/i18n";
import { AccountMenu } from "@/components/accounts/AccountMenu";
import { api } from "@/lib/api";
import { BrandMark, BrandWordmark } from "@/branding/Brand";
import { SessionChip } from "@/components/friends/SessionChip";
import { closeWarning, type CloseWarning } from "@/components/friends/sharingModel";
import { useSharingActivity, type SharingActivity } from "@/components/friends/useSharingActivity";
import { Chip, ConfirmDialog, Icon } from "@/ui";

const CLOSE_TEXT: Record<CloseWarning, TKey> = {
  hosting: "friendsHost.close.hosting",
  joining: "friendsHost.close.joining",
  both: "friendsHost.close.both",
};

/** Rückfrage beim Schließen, solange geteilt wird oder ein Beitritt läuft: das Beenden des Launchers beendet beides. */
function CloseConfirm({ activity: { session, join }, open, onOpenChange, onConfirm }: {
  activity: SharingActivity; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void;
}) {
  const { t } = useI18n();
  const warning = closeWarning(session !== undefined, join !== null);
  const name = join?.hostName ?? t("friendsHost.chip.unknownHost");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("friendsHost.close.title")}
      text={warning && t(CLOSE_TEXT[warning], { name })}
      confirmLabel={t("common.close")}
      onConfirm={onConfirm}
    />
  );
}

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). Sonderform: volle Leistenhöhe, bündig am Rand. */
function WindowButtons({ activity }: { activity: SharingActivity }) {
  const { t } = useI18n();
  const [confirmingClose, setConfirmingClose] = useState(false);
  if (!api.capabilities.nativeWindow) return null;
  const win = getCurrentWindow();
  const askClose = () => (closeWarning(activity.session !== undefined, activity.join !== null) ? setConfirmingClose(true) : void win.close());
  return (
    <div className="win">
      <button
        type="button"
        className="winbtn"
        aria-label={t("ui.window.minimize")}
        onClick={() => void win.minimize()}
      >
        <Icon name="wmin" size="s" />
      </button>
      <button
        type="button"
        className="winbtn"
        aria-label={t("ui.window.maximize")}
        onClick={() => void win.toggleMaximize()}
      >
        <Icon name="wmax" size="s" />
      </button>
      <button
        type="button"
        className="winbtn close"
        aria-label={t("common.close")}
        onClick={askClose}
      >
        <Icon name="x" size="s" />
      </button>
      <CloseConfirm activity={activity} open={confirmingClose} onOpenChange={setConfirmingClose} onConfirm={() => void win.close()} />
    </div>
  );
}

/** Fensterleiste: Marke links, Konto und Fensterknöpfe rechts; die Bereiche liegen in der Seitenleiste. */
export function TitleBar({ online }: { online: boolean }) {
  const { t } = useI18n();
  const activity = useSharingActivity();
  return (
    <header className="bar" data-tauri-drag-region>
      <Link to="/" className="wm fx" aria-label={t("ui.titlebar.homeAria")}>
        <BrandMark />
        <BrandWordmark />
      </Link>
      <div className="bar-mid items-center" data-tauri-drag-region>
        <SessionChip activity={activity} />
      </div>
      <div className="bar-right">
        {/* Live-Region bleibt stehen (links neben der Gruppe, schiebt nichts); online leer, damit nichts vorgelesen wird */}
        <span className="pointer-events-none absolute top-1/2 right-[calc(100%+8px)] flex -translate-y-1/2" role="status">
          {!online && (
            <Chip tone="warn" icon="plug">
              {t("ui.offline.label")}<span className="sr">{t("ui.offline.detail")}</span>
            </Chip>
          )}
        </span>
        <AccountMenu />
        <WindowButtons activity={activity} />
      </div>
    </header>
  );
}
