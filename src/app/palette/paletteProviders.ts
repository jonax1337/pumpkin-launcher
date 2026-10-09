import { loaderLine } from "@/components/common";
import type { Phase } from "@/components/play/phase";
import { t, type TKey } from "@/i18n";
import { api } from "@/lib/api";
import { discoverUrl, newInstanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import { quickPlayTarget, type Instance, type QuickPlay } from "@/lib/types";
import { SECTIONS, settingsSectionUrl } from "@/pages/settings/sections";
import { TEXT_SIZE_KEYS } from "@/pages/settings/AppearanceTab";
import { useSettings, type TextSize } from "@/store/settings";
import { FRIENDS_PATH, TABS } from "../mainTabs";
import { SHORTCUT } from "../shortcuts";
import type { PaletteItem } from "./paletteModel";

/** Suchbegriffe eines Befehls: die Wörter des Eintrags `palette.kw.*`. */
const words = (key: TKey) => t(key).split(/\s+/);

type Go = (to: string) => void;

// ---------- Instanzen ----------

export interface InstanceActions {
  phaseOf: (instanceId: string) => Phase;
  open: (instance: Instance) => void;
  /** Dieselbe Funktion wie der Spielen-Knopf (`usePlay`); mit `quickPlay` direkt in Welt oder Server. */
  play: (instance: Instance, quickPlay: QuickPlay | null) => void;
  /** Beenden mit Rückfrage (`askStop`). */
  stop: (instance: Instance) => void;
}

/** Phasen, in denen der Spielen-Knopf nicht klickbar ist; der Grund steht dann statt der Untertitelzeile. */
const PLAY_BLOCKED_BY: Partial<Record<Phase, TKey>> = {
  loading: "ui.dialog.pending",
  preparing: "components.game.installing",
  starting: "components.game.starting",
};

function playItem(instance: Instance, disabledReason: string | undefined, actions: InstanceActions): PaletteItem {
  return {
    id: `play:${instance.id}`,
    group: "instances",
    title: t("palette.play", { name: instance.name }),
    subtitle: loaderLine(instance),
    icon: "play",
    keywords: words("palette.kw.play"),
    disabledReason,
    run: () => actions.play(instance, null),
  };
}

function playLastItem(instance: Instance, lastPlay: QuickPlay, disabledReason: string | undefined, actions: InstanceActions): PaletteItem {
  return {
    id: `playLast:${instance.id}`,
    group: "instances",
    title: t("palette.playLast", { name: instance.name, target: quickPlayTarget(lastPlay) }),
    subtitle: loaderLine(instance),
    icon: "play",
    keywords: [...words("palette.kw.play"), ...words("palette.kw.resume")],
    disabledReason,
    run: () => actions.play(instance, lastPlay),
  };
}

function stopItem(instance: Instance, actions: InstanceActions): PaletteItem {
  return {
    id: `stop:${instance.id}`,
    group: "instances",
    title: t("palette.stop", { name: instance.name }),
    subtitle: t("components.game.running"),
    icon: "stop",
    keywords: words("palette.kw.stop"),
    run: () => actions.stop(instance),
  };
}

function openItem(instance: Instance, actions: InstanceActions): PaletteItem {
  return {
    id: `open:${instance.id}`,
    group: "instances",
    title: t("palette.open", { name: instance.name }),
    subtitle: loaderLine(instance),
    icon: "library",
    keywords: words("palette.kw.open"),
    run: () => actions.open(instance),
  };
}

/** Spielen (und Weiterspielen), solange nichts läuft; läuft das Spiel, an dessen Stelle Beenden. Öffnen geht immer. */
function instanceCommands(instance: Instance, actions: InstanceActions): PaletteItem[] {
  const phase = actions.phaseOf(instance.id);
  if (phase === "running") return [stopItem(instance, actions), openItem(instance, actions)];
  const blockedBy = PLAY_BLOCKED_BY[phase];
  const disabledReason = blockedBy && t(blockedBy);
  return [
    playItem(instance, disabledReason, actions),
    ...(instance.lastQuickPlay ? [playLastItem(instance, instance.lastQuickPlay, disabledReason, actions)] : []),
    openItem(instance, actions),
  ];
}

export const instanceItems = (instances: Instance[], actions: InstanceActions): PaletteItem[] =>
  instances.flatMap((instance) => instanceCommands(instance, actions));

// ---------- Navigation ----------

/** Die Bereiche der Seitenleiste (ohne Freunde, wo die Seitenleiste sie ausblendet), Einstellungen und jeder Abschnitt darin. */
export function navigationItems(go: Go, friendsHidden: boolean): PaletteItem[] {
  const navigate = words("palette.kw.navigate");
  const settingsWords = [...navigate, ...words("palette.kw.settings")];
  const areas = TABS.filter((tab) => !(tab.to === FRIENDS_PATH && friendsHidden)).map((tab): PaletteItem => ({
    id: `nav:${tab.to}`,
    group: "navigation",
    title: t(tab.key),
    icon: tab.icon,
    shortcut: tab.shortcut,
    keywords: navigate,
    run: () => go(tab.to),
  }));
  const settings: PaletteItem = {
    id: "nav:/settings",
    group: "navigation",
    title: t("common.settings"),
    icon: "settings",
    shortcut: SHORTCUT.settings,
    keywords: settingsWords,
    run: () => go("/settings"),
  };
  const sections = SECTIONS.map((section): PaletteItem => ({
    id: `nav:settings:${section.value}`,
    group: "navigation",
    title: t("palette.settingsTab", { name: t(section.key) }),
    icon: section.icon,
    keywords: settingsWords,
    run: () => go(settingsSectionUrl(section.value)),
  }));
  return [...areas, settings, ...sections];
}

// ---------- Aktionen ----------

export interface ActionEnvironment {
  go: Go;
  checkForUpdates: () => void;
  /** Warum die Suche nach Updates gerade nicht startet (Suche oder Installation läuft); sonst undefined. */
  updateBlockedReason: string | undefined;
  motion: boolean;
  /** Das System wünscht weniger Bewegung: der Schalter der Einstellungen ist dann gesperrt, also auch der Befehl. */
  systemReducesMotion: boolean;
  textSize: TextSize;
}

function motionItem({ motion, systemReducesMotion }: ActionEnvironment): PaletteItem {
  return {
    id: "action:motion",
    group: "actions",
    title: t(motion ? "palette.motionOff" : "palette.motionOn"),
    icon: "sparkle",
    keywords: words("palette.kw.motion"),
    disabledReason: systemReducesMotion ? t("pages.settings.motionReducedHint") : undefined,
    run: () => useSettings.getState().set({ motion: !motion }),
  };
}

function textSizeItem({ textSize }: ActionEnvironment): PaletteItem {
  const at = TEXT_SIZE_KEYS.findIndex((size) => size.value === textSize);
  const next = TEXT_SIZE_KEYS[(at + 1) % TEXT_SIZE_KEYS.length];
  return {
    id: "action:textSize",
    group: "actions",
    title: t("palette.textSize"),
    subtitle: t("palette.textSizeChange", { from: t(TEXT_SIZE_KEYS[at].key), to: t(next.key) }),
    icon: "settings",
    keywords: words("palette.kw.textSize"),
    run: () => useSettings.getState().set({ textSize: next.value }),
  };
}

export function actionItems(env: ActionEnvironment): PaletteItem[] {
  return [
    {
      id: "action:newInstance",
      group: "actions",
      title: t("palette.newInstance"),
      icon: "plus",
      shortcut: SHORTCUT.newInstance,
      keywords: words("palette.kw.newInstance"),
      run: () => env.go(newInstanceUrl()),
    },
    {
      id: "action:import",
      group: "actions",
      title: t("palette.import"),
      icon: "download",
      keywords: words("palette.kw.import"),
      run: () => env.go(newInstanceUrl({ type: "import" })),
    },
    {
      id: "action:checkUpdates",
      group: "actions",
      title: t("palette.checkUpdates"),
      icon: "refresh",
      keywords: words("palette.kw.checkUpdates"),
      disabledReason: env.updateBlockedReason,
      run: env.checkForUpdates,
    },
    {
      id: "action:openDataFolder",
      group: "actions",
      title: t("palette.openDataFolder"),
      icon: "folder",
      keywords: words("palette.kw.openDataFolder"),
      run: () => void api.storageOpenDir().catch(toastError),
    },
    {
      id: "action:openInstancesFolder",
      group: "actions",
      title: t("palette.openInstancesFolder"),
      icon: "folder",
      keywords: words("palette.kw.openInstancesFolder"),
      run: () => void api.storageOpenInstancesDir().catch(toastError),
    },
    motionItem(env),
    textSizeItem(env),
  ];
}

// ---------- Suche ----------

/** „Entdecken nach … durchsuchen“: öffnet Entdecken mit dem getippten Text im Suchfeld. */
export const discoverSearchItem = (query: string, go: Go): PaletteItem => ({
  id: "search:discover",
  group: "search",
  title: t("palette.searchDiscover", { query }),
  icon: "search",
  keywords: [],
  run: () => go(discoverUrl({ query })),
});
