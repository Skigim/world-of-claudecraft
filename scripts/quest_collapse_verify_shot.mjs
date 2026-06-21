// Verifies the SHIPPED collapsible quest tracker end to end: boots the offline
// game, injects the reference-image quests straight into the live questLog, then
// drives the real header toggle (the delegated click handler in hud.ts) and
// captures expanded + collapsed, confirming the round-trip and the "Quests (N)"
// collapsed header. Output: tmp/qt_real_{expanded,collapsed}.png (+ _full).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://[::1]:5173';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '..', 'tmp');
fs.mkdirSync(OUT, { recursive: true });
const CROP = { x: 1300, y: 250, width: 296, height: 320 };

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,1000', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await page.waitForSelector('#btn-offline', { timeout: 120000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 250));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game && window.__game.hud && window.__game.world, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// Inject the reference-image quests directly into the live quest log (acceptQuest
// needs a nearby giver NPC; this bypasses that for a deterministic tracker).
const injected = await page.evaluate(() => {
  const ql = window.__game.world.questLog;
  ql.clear();
  ql.set('q_wolves', { questId: 'q_wolves', counts: [3], state: 'active' });
  ql.set('q_murlocs', { questId: 'q_murlocs', counts: [2], state: 'active' });
  ql.set('q_spiders', { questId: 'q_spiders', counts: [6, 4], state: 'ready' }); // complete
  ql.set('q_boars', { questId: 'q_boars', counts: [1], state: 'active' });
  ql.set('q_mine', { questId: 'q_mine', counts: [4], state: 'active' });
  return ql.size;
});
console.log('injected quests:', injected);
await new Promise((r) => setTimeout(r, 600)); // let the per-frame update() repaint the tracker

const headerText = (label) => page.evaluate(() => document.querySelector('#quest-tracker .qt-header')?.textContent?.trim());
const expanded = (label) => page.evaluate(() => document.querySelector('#quest-tracker')?.querySelectorAll('.qt-title').length);

// --- Expanded (default) ---
console.log('expanded header:', await headerText(), '| quest rows:', await expanded());
await page.screenshot({ path: path.join(OUT, 'qt_real_expanded.png'), clip: CROP });
await page.screenshot({ path: path.join(OUT, 'qt_real_expanded_full.png') });

// --- Click the header -> collapsed (exercises the real toggle handler) ---
await page.click('#quest-tracker .qt-header');
await new Promise((r) => setTimeout(r, 300));
const collapsedHeader = await headerText();
const collapsedRows = await expanded();
console.log('collapsed header:', collapsedHeader, '| quest rows:', collapsedRows);
await page.screenshot({ path: path.join(OUT, 'qt_real_collapsed.png'), clip: CROP });
await page.screenshot({ path: path.join(OUT, 'qt_real_collapsed_full.png') });

// --- Click again -> expands back (round-trip) ---
await page.click('#quest-tracker .qt-header');
await new Promise((r) => setTimeout(r, 300));
const reExpandedRows = await expanded();
console.log('re-expanded quest rows:', reExpandedRows);

// --- Verify persistence: the setting was written ---
const persisted = await page.evaluate(() => window.__game.hud.optionsHooks.settings.get('questTrackerCollapsed'));
console.log('persisted questTrackerCollapsed (after 2 toggles):', persisted);

await browser.close();

console.log('\n=== checks ===');
console.log(collapsedRows === 0 ? 'PASS collapsed hides quest rows' : `FAIL collapsed still shows ${collapsedRows} rows`);
console.log(reExpandedRows === 5 ? 'PASS re-expand restores all 5 quests' : `FAIL re-expand shows ${reExpandedRows}`);
console.log(/\(\s*5\s*\)/.test(collapsedHeader || '') ? 'PASS collapsed header shows the (5) count' : `WARN collapsed header = "${collapsedHeader}"`);
if (errors.length) { console.log(`\n${errors.length} console/page errors:`); errors.slice(0, 10).forEach((e) => console.log('  ' + e)); }
else console.log('No console/page errors.');
