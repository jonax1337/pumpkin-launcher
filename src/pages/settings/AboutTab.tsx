import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Heading, Hint, Icon, Panel, type IconName } from "@/ui";
import { BrandWordmark, Buddy } from "@/branding/Brand";
import { UpdateCheckButton, UpdateChip, UpdateDetails } from "@/components/AppUpdate";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { SupportSection } from "@/components/support";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { openPage, REPO_URL } from "@/lib/links";
import pkg from "../../../package.json";
import { InfoDialog } from "./SettingsInfo";

/** Version der laufenden App; im Browser die aus der package.json. */
function useAppVersion() {
  const [version, setVersion] = useState<string>(pkg.version);
  useEffect(() => {
    // Ohne die Auskunft der App bleibt die Version aus der package.json; mehr als eine Zahl geht dabei nicht verloren.
    if (api.capabilities.appVersion) void getVersion().then(setVersion).catch(() => undefined);
  }, []);
  return version;
}

/** Eine Zeile der Linkliste: Symbol, Name mit Zusatz, Pfeil nach außen; `onOpen` öffnet die Seite oder einen Dialog. */
function LinkRow({ icon, label, hint, external = true, onOpen }: { icon: IconName; label: string; hint?: string; external?: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="about-link fx" onClick={onOpen}>
      <Icon name={icon} size="s" />
      <span className="about-link-t">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <Icon name={external ? "external" : "chev-right"} size="s" className="about-link-out" />
    </button>
  );
}

/** Quellcode, Lizenz, Fragen, Fehler melden und Datenschutz an einer Stelle. */
function AboutLinks() {
  const { t } = useI18n();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <div>
      <Heading level="sub" className="about-sub">{t("settings.about.linksTitle")}</Heading>
      <div className="vx-slot about-links">
        <LinkRow icon="link" label={t("settings.about.source")} hint={t("settings.about.sourceHint")} onOpen={() => openPage(REPO_URL)} />
        <LinkRow icon="book" label={t("settings.about.license")} hint={t("settings.about.licenseHint")} onOpen={() => openPage(`${REPO_URL}/blob/main/LICENSE`)} />
        <LinkRow icon="bug" label={t("components.support.reportBug")} hint={t("components.support.reportHint")} onOpen={() => openPage(`${REPO_URL}/issues/new/choose`)} />
        <LinkRow icon="question" label={t("components.support.questionsLabel")} hint={t("components.support.questionsHint")} onOpen={() => openPage(`${REPO_URL}/discussions`)} />
        <LinkRow icon="shield" label={t("components.privacy.title")} external={false} onOpen={() => setPrivacyOpen(true)} />
      </div>
      <InfoDialog open={privacyOpen} onOpenChange={setPrivacyOpen} title={t("components.privacy.title")}>
        <PrivacyNotice />
        <Hint className="about-sources">{t("pages.settings.aboutSources")}</Hint>
      </InfoDialog>
    </div>
  );
}

/** Einstellungen › Über & Support: Versionskarte mit Update-Suche, Links und Diagnose. */
export function AboutTab() {
  const { t } = useI18n();
  const version = useAppVersion();
  return (
    <>
      <Panel level="raised" className="about-card">
        <Buddy mood="hello" size={48} />
        <div className="about-name">
          <BrandWordmark />
          <span className="about-meta">{t("common.version")} {version} · {t("components.update.hint")}</span>
        </div>
        <UpdateChip />
        <UpdateCheckButton />
      </Panel>
      <UpdateDetails />
      <div className="about-grid">
        <AboutLinks />
        <SupportSection version={version} />
      </div>
    </>
  );
}
