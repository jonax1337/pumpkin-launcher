import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Count, Hint } from "@/ui";
import { BrandWordmark, Buddy } from "@/branding/Brand";
import { UpdateRow } from "@/components/AppUpdate";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import pkg from "../../../package.json";

/** Version der laufenden App; im Browser die aus der package.json. */
function useAppVersion() {
  const [version, setVersion] = useState<string>(pkg.version);
  useEffect(() => {
    // Ohne die Auskunft der App bleibt die Version aus der package.json; mehr als eine Zahl geht dabei nicht verloren.
    if (api.capabilities.appVersion) void getVersion().then(setVersion).catch(() => undefined);
  }, []);
  return version;
}

/** Einstellungen › Über: Version, Updates, Quellen. */
export function AboutTab() {
  const { t } = useI18n();
  const version = useAppVersion();
  return (
    <>
      <div className="brand-about">
        <Buddy mood="hello" size={96} />
        <div>
          <BrandWordmark />
          <div className="text-fg-2">
            {t("common.version")} <Count value={version} /> · {t("pages.settings.aboutTagline")}
          </div>
        </div>
      </div>
      <UpdateRow />
      <Hint className="mt-3.5">{t("pages.settings.aboutSources")}</Hint>
    </>
  );
}
