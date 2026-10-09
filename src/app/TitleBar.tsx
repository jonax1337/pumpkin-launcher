import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n, type TKey } from "@/i18n";
import { AccountMenu } from "@/components/accounts/AccountMenu";
import { api } from "@/lib/api";
import { BrandMark, BrandWordmark } from "@/branding/Brand";
import { SessionChip } from "@/components/friends/SessionChip";
import { closeWarning, type CloseWarning } from "@/components/friends/sharingModel";
import { useSharingActivity, type SharingActivity } from "@/components/friends/useSharingActivity";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { ButtonLink, Chip, ConfirmDialog, IconButton } from "@/ui";

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

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). */
function WindowButtons({ activity }: { activity: SharingActivity }) {
  const { t } = useI18n();
  const [confirmingClose, setConfirmingClose] = useState(false);
  if (!api.capabilities.nativeWindow) return null;
  const win = getCurrentWindow();
  const askClose = () => (closeWarning(activity.session !== undefined, activity.join !== null) ? setConfirmingClose(true) : void win.close());
  return (
    <div className="win">
      <IconButton size="s" icon="win-min" label={t("ui.window.minimize")} tip={false} onClick={() => void win.minimize()} />
      <IconButton size="s" icon="win-max" label={t("ui.window.maximize")} tip={false} onClick={() => void win.toggleMaximize()} />
      <IconButton size="s" solid="bad" icon="win-close" label={t("common.close")} tip={false} onClick={askClose} />
      <CloseConfirm activity={activity} open={confirmingClose} onOpenChange={setConfirmingClose} onConfirm={() => void win.close()} />
    </div>
  );
}

/** Fensterleiste: Marke links, Konto und Fensterknöpfe rechts; die Bereiche liegen in der Seitenleiste. */
export function TitleBar({ online }: { online: boolean }) {
  const { t } = useI18n();
  const activity = useSharingActivity();
  const { data: update } = useAppUpdate();
  return (
    <header className="bar" data-tauri-drag-region>
      <div className="wm" data-tauri-drag-region>
        <BrandMark bar />
        <BrandWordmark bar />
      </div>
      <div className="bar-mid" data-tauri-drag-region>
        <SessionChip activity={activity} />
        {update && (
          <ButtonLink to="/settings?tab=ueber" size="s" icon="update" tone="acc">
            {t("ui.titlebar.updateAvailable")}
          </ButtonLink>
        )}
      </div>
      <div className="bar-right">
        {/* Live-Region bleibt stehen (links neben der Gruppe, schiebt nichts); online leer, damit nichts vorgelesen wird */}
        <span className="bar-live" role="status">
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
