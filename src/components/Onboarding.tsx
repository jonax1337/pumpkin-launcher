import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useI18n, type TKey } from "@/i18n";
import { PlayerNameField } from "@/components/PlayerNameField";
import { startMsLogin } from "@/store/accountUi";
import { importable, useForeignInstances } from "@/hooks/useImport";
import { useStarterInstance } from "@/hooks/useStarterInstance";
import { discoverUrl, newInstanceUrl } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button, Choice, Glyph, Hint, Icon, useRoving, type IconName } from "@/ui";
import type { GlyphName, GlyphPalette } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { Buddy } from "@/branding/Brand";
import { useOfflineAllowed, useUsableAccount } from "@/store/offline";
import { accountName, isValidPlayerName, useSettings } from "@/store/settings";

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

  const steps = (
    <div className="steps" aria-label={t("components.onboarding.stepOf", { step })}>
      <i className="on" />
      <i className={cn(step > 1 && "on")} />
    </div>
  );

  return (
    <div className="onb">
      <PixelScene bio="forest" seed={12} mode="hero" className="scene" />
      <div className="shade-onb" />
      {/* Kein Modal: die Fensterleiste bleibt bedienbar, deshalb eine benannte Region */}
      <section className="onb-card plate" aria-labelledby="onb-t">
        {step === 1 ? (
          <form onSubmit={next} className="onb-form">
            {steps}
            <div className="onb-heading">
              <Buddy mood="hello" size={96} />
              <h1 id="onb-t">{t("components.onboarding.welcome")}</h1>
            </div>
            <p>{offlineOk ? t("components.account.askName") : t("components.account.msLoginPrompt")}</p>
            <div className="ob">
              {offlineOk && <PlayerNameField value={name} onChange={setName} help={t("components.playerName.helpShort")} />}
              {offlineOk && <div className="or">{t("components.common.or")}</div>}
              <Button icon="microsoft" variant={offlineOk ? undefined : "primary"} width="full" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>
              <Hint className="ob-ms">
                {offlineOk ? t("components.onboarding.msHintOfflineOk") : t("components.onboarding.msHintRequired")}
              </Hint>
            </div>
            <div className="of">
              <span className="help">{t("components.onboarding.stepOf", { step: 1 })}</span>
              <Button type="submit" variant="primary" width={140} iconEnd="chev-right" disabled={!offlineOk || !nameOk}>
                {t("common.next")}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {steps}
            <div className="onb-heading">
              <Buddy mood={starter.busy ? "loading" : "hello"} size={96} />
              <h1 id="onb-t">{t("components.onboarding.pickStart")}</h1>
            </div>
            <p>{t("components.onboarding.moreLater")}</p>
            <div className="ob">
              <div className="starts" role="radiogroup" aria-label={t("components.onboarding.startGroup")} onKeyDown={roveStarts}>
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
                width={232}
                disabled={starter.busy || (createsHere && !starter.ready)}
                onClick={go}
              >
                {starter.busy ? t("components.newInstance.creating") : t(choice.cta)}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
