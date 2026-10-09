import { useI18n } from "@/i18n";
import { Button, Dialog, DialogActions, Hint, Panel, Progress, Skel, Surface } from "@/ui";
import { ErrorBox } from "@/components/ErrorBox";
import { copyWithToast } from "@/lib/clipboard";
import { openPage } from "@/lib/links";
import type { MsLoginStart } from "@/lib/types";
import { closeMsLogin, startMsLogin, useAccountUi, useMsLogin, type LoginState } from "@/store/accountUi";
import { useOfflineAllowed } from "@/store/offline";
import { AccountAvatar } from "./AccountAvatar";
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
      height={state.step === "done" ? undefined : "m"}
      footer={<MsLoginFooter state={state} />}
    >
      <div className="ms-body">
        <MsLoginStep state={state} />
        {state.step !== "done" && <MsLoginInfo />}
      </div>
    </Dialog>
  );
}

function MsLoginFooter({ state }: { state: LoginState }) {
  const { t } = useI18n();
  if (state.step === "done") return <DialogActions confirm={{ label: t("common.done"), className: "w-[124px]", autoFocus: true, onClick: closeMsLogin }} />;
  return (
    <>
      {state.step === "code" && state.info.mode === "browser" && (
        <Button variant="ghost" onClick={() => void startMsLogin("device")}>{t("components.ms.useCodeInstead")}</Button>
      )}
      <DialogActions
        cancel={{ label: state.step === "error" ? t("common.close") : t("common.cancel"), className: "w-[124px]" }}
        confirm={state.step === "code" ? { label: t("components.ms.openPage"), icon: "external", onClick: () => openPage(state.info.verificationUri) } : undefined}
      />
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
      return <DoneStep id={state.id} name={state.name} />;
    case "error":
      return <ErrorStep message={state.message} />;
  }
}

/** Was vor der Anmeldung zu wissen hilft: welches Konto es sein muss und was mit den Zugangsdaten passiert. */
function MsLoginInfo() {
  const { t } = useI18n();
  return (
    <Panel level="sunk" className="ms-info p-4">
      <div className="ms-info-head">
        <b>{t("components.ms.javaTitle")}</b>
        <Button variant="ghost" size="s" icon="external" bleed="end" onClick={() => openPage(JAVA_EDITION_URL)}>
          {t("components.ms.javaGet")}
        </Button>
      </div>
      <p>{t("components.ms.javaText")}</p>
      <Hint icon="shield">{t("components.ms.trust")}</Hint>
    </Panel>
  );
}

function StartingStep() {
  return (
    <div className="ms-starting" aria-busy>
      <Skel className="h-5 w-4/5" />
      <Skel className="h-16 w-[280px]" />
      <Skel className="h-4 w-3/5" />
    </div>
  );
}

/** „Wartet auf die Anmeldung“: Balken in eigener Zeile, darunter ein Satz, wie lange es noch gilt. */
function WaitingRow({ hint }: { hint: string }) {
  const { t } = useI18n();
  return (
    <div className="ms-waiting" aria-live="polite">
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
      <p>{t("components.ms.checkAddress")} <b className="ms-address">{addressOf(info)}</b></p>
      <WaitingRow hint={t("components.ms.windowWaits", { min: validMinutes(info) })} />
      <Hint>{t("components.ms.nothingHappens")}</Hint>
    </>
  );
}

/** Schritt der Geräteanmeldung: Ziffer in einem kleinen Slot (Pixelschrift, Kupfer), daneben der Text. */
const STEP = "flex items-center gap-3";

function StepNumber({ n }: { n: number }) {
  return (
    <Surface kind="slot" as="span" className="grid size-7 flex-none place-items-center text-[18px] leading-none font-normal font-(family-name:--f-px) text-(--copper)">
      {n}
    </Surface>
  );
}

function DeviceStep({ info }: { info: MsLoginStart }) {
  const { t, tAround } = useI18n();
  const [openBefore, openAfter] = tAround("components.ms.stepOpen", "address");
  return (
    <>
      {/* Code-Anzeige: große Pixelschrift in eingelassenem Slot, Kopieren daneben */}
      <div className="grid gap-2">
        <span className="text-[length:calc(12px*var(--tz))] font-semibold tracking-[.06em] text-(--fg-3) uppercase">{t("components.ms.yourCode")}</span>
        <Surface kind="slot" className="flex min-w-0 items-center justify-between gap-3.5 py-2.5 pr-2.5 pl-[18px]">
          <b className="text-[44px] leading-none font-normal font-(family-name:--f-px) tracking-[.14em] whitespace-nowrap text-(--copper) select-all [text-shadow:var(--tsh)]" aria-label={t("components.ms.codeSpaced", { code: info.userCode.split("").join(" ") })}>
            {info.userCode}
          </b>
          <Button icon="copy" onClick={() => copyWithToast(info.userCode, t("components.ms.codeCopied"))}>{t("common.copy")}</Button>
        </Surface>
      </div>
      <ol className="m-0 grid list-none gap-2.5 p-0">
        <li className={STEP}>
          <StepNumber n={1} />
          <span>{openBefore}<b className="ms-address">{addressOf(info)}</b>{openAfter}</span>
        </li>
        <li className={STEP}>
          <StepNumber n={2} />
          <span>{t("components.ms.stepCode")}</span>
        </li>
        <li className={STEP}>
          <StepNumber n={3} />
          <span>{t("components.ms.stepAccount")}</span>
        </li>
      </ol>
      <WaitingRow hint={t("components.ms.codeValid", { min: validMinutes(info) })} />
    </>
  );
}

function DoneStep({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  return (
    <div className="ms-done">
      <AccountAvatar account={{ kind: "microsoft", id, username: name }} />
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
      {offlineAllowed && <p className="ms-offline">{t("components.ms.offlinePossible")}</p>}
    </>
  );
}
