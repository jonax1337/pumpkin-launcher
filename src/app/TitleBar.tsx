import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "@/i18n";
import { AccountMenu } from "@/components/accounts/AccountMenu";
import { api } from "@/lib/api";
import { BrandWordmark } from "@/branding/Brand";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { ButtonLink, Chip, IconButton } from "@/ui";

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). */
function WindowButtons() {
  const { t } = useI18n();
  if (!api.capabilities.nativeWindow) return null;
  const win = getCurrentWindow();
  return (
    <div className="win">
      <IconButton size="s" icon="win-min" label={t("ui.window.minimize")} tip={false} onClick={() => void win.minimize()} />
      <IconButton size="s" icon="win-max" label={t("ui.window.maximize")} tip={false} onClick={() => void win.toggleMaximize()} />
      <IconButton size="s" solid="bad" icon="win-close" label={t("common.close")} tip={false} onClick={() => void win.close()} />
    </div>
  );
}

/** Fensterleiste: Marke links, Konto und Fensterknöpfe rechts; die Bereiche liegen in der Seitenleiste. */
export function TitleBar({ online }: { online: boolean }) {
  const { t } = useI18n();
  const { data: update } = useAppUpdate();
  return (
    <header className="bar" data-tauri-drag-region>
      <div className="wm" data-tauri-drag-region>
        <BrandWordmark bar />
      </div>
      <div className="bar-mid" data-tauri-drag-region>
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
        <WindowButtons />
      </div>
    </header>
  );
}
