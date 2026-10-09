import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Heading, Hint, LinkList, LinkRow, Panel } from "@/ui";
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

/** Quellcode, Lizenz, Fragen, Fehler melden und Datenschutz an einer Stelle. */
function AboutLinks() {
  const { t } = useI18n();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  return (
    <div>
      <Heading level="sub" className="mb-3">{t("settings.about.linksTitle")}</Heading>
      <LinkList>
        <LinkRow icon="link" label={t("settings.about.source")} hint={t("settings.about.sourceHint")} onClick={() => openPage(REPO_URL)} />
        <LinkRow icon="book" label={t("settings.about.license")} hint={t("settings.about.licenseHint")} onClick={() => openPage(`${REPO_URL}/blob/main/LICENSE`)} />
        <LinkRow icon="bug" label={t("components.support.reportBug")} hint={t("components.support.reportHint")} onClick={() => openPage(`${REPO_URL}/issues/new/choose`)} />
        <LinkRow icon="question" label={t("components.support.questionsLabel")} hint={t("components.support.questionsHint")} onClick={() => openPage(`${REPO_URL}/discussions`)} />
        <LinkRow icon="shield" label={t("components.privacy.title")} external={false} onClick={() => setPrivacyOpen(true)} />
      </LinkList>
      <InfoDialog open={privacyOpen} onOpenChange={setPrivacyOpen} title={t("components.privacy.title")}>
        <PrivacyNotice />
        <Hint>{t("pages.settings.aboutSources")}</Hint>
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
      <Panel level="raised" className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <Buddy mood="hello" size={48} />
        <div className="grid min-w-0 flex-[1_1_220px] gap-1">
          <BrandWordmark />
          <span className="text-ctl-s text-(--fg-2)">{t("common.version")} {version} · {t("components.update.hint")}</span>
        </div>
        <UpdateChip />
        <UpdateCheckButton />
      </Panel>
      <UpdateDetails />
      <div className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-7 *:min-w-0">
        <AboutLinks />
        <SupportSection version={version} />
      </div>
    </>
  );
}
