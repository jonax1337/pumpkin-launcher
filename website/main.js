import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/jersey-10/latin-400.css";
import { renderIcons } from "./icons.js";
import { enhanceDownloadSection } from "./download.js";
import { enhanceNavigation } from "./navigation.js";
import { enhanceMotion } from "./motion.js";
import { enhanceInstallGuides } from "./install-guides.js";

enhanceDownloadSection();
enhanceNavigation();

renderIcons();
const disposeInstallGuides = enhanceInstallGuides();

const disposeMotion = enhanceMotion();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposeMotion();
  disposeInstallGuides();
});
