import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { enhanceDisclosures } from "./disclosures.js";

gsap.registerPlugin(ScrollTrigger);

export function enhanceMotion() {
  const main = document.querySelector("main");
  const media = gsap.matchMedia();
  const revealed = new WeakSet();
  let introPlayed = window.scrollY > 0;
  let refreshFrame = 0;
  let disposed = false;

  media.add({
    desktop: "(min-width: 1001px) and (hover: hover) and (pointer: fine)",
    reducedMotion: "(prefers-reduced-motion: reduce)",
    motion: "(prefers-reduced-motion: no-preference)",
  }, ({ conditions }) => {
    if (conditions.reducedMotion) {
      introPlayed = true;
      return;
    }
    const desktop = conditions.desktop && !ScrollTrigger.isTouch;
    const cleanups = [];
    if (!introPlayed) {
      introPlayed = true;
      cleanups.push(playEntrance(main));
    }
    revealSections(main, desktop ? 64 : 36, revealed);
    animateWorlds(main, desktop, revealed);
    animateFinale(main, revealed);
    if (desktop) {
      addLandscapeDepth(main);
      cleanups.push(addCardTilt(main));
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, main);

  function scheduleRefresh() {
    if (disposed || refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      ScrollTrigger.refresh();
    });
  }

  function refreshDetails(event) {
    if (event.target.matches("details")) scheduleRefresh();
  }

  // Toggle does not bubble; font metrics and disclosures can move later triggers.
  main.addEventListener("toggle", refreshDetails, true);
  document.fonts.ready.then(scheduleRefresh);
  const disposeDisclosures = enhanceDisclosures(main, scheduleRefresh);

  return () => {
    disposed = true;
    cancelAnimationFrame(refreshFrame);
    main.removeEventListener("toggle", refreshDetails, true);
    disposeDisclosures();
    media.revert();
  };
}

function playEntrance(main) {
  const intro = gsap.timeline({ defaults: { ease: "power3.out", clearProps: "transform,opacity" }, onComplete: removeListeners });
  intro
    .from(document.querySelectorAll(".site-header > *"), { opacity: 0, duration: 0.6, stagger: 0.06 }, 0)
    .from(main.querySelector(".hero-landscape img"), { scale: 1.28, duration: 1.8 }, 0)
    .from(main.querySelectorAll(".title-line > span"), { yPercent: 112, rotation: 3, duration: 1.1, stagger: 0.16, ease: "power4.out" }, 0.15)
    .from(main.querySelector(".hero-content .eyebrow"), { x: -28, opacity: 0, duration: 0.7 }, 0.2)
    .from(main.querySelector(".hero-description"), { y: 28, opacity: 0, duration: 0.8 }, 0.4)
    .from(main.querySelector(".hero-actions"), { opacity: 0.35, duration: 0.7 }, 0.5)
    .from(main.querySelectorAll(".hero-bottom > *"), { y: 18, opacity: 0, duration: 0.65, stagger: 0.06 }, 0.65);

  // Navigation never waits for the entrance, including an immediate keyboard jump.
  function finishEntrance() { intro.progress(1); }
  function removeListeners() {
    document.removeEventListener("focusin", finishEntrance);
    document.removeEventListener("pointerdown", finishEntrance);
    window.removeEventListener("wheel", finishEntrance);
  }
  document.addEventListener("focusin", finishEntrance, { once: true });
  document.addEventListener("pointerdown", finishEntrance, { once: true });
  window.addEventListener("wheel", finishEntrance, { once: true, passive: true });
  return removeListeners;
}

function revealSections(main, distance, revealed) {
  const groups = [
    [".worlds > .wrap:first-child", "h2, .section-description"],
    [".details-heading", "h2"],
    [".feature-list article", "[data-icon], h3, p"],
    [".download-head", ".eyebrow, h2, .section-description"],
    [".platform-card", "h3, .platform-req"],
    [".faq-heading", ".eyebrow, h2"],
  ];
  for (const [containerSelector, contentSelector] of groups) {
    for (const container of main.querySelectorAll(containerSelector)) {
      if (!shouldReveal(container, revealed)) continue;
      gsap.from(container.querySelectorAll(contentSelector), {
        y: distance, opacity: 0, duration: 1, stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: entranceTrigger(container, revealed),
      });
    }
  }
}

function shouldReveal(container, revealed) {
  if (revealed.has(container)) return false;
  // A restored scroll position or media-query change must not hide visible content.
  if (container.getBoundingClientRect().top < window.innerHeight) {
    revealed.add(container);
    return false;
  }
  return true;
}

function entranceTrigger(container, revealed) {
  return {
    trigger: container, start: "clamp(top 92%)", end: "clamp(bottom top)",
    once: true, toggleActions: "play complete complete complete", fastScrollEnd: true,
    onEnter: () => revealed.add(container),
  };
}

function animateWorlds(main, desktop, revealed) {
  const cards = main.querySelectorAll(".world-card");
  if (desktop) {
    if ([...cards].some((card) => !shouldReveal(card, revealed))) {
      cards.forEach((card) => revealed.add(card));
      return;
    }
    gsap.from(cards, {
      y: 180, x: (index) => (index - 1) * 70,
      rotation: (index) => [7, -5, -7][index], scale: 0.86, opacity: 0.25,
      stagger: 0.16, ease: "power2.out",
      scrollTrigger: {
        trigger: main.querySelector(".world-grid"), start: "top 95%", end: "top 30%", scrub: 0.8,
        onEnter: () => cards.forEach((card) => revealed.add(card)),
      },
    });
    return;
  }
  cards.forEach((card, index) => {
    if (!shouldReveal(card, revealed)) return;
    gsap.from(card, {
      y: 70, rotation: index % 2 ? 2 : -2, scale: 0.94, opacity: 0,
      duration: 1, ease: "power3.out",
      scrollTrigger: entranceTrigger(card, revealed),
    });
  });
}

function animateFinale(main, revealed) {
  const outro = main.querySelector(".outro");
  if (!shouldReveal(outro, revealed)) return;
  gsap.timeline({
    defaults: { ease: "power3.out" },
    scrollTrigger: entranceTrigger(outro, revealed),
  })
    .from(outro.querySelector(".outro-buddy"), { y: 70, scale: 0.35, rotation: -25, opacity: 0, duration: 1.1, ease: "back.out(1.6)" }, 0)
    .from(outro.querySelector("h2"), { y: 80, scale: 0.92, opacity: 0, duration: 1.1 }, 0.12)
    .from(outro.querySelector("h2 .copper"), { scale: 1.25, rotation: 3, duration: 1.2 }, 0.2)
    .from(outro.querySelector("p"), { y: 28, opacity: 0, duration: 0.8 }, 0.45);
}

function addLandscapeDepth(main) {
  const hero = main.querySelector(".hero");
  const heroScroll = { trigger: hero, start: "clamp(top top)", end: "bottom top", scrub: 0.9 };
  gsap.fromTo(hero.querySelector(".hero-landscape"), { yPercent: 0, scale: 1.1 }, {
    yPercent: 8, scale: 1.22, ease: "none", scrollTrigger: heroScroll,
  });
  gsap.to(hero.querySelectorAll(".title-line"), {
    x: (index) => index ? 85 : -85, y: -55, ease: "none", scrollTrigger: { ...heroScroll },
  });
  addImageParallax(main.querySelector(".world-grid"), main.querySelectorAll(".world-card > img"));
  const outro = main.querySelector(".outro");
  gsap.fromTo(outro.querySelector(".outro-landscape"), { scale: 1.4, yPercent: -8 }, {
    scale: 1.22, yPercent: 8, ease: "none",
    scrollTrigger: { trigger: outro, start: "clamp(top bottom)", end: "clamp(bottom top)", scrub: 1 },
  });
}

function addImageParallax(container, image) {
  gsap.fromTo(image, { yPercent: -8, scale: 1.22 }, {
    yPercent: 8, scale: 1.22, ease: "none",
    scrollTrigger: { trigger: container, start: "clamp(top bottom)", end: "clamp(bottom top)", scrub: 0.8 },
  });
}

function addCardTilt(main) {
  const cleanups = [...main.querySelectorAll(".world-card")].map((card) => {
    gsap.set(card, { transformPerspective: 1000 });
    const tiltX = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power3.out" });
    const tiltY = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power3.out" });
    const lift = gsap.quickTo(card, "z", { duration: 0.5, ease: "power3.out" });
    let bounds;
    function enter() { bounds = card.getBoundingClientRect(); }
    function move(event) {
      if (!bounds) return;
      const x = gsap.utils.clamp(-0.5, 0.5, (event.clientX - bounds.left) / bounds.width - 0.5);
      const y = gsap.utils.clamp(-0.5, 0.5, (event.clientY - bounds.top) / bounds.height - 0.5);
      tiltX(-y * 12);
      tiltY(x * 14);
      lift(18);
    }
    function leave() { tiltX(0); tiltY(0); lift(0); }
    card.addEventListener("pointerenter", enter);
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerleave", leave);
    return () => {
      card.removeEventListener("pointerenter", enter);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerleave", leave);
    };
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}
