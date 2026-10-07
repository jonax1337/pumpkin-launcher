import { ui as deUi } from "../de/ui.ts";

/** English dictionary for the ui area — must define exactly the same keys as the German one. */
export const ui: typeof deUi = {
  // ---------- Navigation and window title ----------
  "ui.nav.home": "Home",
  "ui.nav.library": "Library",
  "ui.nav.discover": "Discover",
  "ui.nav.skins": "Skins",
  "ui.nav.friends": "Friends",
  "ui.nav.announcements": "Announcements",
  "ui.nav.announcementsBadgeAria": "{name}, {count} unread",
  "ui.nav.friendsBadgeAria": "{name}, {count} pending",
  "ui.nav.mainAreas": "Main areas",
  "ui.pageTitle.notFound": "Page not found",

  // ---------- Tasks (title bar) ----------
  "ui.tasks.title": "Tasks",
  "ui.tasks.ariaRunning.one": "1 task running",
  "ui.tasks.ariaRunning.other": "Tasks, {count} running",
  "ui.tasks.clearDone": "Clear finished",
  "ui.tasks.emptyTitle": "No tasks",
  "ui.tasks.emptyBody": "Downloads and installations will appear here.",
  "ui.tasks.installing": "Installing {name}",
  "ui.tasks.loadingContents": "Loading content",
  "ui.tasks.queuedSub": "Waiting for the running task",
  "ui.tasks.unqueueAria": "Remove {label} from the queue",
  "ui.job.cancelAria": "Cancel {label}",

  // ---------- Window ----------
  "ui.window.minimize": "Minimize",
  "ui.window.maximize": "Maximize",
  "ui.titlebar.updateAvailable": "Update available",
  "ui.offline.label": "Offline",
  "ui.offline.detail": ": no internet connection, catalog and downloads are unavailable",

  // ---------- Feedback ----------
  "ui.progress.label": "Progress",
  "ui.toast.containerAria": "Notifications",
  "ui.dialog.pending": "One moment",

  // ---------- Fields ----------
  "ui.field.optional": "(optional)",
  "ui.search.clearAria": "Clear search",
  "ui.select.placeholder": "No selection",

  "ui.context.cut": "Cut",
  "ui.context.copy": "Copy",
  "ui.context.paste": "Paste",
  "ui.context.selectAll": "Select all",
  "ui.context.refresh": "Refresh",
  "ui.context.editFailed": "Could not edit text",

  // ---------- Lists ----------
  "ui.list.undo": "Undo",

  // ---------- Side panel ----------
  "ui.sheet.closeAria": "Close panel",

  // ---------- Memory and switches ----------
  "ui.memory.label": "Memory",
  "ui.switch.on": "On",
  "ui.switch.off": "Off",
  // ---------- Keyboard shortcuts ----------
  "ui.skipToContent": "Skip to content",
  "ui.shortcut.ctrl": "Ctrl",
  "ui.shortcut.title": "Keyboard shortcuts",
  "ui.shortcut.goTo": "Go to {name}",
  "ui.shortcut.settings": "Open settings",
  "ui.shortcut.newInstance": "New instance",
  "ui.shortcut.play": "Play (Home and instance)",
  "ui.shortcut.search": "Search the page",
  "ui.shortcut.help": "This overview",
  "ui.shortcut.tabHint": "Tab moves through all controls, the arrow keys move through lists and tabs, Esc closes windows and menus.",
  "ui.shortcut.windowHint": "Arrange the window with Win+arrow keys; minimize, maximize and close at the top right are reachable with Tab.",
  // ---------- Scenes (biome names) ----------
  "ui.biome.forest": "Forest at dusk",
  "ui.biome.nether": "Nether",
  "ui.biome.end": "The End",
  "ui.biome.snow": "Snowy mountains",
  "ui.biome.cave": "Cave",
  "ui.biome.sea": "Coast",
  "ui.biome.plains": "Plains",
};
