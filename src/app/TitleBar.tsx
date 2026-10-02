import { Link } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "@/i18n";
import { AccountMenu } from "@/components/accounts/AccountMenu";
import { api } from "@/lib/api";
import { BrandMark, BrandWordmark } from "@/branding/Brand";
import { Chip, Icon } from "@/ui";

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). Sonderform: volle Leistenhöhe, bündig am Rand. */
function WindowButtons() {
  const { t } = useI18n();
  if (!api.capabilities.nativeWindow) return null;
  const win = getCurrentWindow();
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
        onClick={() => void win.close()}
      >
        <Icon name="x" size="s" />
      </button>
    </div>
  );
}

/** Fensterleiste: Marke links, Konto und Fensterknöpfe rechts; die Bereiche liegen in der Seitenleiste. */
export function TitleBar({ online }: { online: boolean }) {
  const { t } = useI18n();
  return (
    <header className="bar" data-tauri-drag-region>
      <Link to="/" className="wm fx" aria-label={t("ui.titlebar.homeAria")}>
        <BrandMark />
        <BrandWordmark />
      </Link>
      <div className="bar-mid" data-tauri-drag-region />
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
        <WindowButtons />
      </div>
    </header>
  );
}
