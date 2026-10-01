import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSettings } from "@/store/settings";
import { setCurrentLanguage, t } from "./core";
import { resolveChoice, type Language, type LanguageChoice } from "./types";

export { t };
export type { Language, LanguageChoice };

/** Sprache der Oberfläche: `t`, die gewählte und die aufgelöste Sprache; ein Wechsel greift sofort. */
interface I18n {
  t: typeof t;
  lang: LanguageChoice;
  resolved: Language;
  setLang: (choice: LanguageChoice) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error("useI18n braucht einen LanguageProvider");
  return i18n;
}

/** Wahl übernehmen: Modul-Sprache für `t` und `lib/format.ts` setzen, dazu `lang` am Wurzelelement. */
function applyLanguage(choice: LanguageChoice): LanguageChoice {
  const resolved = resolveChoice(choice);
  setCurrentLanguage(resolved);
  document.documentElement.lang = resolved;
  return choice;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Bereits im ersten Render die eingestellte Sprache, sonst blitzt beim Start die falsche auf.
  const [lang, setLang] = useState<LanguageChoice>(() => applyLanguage(useSettings.getState().language));

  // Einstellungen können nachträglich laden (Persistenz) oder woanders wechseln: sofort übernehmen.
  useEffect(
    () =>
      useSettings.subscribe((s) => {
        const next = applyLanguage(s.language);
        setLang((current) => (current === next ? current : next));
      }),
    [],
  );

  const value = {
    t,
    lang,
    resolved: resolveChoice(lang),
    setLang: (choice: LanguageChoice) => useSettings.getState().set({ language: choice }),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
