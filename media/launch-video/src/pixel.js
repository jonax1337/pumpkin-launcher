// Pixel-art primitives for the film. Everything is drawn once at load from a
// seeded RNG, so every render of a frame produces the same pixels.
(function () {
  const P = (window.PIX = {});

  P.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Ordered 4x4 Bayer matrix, normalised to 0..1 (brand rule: dither only at band edges).
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  P.bayer = (x, y) => B4[(y & 3) * 4 + (x & 3)];

  P.canvas = function (w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    return { c, ctx };
  };

  P.hex = function (h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  const fill = (ctx, col, x, y, w = 1, h = 1) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };

  // ------------------------------------------------------------------ icons
  // 12x12 item sprites for the four kinds of content.
  const ICONS = {
    mod: {
      pal: { K: "#1d1a2b", w: "#e8f2ff", c: "#a9b4c8", g: "#35c46a", G: "#9cf0a8", h: "#1f8a4a" },
      rows: [
        "....KKKK....",
        "....KwcK....",
        "....KccK....",
        "...KKccKK...",
        "..KwgggggK..",
        ".KwgGgggghK.",
        ".KggggGgghK.",
        ".KgGggggghK.",
        ".KgggggGghK.",
        "..KhhhhhhK..",
        "...KKKKKK...",
        "............",
      ],
    },
    pack: {
      pal: { K: "#1d1a2b", b: "#8a5a35", B: "#c48a50", y: "#f8bd72", d: "#5e3a24" },
      rows: [
        "............",
        ".KKKKKKKKKK.",
        ".KBBBBBBBBK.",
        ".KbbbbbbbbK.",
        ".KbbbbbbbbK.",
        ".KKKKyyKKKK.",
        ".KBBByyBBBK.",
        ".KbbbbbbbbK.",
        ".KbbbbbbbbK.",
        ".KddddddddK.",
        ".KKKKKKKKKK.",
        "............",
      ],
    },
    shader: {
      pal: { y: "#ffd84a", Y: "#fff3b8", o: "#f29a3a" },
      rows: [
        ".....y......",
        ".y...y...y..",
        "..y.....y...",
        "....ooo.....",
        "...oYYYo....",
        "yy.oYYYo.yy.",
        "...oYYyo....",
        "....ooo.....",
        "..y.....y...",
        ".y...y...y..",
        ".....y......",
        "............",
      ],
    },
    res: {
      pal: { K: "#1d1a2b", g: "#5fbf4a", G: "#9be36e", d: "#8a5a35", D: "#6b4428", l: "#a8744a" },
      rows: [
        "KKKKKKKKKKKK",
        "KGgGgGGgGgGK",
        "KgGgggGgggGK",
        "KgdgGdgGdgdK",
        "KddldddddlDK",
        "KdDddlddDddK",
        "KdddDddddlDK",
        "KldddddDdddK",
        "KdDddlddddDK",
        "KdddddddDldK",
        "KDdDDdDDdDDK",
        "KKKKKKKKKKKK",
      ],
    },
  };
  // Chest tints so FTB / Technic packs read as different packs.
  P.PACK_TINTS = {
    wood: null,
    violet: { b: "#6d4fa8", B: "#9d7fd6", d: "#46326e" },
    ice: { b: "#4c7fb0", B: "#86bde6", d: "#2f5478" },
    ember: { b: "#a83e2e", B: "#e0704a", d: "#6e2420" },
  };
  P.iconCanvas = function (kind, tint) {
    const def = ICONS[kind];
    const { c, ctx } = P.canvas(12, 12);
    def.rows.forEach((row, y) => {
      for (let x = 0; x < 12; x++) {
        const k = row[x];
        if (k === ".") continue;
        let col = def.pal[k];
        if (tint && kind === "pack" && tint[k]) col = tint[k];
        fill(ctx, col, x, y);
      }
    });
    return c;
  };

  // ------------------------------------------------------------------ islands
  const BIOMES = {
    forest: {
      top: ["#9ee88f", "#4fbf62", "#2f8f4a"], dirt: ["#8a5638", "#6a4029"],
      stone: ["#6b6f88", "#555a73", "#40445b", "#2e3144"], edge: "#1a1c2b", vine: "#2f8f4a",
    },
    nether: {
      top: ["#ff9a5a", "#d9523a", "#9e2f2f"], dirt: ["#8a2f36", "#6e252d"],
      stone: ["#7a2e38", "#62242e", "#4a1c26", "#35141d"], edge: "#1e0b12", vine: "#c23a3a",
    },
    end: {
      top: ["#f3eebd", "#d8d099", "#aea56d"], dirt: ["#9a8fb8", "#7d6fa3"],
      stone: ["#65509a", "#523f82", "#40316a", "#2e2350"], edge: "#171029", vine: "#9b7fd6",
    },
    snow: {
      top: ["#ffffff", "#e6eefb", "#b8c8e4"], dirt: ["#7f8fb0", "#6a7a9c"],
      stone: ["#61749a", "#4c5d80", "#3a4866", "#29334b"], edge: "#141a28", vine: "#9fd8ff",
    },
    hub: {
      top: ["#c6e0a0", "#86b06e", "#5e8a58"], dirt: ["#8a5a3c", "#6c4230"],
      stone: ["#6e5a70", "#584760", "#43364d", "#30263a"], edge: "#1a1422", vine: "#69866e",
    },
  };

  function shadeStone(pal, f, x, y) {
    // f: 0 at the top of the rock, 1 at the tip; Bayer-dithered band edges.
    const bands = pal.stone.length;
    const v = f * (bands - 1);
    const i = Math.floor(v);
    const frac = v - i;
    const pick = frac > 0.72 && P.bayer(x, y) < (frac - 0.72) / 0.28 ? i + 1 : i;
    return pal.stone[Math.min(bands - 1, pick)];
  }

  // Draws one floating island. Returns {canvas, surface(x), w, h}.
  P.island = function (o) {
    const rnd = P.rng(o.seed);
    const pal = BIOMES[o.biome];
    const W = o.w, H = o.h, top = o.top;
    const { c, ctx } = P.canvas(W, H);
    const topY = [], bot = [];
    const margin = 4;
    let bump = 0;
    for (let x = 0; x < W; x++) {
      if (x % 7 === 0) bump = Math.round((rnd() - 0.5) * 2.2);
      const nx = (x - W / 2) / (W / 2 - margin);
      const edge = Math.abs(nx) > 0.9 ? Math.round((Math.abs(nx) - 0.9) * 22) : 0;
      topY[x] = top + bump + edge;
    }
    let jag = 0;
    for (let x = 0; x < W; x++) {
      const nx = (x - W / 2) / (W / 2 - margin);
      if (x % 3 === 0) jag = Math.round(rnd() * 4);
      const base = Math.abs(nx) >= 1 ? 0 : o.depth * Math.pow(1 - nx * nx, 0.75);
      bot[x] = topY[x] + Math.max(3, Math.round(base + jag));
    }
    for (let x = 0; x < W; x++) {
      const nx = (x - W / 2) / (W / 2 - margin);
      if (Math.abs(nx) >= 1) continue;
      for (let y = topY[x]; y <= bot[x]; y++) {
        const d = y - topY[x];
        let col;
        if (d === 0) col = pal.top[0];
        else if (d <= 2) col = pal.top[1];
        else if (d === 3) col = P.bayer(x, y) < 0.5 ? pal.top[2] : pal.dirt[0];
        else if (d <= 5) col = pal.dirt[0];
        else if (d <= 8) col = P.bayer(x, y) < (d - 5) / 4 ? pal.dirt[1] : pal.dirt[0];
        else col = shadeStone(pal, (d - 8) / Math.max(1, bot[x] - topY[x] - 8), x, y);
        if (y === bot[x]) col = pal.edge;
        fill(ctx, col, x, y);
      }
      // light from the upper left, shade on the right rim
      if (nx < -0.86) for (let y = topY[x] + 9; y < bot[x]; y++) if (P.bayer(x, y) < 0.5) fill(ctx, pal.stone[0], x, y);
      if (nx > 0.8)
        for (let y = topY[x] + 6; y < bot[x]; y++) if (P.bayer(x, y) < 0.6) fill(ctx, pal.stone[pal.stone.length - 1], x, y);
    }
    // hanging vines / roots
    for (let i = 0; i < (o.vines || 0); i++) {
      const x = Math.floor(W * 0.2 + rnd() * W * 0.6);
      const len = 3 + Math.floor(rnd() * 9);
      for (let k = 1; k <= len; k++) fill(ctx, k === len ? pal.top[1] : pal.vine, x, bot[x] - 1 + k);
    }
    // loose rock bits under the tip
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(W / 2 + (rnd() - 0.5) * W * 0.4);
      const y = bot[x] + 6 + Math.floor(rnd() * 8);
      if (y + 2 < H) {
        fill(ctx, pal.stone[1], x, y); fill(ctx, pal.stone[2], x + 1, y);
        fill(ctx, pal.stone[2], x, y + 1); fill(ctx, pal.edge, x + 1, y + 1);
      }
    }
    const surface = (x) => topY[Math.max(0, Math.min(W - 1, Math.round(x)))];
    (o.deco || []).forEach((d) => DECO[d.t](ctx, d, surface, rnd));
    return { canvas: c, w: W, h: H, surface, bot };
  };

  const DECO = {
    pine(ctx, d, s) {
      const b = s(d.x), h = d.h || 18, lf = d.leaf || ["#3f8a58", "#2c6b45", "#1d4d33"];
      fill(ctx, "#5a3a26", d.x, b - 3, 1, 3);
      for (let k = 0; k < h - 3; k++) {
        const y = b - 3 - k;
        const r = Math.max(0, Math.round(((h - 3 - k) / (h - 3)) * (h / 3.2)) - (k % 4 === 3 ? 1 : 0));
        fill(ctx, lf[1], d.x - r, y, r * 2 + 1, 1);
        if (r > 0) fill(ctx, lf[0], d.x - r, y, r, 1);
        if (r > 1) fill(ctx, lf[2], d.x + r, y, 1, 1);
        if (d.snow && k % 4 === 0 && r > 0) fill(ctx, "#f4f8ff", d.x - r, y, r + 1, 1);
      }
      fill(ctx, d.snow ? "#ffffff" : lf[0], d.x, b - h, 1, 1);
    },
    oak(ctx, d, s, rnd) {
      const b = s(d.x), r = d.r || 6, lf = d.leaf || ["#46b866", "#2f8a4e", "#8ee07a", "#1f6a3a"];
      fill(ctx, "#6b4630", d.x, b - 6, 2, 6);
      fill(ctx, "#4e3222", d.x + 1, b - 6, 1, 6);
      const cy = b - 6 - r + 1;
      for (let y = -r; y <= r; y++)
        for (let x = -r - 1; x <= r + 1; x++) {
          const q = (x * x) / ((r + 1) * (r + 1)) + (y * y) / (r * r);
          if (q > 1) continue;
          let col = lf[1];
          if (y < -r * 0.2 && x < r * 0.3) col = lf[0];
          if (q > 0.72 && (y > 0 || x > 0)) col = lf[3];
          if (q < 0.4 && y < -r * 0.4 && x < 0 && rnd() < 0.5) col = lf[2];
          fill(ctx, col, d.x + x, cy + y);
        }
    },
    tuft(ctx, d, s) {
      const b = s(d.x), col = d.col || "#7fe08a";
      fill(ctx, col, d.x, b - 1); fill(ctx, col, d.x + 2, b - 2); fill(ctx, col, d.x + 1, b - 1);
      if (d.flower) fill(ctx, d.flower, d.x + 2, b - 3);
    },
    fungus(ctx, d, s) {
      const b = s(d.x), h = d.h || 9, cap = d.cap || ["#ff5a4a", "#b52a36", "#ffb08a"];
      fill(ctx, "#e0c8a0", d.x, b - h + 2, 1, h - 2);
      fill(ctx, cap[1], d.x - 3, b - h, 7, 2);
      fill(ctx, cap[0], d.x - 2, b - h - 1, 5, 2);
      fill(ctx, cap[2], d.x - 1, b - h - 1, 1, 1);
      fill(ctx, cap[2], d.x + 1, b - h, 1, 1);
    },
    glow(ctx, d, s) {
      const b = s(d.x);
      fill(ctx, "#ffc24a", d.x, b - 3, 3, 3);
      fill(ctx, "#fff0a0", d.x + 1, b - 3, 1, 1);
      fill(ctx, "#c07a2a", d.x + 2, b - 1, 1, 1);
    },
    crystal(ctx, d, s) {
      const b = s(d.x), h = d.h || 10, cols = d.cols || ["#e9dcff", "#c8abee", "#8e6fd0", "#5f45a0"];
      for (let k = 0; k < h; k++) {
        const w = Math.max(1, Math.round((1 - k / h) * 2.4));
        fill(ctx, cols[2], d.x - w + 1, b - 1 - k, w * 2 - 1, 1);
        fill(ctx, cols[1], d.x - w + 1, b - 1 - k, Math.max(1, w - 1), 1);
        if (k > h * 0.3 && k < h * 0.8) fill(ctx, cols[0], d.x - w + 1, b - 1 - k, 1, 1);
      }
      fill(ctx, cols[3], d.x + 1, b - 2, 1, 2);
    },
    chorus(ctx, d, s) {
      const b = s(d.x), c1 = "#8e6fa8", c2 = "#c9a7e0", c3 = "#e7d5f5";
      fill(ctx, c1, d.x, b - 10, 2, 10);
      fill(ctx, c1, d.x - 3, b - 7, 3, 2);
      fill(ctx, c1, d.x - 3, b - 11, 2, 4);
      fill(ctx, c1, d.x + 2, b - 13, 3, 2);
      fill(ctx, c1, d.x + 3, b - 16, 2, 3);
      fill(ctx, c2, d.x - 3, b - 13, 2, 2);
      fill(ctx, c2, d.x, b - 12, 2, 2);
      fill(ctx, c3, d.x + 3, b - 18, 2, 2);
    },
    rock(ctx, d, s) {
      const b = s(d.x);
      fill(ctx, d.c || "#8a8fa8", d.x, b - 3, 5, 3);
      fill(ctx, d.hi || "#b5bad0", d.x + 1, b - 4, 3, 1);
      fill(ctx, d.e || "#555a73", d.x + 4, b - 2, 1, 2);
    },
    pumpkin(ctx, d, s) {
      const b = s(d.x), r = d.r || 3, o = ["#f8bd72", "#e9904d", "#b75c45", "#784153"];
      for (let y = -r; y <= 0; y++)
        for (let x = -r - 1; x <= r + 1; x++) {
          const q = (x * x) / ((r + 1.5) * (r + 1.5)) + ((y + r / 2) * (y + r / 2)) / ((r / 2 + 1) * (r / 2 + 1));
          if (q > 1) continue;
          let col = o[1];
          if (x < -r / 2 && y < -r / 3) col = o[0];
          if (x > r / 2 || y === 0) col = o[2];
          if (x === 0) col = o[2];
          fill(ctx, col, d.x + x, b - 1 + y);
        }
      fill(ctx, "#69866e", d.x, b - r - 2, 1, 2);
      fill(ctx, "#adc795", d.x + 1, b - r - 2, 2, 1);
    },
    lantern(ctx, d, s) {
      const b = s(d.x);
      fill(ctx, "#3a2a2a", d.x, b - 12, 1, 12);
      fill(ctx, "#3a2a2a", d.x - 2, b - 13, 5, 1);
      fill(ctx, "#2b2433", d.x - 2, b - 12, 1, 4);
      fill(ctx, "#2b2433", d.x + 2, b - 12, 1, 4);
      fill(ctx, "#ffd27a", d.x - 1, b - 12, 3, 3);
      fill(ctx, "#fff3c0", d.x, b - 11, 1, 1);
      fill(ctx, "#2b2433", d.x - 2, b - 9, 5, 1);
    },
  };

  // ------------------------------------------------------------------ clouds
  // Puffy cloud whose blobs always stay inside the canvas (no clipped edges):
  // moonlit rim on top, dithered shadow band underneath.
  P.cloud = function (w, h, seed, cols) {
    const rnd = P.rng(seed);
    const { c, ctx } = P.canvas(w, h);
    const base = Math.round(h * 0.78);
    const blobs = [];
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const ry = h * (0.2 + rnd() * 0.22) * (i === Math.floor(n / 2) ? 1.35 : 1);
      const rx = Math.min(ry * 1.7, w * 0.22);
      const x = clampN(w * (0.18 + 0.64 * (i / (n - 1))) + (rnd() - 0.5) * w * 0.08, rx + 2, w - rx - 2);
      const y = Math.max(ry + 1, base - ry * 0.35);
      blobs.push({ x, y, rx, ry });
    }
    const inside = (x, y) => {
      if (y > base) return false;
      for (const b of blobs) {
        const dx = (x - b.x) / b.rx, dy = (y - b.y) / b.ry;
        if (dx * dx + dy * dy <= 1) return true;
      }
      // flat bottom slab between the outer blobs
      return y > base - h * 0.16 && x > blobs[0].x && x < blobs[n - 1].x;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        let col = cols[1];
        if (!inside(x, y - 1) || !inside(x, y - 2)) col = cols[0];
        else if (y > base - h * 0.14 && P.bayer(x, y) < (y - (base - h * 0.14)) / (h * 0.14)) col = cols[2];
        if (!inside(x - 1, y) && y < base - 2) col = cols[0];
        fill(ctx, col, x, y);
      }
    return c;
  };
  function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Little leaf wings in Buddy's brand greens: up / level / down, joint on the right.
  P.wingFrames = function () {
    const F = [
      ["kk........", "kGkk......", "kGGgkk....", ".kGgggkk..", ".kggggggk.", "..kkggggkk", "....kkkkk.", ".........."],
      ["..........", "..........", "..kkkkk...", ".kGGGGgkk.", "kGgggggggk", "kggggggggk", ".kkkkkkkk.", ".........."],
      ["..........", "..........", "..........", "......kkkk", "...kkkgggk", ".kkGggggk.", "kGGggkkk..", "kkkkk....."],
    ];
    const pal = { k: "#2b2433", G: "#adc795", g: "#69866e" };
    return F.map((rows) => {
      const { c, ctx } = P.canvas(10, 8);
      rows.forEach((r, y) => r.split("").forEach((ch, x) => { if (pal[ch]) fill(ctx, pal[ch], x, y); }));
      return c;
    });
  };

  // ------------------------------------------------------------------ dusk scene
  // The instance scene, drawn as separate parallax layers so the camera can dive in.
  P.duskScene = function (W, H, seed) {
    const rnd = P.rng(seed);
    const layers = {};
    {
      const { c, ctx } = P.canvas(W, H);
      const bands = ["#141a36", "#1d2448", "#2c2f5c", "#46386a", "#6b4270", "#9a5470", "#c86f6a", "#e99a6c", "#f6c283"];
      const hz = H * 0.66;
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const f = Math.pow(Math.min(1, y / hz), 1.25) * (bands.length - 1);
        for (let x = 0; x < W; x++) {
          let i = Math.floor(f);
          const fr = f - i;
          if (fr > 0.75 && P.bayer(x, y) < (fr - 0.75) / 0.25) i++;
          const [r, g, b] = P.hex(bands[Math.min(bands.length - 1, i)]);
          const o = (y * W + x) * 4;
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      for (let i = 0; i < 90; i++) fill(ctx, rnd() < 0.2 ? "#ffffff" : "#aeb8e0", Math.floor(rnd() * W), Math.floor(rnd() * H * 0.36));
      for (let i = 0; i < 6; i++) {
        const y = Math.floor(H * (0.28 + rnd() * 0.26)), x = Math.floor(rnd() * W * 0.85), w = 20 + Math.floor(rnd() * 50);
        fill(ctx, i % 2 ? "#e0806e" : "#b8607a", x, y, w, 1);
      }
      layers.sky = c;
    }
    {
      const { c, ctx } = P.canvas(W, H);
      const cx = Math.round(W / 2), cy = Math.round(H * 0.47), r = Math.round(H * 0.13);
      const gap = Math.max(3, Math.round(r * 0.22));
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          const q = (x * x + y * y) / (r * r);
          if (q > 1) continue;
          let col = q > 0.78 ? "#ffd89a" : "#fff0c8";
          if (q < 0.3 && x < 0 && y < 0) col = "#fffaf0";
          if (y > r * 0.25 && (y - Math.round(r * 0.25)) % gap === 0) col = "#e99a6c";
          fill(ctx, col, cx + x, cy + y);
        }
      fill(ctx, "#ffd89a", cx - r - 10, cy + Math.round(r * 0.45), 2 * r + 20, 1);
      layers.sun = c;
    }
    const ridge = (base, amp, freq, cols, rough, seedOff) => {
      const { c, ctx } = P.canvas(W, H);
      const r2 = P.rng(seed + seedOff);
      const ph1 = r2() * 10, ph2 = r2() * 10;
      for (let x = 0; x < W; x++) {
        const n = Math.sin(x * freq + ph1) * 0.6 + Math.sin(x * freq * 2.3 + ph2) * 0.3 + (r2() - 0.5) * rough;
        const top = Math.round(base - amp * (0.5 + 0.5 * n));
        for (let y = top; y < H; y++) fill(ctx, y === top ? cols[0] : y < top + 2 ? cols[1] : cols[2], x, y);
      }
      return c;
    };
    layers.far = ridge(H * 0.7, H * 0.16, 0.035, ["#9a6a86", "#7a5078", "#5c3e66"], 0.05, 11);
    const pines = (base, hMin, hMax, cols, count, seedOff) => {
      const { c, ctx } = P.canvas(W, H);
      const r2 = P.rng(seed + seedOff);
      fill(ctx, cols[1], 0, Math.round(base), W, H);
      for (let i = 0; i < count; i++) {
        const x = Math.floor(r2() * W);
        const h = Math.round(hMin + r2() * (hMax - hMin));
        const b = Math.round(base + r2() * 4);
        for (let k = 0; k < h; k++) {
          const w = Math.max(0, Math.round((1 - k / h) * h * 0.3) - (k % 3 === 2 ? 1 : 0));
          fill(ctx, cols[1], x - w, b - k, w * 2 + 1, 1);
          if (w > 0) fill(ctx, cols[0], x - w, b - k, 1, 1);
        }
      }
      return c;
    };
    layers.mid = pines(H * 0.78, 10, 22, ["#4a3a64", "#382c50"], 70, 23);
    layers.near = pines(H * 0.9, 18, 40, ["#2a2140", "#1c162e"], 26, 37);
    layers.front = pines(H * 1.02, 40, 80, ["#15111f", "#0c0a14"], 7, 51);
    return layers;
  };

  // ------------------------------------------------------------------ buddy
  // Inline SVG holding every pose of the requested motions; poses are switched
  // from timeline time (see film.js), never by SMIL.
  P.buddy = function (motions) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("shape-rendering", "crispEdges");
    const map = {};
    motions.forEach((m) => {
      const def = window.BUDDY[m];
      map[m] = {};
      Object.keys(def.poses).forEach((id) => {
        const g = document.createElementNS(ns, "g");
        g.innerHTML = def.poses[id];
        g.style.display = "none";
        svg.appendChild(g);
        map[m][id] = g;
      });
    });
    let shown = null;
    return {
      svg,
      pose(motion, t) {
        const def = window.BUDDY[motion];
        const loops = motion === "idle" || motion === "sleep" || motion === "loading";
        const lt = loops ? ((t % def.dur) + def.dur) % def.dur : Math.max(0, Math.min(def.dur - 0.001, t));
        let id = def.frames[def.frames.length - 1].pose;
        for (const f of def.frames) if (lt >= f.a && lt < f.b) { id = f.pose; break; }
        const g = map[motion][id];
        if (g !== shown) {
          if (shown) shown.style.display = "none";
          g.style.display = "";
          shown = g;
        }
      },
    };
  };
})();
