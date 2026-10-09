// Abschnitte als Wert + Schlüssel; die Beschriftung löst die Oberfläche erst beim Rendern auf.
export const SECTIONS = [
  { value: "konten", key: "components.account.accounts", icon: "user" },
  { value: "spiel", key: "settings.tabJava", icon: "java" },
  { value: "freunde", key: "friendsSettings.tab", icon: "friends" },
  { value: "speicher", key: "settings.tabStorage", icon: "storage" },
  { value: "darstellung", key: "pages.settings.tabAppearance", icon: "palette" },
  { value: "ueber", key: "pages.settings.tabAbout", icon: "info" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["value"];

export const sectionOf = (id: string | null) => SECTIONS.find((section) => section.value === id);

/** Adresse eines Abschnitts der Einstellungen (`?tab=…`, so liest ihn `SettingsPage`). */
export const settingsSectionUrl = (id: SectionId) => `/settings?tab=${id}`;
