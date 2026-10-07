import { ICON_DATA } from "../src/pixel/icon-data.ts";

export function renderIcons() {
  document.querySelectorAll("[data-icon]").forEach((element) => {
    const rows = ICON_DATA[element.dataset.icon].g7;
    element.innerHTML = `<svg viewBox="0 0 7 7" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${rows.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : [])).join("")}</svg>`;
  });
}
