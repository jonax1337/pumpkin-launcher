import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useI18n, type TKey } from "@/i18n";
import { PlayerNameField } from "@/components/PlayerNameField";
import { startMsLogin } from "@/store/accountUi";
import { importable, useForeignInstances } from "@/hooks/useImport";
import { useStarterInstance } from "@/hooks/useStarterInstance";
import { discoverUrl, newInstanceUrl } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button, Choice, Glyph, Heading, Hint, Icon, Panel, Steps, useRoving, type IconName } from "@/ui";
import type { GlyphName, GlyphPalette } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { Buddy } from "@/branding/Brand";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, isValidPlayerName, useSettings } from "@/store/settings";

/** Breite des Weiter-/Start-Knopfs: auf beiden Schritten gleich, damit er nicht springt. */
const CTA_WIDTH = "w-[232px]";

/** Karte vor der Szene: links am Rand, mittig; Innenabstand und Höhe schrumpfen in kleinen Fenstern. */
const CARD = "onb-card absolute top-1/2 left-gut flex w-[min(540px,calc(calc(var(--vw1,1vw)*100)_-_32px))] -translate-y-1/2 flex-col p-[24px_28px_18px] [@media(max-height:700px)]:p-[18px_24px_14px]";
/** Kopfzeile: Maskottchen und Titel; das Maskottchen schrumpft bei kleiner und weicht bei sehr kleiner Höhe (200 % Zoom). */
const HEADING_ROW = "mb-3 flex items-center gap-3 [@media(max-height:700px)]:mb-2";
const BUDDY = "[@media(max-height:700px)]:size-[52px] [@media(max-height:500px)]:hidden";
const TITLE = "leading-[.95] [--hd-hero:36px] [@media(max-height:700px)]:[--hd-hero:30px] [@media(max-height:500px)]:mb-1 [@media(max-height:500px)]:[--hd-hero:var(--hd-dialog)]";

type Start = "vanilla" | "faster" | "modpack" | "file" | "import";

// Beschriftungen als Schlüssel; übersetzt wird beim Rendern, damit ein Sprachwechsel sofort greift.
const STARTS: { id: Start; glyph: GlyphName; pal: GlyphPalette; title: TKey; text: TKey; cta: TKey; ctaIcon: IconName }[] = [
  { id: "vanilla", glyph: "cube", pal: "steel", title: "components.onboarding.start.vanilla.title", text: "components.onboarding.start.vanilla.text", cta: "components.onboarding.ctaCreatePlay", ctaIcon: "play" },
  { id: "faster", glyph: "rocket", pal: "gold", title: "components.onboarding.start.faster.title", text: "components.onboarding.start.faster.text", cta: "components.onboarding.ctaCreatePlay", ctaIcon: "play" },
  { id: "modpack", glyph: "chest", pal: "violet", title: "components.onboarding.start.modpack.title", text: "components.onboarding.start.modpack.text", cta: "components.onboarding.start.modpack.cta", ctaIcon: "grid" },
  { id: "file", glyph: "spool", pal: "teal", title: "components.onboarding.start.file.title", text: "components.onboarding.start.file.text", cta: "components.onboarding.start.file.cta", ctaIcon: "file" },
  { id: "import", glyph: "compass", pal: "sand", title: "components.onboarding.importForeignNone", text: "components.onboarding.start.import.text", cta: "components.onboarding.start.import.cta", ctaIcon: "swap" },
];

/**
 * Erster Start ohne Instanz: zwei Schritte über der Szene. Name (oder Microsoft), dann womit es losgeht.
 * Mit Microsoft-Konto entfällt der Name: der zweite Schritt folgt der Anmeldung sofort.
 */
