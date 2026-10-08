import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Actions, Button, FormRow, Hint } from "@/ui";
import { BrandWordmark, Buddy } from "@/branding/Brand";
import { UpdateRow } from "@/components/AppUpdate";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { openPage, REPO_URL } from "@/lib/links";
import pkg from "../../../package.json";
import { SettingsInfo } from "./SettingsInfo";

/** Version der laufenden App; im Browser die aus der package.json. */
function useAppVersion() {
  const [version, setVersion] = useState<string>(pkg.version);
  useEffect(() => {
    // Ohne die Auskunft der App bleibt die Version aus der package.json; mehr als eine Zahl geht dabei nicht verloren.
    if (api.capabilities.appVersion) void getVersion().then(setVersion).catch(() => undefined);
  }, []);
  return version;
}

/** Lizenz des Launchers (Apache-2.0) und sein Quellcode. */
function LicenseRows() {
  const { t } = useI18n();
  return (
    <>
      <FormRow label={t("settings.about.license")} hint={t("settings.about.licenseHint")}>
        <Actions>
          <Button icon="ext" onClick={() => openPage(`${REPO_URL}/blob/main/LICENSE`)}>{t("settings.about.licenseRead")}</Button>
        </Actions>
      </FormRow>
      <FormRow label={t("settings.about.source")} hint={t("settings.about.sourceHint")}>
        <Actions>
          <Button icon="ext" onClick={() => openPage(REPO_URL)}>{t("settings.about.sourceOpen")}</Button>
        </Actions>
      </FormRow>
    </>
  );
}

/** Einstellungen › Über: Version, Updates, Lizenz, Quellcode, Datenschutz, Quellen. */
export function AboutTab() {
  const { t } = useI18n();
  const version = useAppVersion();
  return (
    <>
      <div className="brand-about">
        <Buddy mood="hello" size={48} />
        <div>
          <BrandWordmark />
          <div className="text-fg-2">
            {t("common.version")} {version}
          </div>
        </div>
      </div>
      <UpdateRow />
      <LicenseRows />
      <div className="my-3.5">
        <SettingsInfo title={t("components.privacy.title")} label={t("components.privacy.title")}>
          <PrivacyNotice />
          <Hint className="mt-3.5">{t("pages.settings.aboutSources")}</Hint>
        </SettingsInfo>
      </div>
    </>
  );
}
