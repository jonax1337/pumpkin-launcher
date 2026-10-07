export function enhanceNavigation() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", navigateToSection);
  });
  const backToTop = document.querySelector(".back-to-top");
  const marker = document.querySelector(".top-marker");
  const observer = new IntersectionObserver(([entry]) => {
    backToTop.hidden = entry.isIntersecting;
  }, { rootMargin: "360px 0px 0px" });
  observer.observe(marker);
  if (document.body.classList.contains("marketing")) {
    const header = document.querySelector(".site-header");
    header.toggleAttribute("data-overlay", window.scrollY <= 40);
    const headerObserver = new IntersectionObserver(([entry]) => {
      header.toggleAttribute("data-overlay", entry.isIntersecting);
    }, { rootMargin: "40px 0px 0px" });
    headerObserver.observe(marker);
  }
}

function navigateToSection(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.currentTarget;
  if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;

  event.preventDefault();
  // Preserve the keyboard reading position as native fragment navigation would.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  if (target.id === "top") window.scrollTo({ top: 0, behavior });
  else target.scrollIntoView({ block: "start", behavior });
}
