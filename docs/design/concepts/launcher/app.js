/* Komplett-Mockup: Stil- und Bildschirmwechsel, Tabs, Overlays, Menüs, Pixel-Szenen und Skin-Figuren.
   Parameter: ?theme=slots|schiefer|sandstein|klassik  ?open=<overlay-id>  ?tab=<gruppe>:<tab>  #home|library|discover|instance|skins|friends|news|settings */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const THEMES = ["slots", "schiefer", "sandstein", "klassik"];

  /* ---------- Stil ---------- */
  function setTheme(id) {
    if (!THEMES.includes(id)) id = "klassik";
    $("#kit").href = `../kit-${id}.css`;
    document.body.className = document.body.className.replace(/\bk-\w+/g, "").trim() + ` k-${id}`;
    $$("[data-theme]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === id)));
    params.set("theme", id);
    history.replaceState(null, "", `?${params}${location.hash}`);
  }

  /* ---------- Bildschirme ---------- */
  const NAV_OF = { instance: "library" };
  function go(name) {
    if (!$(`.screen[data-screen="${name}"]`)) name = "home";
    $$(".screen").forEach((s) => (s.hidden = s.dataset.screen !== name));
    $$(".navbtn[data-go]").forEach((a) => (a.dataset.go === (NAV_OF[name] || name) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $$(".devbar [data-go]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.go === name)));
    closeAll();
    const s = $(`.screen[data-screen="${name}"]`);
    if (s) s.scrollTop = 0;
    if (location.hash !== `#${name}`) history.replaceState(null, "", `?${params}#${name}`);
  }

  /* ---------- Overlays und Menüs ---------- */
  function closeAll() { $$(".overlay:not([hidden]), .pop:not([hidden])").forEach((e) => (e.hidden = true)); $$("[data-menu][aria-expanded=true]").forEach((b) => b.setAttribute("aria-expanded", "false")); }
  function openOverlay(id) { closeAll(); const o = document.getElementById(id); if (o) { o.hidden = false; const f = $("[autofocus]", o) || $("input:not([type=checkbox]):not([type=radio])", o) || $("button", o); f && f.focus({ preventScroll: true }); } }
  function openMenu(trigger) {
    const id = trigger.dataset.menu, m = document.getElementById(id);
    if (!m) return;
    const was = !m.hidden;
    closeAll();
    if (was) return;
    m.hidden = false; trigger.setAttribute("aria-expanded", "true");
    const r = trigger.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight, side = m.dataset.side;
    let x = side === "right" ? r.right + 8 : r.right - w, y = side === "right" ? r.top : r.bottom + 6;
    x = Math.max(8, Math.min(innerWidth - w - 8, x)); y = Math.max(40, Math.min(innerHeight - h - 8, y));
    m.style.left = `${x}px`; m.style.top = `${y}px`;
  }

  /* ---------- Tabs: [data-tabs=gruppe] > [role=tab][data-tab=name]; Flächen: [data-panel-of=gruppe][data-panel=name] ---------- */
  function setTab(group, name) {
    const list = $(`[data-tabs="${group}"]`);
    if (!list) return;
    $$("[role=tab]", list).forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    $$(`[data-panel-of="${group}"]`).forEach((p) => (p.hidden = p.dataset.panel !== name));
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-theme],[data-go],[data-open],[data-close],[data-menu],[role=tab][data-tab],.seg button,[data-toggle-aria]");
    if (!t) { if (!e.target.closest(".pop,.dialog")) closeAll(); return; }
    if (t.dataset.theme) return setTheme(t.dataset.theme);
    if (t.matches("[role=tab][data-tab]")) { const g = t.closest("[data-tabs]")?.dataset.tabs; return g && setTab(g, t.dataset.tab); }
    if (t.dataset.go) { e.preventDefault(); return go(t.dataset.go); }
    if (t.dataset.open) return openOverlay(t.dataset.open);
    if (t.hasAttribute("data-close")) return closeAll();
    if (t.dataset.menu) { e.stopPropagation(); return openMenu(t); }
    if (t.matches(".seg button")) { $$("button", t.parentElement).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return; }
    if (t.dataset.toggleAria) { t.setAttribute(t.dataset.toggleAria, String(t.getAttribute(t.dataset.toggleAria) !== "true")); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openOverlay("ov-palette"); }
    const tab = e.target.closest?.("[role=tab]");
    if (tab && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const tabs = $$("[role=tab]:not(:disabled)", tab.closest("[role=tablist]")), i = tabs.indexOf(tab);
      const n = tabs[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length];
      n.focus(); n.click(); e.preventDefault();
    }
  });
  addEventListener("hashchange", () => go(location.hash.slice(1)));

  /* ---------- Pixel-Szenen (Canvas, 12 fps entfällt: statisch) ---------- */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const BIOMES = {
    dusk: { sky: ["#0B1030", "#1A1A4A", "#43286A", "#9A4668", "#DD7E5A", "#F2B26F"], stars: 1, sun: { x: .68, y: .52, r: .115, c: "#F7E5AA", ring: 1 }, far: "#3A2C58", near: "#241A3C", tree: "#140E26", trees: "pine", ground: "#0D0919", hor: .72 },
    nether: { sky: ["#1A0505", "#3A0A08", "#5E1308", "#8A2410"], far: "#3A0F0C", near: "#2A0A0A", tree: "#1A0505", trees: "none", ground: "#7A1E0A", lava: 1, embers: 1, hor: .74 },
    end: { sky: ["#07040F", "#120A24", "#201240", "#33205E"], stars: 2, far: "#241643", near: "#1A1030", tree: "#0F0820", trees: "none", ground: "#C9C288", island: 1, hor: .8 },
    snow: { sky: ["#41648A", "#6E93B8", "#A4C4DC", "#D6E6F0"], sun: { x: .3, y: .38, r: .07, c: "#FFFBE8" }, far: "#93AECA", near: "#C9DBE8", tree: "#1F4B45", trees: "pine", ground: "#EAF2F8", snowy: 1, hor: .72 },
    cave: { sky: ["#0A0C12", "#12151D", "#1B1F2A", "#262B38"], far: "#1B1F29", near: "#12151C", tree: "#0A0C11", trees: "none", ground: "#0C0E14", drip: 1, hor: .8 },
    coast: { sky: ["#18385A", "#2E6A93", "#5FA3BF", "#F2C58A", "#F7DDA8"], sun: { x: .55, y: .6, r: .085, c: "#FFF3C8" }, far: "#2A6A7A", near: "#1D5262", tree: "#123A46", trees: "none", ground: "#E5CC8C", water: 1, hor: .64 },
    plains: { sky: ["#4C86D0", "#6BA4E0", "#9CC8EE", "#C7E2F6"], sun: { x: .82, y: .2, r: .05, c: "#FFF1A8", square: 1 }, clouds: 1, far: "#5E9F4A", near: "#4F8A3E", tree: "#2F6B2A", trees: "oak", ground: "#3E7A32", hor: .7 },
  };
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
  function drawScene(cv) {
    const B = BIOMES[cv.dataset.scene] || BIOMES.dusk, seed = +(cv.dataset.seed || 7), w = +(cv.dataset.w || 320), h = Math.round(w * (+(cv.dataset.h || 9) / 16));
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d"), R = rng(seed + 31), px = (x, y, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); };
    const hor = Math.round(h * B.hor), n = B.sky.length;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = Math.min(1, y / hor) * (n - 1), i = Math.min(n - 2, Math.floor(t)), f = t - i;
      px(x, y, f > BAYER[(y & 3) * 4 + (x & 3)] / 16 ? B.sky[i + 1] : B.sky[i]);
    }
    if (B.stars) for (let i = 0; i < w * (B.stars === 2 ? .35 : .22); i++) { const y = R() * hor * .7; px(R() * w, y, R() < .2 ? "#fff" : "#9AA6D8"); }
    if (B.clouds) for (let k = 0; k < 5; k++) { const cx = R() * w, cy = h * (.1 + R() * .25), l = 14 + R() * 22; g.fillStyle = "#fff"; g.fillRect(cx, cy, l, 3); g.fillRect(cx + 4, cy - 3, l * .5, 3); g.fillStyle = "#DCEBF8"; g.fillRect(cx, cy + 3, l, 1); }
    if (B.sun) { const s = B.sun, cx = s.x * w, cy = s.y * h, r = s.r * w; for (let y = -r * 1.8; y <= r * 1.8; y++) for (let x = -r * 1.8; x <= r * 1.8; x++) { const d = Math.hypot(x, y); if (s.square ? Math.max(Math.abs(x), Math.abs(y)) < r : d < r) px(cx + x, cy + y, s.c); else if (!s.square && d < r * 1.7 && (d - r) / (r * .7) > BAYER[((cy + y) & 3) * 4 + ((cx + x) & 3)] / 16 ? false : (!s.square && d < r * 1.7 && d >= r && ((x + y) & 1) === 0 && d < r * 1.35)) px(cx + x, cy + y, B.sky[Math.min(n - 1, 4)]); }
      if (s.ring) { g.fillStyle = "#E6A06A"; g.fillRect(cx - r * 1.6, cy + 1, r * 3.2, 2); g.fillStyle = "#C7785A"; g.fillRect(cx - r * 1.3, cy + 5, r * 2.6, 1); } }
    if (B.island) { for (let k = 0; k < 4; k++) { const cx = R() * w, cy = h * (.45 + R() * .2), l = 16 + R() * 28; for (let x = 0; x < l; x++) { const d = Math.abs(x - l / 2) / (l / 2); g.fillStyle = "#C9C288"; g.fillRect(cx + x, cy, 1, 3); g.fillStyle = "#6A6A44"; g.fillRect(cx + x, cy + 3, 1, Math.max(1, (1 - d) * 9)); } } }
    const s1 = R() * 9, s2 = R() * 9, ridge = (x, base, amp, f) => base + amp * (Math.sin(x * f + s1) + .5 * Math.sin(x * f * 2.3 + s2) + .25 * Math.sin(x * f * 5.1));
    for (let x = 0; x < w; x++) { const y = Math.round(ridge(x, hor - h * .05, h * .07, .018)); g.fillStyle = B.far; g.fillRect(x, y, 1, h - y); if (B.snowy) { g.fillStyle = "#fff"; g.fillRect(x, y, 1, 3 + (x % 5 === 0 ? 1 : 0)); } }
    if (B.water) { for (let y = hor; y < h; y++) for (let x = 0; x < w; x++) px(x, y, (y + (x >> 3)) % 4 === 0 ? "#3A86A8" : "#245F7C"); g.fillStyle = "#FFE7A8"; for (let y = hor + 1; y < h - 2; y += 2) g.fillRect(w * .55 - (y - hor) * .3, y, 2 + (y - hor) * .4, 1); }
    const baseY = Math.round(hor + h * .03), nearTop = new Array(w);
    for (let x = 0; x < w; x++) { const y = Math.round(ridge(x, baseY, h * .035, .03)); nearTop[x] = y; g.fillStyle = B.near; g.fillRect(x, y, 1, h - y); }
    const tree = (x, y, t) => { g.fillStyle = B.tree; const k = 5 + R() * 9;
      if (t === "pine") { for (let i = 0; i < k; i++) { const half = Math.floor(i / 2.2) + 1; g.fillRect(x - half, y - k * 1.6 + i * 1.6, half * 2 + 1, 2); } g.fillRect(x, y - 2, 1, 3); if (B.snowy) { g.fillStyle = "#fff"; g.fillRect(x - 1, y - k * 1.6, 3, 1); } }
      else if (t === "oak") { g.fillRect(x, y - 6, 2, 7); g.fillRect(x - 3, y - 11, 8, 5); g.fillStyle = "#3C8A34"; g.fillRect(x - 3, y - 11, 8, 1); } };
    if (B.trees !== "none") for (let x = 4; x < w - 4; x += (B.trees === "oak" ? 9 : 2) + Math.floor(R() * (B.trees === "oak" ? 12 : 3))) if (R() < .75) tree(x, nearTop[x] + 2, B.trees);
    for (let y = Math.round(h * .94); y < h; y++) g.fillStyle = B.ground, g.fillRect(0, y, w, 1);
    if (B.lava) for (let y = Math.round(h * .86); y < h; y++) for (let x = 0; x < w; x++) px(x, y, ((x >> 2) + y) % 5 === 0 ? "#FFB347" : ((x >> 1) + y) % 3 === 0 ? "#E0561A" : B.ground);
    if (B.embers) for (let i = 0; i < 40; i++) px(R() * w, R() * hor, R() < .5 ? "#FF9A3C" : "#FFD27A");
    if (B.drip) for (let i = 0; i < w / 6; i++) { const x = (R() * w) | 0, l = 3 + R() * h * .22; g.fillStyle = "#06070B"; g.fillRect(x, 0, 3, l); g.fillRect(x + 1, l, 1, 2); }
  }

  /* ---------- Skin-Figuren: data-skin="haar|haut|oberteil|hose" (+ data-slim); data-head="haar|haut" ---------- */
  function shade(c, k) { return "#" + hex(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0")).join(""); }
  function drawSkin(cv) {
    const [hair, skin, top, pants] = cv.dataset.skin.split("|"), slim = cv.hasAttribute("data-slim"), aw = slim ? 3 : 4;
    cv.width = 16; cv.height = 32; const g = cv.getContext("2d"), r = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    r(4, 0, 8, 8, skin); r(4, 0, 8, 2, hair); r(4, 2, 1, 3, hair); r(11, 2, 1, 3, hair); r(5, 4, 2, 1, "#fff"); r(9, 4, 2, 1, "#fff"); r(6, 4, 1, 1, "#3B4DAA"); r(9, 4, 1, 1, "#3B4DAA"); r(6, 6, 4, 1, shade(skin, .78));
    r(4, 8, 8, 12, top); r(11, 8, 1, 12, shade(top, .8)); r(4, 8, 8, 1, shade(top, 1.15));
    r(4 - aw, 8, aw, 12, top); r(12, 8, aw, 12, shade(top, .88)); r(4 - aw, 16, aw, 4, skin); r(12, 16, aw, 4, shade(skin, .9));
    r(4, 20, 4, 12, pants); r(8, 20, 4, 12, shade(pants, .85)); r(4, 29, 4, 3, "#2A2A33"); r(8, 29, 4, 3, "#23232B");
  }
  function drawHead(cv) { const [hair, skin] = cv.dataset.head.split("|"); cv.width = 8; cv.height = 8; const g = cv.getContext("2d"); g.fillStyle = skin; g.fillRect(0, 0, 8, 8); g.fillStyle = hair; g.fillRect(0, 0, 8, 2); g.fillRect(0, 2, 1, 2); g.fillRect(7, 2, 1, 2); g.fillStyle = "#fff"; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1); g.fillStyle = "#3B4DAA"; g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1); g.fillStyle = shade(skin, .75); g.fillRect(3, 6, 2, 1); }

  /* ---------- Start ---------- */
  $$("canvas[data-scene]").forEach(drawScene);
  $$("canvas[data-skin]").forEach(drawSkin);
  $$("canvas[data-head]").forEach(drawHead);
  setTheme(params.get("theme") || "klassik");
  go(location.hash.slice(1) || "home");
  if (params.get("tab")) { const [g, n] = params.get("tab").split(":"); setTab(g, n); }
  if (params.get("open")) openOverlay(params.get("open"));
  if (params.get("menu")) { const t = $(`[data-menu="${params.get("menu")}"]`); t && openMenu(t); }
})();
