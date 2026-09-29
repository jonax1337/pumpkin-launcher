async (page) => {
  const BASE = 'http://localhost:5188';
  const OUT = 'docs/ux-audit/final/browser';
  const SIZES = [[800, 600], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];
  const SETTINGS = JSON.stringify({ state: { javaPath: '', memoryMb: null, msClientId: '', active: { kind: 'offline', name: 'Jonas' }, offlineAccounts: ['Jonas', 'Steve_42'], sidebarCollapsed: null }, version: 3 });
  const EMPTY = JSON.stringify({ state: { javaPath: '', memoryMb: null, msClientId: '', active: null, offlineAccounts: [], sidebarCollapsed: null }, version: 3 });
  const seed = async (value) => { await page.goto(BASE + '/404'); await page.evaluate((v) => localStorage.setItem('launcher-settings', v), value); };
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const clickPlay = () => page.getByRole('button', { name: /spielen$/ }).first().click();

  // Prüft horizontales Überlaufen. Pseudo-Elemente (unsichtbare Klickflächen von Schaltern) zählen nicht mit.
  // doc: Seite breiter als das Fenster. clipped: abgeschnittener Inhalt ohne Ellipse. spill: Inhalt ragt sichtbar
  // über sein Element hinaus. untitled: per Ellipse gekürzter Text ohne title. Scrollende Bereiche und sr-only zählen nicht.
  const check = () => page.evaluate(() => {
    const off = document.createElement('style');
    off.textContent = '*::before, *::after { content: none !important; }';
    document.head.append(off);
    const doc = document.documentElement.scrollWidth > window.innerWidth;
    const clipped = [], spill = [], untitled = [];
    const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} (${el.scrollWidth}>${el.clientWidth})`;
    for (const el of document.querySelectorAll('body *')) {
      if (el.clientWidth <= 1 || el.scrollWidth <= el.clientWidth + 1) continue;
      if (el.closest('[data-sonner-toaster], rookery-cursor')) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      if (cs.textOverflow === 'ellipsis') {
        if (!el.closest('[title]')) untitled.push(el.textContent.trim().slice(0, 40));
      } else if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') clipped.push(name(el));
      else spill.push(name(el));
    }
    off.remove();
    return { doc, clipped: clipped.slice(0, 5), spill: spill.slice(0, 5), untitled: untitled.slice(0, 5) };
  });
  const hideCursor = () => page.evaluate(() => document.querySelectorAll('rookery-cursor').forEach((c) => (c.style.display = 'none')));

  const VIEWS = [
    ['spielen', async () => { await seed(SETTINGS); await page.goto(BASE + '/'); await settle(); }],
    ['bibliothek', async () => { await page.goto(BASE + '/instances'); await settle(); }],
    ['instanz-inhalte', async () => { await page.goto(BASE + '/instances/inst-survival?tab=content'); await settle(1800); }],
    ['instanz-einstellungen', async () => { await page.goto(BASE + '/instances/inst-survival?tab=settings'); await settle(); }],
    ['instanz-protokoll', async () => { await page.goto(BASE + '/instances/inst-vanilla?tab=console'); await settle(); await clickPlay(); await page.waitForTimeout(13000); await page.mouse.move(1, 1); }],
    ['entdecken', async () => { await page.goto(BASE + '/discover'); await settle(3000); await page.locator('input[type=search]').blur(); }],
    ['entdecken-details', async () => { await page.goto(BASE + '/discover?projekt=1KVo5zza'); await settle(3000); }],
    ['einstellungen', async () => { await page.goto(BASE + '/settings'); await settle(); }],
    ['dialog-neu', async () => { await page.goto(BASE + '/instances'); await settle(); await page.getByRole('button', { name: 'Neu', exact: true }).click(); await settle(); await page.getByText('Erweitert').click(); await settle(400); }],
    ['fortschritt', async () => { await page.goto(BASE + '/'); await settle(); await clickPlay(); await page.waitForTimeout(1600); await page.mouse.move(1, 1); }],
    ['leerzustand', async () => { await page.goto(BASE + '/instances?mock=leer'); await settle(); }],
    ['onboarding', async () => { await seed(EMPTY); await page.goto(BASE + '/?mock=leer'); await settle(1200); }],
  ];

  const only = globalThis.__views;
  const results = {};
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const [name, open] of VIEWS) {
      if (only && !only.includes(name)) continue;
      await open();
      results[`${w}x${h}/${name}`] = await check();
      await hideCursor();
      await page.screenshot({ path: `${OUT}/${w}x${h}/${name}.png` });
    }
  }
  return JSON.stringify(results);
}
