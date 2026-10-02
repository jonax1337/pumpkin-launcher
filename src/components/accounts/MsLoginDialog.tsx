import { useI18n } from "@/i18n";
import { Avatar, Button, Dialog, DialogActions, ErrorBox, Hint, Panel, Progress, Skel } from "@/ui";
import { copyWithToast } from "@/lib/clipboard";
import { openPage } from "@/lib/links";
import type { MsLoginStart } from "@/lib/types";
import { closeMsLogin, startMsLogin, useAccountUi, useMsLogin, type LoginState } from "@/store/accountUi";
import { useOfflineAllowed } from "@/store/offline";
import { ThenSub } from "./ThenSub";

/** So viele ganze Minuten läuft die Anmeldung noch, mindestens eine. */
const validMinutes = (info: MsLoginStart) => Math.max(1, Math.round(info.expiresIn / 60));

/** Die Adresse, wie der Browser sie zeigt: ohne „https://“, „www.“ und ohne Query (die Anmelde-URL trägt PKCE-Parameter). */
const addressOf = (info: MsLoginStart) => info.verificationUri.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "");

const JAVA_EDITION_URL = "https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc";

/** Microsoft-Anmeldung: ein Dialog für Kontomenü, Einstellungen und Onboarding. */
export function MsLoginDialog() {
  const { t } = useI18n();
  const state = useMsLogin();
  const then = useAccountUi((s) => s.then);
  return (
    <Dialog
      open={state.step !== "idle"}
      onOpenChange={(open) => !open && closeMsLogin()}
      title={t("components.account.msLogin")}
      sub={then && state.step !== "done" ? <ThenSub label={then.label} /> : undefined}
      width={540}
      height={state.step === "done" ? undefined : 580}
      footer={<MsLoginFooter state={state} />}
    >
      <div className="flex min-h-full flex-col gap-3">
        <MsLoginStep state={state} />
        {state.step !== "done" && <MsLoginInfo />}
      </div>
    </Dialog>
  );
}

function MsLoginFooter({ state }: { state: LoginState }) {
  const { t } = useI18n();
  if (state.step === "done") return <DialogActions confirm={{ label: t("common.done"), width: 124, autoFocus: true, onClick: closeMsLogin }} />;
  return (
    <>
      {state.step === "code" && <Button icon="ext" onClick={() => openPage(state.info.verificationUri)}>{t("components.ms.openPage")}</Button>}
      {state.step === "code" && state.info.mode === "browser" && (
        <Button variant="ghost" onClick={() => void startMsLogin("device")}>{t("components.ms.useCodeInstead")}</Button>
      )}
      <DialogActions cancel={{ label: state.step === "error" ? t("common.close") : t("common.cancel"), width: 124 }} />
    </>
  );
}

function MsLoginStep({ state }: { state: LoginState }) {
  switch (state.step) {
    case "idle":
      return null;
    case "starting":
      return <StartingStep />;
    case "code":
      return state.info.mode === "browser" ? <BrowserStep info={state.info} /> : <DeviceStep info={state.info} />;
    case "done":
      return <DoneStep name={state.name} />;
    case "error":
      return <ErrorStep message={state.message} />;
  }
}

/** Was vor der Anmeldung zu wissen hilft: welches Konto es sein muss und was mit den Zugangsdaten passiert. */
function MsLoginInfo() {
  const { t } = useI18n();
  return (
    <Panel level="sunk" pad="m" className="mt-auto flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <b>{t("components.ms.javaTitle")}</b>
        <Button variant="ghost" size="s" icon="ext" bleed="end" onClick={() => openPage(JAVA_EDITION_URL)}>
          {t("components.ms.javaGet")}
        </Button>
      </div>
      <p>{t("components.ms.javaText")}</p>
      <Hint icon="check">{t("components.ms.trust")}</Hint>
    </Panel>
  );
}

function StartingStep() {
  return (
    <div className="flex flex-col gap-3 pt-1" aria-busy>
      <Skel h={20} w="80%" />
      <Skel h={64} w={280} />
      <Skel h={16} w="60%" />
    </div>
  );
}

/** „Wartet auf die Anmeldung“: Balken in eigener Zeile, darunter ein Satz, wie lange es noch gilt. */
function WaitingRow({ hint }: { hint: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <Progress label={t("components.ms.waiting")} />
      <Hint>{hint}</Hint>
    </div>
  );
}

function BrowserStep({ info }: { info: MsLoginStart }) {
  const { t } = useI18n();
  return (
    <>
      <p>{t("components.ms.browserOpened")}</p>
      <p>{t("components.ms.checkAddress")} <b className="select-all break-all font-mono">{addressOf(info)}</b></p>
      <WaitingRow hint={t("components.ms.windowWaits", { min: validMinutes(info) })} />
      <Hint>{t("components.ms.nothingHappens")}</Hint>
    </>
  );
}

function DeviceStep({ info }: { info: MsLoginStart }) {
  const { t } = useI18n();
  return (
    <>
      <p>{t("components.ms.openAt")} <b className="select-all break-all">{addressOf(info)}</b> {t("components.ms.enterCode")}</p>
      {/* Code-Anzeige (Sonderform: große Pixelschrift in eingelassener Platte) */}
      <div className="codebox">
        <span
          className="code select-all"
          aria-label={t("components.ms.codeSpaced", { code: info.userCode.split("").join(" ") })}
        >
          {info.userCode}
        </span>
        <Button icon="copy" onClick={() => copyWithToast(info.userCode, t("components.ms.codeCopied"))}>{t("common.copy")}</Button>
      </div>
      <WaitingRow hint={t("components.ms.codeValid", { min: validMinutes(info) })} />
    </>
  );
}

function DoneStep({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex items-center gap-3.5">
      <Avatar name={name} />
      <div>
        <Hint tone="ok">{t("components.account.loggedInAs", { name })}</Hint>
        <p>{t("components.ms.accountActive")}</p>
      </div>
    </div>
  );
}

function ErrorStep({ message }: { message: string }) {
  const { t } = useI18n();
  const offlineAllowed = useOfflineAllowed((s) => s.allowed);
  return (
    <>
      <ErrorBox title={t("components.ms.loginFailed")} error={message} onRetry={() => void startMsLogin()} />
      {offlineAllowed && <p className="mt-3">{t("components.ms.offlinePossible")}</p>}
    </>
  );
}
