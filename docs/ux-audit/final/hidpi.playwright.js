async (page) => {
  // Hi-DPI-Stichprobe: eigener Kontext mit deviceScaleFactor, Spielen und Bibliothek bei 1280×800.
  const SETTINGS = JSON.stringify({ state: { javaPath: '', memoryMb: null, msClientId: '', active: { kind: 'offline', name: 'Jonas' }, offlineAccounts: ['Jonas'], sidebarCollapsed: null }, version: 3 });
  const out = {};
  for (const scale of [1.25, 1.5]) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale });
    const p = await ctx.newPage();
    await p.goto('http://localhost:5188/404');
    await p.evaluate((v) => localStorage.setItem('launcher-settings', v), SETTINGS);
    for (const [name, url] of [['spielen', '/'], ['bibliothek', '/instances']]) {
      await p.goto('http://localhost:5188' + url);
      await p.waitForTimeout(1000);
      out[`${scale}/${name}`] = await p.evaluate(() => ({ dpr: devicePixelRatio, docOverflow: document.documentElement.scrollWidth > innerWidth }));
      await p.screenshot({ path: `docs/ux-audit/final/browser/hidpi-${scale}x/1280x800-${name}.png`, scale: 'device' });
    }
    await ctx.close();
  }
  return JSON.stringify(out);
}
