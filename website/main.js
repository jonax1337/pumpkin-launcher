import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/jersey-10/latin-400.css";
import { renderIcons } from "./icons.js";
import { currentSeason, nextSeasonCheck } from "../src/branding/calendar.ts";
import { enhanceDownloadSection } from "./download.js";
import { enhanceNavigation } from "./navigation.js";
import { enhanceMotion } from "./motion.js";
import { enhanceInstallGuides } from "./install-guides.js";

const seasonMarks = import.meta.glob("./assets/brand/*/mark.svg", { eager: true, query: "?url", import: "default" });
let seasonTimer;
function syncSeason() {
  clearTimeout(seasonTimer);
  const { id } = currentSeason();
  if (document.documentElement.dataset.season !== id) {
    document.documentElement.dataset.season = id;
    const url = seasonMarks[`./assets/brand/${id}/mark.svg`];
    document.querySelectorAll("[data-seasonal]").forEach((element) => {
      if (element.tagName === "LINK") element.href = url;
      else element.src = url;
    });
  }
  seasonTimer = setTimeout(syncSeason, nextSeasonCheck());
}
syncSeason();
window.addEventListener("focus", syncSeason);
document.addEventListener("visibilitychange", syncSeason);

enhanceDownloadSection();
enhanceNavigation();

renderIcons();
const disposeInstallGuides = enhanceInstallGuides();

const disposeMotion = enhanceMotion();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposeMotion();
  disposeInstallGuides();
  clearTimeout(seasonTimer);
  window.removeEventListener("focus", syncSeason);
  document.removeEventListener("visibilitychange", syncSeason);
});
