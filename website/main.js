import "@fontsource-variable/hanken-grotesk";
import "@fontsource/big-shoulders-display/800";
import "@fontsource/big-shoulders-display/700";
import "@fontsource/jersey-10/latin-400.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ICON_DATA } from "../src/pixel/icon-data.ts";
import { currentSeason, nextSeasonCheck } from "../src/branding/calendar.ts";

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

gsap.registerPlugin(ScrollTrigger);
document.querySelectorAll("[data-icon]").forEach((element) => {
  const rows = ICON_DATA[element.dataset.icon].g7;
  element.innerHTML = `<svg viewBox="0 0 7 7" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : [])).join("")}</svg>`;
});

const media = gsap.matchMedia();
media.add("(prefers-reduced-motion: no-preference)", () => {
  // Entrance and one parallax scene; the rest of the motion tells the product story.
  gsap.timeline({ defaults: { ease: "power3.out" } })
    .from(".hero-landscape", { scale: 1.14, duration: 1.8 }, 0)
    .from(".title-line > span", { yPercent: 110, duration: 1.15, stagger: .13 }, .15)
    .from(".hero-enter", { y: 18, autoAlpha: 0, duration: .7, stagger: .1 }, .6);
  gsap.to(".hero-content", { y: -65, autoAlpha: 0, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom 28%", scrub: .7 } });
  gsap.to(".hero-landscape", { yPercent: 16, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: .7 } });
  gsap.to(".title-line > span", { x: (index) => index ? 65 : -65, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: .7 } });
  gsap.utils.toArray(".reveal").forEach((element) => {
    gsap.from(element, { y: 40, autoAlpha: 0, duration: .85, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 92%", once: true } });
  });
  gsap.from(".outro-content > *", { y: 45, autoAlpha: 0, duration: 1, stagger: .12, ease: "power3.out", scrollTrigger: { trigger: ".outro", start: "top 65%", once: true } });
});

media.add("(min-width: 900px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)", () => {
  const showcase = document.querySelector(".showcase");
  const shots = gsap.utils.toArray(".product-shot");
  showcase.classList.add("is-pinned");
  gsap.set(shots.slice(1), { autoAlpha: 0, y: 90, rotationX: 7, scale: .96 });
  // Scroll advances through real screens; mobile and reduced motion keep a normal document.
  // CSS sticky reserves the whole scroll distance without switching layout positions mid-scroll.
  const tour = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { id: "product-tour", trigger: showcase.parentElement, start: "top top", end: "bottom bottom", scrub: .65, invalidateOnRefresh: true } });
  tour.from(shots[0], { rotationX: 12, y: 65, scale: .9, duration: .7 }).to({}, { duration: .6 });
  shots.slice(1).forEach((shot, index) => {
    tour.to(shots[index], { y: -50, autoAlpha: 0, scale: .97, duration: .5 })
      .to(shot, { y: 0, rotationX: 0, scale: 1, autoAlpha: 1, duration: .65 }, "<.1")
      .to({}, { duration: index === shots.length - 2 ? .6 : .7 });
  });
  gsap.from(".world-card", { y: 130, rotation: (index) => [4,-3,3][index], autoAlpha: 0, stagger: .15, ease: "power2.out", scrollTrigger: { trigger: ".world-grid", start: "top 90%", end: "top 25%", scrub: .8 } });
  return () => showcase.classList.remove("is-pinned");
});

// Refresh the triggers in document order after sizing the sticky product tour.
ScrollTrigger.sort();
document.fonts.ready.then(() => ScrollTrigger.refresh());
window.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
document.querySelectorAll("details").forEach((item) => item.addEventListener("toggle", () => ScrollTrigger.refresh()));
if (import.meta.hot) import.meta.hot.dispose(() => {
  media.revert();
  clearTimeout(seasonTimer);
  window.removeEventListener("focus", syncSeason);
  document.removeEventListener("visibilitychange", syncSeason);
});
