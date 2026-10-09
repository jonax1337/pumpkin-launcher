import { iconShape, ICON_CELLS, isIconName } from "../src/pixel/icon-data.ts";

export function renderIcons() {
  document.querySelectorAll("[data-icon]").forEach((element) => {
    const name = element.dataset.icon;
    if (!isIconName(name)) return;
    const { solid, dim } = iconShape(name);
    element.innerHTML = `<svg viewBox="0 0 ${ICON_CELLS} ${ICON_CELLS}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="${solid}"/>${dim ? `<path d="${dim}" opacity=".5"/>` : ""}</svg>`;
  });
}
