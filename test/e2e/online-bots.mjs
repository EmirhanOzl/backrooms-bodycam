// Browser smoke test for the multiplayer bot selector and the live server state.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { startGameServer } from '../../lib/server.js';

const srv = await startGameServer({ port: 0, host: '127.0.0.1', log: () => {} });
let browser;
let friend;
const waitForServer = async (condition) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail('timed out waiting for server state');
};

try {
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${srv.port}/`);
  await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 90000 });
  await page.click('#nav button[data-p="online"]');
  await page.waitForFunction(() => !document.getElementById('btnOnline').disabled);
  await page.locator('#onlineBots').focus();
  await page.locator('#onlineBots').press('Home');
  assert.equal(await page.locator('#onlineBotsv').textContent(), '0');
  await page.click('#btnOnline');
  await page.waitForFunction(() => window.__game?.state === 'game', null, { timeout: 90000 });
  await waitForServer(() => srv.core.onlineBotCount === 0);
  assert.equal([...srv.core.players.values()].filter((p) => p.bot).length, 0);

  friend = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  await new Promise((resolve, reject) => { friend.once('open', resolve); friend.once('error', reject); });
  friend.send(JSON.stringify({ t: 'join', name: 'Friend', bots: 10 }));
  await waitForServer(() => [...srv.core.players.values()].filter((p) => !p.bot).length === 2);
  assert.equal([...srv.core.players.values()].filter((p) => p.bot).length, 0);

  await page.evaluate(() => window.__game.quitToMenu());
  await page.waitForFunction(() => document.getElementById('onlineBots').disabled && document.getElementById('onlineBotsv').textContent === '0');
  friend.close();
  await waitForServer(() => srv.core.onlineBotCount === null);
  await page.click('#nav button[data-p="online"]');
  await page.waitForFunction(() => !document.getElementById('onlineBots').disabled);
  await page.locator('#onlineBots').focus();
  await page.locator('#onlineBots').press('End');
  assert.equal(await page.locator('#onlineBotsv').textContent(), '10');
  await page.click('#btnOnline');
  await page.waitForFunction(() => window.__game?.state === 'game', null, { timeout: 90000 });
  await waitForServer(() => srv.core.onlineBotCount === 10);
  assert.equal([...srv.core.players.values()].filter((p) => p.bot).length, 10);

  // The human creature has no firearm slot; the HUD must keep rendering and melee must remain usable.
  await page.evaluate(() => window.__game.quitToMenu());
  await waitForServer(() => [...srv.core.players.values()].every((p) => p.bot));
  await page.click('#nav button[data-p="online"]');
  await page.waitForFunction(() => !document.getElementById('onlineMode').disabled);
  await page.selectOption('#onlineMode', 'escape');
  await page.selectOption('#onlineRole', 'monster');
  await page.locator('#onlineBots').focus();
  await page.locator('#onlineBots').press('Home');
  await page.click('#btnOnline');
  await page.waitForFunction(() => window.__game?.state === 'game' && window.__game.me.role === 'monster', null, { timeout: 90000 });
  await page.locator('#pause:not(.hidden) #btnResume, body:has(#pause.hidden) #view').click();
  await page.waitForFunction(() => window.__game.locked);
  const creature = [...srv.core.players.values()].find((p) => !p.bot);
  assert.equal(creature.role, 'monster');
  assert.equal(await page.evaluate(() => window.__game.me.inv.secondary), null);
  await page.mouse.down();
  await waitForServer(() => creature.lastSwing >= creature.spawnT);
  await page.mouse.up();
  assert.equal(creature.weapon, 'knife');
  assert.equal(srv.core.onlineBotCount, 0);
  assert.equal(srv.core.escapeState().total, 1, 'an AI survivor makes the solo creature session playable');
  assert.deepEqual(pageErrors, []);
  console.log('PASS online selection: 0/10 bots, friend join, occupied settings, reset and playable human creature with no firearm');
} finally {
  friend?.terminate();
  await browser?.close();
  await srv.close();
}
