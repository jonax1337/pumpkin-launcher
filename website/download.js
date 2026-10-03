// Progressive enhancement for the download section. Local only: reads the browser's own OS hints, makes no request.
const MOBILE_PATTERN = /Android|iPhone|iPad|iPod|Mobi|Windows Phone|CrOS/i;
const CTA_LABELS = {
  full: (name) => `Für ${name} herunterladen`,
  short: (name) => `Für ${name}`,
};

// Returns "windows", "macos" or "linux"; null for phones, tablets, ChromeOS and anything unknown.
export function detectDesktopOs({ platform = "", userAgent = "", mobile = false, maxTouchPoints = 0 }) {
  if (mobile || MOBILE_PATTERN.test(userAgent)) return null;
  const hint = platform || userAgent;
  if (/win/i.test(hint)) return "windows";
  // iPadOS reports itself as a Mac but has a touch screen.
  if (/mac/i.test(hint)) return maxTouchPoints > 1 ? null : "macos";
  if (/linux|x11/i.test(hint)) return "linux";
  return null;
}

function readBrowserHints() {
  return {
    platform: navigator.userAgentData?.platform,
    userAgent: navigator.userAgent,
    mobile: navigator.userAgentData?.mobile,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

function personalizeCallsToAction(osName) {
  document.querySelectorAll("[data-download-cta]").forEach((label) => {
    label.textContent = CTA_LABELS[label.dataset.downloadCta](osName);
  });
}

export function enhanceDownloadSection() {
  const grid = document.querySelector("[data-platform-grid]");
  const os = detectDesktopOs(readBrowserHints());
  const card = os && grid.querySelector(`[data-platform="${os}"]`);
  document.querySelector("[data-desktop-note]").toggleAttribute("data-visible", !card);
  if (!card) return;
  // Moving the node keeps the visual order and the keyboard order identical.
  card.toggleAttribute("data-recommended", true);
  grid.prepend(card);
  personalizeCallsToAction(card.dataset.osName);
}
