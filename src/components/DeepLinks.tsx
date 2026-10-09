import { useI18n } from "@/i18n";
import { useDeepLinkRequests } from "@/hooks/useDeepLinkRequests";
import { usePlay } from "@/hooks/usePlay";
import { closeLaunchAsk, useLaunchAsks } from "@/store/launchAsks";
import { Dialog, DialogActions } from "@/ui";

/** Links von außen ausführen (`useDeepLinkRequests`) und die Rückfrage zeigen, bevor einer von ihnen ein Spiel startet. */
export function DeepLinks() {
  useDeepLinkRequests();
  return <LaunchAskDialog />;
}

/**
 * „<Name> starten?“: Ein Link aus dem Netz startet nie von selbst, auch ein handgeschriebener `pumpkin://launch/<id>` nicht.
 * „Abbrechen“ hat den Startfokus, damit ein Enter, das gerade im anderen Fenster gedrückt wird, nichts startet.
 */
function LaunchAskDialog() {
  const { t } = useI18n();
  const ask = useLaunchAsks((state) => state.queue[0]);
  const play = usePlay();
  const target = ask?.quickPlay;
  const note = target && (target.type === "world"
    ? t("deepLinks.launch.world", { target: target.id })
    : t("deepLinks.launch.server", { target: target.address }));
  const confirm = () => {
    if (!ask) return;
    closeLaunchAsk();
    void play(ask.instance, undefined, ask.quickPlay);
  };
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(open) => !open && closeLaunchAsk()}
      title={ask ? t("deepLinks.launch.title", { name: ask.instance.name }) : ""}
      size="s"
      role="alertdialog"
      footer={
        <DialogActions
          cancel={{ label: t("common.cancel"), autoFocus: true }}
          confirm={{ label: t("deepLinks.launch.confirm"), icon: "play", className: "w-[130px]", onClick: confirm }}
        />
      }
    >
      <p>{t("deepLinks.launch.text")}</p>
      {note && <p className="dl-note">{note}</p>}
    </Dialog>
  );
}
