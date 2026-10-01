// "One Take" — the whole film is one continuous camera move through a single
// pixel world, following Buddy. Static art is drawn once; everything that
// moves is derived from timeline time, either by GSAP tweens or by render(t).
(function () {
  const P = window.PIX;
  const root = document.querySelector("[data-composition-id]");
  const W = Number(root.dataset.width), H = Number(root.dataset.height);
  const V = H > W;
  if (V) root.classList.add("v");
  const DUR = Number(root.dataset.duration);
  const U = 2; // world units per art pixel

  const el = (tag, cls, parent, css) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) for (const k in css) k.startsWith("--") ? e.style.setProperty(k, css[k]) : (e.style[k] = css[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, f) => a + (b - a) * f;
  const smooth = (u) => u * u * (3 - 2 * u);
  const outCubic = (u) => 1 - Math.pow(1 - u, 3);
  const outBack = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ layout
  const POS = V
    ? { hub: [1200, 1000], modrinth: [930, 230], curse: [1470, 590], ftb: [1470, 1420], technic: [930, 1780] }
    : { hub: [1200, 780], modrinth: [560, 420], curse: [1850, 400], ftb: [1850, 1160], technic: [560, 1150] };
  const [mx, my] = POS.modrinth, [cx, cy] = POS.curse, [fx, fy] = POS.ftb, [tx, ty] = POS.technic, [hx, hy] = POS.hub;
  const NEST = V ? [mx - 60, my - 430] : [mx - 190, my - 380];
  // where Buddy hovers at each island: right of it (landscape) / below it (portrait)
  const HOV = (p) => (V ? [p[0] + 70, p[1] + 250] : [p[0] + 232, p[1] - 96]);

  const SOURCES = [
    { id: "modrinth", name: "Modrinth", col: "#1bd96a", biome: "forest", seed: 11, fx: "firefly", fall: ["#7fd4ff", "#c8f0ff", "#46a6e6"],
      sub: "Mods · Modpacks · Shader · Ressourcenpakete",
      items: [["mod"], ["pack", "wood"], ["shader"], ["res"]],
      deco: [
        { t: "oak", x: 24, r: 6 }, { t: "pine", x: 40, h: 22 }, { t: "tuft", x: 56, flower: "#ff8ad0" }, { t: "tuft", x: 66 },
        { t: "tuft", x: 78, flower: "#ffe066" }, { t: "oak", x: 96, r: 7 }, { t: "pine", x: 110, h: 17 }, { t: "tuft", x: 86 },
      ] },
    { id: "curse", name: "CurseForge", col: "#f16436", biome: "nether", seed: 23, fx: "ember", fall: ["#ffb03a", "#ffe07a", "#e0582a"],
      sub: "Mods · Modpacks · Shader · Ressourcenpakete",
      items: [["mod"], ["pack", "ember"], ["shader"], ["res"]],
      deco: [
        { t: "fungus", x: 28, h: 12 }, { t: "glow", x: 44 }, { t: "tuft", x: 58, col: "#ff6a4a" }, { t: "fungus", x: 72, h: 8, cap: ["#ff9a3a", "#c2552a", "#ffd08a"] },
        { t: "rock", x: 84, c: "#9e3a3a", hi: "#d9523a", e: "#5e1f25" }, { t: "fungus", x: 100, h: 14 }, { t: "glow", x: 110 },
      ] },
    { id: "ftb", name: "Feed The Beast", col: "#c4a6ff", biome: "end", seed: 37, fx: "end",
      sub: "Modpacks",
      items: [["pack", "violet"], ["pack", "ember"], ["pack", "violet"], ["pack", "wood"]],
      deco: [
        { t: "crystal", x: 26, h: 13 }, { t: "crystal", x: 33, h: 8 }, { t: "chorus", x: 58 }, { t: "rock", x: 76, c: "#d8d099", hi: "#f3eebd", e: "#aea56d" },
        { t: "crystal", x: 96, h: 16 }, { t: "crystal", x: 103, h: 9 }, { t: "chorus", x: 114 },
      ] },
    { id: "technic", name: "Technic", col: "#7cd0ff", biome: "snow", seed: 41, fx: "snow",
      sub: "Modpacks",
      items: [["pack", "ice"], ["pack", "wood"], ["pack", "ice"], ["pack", "ember"]],
      deco: [
        { t: "pine", x: 24, h: 24, snow: true }, { t: "pine", x: 38, h: 16, snow: true }, { t: "rock", x: 60, c: "#b8c8e4", hi: "#ffffff", e: "#7f8fb0" },
        { t: "pine", x: 96, h: 26, snow: true }, { t: "pine", x: 110, h: 15, snow: true }, { t: "tuft", x: 76, col: "#e6eefb" },
      ] },
  ];

  // ------------------------------------------------------------------ stage
  const stage = el("div", "layer", root);
  const skyC = P.canvas(Math.ceil(W / 8), Math.ceil(H / 8));
  skyC.c.id = "sky";
  stage.appendChild(skyC.c);
  const farL = el("div", "cam", stage);
  const world = el("div", "cam", stage);
  const fgL = el("div", "cam", stage);
  const fxC = P.canvas(Math.ceil(W / 4), Math.ceil(H / 4)); // speed lines, fireworks, confetti
  Object.assign(fxC.c.style, { position: "absolute", left: "0px", top: "0px", width: W + "px", height: H + "px" });
  root.appendChild(fxC.c);
  const vign = el("div", "vignette", root);
  const hud = el("div", "hud", root);
  const flash = el("div", "flash", root);

  // clouds (parallax layers) — moonlit, never clipped
  const clouds = [];
  const cr = P.rng(99);
  for (let i = 0; i < (V ? 16 : 18); i++) {
    const w = 40 + Math.floor(cr() * 44);
    const h = Math.round(w * (0.34 + cr() * 0.1));
    const c = P.cloud(w, h, 500 + i * 7, ["#8f9cf2", "#4d58a8", "#3a4288"]);
    c.className = "cloud";
    c.style.width = w * 4 + "px";
    c.style.height = h * 4 + "px";
    c.style.opacity = 0.62;
    farL.appendChild(c);
    const x0 = V ? 700 : 300, x1 = V ? 1700 : 2100, y1 = V ? 2100 : 1500;
    clouds.push({ c, x: lerp(x0, x1, cr()) * 0.45, y: lerp(-700, y1, cr()) * 0.45, drift: 3 + cr() * 6 });
  }
  const fgClouds = [];
  const fgSpots = V
    ? [[1180, 420], [1520, 1010], [1180, 1620], [800, -200], [1650, 250]]
    : [[1210, 330], [1950, 780], [1200, 1300], [420, 780], [300, -120]];
  fgSpots.forEach(([x, y], i) => {
    const w = 64 + i * 8, h = Math.round(w * 0.36);
    const c = P.cloud(w, h, 900 + i * 13, ["#e4e9ff", "#aab4f4", "#8590dc"]);
    c.className = "cloud";
    c.style.width = w * 6 + "px";
    c.style.height = h * 6 + "px";
    fgL.appendChild(c);
    fgClouds.push({ c, x: x * 1.45 - w * 3, y: y * 1.45 - h * 3, drift: 10 + i * 3 });
  });

  // ------------------------------------------------------------------ islands
  const islands = [];
  const makeIsland = (src, pos, opt) => {
    const art = P.island({ w: opt.w, h: opt.h, top: opt.top, depth: opt.depth, biome: src.biome, seed: src.seed, vines: opt.vines, deco: src.deco });
    const node = el("div", "isl", world, { left: pos[0] - opt.w + "px", top: pos[1] - opt.top * U + "px", width: opt.w * U + "px", height: opt.h * U + "px" });
    art.canvas.style.width = opt.w * U + "px";
    art.canvas.style.height = opt.h * U + "px";
    node.appendChild(art.canvas);
    const isl = { node, pos, art, phase: src.seed * 0.37, src, bob: 0 };
    islands.push(isl);
    return isl;
  };
  SOURCES.forEach((s, k) => {
    const isl = makeIsland(s, POS[s.id], { w: 130, h: 110, top: 26, depth: 52, vines: 7 });
    const lab = el("div", "isl-label", isl.node, { left: 130 - 300 + "px", top: 26 * U - 196 + "px", "--c": s.col });
    const nm = el("div", "isl-name", lab);
    s.name.split("").forEach((ch) => { el("span", "", nm).textContent = ch === " " ? " " : ch; });
    const sub = el("div", "isl-sub", lab);
    sub.textContent = s.sub.toUpperCase();
    isl.label = { nm, sub };
    isl.T = 4 + 4 * k;
    // waterfall / lavafall over the front face
    if (s.fall) {
      const fc = P.canvas(5, 64);
      Object.assign(fc.c.style, { position: "absolute", left: 104 * U + "px", top: (isl.art.surface(104) - 1) * U + "px", width: 5 * U + "px", height: 64 * U + "px" });
      isl.node.appendChild(fc.c);
      isl.fall = { ctx: fc.ctx, cols: s.fall, last: -1 };
    }
    // ambient particles
    const pr = P.rng(s.seed * 17);
    isl.parts = [];
    for (let i = 0; i < 16; i++) {
      const d = el("div", "pt", world, { position: "absolute", left: "0px", top: "0px", width: (s.fx === "snow" ? 3 : 4) + "px", height: (s.fx === "snow" ? 3 : 4) + "px" });
      isl.parts.push({ d, a: pr(), b: pr(), c: pr() });
    }
  });
  const hubSrc = {
    biome: "hub", seed: 77,
    deco: [
      { t: "lantern", x: 16 }, { t: "pumpkin", x: 30, r: 3 }, { t: "tuft", x: 40 }, { t: "pumpkin", x: 46, r: 2 }, { t: "tuft", x: 62, flower: "#f8bd72" },
      { t: "tuft", x: 104 }, { t: "pumpkin", x: 122, r: 2 }, { t: "pumpkin", x: 136, r: 3 }, { t: "tuft", x: 146, flower: "#ffe066" }, { t: "lantern", x: 156 },
    ],
  };
  const hub = makeIsland(hubSrc, POS.hub, { w: 172, h: 124, top: 30, depth: 62, vines: 10 });
  const nest = makeIsland({ biome: "hub", seed: 5, deco: [{ t: "tuft", x: 8 }, { t: "lantern", x: 36 }] }, [NEST[0], NEST[1] + 22], { w: 44, h: 40, top: 12, depth: 20, vines: 3 });
  nest.phase = 0.4;
  const HUBC = [hx, hy - 22]; // Buddy sitting on the hub

  // hub glow + shockwave rings
  const glowArt = P.canvas(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot(x - 31.5, y - 31.5) / 32;
      if (d <= 1 && P.bayer(x, y) < Math.pow(1 - d, 1.6)) {
        glowArt.ctx.fillStyle = d < 0.35 ? "#ffe2a8" : "#ff9f5a";
        glowArt.ctx.fillRect(x, y, 1, 1);
      }
    }
  const glow = el("div", "glowc", world, { left: HUBC[0] - 200 + "px", top: HUBC[1] - 200 + "px", width: "400px", height: "400px" });
  glowArt.c.style.width = "400px";
  glowArt.c.style.height = "400px";
  glow.appendChild(glowArt.c);
  const ring = P.canvas(160, 160);
  const ringNode = el("div", "ring", world, { left: HUBC[0] - 800 + "px", top: HUBC[1] - 800 + "px", width: "1600px", height: "1600px" });
  ring.c.style.width = "1600px";
  ring.c.style.height = "1600px";
  ringNode.appendChild(ring.c);

  // ------------------------------------------------------------------ Buddy's flight
  const K2 = (t, p, hold) => ({ t, x: p[0], y: p[1], hold });
  const add2 = (p, d) => [p[0] + d[0], p[1] + d[1]];
  const mid = (a, b, d) => [(a[0] + b[0]) / 2 + d[0], (a[1] + b[1]) / 2 + d[1]];
  const Hs = [POS.modrinth, POS.curse, POS.ftb, POS.technic].map(HOV);
  const bKeys = V
    ? [
        K2(0, NEST, true), K2(3.3, NEST, true), K2(3.62, mid(NEST, Hs[0], [140, -40])), K2(3.95, Hs[0]),
        K2(6.75, add2(Hs[0], [26, 8])), K2(7.35, mid(Hs[0], Hs[1], [-60, 60])), K2(7.92, Hs[1]),
        K2(10.75, add2(Hs[1], [26, 8])), K2(11.35, mid(Hs[1], Hs[2], [150, 0])), K2(11.92, Hs[2]),
        K2(14.75, add2(Hs[2], [-26, 8])), K2(15.35, mid(Hs[2], Hs[3], [-60, 40])), K2(15.92, Hs[3]),
        K2(18.75, add2(Hs[3], [-20, 8])), K2(19.6, add2(Hs[3], [140, -220])), K2(21.2, [hx - 300, hy + 260]),
        K2(22.3, [hx + 300, hy + 200]), K2(23.3, [hx, hy - 240]), K2(23.5, [hx, hy - 252], true),
      ]
    : [
        K2(0, NEST, true), K2(3.3, NEST, true), K2(3.62, mid(NEST, Hs[0], [0, -40])), K2(3.95, Hs[0]),
        K2(6.75, add2(Hs[0], [22, -8])), K2(7.35, mid(Hs[0], Hs[1], [0, -150])), K2(7.92, Hs[1]),
        K2(10.75, add2(Hs[1], [22, -8])), K2(11.35, mid(Hs[1], Hs[2], [120, 0])), K2(11.92, Hs[2]),
        K2(14.75, add2(Hs[2], [-22, -8])), K2(15.35, mid(Hs[2], Hs[3], [0, 120])), K2(15.92, Hs[3]),
        K2(18.75, add2(Hs[3], [-16, -8])), K2(19.6, add2(Hs[3], [180, -220])), K2(21.2, [hx - 470, hy - 170]),
        K2(22.3, [hx + 430, hy - 120]), K2(23.3, [hx, hy - 250]), K2(23.5, [hx, hy - 262], true),
      ];

  // Monotone cubic (PCHIP) per channel: C1-smooth, never overshoots a key.
  const pchip = (keys, chans) => {
    const TAN = {};
    chans.forEach((c) => {
      const n = keys.length, m = new Array(n).fill(0);
      const h = (k) => keys[k + 1].t - keys[k].t;
      const d = (k) => (keys[k + 1][c] - keys[k][c]) / h(k);
      for (let k = 1; k < n - 1; k++) {
        if (keys[k].hold) continue;
        const d0 = d(k - 1), d1 = d(k);
        if (d0 * d1 <= 0) continue;
        const w1 = 2 * h(k) + h(k - 1), w2 = h(k) + 2 * h(k - 1);
        m[k] = (w1 + w2) / (w1 / d0 + w2 / d1);
      }
      TAN[c] = m;
    });
    return (t, c) => {
      const n = keys.length;
      if (t <= keys[0].t) return keys[0][c];
      if (t >= keys[n - 1].t) return keys[n - 1][c];
      let i = 0;
      while (keys[i + 1].t <= t) i++;
      const k1 = keys[i], k2 = keys[i + 1];
      const h = k2.t - k1.t, s = (t - k1.t) / h;
      const m1 = TAN[c][i] * h, m2 = TAN[c][i + 1] * h;
      const s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * k1[c] + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * k2[c] + (s3 - s2) * m2;
    };
  };
  const bSpline = pchip(bKeys, ["x", "y"]);

  // ------------------------------------------------------------------ launcher window
  const WS = 0.28;
  const WX = hx - 800 * WS, WY = HUBC[1] - 450 * WS;
  const winPos = el("div", "win-pos", world, { left: WX + "px", top: WY + "px", transform: `scale(${WS})`, zIndex: 3 });
  const winGlow = el("div", "win-glow", winPos);
  const win = el("div", "win", winPos);
  const body = el("div", "win-body", win);
  const winFrame = el("div", "win-frame", win);
  const winPt = (u, v) => [WX + u * WS, WY + v * WS];

  const glyph = (rows, pal, px) => {
    const h = rows.length, w = rows[0].length;
    const { c, ctx } = P.canvas(w, h);
    rows.forEach((r, y) => { for (let x = 0; x < w; x++) if (r[x] !== "." && pal[r[x]]) { ctx.fillStyle = pal[r[x]]; ctx.fillRect(x, y, 1, 1); } });
    if (px) { c.style.width = w * px + "px"; c.style.height = h * px + "px"; }
    return c;
  };
  const GL = { a: "#a9b4c8", c: "#e39860" };
  const ICON = {
    home: ["....a....", "...aaa...", "..aaaaa..", ".aaaaaaa.", "aaaaaaaaa", ".aa...aa.", ".aa.a.aa.", ".aa.a.aa.", ".aaaaaaa."],
    lib: ["aaaaaaaaa", "a.......a", "aaaaaaaaa", "a.......a", "a..aaa..a", "a.......a", "a.......a", "a.......a", "aaaaaaaaa"],
    find: ["..cccc...", ".c....c..", "c......c.", "c......c.", "c......c.", ".c....c..", "..ccccc..", "......cc.", ".......cc"],
    gear: ["...a.a...", ".aaaaaaa.", ".aa...aa.", "aa.....aa", ".a..a..a.", "aa.....aa", ".aa...aa.", ".aaaaaaa.", "...a.a..."],
  };
  const tb = el("div", "tb", body);
  el("img", "px", tb).src = "assets/img/mark.svg";
  el("div", "brand", tb).textContent = "PUMPKIN LAUNCHER";
  const acct = el("div", "acct", tb);
  acct.appendChild(glyph(["kkkkkkkk", "kbbbbbbk", "ksssssbk", "kswsswsk", "kssssssk", "kssrrssk", "kssssssk", "kkkkkkkk"],
    { k: "#2b1c14", b: "#4a2f1e", s: "#c89272", w: "#ffffff", r: "#8a4a3a" }));
  el("span", "", acct).textContent = "Pixelpilot";
  const sb = el("div", "sb", body);
  [["home", 40], ["lib", 116], ["find", 192], ["gear", 752]].forEach(([k, y]) => {
    el("div", "ic" + (k === "find" ? " on" : ""), sb, { top: y + "px" }).appendChild(glyph(ICON[k], GL));
  });

  const sceneBox = el("div", "scene", body);
  const SL = P.duskScene(400, 225, 1337);
  const sceneLayers = [];
  [["sky", 0.12], ["sun", 0.25], ["far", 0.45], ["mid", 0.72], ["near", 1.05], ["front", 1.6]].forEach(([k, depth]) => {
    sceneBox.appendChild(SL[k]);
    sceneLayers.push({ c: SL[k], depth, k });
  });
  const sceneShade = el("div", "scene-shade", sceneBox);

  const pagewrap = el("div", "pagewrap", body);
  const disc = el("div", "page", pagewrap, { background: "#070a11" });
  const inst = el("div", "page", pagewrap);

  el("div", "h-page", disc, { left: "46px", top: "48px" }).textContent = "Entdecken";
  const tabs = el("div", "tabs", disc, { right: "46px", top: "56px" });
  ["Modpacks", "Mods", "Shader", "Ressourcenpakete"].forEach((t, i) => (el("div", "tab" + (i ? "" : " on"), tabs).textContent = t));
  const f1 = el("div", "field", disc, { left: "46px", top: "170px", width: "470px" });
  f1.appendChild(glyph(ICON.find, { c: "#a9b4c8" }, 3));
  el("span", "", f1).textContent = "In Modpacks suchen";
  const f2 = el("div", "field", disc, { left: "540px", top: "170px", width: "360px" });
  el("span", "", f2).textContent = "Quelle";
  const selVal = el("span", "sel-val", f2);
  const selSpans = ["Modrinth", "CurseForge", "FTB", "Technic"].map((n) => { const s = el("span", "", selVal); s.textContent = n; return s; });
  el("span", "chev", f2).textContent = "v";
  const f3 = el("div", "field", disc, { left: "924px", top: "170px", width: "220px" });
  el("span", "", f3).textContent = "Version";
  el("b", "", f3).textContent = "Alle";
  el("span", "chev", f3).textContent = "v";
  const f4 = el("div", "field", disc, { left: "1168px", top: "170px", width: "220px" });
  el("span", "", f4).textContent = "Loader";
  el("b", "", f4).textContent = "Alle";
  el("span", "chev", f4).textContent = "v";
  el("div", "sect", disc, { left: "46px", top: "272px" }).textContent = "BELIEBT";
  const rowsBox = el("div", "rows", disc);
  const CATALOG = [
    ["Modrinth", "#1bd96a", [["Fabulously Optimized", "robotkoer", "wood"], ["Cobblemon Official Modpack", "CobbledStudios", "ember"], ["Better MC [FABRIC] BMC2", "SHXRKIE", "violet"]]],
    ["CurseForge", "#f16436", [["All the Mods 10", "ATMTeam", "ember"], ["RLCraft", "Shivaxi", "wood"], ["SkyFactory 4", "Bacon_Donut", "ice"]]],
    ["FTB", "#c4a6ff", [["FTB StoneBlock 4", "FTB Team", "violet"], ["FTB Skies 2", "FTB Team", "ice"], ["FTB Evolution", "FTB Team", "ember"]]],
    ["Technic", "#7cd0ff", [["Tekkit Classic", "TechnicTeam", "ice"], ["Hexxit", "TechnicTeam", "wood"], ["Attack of the B-Team", "TechnicTeam", "violet"]]],
  ];
  const anlegen = (parent, cls, css) => {
    const b = el("div", cls, parent, css);
    el("span", "pl", b).textContent = "+";
    b.appendChild(document.createTextNode("Anlegen"));
    return b;
  };
  const rowSets = CATALOG.map(([src, col, packs]) => {
    const set = el("div", "rowset", rowsBox);
    const rows = packs.map(([name, by, tint], i) => {
      const r = el("div", "row" + (i ? "" : " big"), set, { top: i * 124 + "px" });
      el("div", "ico", r).appendChild(P.iconCanvas("pack", P.PACK_TINTS[tint]));
      const meta = el("div", "meta", r);
      const nm = el("div", "nm", meta);
      nm.textContent = name;
      el("small", "", nm).textContent = "von " + by;
      const chips = el("div", "chips", meta);
      const c1 = el("span", "chip src", chips, { "--c": col });
      el("i", "", c1);
      c1.appendChild(document.createTextNode(src));
      el("span", "chip", chips).textContent = "Modpack";
      anlegen(r, "btn2");
      return r;
    });
    return { set, rows };
  });
  const pressAnlegen = anlegen(rowSets[0].rows[0], "btn2 press", { position: "absolute", right: "22px", top: "26px", opacity: 0 });

  Object.assign(inst.style, { left: "-84px", top: "-60px", width: "1600px", height: "900px" });
  const iWrap = el("div", "inst", inst);
  const back = el("div", "back", iWrap);
  el("b", "", back).textContent = "‹";
  back.appendChild(document.createTextNode("Bibliothek"));
  const iTitle = el("div", "i-title", iWrap);
  iTitle.textContent = "Fabulously Optimized";
  const iSub = el("div", "i-sub", iWrap);
  iSub.appendChild(document.createTextNode("Fabric "));
  el("b", "", iSub).textContent = "1.21.4";
  iSub.appendChild(document.createTextNode("  ·  Modpack von robotkoer"));
  const play = el("div", "play", iWrap);
  el("div", "base", play);
  const face = el("div", "face", play);
  el("div", "pic", face).appendChild(glyph(["cc......", "cccc....", "cccccc..", "cccccccc", "cccccc..", "cccc....", "cc......"], { c: "#e39860" }));
  const lbl = el("div", "lbl", face);
  const state = (big, small, bigCss) => {
    const s = el("div", "st", lbl);
    el("div", "big", s, bigCss).textContent = big;
    if (small) el("div", "small", s).textContent = small;
    return s;
  };
  const st1 = state("Spielen", "Installiert beim ersten Start");
  const st2 = state("Wird installiert", null, { fontSize: "40px" });
  const pct = el("div", "pct", st2);
  const pctNum = el("span", "", pct);
  pctNum.textContent = "0";
  el("span", "", pct).textContent = "%";
  const cells = el("div", "cells", st2);
  const cellFills = [];
  for (let i = 0; i < 12; i++) {
    const c = el("i", "", cells, { position: "relative" });
    cellFills.push(el("i", "f", c, { position: "absolute", left: "0px", top: "0px", width: "13px", height: "16px" }));
  }
  const st3 = state("Startet …", "Viel Spaß!");
  const ldLabel = el("div", "ld-label", iWrap);
  ldLabel.textContent = "LOADER";
  const ldRow = el("div", "ld-row", iWrap);
  const LOADERS = [["Vanilla", "#7fbf5a"], ["Fabric", "#dbc9a0"], ["Forge", "#8a95a8"], ["NeoForge", "#f08a3a"], ["Quilt", "#a57fe0"]];
  const lds = LOADERS.map(([n, c]) => {
    const d = el("div", "ld", ldRow, { "--c": c });
    el("i", "", d);
    d.appendChild(document.createTextNode(n));
    return d;
  });
  const ldOn = el("div", "ld on", iWrap, { position: "absolute", left: 130 + 194 + "px", top: "500px", "--c": "#dbc9a0" });
  el("i", "", ldOn);
  ldOn.appendChild(document.createTextNode("Fabric"));
  const iTabs = el("div", "i-tabs", iWrap);
  ["Inhalte 3", "Protokoll", "Einstellungen"].forEach((t, i) => (el("span", i ? "" : "on", iTabs).textContent = t));
  const iList = el("div", "i-list", iWrap);
  [["mod", "Sodium", "Mod · Leistung"], ["shader", "Iris Shaders", "Mod · Shader"], ["res", "Fresh Animations", "Ressourcenpaket"]].forEach(([k, n, s]) => {
    const r = el("div", "i-row", iList);
    el("div", "ico", r).appendChild(P.iconCanvas(k));
    const m = el("div", "nm", r);
    m.textContent = n;
    el("small", "", m).textContent = s;
    el("div", "tg", r);
  });

  // ------------------------------------------------------------------ path, items, Buddy (above the window)
  const pathPts = [];
  for (let s = 3.4; s <= 23.5; s += 0.055) pathPts.push({ s, x: bSpline(s, "x"), y: bSpline(s, "y") });
  const PB = pathPts.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [1e9, 1e9, -1e9, -1e9]);
  const pathC = P.canvas(Math.ceil((PB[2] - PB[0] + 40) / 4), Math.ceil((PB[3] - PB[1] + 40) / 4));
  const pathNode = el("div", "", world, { position: "absolute", left: PB[0] - 20 + "px", top: PB[1] - 20 + "px", zIndex: 2 });
  Object.assign(pathC.c.style, { width: pathC.c.width * 4 + "px", height: pathC.c.height * 4 + "px" });
  pathNode.appendChild(pathC.c);

  const items = [];
  SOURCES.forEach((s, k) => {
    const isl = islands[k];
    s.items.forEach(([kind, tint], j) => {
      const node = el("div", "item", world, { zIndex: 6 });
      node.appendChild(P.iconCanvas(kind, tint ? P.PACK_TINTS[tint] : null));
      const sparks = [];
      for (let q = 0; q < 6; q++) sparks.push(el("div", "trail", world, { background: q % 2 ? s.col : "#fff6de", zIndex: 6 }));
      items.push({ node, sparks, isl, home: [isl.pos[0] + (j - 1.5) * 56, isl.pos[1] - 76], pop: isl.T + 0.5 + j * 0.5, j, k });
    });
  });
  const SLOT = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
  items.forEach((it) => {
    it.slot = SLOT[it.k * 4 + it.j];
    it.catchT = it.pop + 0.3;
    it.inOrbit = it.catchT + 0.5;
    it.absorbT = Math.max(it.isl.T + 2.72, it.inOrbit + 0.15) + it.j * 0.05;
  });

  const flyer = el("div", "", world, { position: "absolute", left: "0px", top: "0px", width: "96px", height: "96px", transformOrigin: "48px 50px", zIndex: 5 });
  const buddy = P.buddy(["sleep", "oops", "idle", "success", "hello", "loading"]);
  buddy.svg.style.width = "96px";
  buddy.svg.style.height = "96px";
  buddy.svg.style.position = "absolute";
  flyer.appendChild(buddy.svg);
  const wings = [0, 1].map((side) => {
    const box = el("div", "", null, { position: "absolute", left: side ? "68px" : "8px", top: "39px", width: "20px", height: "16px", transform: side ? "scaleX(-1)" : "" });
    flyer.insertBefore(box, buddy.svg);
    return P.wingFrames().map((c) => {
      Object.assign(c.style, { position: "absolute", left: "0px", top: "0px", width: "20px", height: "16px", display: "none" });
      box.appendChild(c);
      return c;
    });
  });
  const bang = el("div", "", flyer, { position: "absolute", left: "70px", top: "-6px", width: "8px", height: "28px", opacity: 0 });
  bang.appendChild(glyph(["ww", "ww", "ww", "ww", "ww", "..", "ww"], { w: "#fff3c0" }, 4));
  const trailDots = [];
  for (let q = 0; q < 10; q++) trailDots.push(el("div", "trail", world, { background: q % 3 === 0 ? "#fff3c0" : "#ffb35a", zIndex: 4 }));

  // ------------------------------------------------------------------ HUD copy
  const hudBlock = (rows, top, lh, size) => {
    const words = [];
    rows.forEach((row, i) => {
      const ln = el("div", "line", hud, { top: top + i * lh + "px" });
      if (size) ln.style.fontSize = size + "px";
      row.forEach(([txt, t, cu], j) => {
        if (j) ln.appendChild(document.createTextNode(" "));
        const w = el("span", "w" + (cu ? " cu" : ""), ln);
        w.textContent = txt;
        words.push({ w, t });
      });
    });
    return words;
  };
  const intro = V
    ? hudBlock([[["Mods.", 0.45]], [["Modpacks.", 0.95]], [["Shader.", 1.45]]], 250, 116)
        .concat(hudBlock([[["Überall", 2.0, 1]], [["verstreut.", 2.15, 1]]], 1380, 116))
    : hudBlock([[["Mods.", 0.45], ["Modpacks.", 0.95], ["Shader.", 1.45]]], 120, 110)
        .concat(hudBlock([[["Überall", 2.0, 1], ["verstreut.", 2.15, 1]]], 850, 110));
  const ask = V
    ? hudBlock([[["Was,", 20.9], ["wenn", 21.1]], [["alles", 21.35]], [["an einem", 21.6]], [["Ort wäre?", 21.85, 1]]], 230, 112)
    : hudBlock([[["Was,", 20.9], ["wenn", 21.1], ["alles", 21.35]], [["an einem", 21.6], ["Ort wäre?", 21.85, 1]]], 80, 108);
  const answer = V
    ? hudBlock([[["Ein", 24.05]], [["Launcher.", 24.2]], [["Alle", 24.5, 1]], [["Quellen.", 24.65, 1]]], 200, 128, 124)
    : hudBlock([[["Ein", 24.05], ["Launcher.", 24.2]], [["Alle", 24.5, 1], ["Quellen.", 24.65, 1]]], 70, 124, 118);

  // ------------------------------------------------------------------ outro lockup
  const outro = el("div", "outro", root);
  const oShade = el("div", "", outro, { position: "absolute", left: "0px", top: "0px", width: "100%", height: "100%",
    background: "linear-gradient(180deg, rgba(7,10,17,0) 42%, rgba(7,10,17,.55) 68%, rgba(7,10,17,.82) 100%)" });
  const lock = el("div", "o-lock", outro);
  const oWord = el("div", "o-word", lock);
  el("img", "", oWord).src = "assets/img/wordmark-light.svg";
  const oTag = el("div", "o-tag", lock);
  const tag1 = el("span", "", oTag);
  tag1.textContent = "Jede Welt.";
  const tag2 = el("span", "cu", oTag);
  tag2.textContent = "Dein Ding.";
  const oUrl = el("div", "o-url", lock);
  // pixel GitHub mark: a filled circle with the octocat cut out
  const gh = P.canvas(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (Math.hypot(x - 7.5, y - 7.5) > 7.9) continue;
      const head = ((x - 7.5) / 4.4) ** 2 + ((y - 7.2) / 3.3) ** 2 <= 1;
      const ears = ((y === 3 || y === 4) && (x === 4 || x === 11)) || (y === 4 && (x === 5 || x === 10));
      const body = y >= 10 && x >= 6 && x <= 9;
      const tail = (y === 10 && x === 3) || (y === 11 && (x === 3 || x === 4)) || (y === 12 && (x === 4 || x === 5));
      if (head || ears || body || tail) continue;
      gh.ctx.fillStyle = "#f6e7c8";
      gh.ctx.fillRect(x, y, 1, 1);
    }
  gh.c.className = "gh";
  oUrl.appendChild(gh.c);
  el("span", "", oUrl).textContent = "GITHUB.COM/JONAX1337/PUMPKIN-LAUNCHER";
  if (!V) {
    lock.style.top = "648px";
    Object.assign(oWord.style, { width: "760px", height: "85px" });
    oTag.style.marginTop = "26px";
    oUrl.style.marginTop = "30px";
  } else {
    lock.style.top = "1168px";
    Object.assign(oWord.style, { width: "820px", height: "92px" });
    oTag.style.fontSize = "104px";
    oTag.style.marginTop = "40px";
    oUrl.style.marginTop = "52px";
  }

  // ------------------------------------------------------------------ camera
  const K = (t, x, y, w, vw, hold) => ({ t, x, y, lz: Math.log(V ? W / vw : W / w), hold });
  const WK = (t, u, v, wl, wv, hold) => {
    const [x, y] = winPt(u, v);
    return K(t, x, y, wl * WS, wv * WS, hold);
  };
  const keys = V
    ? [
        K(0, NEST[0], NEST[1] + 10, 0, 250), K(1.6, NEST[0] + 10, NEST[1] + 30, 0, 380), K(3.0, NEST[0] + 30, NEST[1] + 80, 0, 470),
        K(4, mx + 20, my + 40, 0, 470), K(6.7, mx + 30, my + 70, 0, 410),
        K(7.4, (mx + cx) / 2 + 60, (my + cy) / 2 + 120, 0, 600), K(8, cx + 20, cy + 40, 0, 470), K(10.7, cx + 30, cy + 70, 0, 410),
        K(11.4, cx + 90, (cy + fy) / 2 + 100, 0, 620), K(12, fx + 20, fy + 40, 0, 470), K(14.7, fx + 10, fy + 70, 0, 410),
        K(15.4, (fx + tx) / 2, (fy + ty) / 2 + 100, 0, 600), K(16, tx + 20, ty + 40, 0, 470), K(18.7, tx + 10, ty + 70, 0, 410),
        K(19.6, tx + 80, ty - 150, 0, 560), K(21.4, hx, hy - 60, 0, 1040), K(23.4, hx, hy - 40, 0, 1100), K(24, hx, hy - 40, 0, 900),
        K(25, hx, hy - 30, 0, 640),
        WK(26.3, 520, 470, 0, 980), WK(27.4, 560, 440, 0, 900), WK(28.9, 600, 440, 0, 900), WK(29.6, 1150, 440, 0, 860),
        WK(30.3, 580, 470, 0, 920), WK(31.9, 606, 470, 0, 1000), WK(32.7, 980, 330, 0, 840), WK(33.3, 1320, 250, 0, 600),
        WK(34.8, 1320, 252, 0, 560), WK(36.4, 800, 450, 0, 506, true), WK(44, 800, 450, 0, 490),
      ]
    : [
        K(0, NEST[0], NEST[1] - 6, 330), K(1.6, NEST[0] + 30, NEST[1] + 10, 640), K(3.0, NEST[0] + 90, NEST[1] + 50, 860),
        K(4, mx + 60, my - 40, 860), K(6.7, mx + 96, my - 36, 760),
        K(7.4, (mx + cx) / 2, 280, 1080), K(8, cx + 60, cy - 40, 860), K(10.7, cx + 96, cy - 36, 760),
        K(11.4, cx + 90, (cy + fy) / 2, 1080), K(12, fx + 96, fy - 40, 860), K(14.7, fx + 60, fy - 36, 760),
        K(15.4, (fx + tx) / 2, fy + 120, 1080), K(16, tx + 96, ty - 40, 860), K(18.7, tx + 60, ty - 36, 760),
        K(19.6, tx + 200, ty - 150, 940), K(21.4, hx, hy - 60, 1780), K(23.4, hx, hy - 40, 1920), K(24, hx, hy - 40, 1650),
        K(25, hx, hy - 40, 1000),
        WK(26.3, 800, 450, 1720), WK(27.4, 800, 452, 1620), WK(28.9, 830, 470, 1540), WK(29.6, 900, 470, 1500),
        WK(30.3, 760, 470, 1560), WK(31.9, 700, 480, 1400), WK(32.7, 1080, 330, 1000), WK(33.3, 1296, 250, 640),
        WK(34.8, 1300, 250, 600), WK(36.4, 800, 450, 1600, 0, true), WK(44, 800, 450, 1540),
      ];
  const cSpline = pchip(keys, ["x", "y", "lz"]);
  const camAt = (t) => ({ x: cSpline(t, "x"), y: cSpline(t, "y"), z: Math.exp(cSpline(t, "lz")) });

  // ------------------------------------------------------------------ Buddy state at time t
  const S_END = V ? 0.66 : 0.8;
  const UI_S = 0.5;
  const hop = (t, t0, t1, a, b, apex) => {
    const u = clamp((t - t0) / (t1 - t0), 0, 1);
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u) - apex * 4 * u * (1 - u)];
  };
  const W2 = (p) => winPt(p[0], p[1]);
  const UIP = {
    perch: [700, 108], quelle: [720, 173], anl: [1447, 359],
    chip: (i) => [218 + i * 194, 443], playTop: [1320, 131], end: V ? [800, 178] : [800, 158],
  };
  const LAND = [3.95, 7.92, 11.92, 15.92, 24.0, 25.9, 29.47, 30.0, 30.5, 31.0, 31.5, 32.0, 32.25, 33.0, 36.5];
  const BONK = [27.5, 28.0, 28.5, 29.0];
  const HOPS = [[29.47, UIP.anl], [29.55, UIP.anl], [30.0, UIP.chip(0)], [30.5, UIP.chip(1)], [31.0, UIP.chip(2)],
    [31.5, UIP.chip(3)], [32.0, UIP.chip(4)], [32.25, UIP.chip(1)], [32.4, UIP.chip(1)]];
  const budAt = (t) => {
    let p, s = 1, pose = "idle", pt = t, rotorOn = true;
    if (t < 23.5) {
      p = [bSpline(t, "x"), bSpline(t, "y")];
      const hov = t < 3.3 ? 0 : 1;
      p = [p[0] + Math.sin(t * 2.3) * 7 * hov, p[1] + Math.sin(t * 3.1 + 1) * 6 * hov];
      if (t < 3.0) { pose = "sleep"; rotorOn = false; }
      else if (t < 3.9) { pose = "oops"; pt = t - 3.0; rotorOn = t > 3.15; }
      for (const isl of islands.slice(0, 4)) if (t >= isl.T && t < isl.T + 1.46) { pose = "success"; pt = t - isl.T; }
    } else if (t < 24.0) {
      const u = (t - 23.5) / 0.5;
      p = [hx, lerp(bKeys[bKeys.length - 1].y, HUBC[1], Math.pow(u, 2.4))];
    } else if (t < 25.6) {
      p = HUBC.slice();
      pose = "hello"; pt = t - 24.0; rotorOn = false;
    } else if (t < 25.9) {
      p = hop(t, 25.6, 25.9, HUBC, W2(UIP.perch), 60);
      s = lerp(1, UI_S, smooth((t - 25.6) / 0.3));
    } else if (t < 29.0) {
      s = UI_S;
      const perch = W2(UIP.perch), q = W2(UIP.quelle);
      if (t < 27.25) p = [perch[0] + Math.sin(t * 2.4) * 3, perch[1] + Math.sin(t * 3.3) * 3];
      else if (t < 27.5) p = hop(t, 27.25, 27.5, perch, q, 20);
      else {
        const ph = ((t - 27.5) % 0.5) / 0.5;
        p = [q[0], q[1] - 53 * WS * 4 * ph * (1 - ph)];
      }
    } else if (t < 29.47) {
      s = UI_S;
      p = hop(t, 29.0, 29.47, W2(UIP.quelle), W2(UIP.anl), 150 * WS);
    } else if (t < 32.4) {
      s = UI_S;
      let i = 0;
      while (i < HOPS.length - 2 && HOPS[i + 1][0] <= t) i++;
      const [t0, a] = HOPS[i], [t1, b] = HOPS[i + 1];
      const dist = Math.abs(b[0] - a[0]);
      p = t1 - t0 < 0.1 ? W2(a) : hop(t, t0, t1, W2(a), W2(b), (dist > 400 ? 170 : 90) * WS);
    } else if (t < 33.0) {
      s = UI_S;
      p = hop(t, 32.4, 33.0, W2(UIP.chip(1)), W2(UIP.playTop), 220 * WS);
    } else if (t < 35.0) {
      s = UI_S;
      const q = W2(UIP.playTop);
      p = [q[0], q[1] + Math.sin(t * 6) * 0.6];
      pose = t < 34.9 ? "loading" : "success";
      pt = t < 34.9 ? t - 33.1 : t - 34.9;
    } else if (t < 36.5) {
      p = hop(t, 35.0, 36.5, W2(UIP.playTop), W2(UIP.end), 110 * WS);
      s = lerp(UI_S, S_END, smooth((t - 35.0) / 1.5));
      pose = t < 35.46 ? "success" : "idle";
      pt = t - 34.9;
    } else {
      s = S_END;
      const e = W2(UIP.end);
      p = [e[0] + Math.sin(t * 1.9) * 2, e[1] + Math.sin(t * 2.6) * 3];
      if (t >= 37.0 && t < 38.46) { pose = "success"; pt = t - 37.0; }
      else if (t >= 39.6 && t < 41.1) { pose = "hello"; pt = t - 39.6; }
      else pt = t - 36.5;
    }
    return { p, s, pose, pt, rotorOn };
  };
  const budPos = (t) => budAt(t).p;

  // ------------------------------------------------------------------ sky with aurora
  const AW = skyC.c.width, AH = skyC.c.height;
  const skyImg = skyC.ctx.createImageData(AW, AH);
  const sky32 = new Uint32Array(skyImg.data.buffer);
  const abgr = (h) => { const [r, g, b] = P.hex(h); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };
  const BANDS = ["#050814", "#081028", "#0c173a", "#12204c", "#1a2a5e", "#23316c", "#2f3478", "#403a86", "#55408e", "#6c4694"].map(abgr);
  const AUR = [["#1f8f8a", "#2ee6c8", "#b4fff0"], ["#6a3fb0", "#d86cff", "#ffd0ff"]].map((a) => a.map(abgr));
  const sr = P.rng(4242);
  const stars = [];
  for (let i = 0; i < (V ? 360 : 320); i++)
    stars.push({ x: sr(), y: sr() * 2.2 - 0.6, big: sr() < 0.16, p: Math.floor(sr() * 16), per: 5 + Math.floor(sr() * 9) });
  const STAR_DIM = abgr("#b8cdf0"), STAR_HI = abgr("#ffffff");
  const drawSky = (t, cam) => {
    const alt = clamp((cam.y + 700) / 2600, 0, 1);
    for (let y = 0; y < AH; y++) {
      const f = clamp((y / AH) * 0.5 + alt * 0.58, 0, 0.999) * (BANDS.length - 1);
      const i = Math.floor(f), fr = f - i;
      for (let x = 0; x < AW; x++) {
        const k = fr > 0.7 && P.bayer(x, y) < (fr - 0.7) / 0.3 ? i + 1 : i;
        sky32[y * AW + x] = BANDS[Math.min(BANDS.length - 1, k)];
      }
    }
    // aurora curtains: dithered ribbons with vertical rays, drifting in parallax
    const ox = cam.x * 0.02, oy = cam.y * 0.03;
    const auroraAmt = (1 - alt * 0.55) * (t > 25 ? 0.55 : 1);
    for (let r = 0; r < 2; r++) {
      const pal = AUR[r];
      for (let x = 0; x < AW; x++) {
        const X = x + ox * (r ? 1.3 : 1);
        const yc = AH * (r ? 0.3 : 0.2) - oy + Math.sin(X * 0.045 + t * 0.55 + r * 2) * AH * 0.07 + Math.sin(X * 0.013 - t * 0.3 + r) * AH * 0.09;
        const ray = 0.72 + 0.28 * Math.sin(X * 0.35 + t * 1.6 + r * 3) * Math.sin(X * 0.11 - t * 0.5);
        const hgt = AH * (r ? 0.06 : 0.1) * (0.7 + 0.3 * ray);
        for (let d = -2; d < hgt; d++) {
          const y = Math.round(yc + d);
          if (y < 0 || y >= AH) continue;
          const a = (d < 0 ? 0.7 : Math.pow(1 - d / hgt, 1.3)) * ray * auroraAmt * (r ? 0.7 : 0.85);
          if (a < 0.12) continue;
          if (a < 0.3 && P.bayer(x, y) >= (a - 0.12) / 0.18) continue;
          sky32[y * AW + x] = d < 1 && a > 0.55 ? pal[2] : a > 0.5 ? pal[1] : pal[0];
        }
      }
    }
    const tq = Math.floor(t * 10);
    const sx = cam.x * 0.035, sy = cam.y * 0.035;
    for (const s of stars) {
      const px = Math.floor((((s.x * AW * 1.6 - sx) % AW) + AW) % AW);
      const py = Math.floor(s.y * AH * 1.4 - sy + 20);
      if (py < 1 || py >= AH - 1 || px < 1 || px >= AW - 1) continue;
      if (py / AH + alt * 0.9 > 1.05) continue;
      const tw = (tq + s.p) % s.per === 0;
      sky32[py * AW + px] = tw || s.big ? STAR_HI : STAR_DIM;
      if (s.big && tw) {
        sky32[py * AW + px - 1] = STAR_DIM; sky32[py * AW + px + 1] = STAR_DIM;
        sky32[(py - 1) * AW + px] = STAR_DIM; sky32[(py + 1) * AW + px] = STAR_DIM;
      }
    }
    skyC.ctx.putImageData(skyImg, 0, 0);
  };

  // ------------------------------------------------------------------ fx canvas: speed lines, fireworks, confetti
  const FW = fxC.c.width, FH = fxC.c.height, fx2 = fxC.ctx;
  const lr = P.rng(77);
  const lines = [];
  for (let i = 0; i < 46; i++) lines.push({ x: lr(), y: lr(), l: 0.5 + lr() * 0.8, sp: 0.6 + lr() * 0.8 });
  const FWC = [["#ffd84a", "#fff3b8", "#ff9f3a"], ["#2ee6c8", "#b4fff0", "#1fa0ff"], ["#ff6ad5", "#ffd0ff", "#b04cff"], ["#e39860", "#ffe6c4", "#ff6d4a"], ["#7cf57a", "#e0ffd0", "#2ecc6a"]];
  const FIREWORKS = (V
    ? [[38.0, 0.24, 0.14], [38.05, 0.76, 0.18], [38.5, 0.5, 0.07], [39.0, 0.18, 0.28], [40.0, 0.78, 0.1], [40.02, 0.3, 0.2], [41.0, 0.7, 0.28], [42.0, 0.26, 0.1], [42.8, 0.8, 0.2]]
    : [[38.0, 0.18, 0.2], [38.05, 0.82, 0.22], [38.5, 0.3, 0.1], [39.0, 0.72, 0.1], [40.0, 0.12, 0.34], [40.02, 0.88, 0.32], [41.0, 0.24, 0.12], [42.0, 0.78, 0.14], [42.8, 0.5, 0.06]]
  ).map(([t0, x, y], i) => ({ t0, x: x * FW, y: y * FH, col: FWC[i % FWC.length], n: 36, seed: 300 + i }));
  const fwParts = FIREWORKS.map((f) => {
    const r = P.rng(f.seed);
    return Array.from({ length: f.n }, (_, i) => ({ a: (i / f.n) * TAU + r() * 0.2, v: 30 + r() * 26, c: Math.floor(r() * 3) }));
  });
  const conf = [];
  { const r = P.rng(909); for (let i = 0; i < 60; i++) conf.push({ a: -Math.PI / 2 + (r() - 0.5) * 2.6, v: 150 + r() * 140, c: FWC[i % 5][Math.floor(r() * 2)], sp: r() * 10 }); }
  const px1 = (x, y, col, w = 1, h = 1) => { fx2.fillStyle = col; fx2.fillRect(Math.round(x), Math.round(y), w, h); };
  const drawFx = (t, velS, confetti0) => {
    fx2.clearRect(0, 0, FW, FH);
    // speed lines along the camera motion; radial warp during the dive
    const dive = t > 34.95 && t < 36.5 ? Math.sin(Math.PI * clamp((t - 34.95) / 1.5, 0, 1)) : 0;
    const spd = Math.hypot(velS[0], velS[1]);
    const lin = t < 35 ? smooth(clamp((spd - 900) / 1800, 0, 1)) : 0;
    if (lin > 0.02 || dive > 0.02) {
      fx2.globalAlpha = 0.42;
      for (const L of lines) {
        let x0, y0, dx, dy, len;
        if (dive > 0.02) {
          const ang = L.x * TAU, r0 = (((L.y + t * L.sp * 1.4) % 1) * 0.9 + 0.1) * Math.max(FW, FH) * 0.7;
          dx = Math.cos(ang); dy = Math.sin(ang);
          x0 = FW / 2 + dx * r0; y0 = FH / 2 + dy * r0 * 0.9;
          len = 26 * dive * L.l;
        } else {
          const n = spd || 1;
          dx = -velS[0] / n; dy = -velS[1] / n;
          x0 = (((L.x * FW + dx * t * 300 * L.sp) % FW) + FW) % FW;
          y0 = (((L.y * FH + dy * t * 300 * L.sp) % FH) + FH) % FH;
          len = 30 * lin * L.l;
        }
        for (let k = 0; k < len; k++) px1(x0 - dx * k, y0 - dy * k, k < 2 ? "#ffffff" : "#cfe0ff");
      }
      fx2.globalAlpha = 1;
    }
    // (fireworks + confetti removed: the outro stays clean)
    [].forEach((f, i) => {
      const dt = t - f.t0;
      if (dt < -0.45 || dt > 1.6) return;
      if (dt < 0) {
        const y = lerp(FH + 4, f.y, outCubic(1 + dt / 0.45));
        px1(f.x, y, "#fff3c0", 1, 2);
        px1(f.x, y + 3, f.col[0]);
        return;
      }
      const fade = 1 - dt / 1.6;
      fwParts[i].forEach((q) => {
        const d = q.v * dt * (1 - dt * 0.28);
        const x = f.x + Math.cos(q.a) * d, y = f.y + Math.sin(q.a) * d + 9 * dt * dt;
        if (P.bayer(Math.round(x), Math.round(y)) > fade) return;
        px1(x, y, f.col[q.c], dt < 0.5 ? 2 : 1, dt < 0.5 ? 2 : 1);
        if (dt > 0.1) px1(x - Math.cos(q.a) * 2, y - Math.sin(q.a) * 2 - 1, f.col[2]);
      });
      if (dt < 0.1) { px1(f.x - 4, f.y, "#ffffff", 9, 1); px1(f.x, f.y - 4, "#ffffff", 1, 9); px1(f.x - 1, f.y - 1, "#fff3c0", 3, 3); }
    });
    if (false) {
      const dt = t - 37.0;
      conf.forEach((q) => {
        const drag = 1 / (1 + dt * 2.2);
        const x = confetti0[0] + Math.cos(q.a) * q.v * dt * drag + Math.sin(dt * 6 + q.sp) * 2;
        const y = confetti0[1] - 18 + Math.sin(q.a) * q.v * dt * drag + 46 * dt * dt;
        if (P.bayer(Math.round(x), Math.round(y)) > 1 - dt / 2.8) return;
        const flip = Math.floor(dt * 10 + q.sp) % 2;
        px1(x, y, q.c, flip ? 3 : 2, flip ? 2 : 3);
      });
    }
  };

  // ------------------------------------------------------------------ render(t)
  const layerXf = (cam, f, zf, rot, dx, dy) =>
    `translate(${W / 2 + dx}px, ${H / 2 + dy}px) rotate(${rot}deg) scale(${zf}) translate(${-cam.x * f}px, ${-cam.y * f}px)`;
  const PARTFX = {
    firefly: (q, t) => { const a = t * (0.4 + q.c * 0.5) + q.a * TAU; return [(q.a - 0.5) * 230 + Math.sin(a) * 18, -20 - q.b * 110 + Math.cos(a * 1.3) * 12, 0.3 + 0.7 * Math.max(0, Math.sin(t * 2.5 + q.c * 9)), "#d8ff7a"]; },
    ember: (q, t) => { const u = (t * (0.18 + q.c * 0.2) + q.b) % 1; return [(q.a - 0.5) * 220 + Math.sin(t * 2 + q.c * 7) * 10, -10 - u * 190, 1 - u, u < 0.4 ? "#ffd06a" : "#ff6a3a"]; },
    end: (q, t) => { const u = (t * (0.1 + q.c * 0.12) + q.b) % 1; return [(q.a - 0.5) * 240 + Math.sin(t + q.c * 5) * 16, 20 - u * 200, Math.sin(u * Math.PI), q.c > 0.5 ? "#e0b8ff" : "#9b6fff"]; },
    snow: (q, t) => { const u = (t * (0.12 + q.c * 0.1) + q.b) % 1; return [(q.a - 0.5) * 300 + Math.sin(t * 1.4 + q.c * 8) * 14, -220 + u * 420, Math.sin(u * Math.PI), "#ffffff"]; },
  };
  let lastRingStep = -2, lastPathN = -1;
  const ARRIVE = [3.95, 7.92, 11.92, 15.92];
  const render = (t) => {
    const cam = camAt(t);
    // beat punches: a zoom kick on every beat of the drop, a bigger one on each island arrival
    let punch = 0;
    if (t >= 24.5 && t < 35) { const kb = Math.floor(t * 2) / 2; punch += 0.011 * Math.exp(-(t - kb) * 9); }
    for (const T of [4, 8, 12, 16]) if (t >= T && t < T + 1) punch += 0.045 * Math.exp(-(t - T) * 6);
    if (t >= 24 && t < 25) punch += 0.08 * Math.exp(-(t - 24) * 6);
    cam.z *= 1 + punch;

    const a = camAt(t - 0.15), b = camAt(t + 0.15);
    const velS = [((b.x - a.x) / 0.3) * cam.z, ((b.y - a.y) / 0.3) * cam.z];
    const fly = 1 - smooth(clamp((t - 24.6) / 1.2, 0, 1));
    const rot = clamp(velS[0] * 0.0012, -3.6, 3.6) * fly;
    let dx = (Math.sin(t * 0.83) * 5 + Math.sin(t * 2.1 + 1.3) * 2) * fly;
    let dy = (Math.sin(t * 0.61 + 0.7) * 4 + Math.sin(t * 1.7) * 2) * fly;
    if (t >= 24 && t < 24.7) {
      const e = Math.exp(-(t - 24) * 8) * 22;
      dx += Math.sin(t * 90) * e;
      dy += Math.cos(t * 77) * e;
    }
    world.style.transform = layerXf(cam, 1, cam.z, rot, dx, dy);
    farL.style.transform = layerXf(cam, 0.45, Math.pow(cam.z, 0.45) * Math.pow(2.6, 0.55), rot * 0.6, dx * 0.4, dy * 0.4);
    fgL.style.transform = layerXf(cam, 1.45, Math.pow(cam.z, 1.3) * Math.pow(2.6, -0.3), rot * 1.3, dx * 1.6, dy * 1.6);
    if (t < 36.6) drawSky(t, cam);

    for (const c of clouds) c.c.style.transform = `translate(${c.x + t * c.drift}px, ${c.y}px)`;
    const speed = Math.hypot(velS[0], velS[1]);
    const fgOp = 0.55 * smooth(clamp((speed - 250) / 900, 0, 1)) * (1 - clamp((t - 20.2) / 1.2, 0, 1));
    for (const c of fgClouds) {
      c.c.style.transform = `translate(${c.x + t * c.drift}px, ${c.y}px)`;
      c.c.style.opacity = fgOp;
    }

    for (const isl of islands) {
      isl.bob = Math.round(Math.sin(t * 0.9 + isl.phase) * 3) * U;
      isl.node.style.transform = `translate(0px, ${isl.bob}px)`;
      if (isl.fall) {
        const step = Math.floor(t * 14);
        if (step !== isl.fall.last) {
          const { ctx, cols } = isl.fall;
          ctx.clearRect(0, 0, 5, 64);
          for (let y = 0; y < 64; y++)
            for (let x = 0; x < 5; x++) {
              if (y > 52 && P.bayer(x, y) < (y - 52) / 12) continue;
              const k = (y - step * 2 + x * 3) & 7;
              ctx.fillStyle = k < 2 ? cols[1] : k < 5 ? cols[0] : cols[2];
              ctx.fillRect(x, y, 1, 1);
            }
          isl.fall.last = step;
        }
      }
      if (isl.parts) {
        const fn = PARTFX[isl.src.fx];
        for (const q of isl.parts) {
          const [ox, oy, op, col] = fn(q, t);
          q.d.style.background = col;
          q.d.style.opacity = clamp(op, 0, 1);
          q.d.style.transform = `translate(${Math.round((isl.pos[0] + ox) / 2) * 2}px, ${Math.round((isl.pos[1] + oy + isl.bob) / 2) * 2}px)`;
        }
      }
    }

    // Buddy
    const B = budAt(t);
    buddy.pose(B.pose, B.pt);
    const bp = B.p, bpPrev = budPos(t - 0.06), bpNext = budPos(t + 0.06);
    const bvx = (bpNext[0] - bpPrev[0]) / 0.12;
    let brot = t < 23.5 && t > 3.3 ? clamp(bvx * 0.012, -16, 16) : 0;
    ARRIVE.forEach((T, i) => { if (t >= T && t < T + 0.5) brot += 360 * outCubic((t - T) / 0.5) * (i >= 2 ? -1 : 1); });
    let sy = 1;
    for (const T of LAND) if (t >= T && t < T + 0.3) sy -= 0.22 * Math.exp(-(t - T) * 16) * Math.cos((t - T) * 30);
    for (const T of BONK) if (t >= T && t < T + 0.2) sy -= 0.28 * Math.exp(-(t - T) * 18);
    if (t > 23.5 && t < 24) sy += (0.25 * (t - 23.5)) / 0.5; // stretch in the slam
    for (const it of items) { const g0 = it.absorbT + 0.3; if (t >= g0 && t < g0 + 0.2) sy += 0.12 * Math.exp(-(t - g0) * 14); }
    const sx = 1 / Math.max(0.6, sy);
    flyer.style.transform = `translate(${bp[0] - 48}px, ${bp[1] - 50}px) rotate(${brot}deg) scale(${B.s * sx}, ${B.s * sy})`;
    // wings flap fast in flight, lazily while hovering
    const flapHz = (t > 3.3 && t < 23.5) || (t > 35 && t < 36.5) ? 12 : 7;
    const wf = [0, 1, 2, 1][Math.floor(t * flapHz) % 4];
    wings.forEach((frames) => frames.forEach((c, i) => (c.style.display = B.rotorOn && i === wf ? "" : "none")));
    bang.style.opacity = t >= 3.0 && t < 3.6 ? 1 : 0;
    bang.style.transform = `translateY(${t < 3.1 ? (3.1 - t) * 60 : 0}px)`;
    // sparkle trail while flying
    const trailOn = (t > 3.3 && t < 24) || (t > 35 && t < 36.5);
    trailDots.forEach((d, q) => {
      const tq = t - (q + 1) * 0.035;
      if (!trailOn || tq < 3.3) { d.style.opacity = 0; return; }
      const pp = budPos(tq);
      const moving = Math.hypot(pp[0] - bp[0], pp[1] - bp[1]) > 8 * B.s;
      d.style.opacity = moving ? 1 - q / 10 : 0;
      d.style.transform = `translate(${Math.round((pp[0] + 8 * Math.sin(q * 2.1)) / 2) * 2}px, ${Math.round((pp[1] + 20 * B.s) / 2) * 2}px) scale(${(3 - q * 0.22) * Math.max(0.5, B.s)})`;
    });

    // the flight path Buddy drew, revealed for the overview
    let n = pathPts.length;
    if (t < 24) { n = 0; while (n < pathPts.length && pathPts[n].s <= t) n++; }
    if (n !== lastPathN) {
      pathC.ctx.clearRect(0, 0, pathC.c.width, pathC.c.height);
      for (let i = 0; i < n; i++) {
        if (i % 3 === 2) continue;
        const p = pathPts[i];
        pathC.ctx.fillStyle = i % 6 < 2 ? "#ffd89a" : "#ff9f5a";
        pathC.ctx.fillRect(Math.round((p.x - PB[0] + 20) / 4), Math.round((p.y - PB[1] + 20) / 4), 1, 1);
      }
      lastPathN = n;
    }
    pathNode.style.opacity = t < 20 ? 0.35 : t < 24 ? 0.35 + 0.65 * smooth((t - 20) / 1.5) : Math.max(0, 1 - (t - 24) / 0.5);

    // items: pop on the island → caught into Buddy's orbit → burst on the drop
    const spin = t * 2.6;
    const orbR = 46;
    for (const it of items) {
      const ang = t < 24 ? spin + (it.j / 4) * TAU : 24 * 2.6 + (it.slot / 16) * TAU;
      const orb = [bp[0] + Math.cos(ang) * orbR, bp[1] - 4 + Math.sin(ang) * orbR * 0.42];
      const front = Math.sin(ang) > 0;
      let x, y, sc = 1, op = 1, rotI = 0;
      if (t < it.pop) { op = 0; x = it.home[0]; y = it.home[1]; sc = 0; }
      else if (t < it.catchT) {
        const u = clamp((t - it.pop) / 0.3, 0, 1);
        x = it.home[0]; y = it.home[1] - 10 * u + it.isl.bob; sc = outBack(u) * 1.2;
      } else if (t < it.inOrbit) {
        const u = smooth((t - it.catchT) / (it.inOrbit - it.catchT));
        const hx0 = it.home[0], hy0 = it.home[1] - 10;
        const cxm = (hx0 + orb[0]) / 2, cym = Math.min(hy0, orb[1]) - 60;
        x = (1 - u) * (1 - u) * hx0 + 2 * u * (1 - u) * cxm + u * u * orb[0];
        y = (1 - u) * (1 - u) * hy0 + 2 * u * (1 - u) * cym + u * u * orb[1];
        sc = 1.2 - 0.4 * u; rotI = Math.round(u * 8) * 45;
      } else if (t < it.absorbT) {
        x = orb[0]; y = orb[1]; sc = front ? 0.9 : 0.62; op = front ? 1 : 0.7;
      } else if (t < it.absorbT + 0.3) {
        const u = (t - it.absorbT) / 0.3;
        x = lerp(orb[0], bp[0], u * u); y = lerp(orb[1], bp[1], u * u);
        sc = lerp(0.9, 0.2, u); op = 1;
      } else if (t < 24) {
        op = 0; x = bp[0]; y = bp[1]; sc = 0;
      } else {
        const u = clamp((t - 24) / 0.9, 0, 1);
        const d = 30 + 560 * outCubic(u);
        x = HUBC[0] + Math.cos(ang) * d; y = HUBC[1] + Math.sin(ang) * d * 0.7;
        sc = 1.4; op = 1 - u; rotI = Math.round(u * 12) * 45;
      }
      it.node.style.zIndex = front || t >= 24 ? 6 : 4;
      it.node.style.opacity = op;
      it.node.style.transform = `translate(${x - 12}px, ${y - 12}px) rotate(${rotI}deg) scale(${sc})`;
      const bu = t - it.pop;
      it.sparks.forEach((sp, q) => {
        if (bu < 0 || bu > 0.4) { sp.style.opacity = 0; return; }
        const aq = (q / 6) * TAU + 0.3;
        const d = 40 * outCubic(bu / 0.4);
        sp.style.opacity = 1 - bu / 0.4;
        sp.style.transform = `translate(${Math.round((it.home[0] + Math.cos(aq) * d) / 2) * 2}px, ${Math.round((it.home[1] + Math.sin(aq) * d + it.isl.bob) / 2) * 2}px) scale(2)`;
      });
    }

    // hub glow: charges up with Buddy's approach, flares on the slam
    let g = 0.12;
    if (t > 20) g = 0.12 + 0.45 * smooth(clamp((t - 20) / 3.5, 0, 1));
    if (t >= 24) g = 0.4 + 0.6 * Math.exp(-(t - 24) * 2.2);
    glow.style.opacity = t > 26.5 ? 0 : g;
    glow.style.transform = `translate(0px, ${hub.bob}px) scale(${1 + (t >= 24 ? 0.5 * Math.exp(-(t - 24) * 3) : t > 21 ? 0.05 * Math.sin(t * 8) : 0)})`;

    // double shockwave (pixel circles fading out through the Bayer matrix)
    const r1 = (t - 24) / 0.9, r2 = (t - 24.12) / 1.1;
    const step = (r1 > 0 && r1 < 1) || (r2 > 0 && r2 < 1) ? Math.floor((t - 24) * 30) : -1;
    if (step !== lastRingStep) {
      ring.ctx.clearRect(0, 0, 160, 160);
      [[r1, "#ff9f5a", "#fff0cf", 72], [r2, "#2ee6c8", "#d8fff6", 76]].forEach(([ru, c1, c2, R]) => {
        if (!(ru > 0 && ru < 1)) return;
        const r = 5 + R * (1 - Math.pow(1 - ru, 3)), fade = 1 - ru;
        for (let y = 0; y < 160; y++)
          for (let x = 0; x < 160; x++) {
            const d = Math.hypot(x - 79.5, y - 79.5);
            if (Math.abs(d - r) < 1.7 && P.bayer(x, y) < fade) {
              ring.ctx.fillStyle = d > r ? c1 : c2;
              ring.ctx.fillRect(x, y, 1, 1);
            }
          }
      });
      lastRingStep = step;
    }

    // scene dive: layers scale about the sun, near layers faster; sun pulses on the beat
    const D = t < 35 ? -0.55 : t < 36.4 ? -0.55 * (1 - smooth((t - 35) / 1.4)) : ((t - 36.4) / 7.6) * 0.1;
    const sunPulse = 0;
    for (const L of sceneLayers) {
      let sc = L.depth < 0.2 ? Math.max(1, Math.exp(L.depth * D)) : Math.exp(L.depth * D);
      if (L.k === "sun") sc *= 1 + sunPulse;
      L.c.style.transform = `scale(${sc})`;
    }

    // fx: confetti launches from Buddy's screen position
    const cf = [(W / 2 + (bp[0] - cam.x) * cam.z) / 4, (H / 2 + (bp[1] - cam.y) * cam.z) / 4];
    drawFx(t, velS, t > 36.5 ? cf : null);
  };

  // ------------------------------------------------------------------ timeline
  const tl = gsap.timeline({ paused: true });
  const clock = { t: 0 };
  tl.to(clock, { t: DUR, duration: DUR, ease: "none", onUpdate: () => render(clock.t) }, 0);

  islands.slice(0, 4).forEach((isl) => {
    if (V) tl.to([isl.label.nm, isl.label.sub], { opacity: 0, duration: 0.3, ease: "steps(3)" }, 20.5);
    tl.fromTo(isl.label.nm.children, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "steps(3)", stagger: 0.035 }, isl.T - 0.45);
    tl.fromTo(isl.label.sub, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, ease: "steps(2)" }, isl.T + 0.2);
  });

  const inWords = (ws) => ws.forEach(({ w, t }) => {
    tl.fromTo(w, { y: 60, opacity: 0, scale: 1.25 }, { y: 0, opacity: 1, scale: 1, duration: 0.42, ease: "back.out(2.4)" }, t);
    tl.fromTo(w, { filter: "brightness(3.2)" }, { filter: "brightness(1)", duration: 0.35, ease: "power2.out", immediateRender: false }, t + 0.05);
  });
  const outWords = (ws, t) => ws.forEach(({ w }, i) => tl.to(w, { y: -44, opacity: 0, duration: 0.26, ease: "power2.in" }, t + i * 0.03));
  inWords(intro); outWords(intro, 3.1);
  inWords(ask); outWords(ask, 23.15);
  inWords(answer); outWords(answer, 25.3);

  tl.fromTo(flash, { opacity: 0 }, { opacity: 0.55, duration: 0.02, ease: "none" }, 24);
  tl.to(flash, { opacity: 0, duration: 0.5, ease: "power2.out" }, 24.03);

  tl.fromTo(winPos, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none" }, 24.99);
  tl.fromTo(win, { scaleX: 0.04, scaleY: 0.012, transformOrigin: "50% 50%" }, { scaleX: 1, duration: 0.27, ease: "steps(3)" }, 25.0);
  tl.to(win, { scaleY: 1, duration: 0.27, ease: "steps(3)" }, 25.27);
  tl.fromTo(winGlow, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, 25.0);
  tl.to(winGlow, { opacity: 0.25, duration: 1.2, ease: "power2.out" }, 25.6);
  tl.to(winGlow, { opacity: 0, duration: 0.5, ease: "none" }, 35.0);

  tl.fromTo(rowSets[0].rows, { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "steps(3)", stagger: 0.12 }, 25.7);
  rowSets.slice(1).forEach((s) => tl.set(s.set, { opacity: 0 }, 0));
  selSpans.slice(1).forEach((s) => tl.set(s, { opacity: 0 }, 0));
  const order = [0, 1, 2, 3, 0];
  BONK.forEach((ts, i) => {
    const a = order[i], b = order[i + 1];
    tl.to(rowSets[a].set, { x: -70, opacity: 0, duration: 0.14, ease: "steps(2)" }, ts);
    tl.fromTo(rowSets[b].set, { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.2, ease: "steps(3)", immediateRender: false }, ts + 0.1);
    tl.to(selSpans[a], { y: -14, opacity: 0, duration: 0.1, ease: "steps(2)" }, ts);
    tl.fromTo(selSpans[b], { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.14, ease: "steps(2)", immediateRender: false }, ts + 0.06);
    tl.fromTo(f2, { y: 0 }, { y: 5, duration: 0.05, ease: "none", immediateRender: false }, ts);
    tl.to(f2, { y: 0, duration: 0.12, ease: "back.out(3)" }, ts + 0.06);
  });

  // Buddy stomps "Anlegen" → instance page
  tl.fromTo(pressAnlegen, { opacity: 0 }, { opacity: 1, duration: 0.02, ease: "none" }, 29.47);
  tl.to(disc, { x: -1516, duration: 0.5, ease: "power3.inOut" }, 29.6);
  tl.fromTo(inst, { x: 1516 }, { x: 0, duration: 0.5, ease: "power3.inOut" }, 29.6);
  tl.fromTo(sceneBox, { clipPath: "inset(60px 0px 900px 1600px)" }, { clipPath: "inset(60px 0px 480px 84px)", duration: 0.5, ease: "power3.inOut" }, 29.6);

  // loader chips pop exactly when Buddy lands on them
  tl.fromTo(ldLabel, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "steps(2)" }, 29.95);
  lds.forEach((d, i) => {
    tl.fromTo(d, { y: 26, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: "back.out(3)" }, 29.85 + i * 0.5);
    tl.to(d, { y: 6, duration: 0.05, ease: "none" }, 30.0 + i * 0.5);
    tl.to(d, { y: 0, duration: 0.15, ease: "back.out(3)" }, 30.06 + i * 0.5);
  });
  tl.fromTo(ldOn, { opacity: 0, y: 0 }, { opacity: 1, duration: 0.1, ease: "steps(2)" }, 32.25);
  tl.to(ldOn, { y: 6, duration: 0.05, ease: "none" }, 32.25);
  tl.to(ldOn, { y: 0, duration: 0.15, ease: "back.out(3)" }, 32.31);

  // SPIELEN: Buddy lands on it, it installs, it starts
  tl.to(face, { y: 6, duration: 0.05, ease: "none" }, 33.0);
  tl.to(face, { y: 0, duration: 0.1, ease: "back.out(3)" }, 33.14);
  tl.set([st2, st3], { opacity: 0 }, 0);
  tl.to(st1, { opacity: 0, duration: 0.05, ease: "none" }, 33.1);
  tl.to(st2, { opacity: 1, duration: 0.05, ease: "none" }, 33.12);
  tl.set(cellFills, { opacity: 0 }, 0);
  cellFills.forEach((c, i) => tl.to(c, { opacity: 1, duration: 0.01, ease: "none" }, 33.25 + (i + 1) * (1.6 / 12) - 0.01));
  tl.to(pctNum, { innerText: 100, snap: { innerText: 1 }, duration: 1.6, ease: "none" }, 33.25);
  tl.to(st2, { opacity: 0, duration: 0.05, ease: "none" }, 34.88);
  tl.to(st3, { opacity: 1, duration: 0.05, ease: "none" }, 34.9);
  tl.fromTo(face, { filter: "brightness(1)" }, { filter: "brightness(1.6)", duration: 0.05, ease: "none", immediateRender: false }, 34.9);
  tl.to(face, { filter: "brightness(1)", duration: 0.3, ease: "power2.out" }, 34.96);

  // dive: the UI falls away and the scene opens up to fill the window
  tl.to(tb, { y: -70, opacity: 0, duration: 0.45, ease: "power2.in" }, 35.0);
  tl.to(sb, { x: -90, opacity: 0, duration: 0.45, ease: "power2.in" }, 35.0);
  tl.to([back, iTitle, iSub, play, ldLabel, ldRow, ldOn, iTabs, iList], { opacity: 0, y: 30, duration: 0.35, ease: "power2.in", stagger: 0.025 }, 35.05);
  tl.to(sceneBox, { clipPath: "inset(0px 0px 0px 0px)", duration: 1.0, ease: "power2.inOut" }, 35.05);
  tl.to(sceneShade, { opacity: 0, duration: 0.9, ease: "power1.inOut" }, 35.15);
  tl.to(winFrame, { opacity: 0, duration: 0.6, ease: "none" }, 35.7);
  tl.to(vign, { opacity: 0.6, duration: 1.0, ease: "none" }, 35.5);

  tl.fromTo(oShade, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: "power1.out" }, 36.6);
  tl.fromTo(oWord, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.4, ease: "steps(8)" }, 38.0);
  tl.fromTo(oWord, { filter: "brightness(2.6)" }, { filter: "brightness(1)", duration: 0.6, ease: "power2.out", immediateRender: false }, 38.3);
  [tag1, tag2].forEach((w, i) => {
    tl.fromTo(w, { y: 50, opacity: 0, scale: 1.3 }, { y: 0, opacity: 1, scale: 1, duration: 0.42, ease: "back.out(2.4)" }, 38.45 + i * 0.3);
    tl.fromTo(w, { filter: "brightness(3)" }, { filter: "brightness(1)", duration: 0.35, ease: "power2.out", immediateRender: false }, 38.5 + i * 0.3);
  });
  tl.fromTo(oUrl, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.45, ease: "steps(9)" }, 39.3);

  // transparent overlay canvases and Buddy's deliberate flights over the UI are layered on purpose
  [fxC.c, pathNode, ringNode, glow, winGlow].forEach((n) => {
    n.setAttribute("data-layout-ignore", "");
    n.setAttribute("data-layout-allow-occlusion", "");
    n.style.pointerEvents = "none";
  });
  // world text sits under the full-frame fx canvas (speed lines, fireworks), which the
  // audit treats as opaque; the waiver is read on the text element itself
  world.querySelectorAll("*").forEach((n) => {
    if ([...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) n.setAttribute("data-layout-allow-occlusion", "");
  });
  [flyer, ...items.map((i) => i.node)].forEach((n) => n.setAttribute("data-layout-allow-occlusion", ""));

  render(0);
  // registered by the inline script in index.html (the linter reads it there)
  window.__pumpkinTimeline = tl;
})();
