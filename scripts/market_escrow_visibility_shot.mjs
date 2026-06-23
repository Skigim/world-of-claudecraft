// Before/after evidence for the World Market "listed goods vanish" fix.
// Boots the offline game, floods the shared market past the wire cap, then
// lists a stack of gear through the REAL HUD and screenshots the Browse tab.
// With the bug the seller's fresh listing is missing; with the fix it shows as
// "Reclaim". Needs `npm run dev` up. Output: tmp/market_escrow_<label>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.argv[2] ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1600,900','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#nav-btn-play')?.click());
await sleep(300);
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await sleep(300);
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  const nm = document.querySelector('#char-name'); if (nm) nm.value = 'Tester';
});
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, { timeout: 20000, polling: 200 });
await sleep(1200);

// Stand at the Merchant; flood the global market past the wire cap; stock bags.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
  const me = sim.player;
  const p = sim.groundPos(merchant.pos.x, merchant.pos.z - 3.2);
  me.pos = p; me.prevPos = { ...p }; me.facing = 0;
  sim.players.get(me.id).copper = 50000;
  let id = 100000;
  for (let i = 0; i < 150; i++) {
    sim.marketListings.push({
      id: id++, sellerKey: 'Flooder' + i, sellerName: 'Flooder' + i,
      itemId: 'roasted_boar', count: 1, price: 100, expiresAt: sim.time + 100000, house: false,
    });
  }
  sim.addItem('worn_sword', 2); // a stack of 2 gear
});

// List the stack of 2 through the real HUD sell flow.
await page.evaluate(() => window.__game.hud.openMarket());
await sleep(400);
await page.evaluate(() => document.querySelector('#market-window [data-tab="sell"]').click());
await sleep(300);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#bags .bag-item')].find((r) => /Worn Shortsword/.test(r.textContent));
  row.click();
});
await sleep(300);
await page.evaluate(() => {
  const q = document.querySelector('#mkt-qty'); if (q) q.value = '2';
  document.querySelector('#mkt-g').value = '0';
  document.querySelector('#mkt-s').value = '5';
  document.querySelector('#mkt-c').value = '0';
  document.querySelector('.mkt-list-btn').click();
});
await sleep(600);

// Back to unfiltered Browse — exactly what a seller sees after listing. Page to
// the end, where an alphabetically-late "Worn Shortsword" would sit.
await page.evaluate(() => window.__game.hud.openMarket());
await sleep(400);
for (let i = 0; i < 10; i++) {
  const advanced = await page.evaluate(() => {
    const next = document.querySelector('#market-body [data-market-page="next"]');
    if (next && !next.disabled) { next.click(); return true; }
    return false;
  });
  if (!advanced) break;
  await sleep(200);
}
await sleep(300);
const state = await page.evaluate(() => {
  const sim = window.__game.sim;
  const wire = window.__game.world.marketInfo.listings;
  const rows = [...document.querySelectorAll('#market-body .mkt-row')].filter((r) => /Worn Shortsword/.test(r.textContent));
  return {
    inBags: sim.countItem('worn_sword'),
    mineInWire: wire.some((l) => l.mine && l.itemId === 'worn_sword'),
    mineRowsOnPage: rows.length,
    reclaimVisible: rows.some((r) => /Reclaim/i.test(r.textContent)),
    totalListings: sim.marketListings.filter((l) => !l.house).length,
  };
});
console.log(`[${LABEL}] bags=${state.inBags} mineVisibleToSeller=${state.mineInWire} onPage=${state.mineRowsOnPage} reclaim=${state.reclaimVisible} totalListings=${state.totalListings}`);
await page.screenshot({ path: `tmp/market_escrow_${LABEL}.png` });
await browser.close();
process.exit(0);
