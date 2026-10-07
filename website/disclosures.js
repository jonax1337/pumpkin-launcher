import { gsap } from "gsap";

export function enhanceDisclosures(root, onLayoutChange) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const disclosures = [...root.querySelectorAll("details")].map((details) => animateDisclosure(details, reducedMotion, onLayoutChange));
  const finish = () => disclosures.forEach((disclosure) => disclosure.finish());
  window.addEventListener("resize", finish);
  reducedMotion.addEventListener("change", finish);
  return () => {
    window.removeEventListener("resize", finish);
    reducedMotion.removeEventListener("change", finish);
    disclosures.forEach((disclosure) => disclosure.dispose());
  };
}

function animateDisclosure(details, reducedMotion, onLayoutChange) {
  const summary = details.querySelector("summary");
  let animation;
  let expanded;

  function complete() {
    details.open = expanded;
    gsap.set(details, { clearProps: "height,overflow" });
    animation = undefined;
    onLayoutChange();
  }

  function toggle(event) {
    event.preventDefault();
    expanded = animation ? !expanded : !details.open;
    const startHeight = details.getBoundingClientRect().height;
    animation?.kill();
    animation = undefined;
    details.style.height = "auto";
    details.open = expanded;
    const endHeight = details.getBoundingClientRect().height;
    if (reducedMotion.matches) {
      complete();
      return;
    }
    // Keep native content rendered while closing; only this disclosure changes height.
    details.open = true;
    gsap.set(details, { height: startHeight, overflow: "hidden" });
    animation = gsap.to(details, {
      height: endHeight, duration: 0.4, ease: "power3.inOut", onComplete: complete,
    });
  }

  function finish() { animation?.progress(1); }
  summary.addEventListener("click", toggle);
  return {
    finish,
    dispose() {
      summary.removeEventListener("click", toggle);
      finish();
    },
  };
}