export function Onboarding() {
  const { t } = useI18n();
  const active = useUsableAccount();
  // Offizieller Build ohne Microsoft-Konto: nur die Anmeldung, kein Spielername (Backend: `offline_allowed`).
  const offlineOk = useOfflineAllowed((s) => s.allowed);
  const addAccount = useSettings((s) => s.addAccount);
  const [nameDone, setNameDone] = useState(!!active);
  const [name, setName] = useState(active?.kind === "offline" ? active.name : "");
  const [start, setStart] = useState<Start>("faster");
  const starter = useStarterInstance();
  const navigate = useNavigate();
  const microsoft = active?.kind === "microsoft";
  const step = nameDone || microsoft ? 2 : 1;
  const nameOk = isValidPlayerName(name);
  const choice = STARTS.find((s) => s.id === start)!;
  // Pfeiltasten in der Startwahl: Auswahl folgt dem Fokus, ein Tab-Stopp.
  const roveStarts = useRoving<HTMLDivElement>("xy");
  // Wer schon einen anderen Launcher nutzt, übernimmt seine Instanzen statt neu anzufangen.
  const foreign = useForeignInstances(step === 2).data?.filter(importable).length ?? 0;

  function next(e: FormEvent) {
    e.preventDefault();
    if (!offlineOk || !nameOk) return;
    if (name !== accountName(active)) addAccount(name);
    setNameDone(true);
  }

  // Datei und Import öffnen den Dialog der Bibliothek, nicht einen eigenen: das Onboarding verschwindet mit der ersten Instanz
  function go() {
    switch (start) {
      case "vanilla":
        return void starter.vanilla();
      case "faster":
        return void starter.faster();
      case "modpack":
        return navigate(discoverUrl());
      case "file":
        return navigate(newInstanceUrl({ type: "file", path: "" }));
      case "import":
        return navigate(newInstanceUrl({ type: "import" }));
    }
  }

  const importTitle = foreign
    ? t(foreign === 1 ? "components.onboarding.importForeign.one" : "components.onboarding.importForeign.other", { n: foreign })
    : null;
  const createsHere = start === "vanilla" || start === "faster";

  const steps = <Steps current={step} total={2} label={t("components.onboarding.stepOf", { step })} className="mb-4 [@media(max-height:700px)]:mb-2.5" />;

  return (
    <div className="onb">
      <PixelScene bio="forest" seed={12} mode="hero" className="scene" />
      <div className="shade-onb" />
      {/* Kein Modal: die Fensterleiste bleibt bedienbar, deshalb eine benannte Region */}
      <Panel
        as="section"
        level="raised"
        className={cn(CARD, step === 1 ? "h-auto max-h-[min(620px,calc(calc(var(--vh1,1vh)*100)_-_var(--bar)_-_32px))]" : "h-[min(620px,calc(calc(var(--vh1,1vh)*100)_-_var(--bar)_-_32px))]")}
        aria-labelledby="onb-t"
      >
        {step === 1 ? (
          <form onSubmit={next} className="onb-form">
            {steps}
            <div className={HEADING_ROW}>
              <Buddy mood="hello" size={96} className={BUDDY} />
              <Heading level="hero" id="onb-t" className={TITLE}>{t("components.onboarding.welcome")}</Heading>
            </div>
            <p>{offlineOk ? t("components.account.askName") : t("components.account.msLoginPrompt")}</p>
            <div className="ob flex-initial">
              {offlineOk && <PlayerNameField value={name} onChange={setName} help={t("components.playerName.helpShort")} />}
              {offlineOk && <div className="or">{t("components.common.or")}</div>}
              <Button icon="microsoft" variant={offlineOk ? undefined : "primary"} className="w-full" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>
              <Hint>
                {offlineOk ? t("components.onboarding.msHintOfflineOk") : t("components.onboarding.msHintRequired")}
              </Hint>
            </div>
            <div className="of">
              <span className="help">{t("components.onboarding.stepOf", { step: 1 })}</span>
              <Button type="submit" variant="primary" size="l" className={CTA_WIDTH} iconEnd="chev-right" disabled={!offlineOk || !nameOk}>
                {t("common.next")}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {steps}
            <div className={HEADING_ROW}>
              <Buddy mood={starter.busy ? "loading" : "hello"} size={96} className={BUDDY} />
              <Heading level="hero" id="onb-t" className={TITLE}>{t("components.onboarding.pickStart")}</Heading>
            </div>
            <p>{t("components.onboarding.moreLater")}</p>
            <div className="ob">
              <div className="flex flex-col gap-1.5 [@media(max-height:700px)]:gap-1" role="radiogroup" aria-label={t("components.onboarding.startGroup")} onKeyDown={roveStarts}>
                {STARTS.map((s) => (
                  <Choice
                    key={s.id}
                    role="radio"
                    media={<Glyph name={s.glyph} pal={s.pal} box={40} />}
                    title={s.id === "import" && importTitle ? importTitle : t(s.title)}
                    sub={t(s.text)}
                    trail={start === s.id ? <Icon name="check" /> : undefined}
                    selected={start === s.id}
                    tabIndex={start === s.id ? 0 : -1}
                    className="[@media(max-height:700px)]:h-[52px]"
                    disabled={starter.busy}
                    onClick={() => setStart(s.id)}
                  />
                ))}
              </div>
            </div>
            <div className="of">
              {microsoft ? (
                <span className="help">{t("components.account.loggedInAs", { name: accountName(active) })}</span>
              ) : (
                <Button variant="ghost" onClick={() => setNameDone(false)} disabled={starter.busy}>{t("common.back")}</Button>
              )}
              {/* Symbol links wie bei allen Knöpfen; beim Anlegen die Sanduhr */}
              <Button
                variant="primary"
                size="l"
                icon={starter.busy ? "hourglass" : choice.ctaIcon}
                className={CTA_WIDTH}
                disabled={starter.busy || (createsHere && !starter.ready)}
                onClick={go}
              >
                {starter.busy ? t("components.newInstance.creating") : t(choice.cta)}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
