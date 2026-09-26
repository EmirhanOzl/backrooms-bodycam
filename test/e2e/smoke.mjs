// End-to-end smoke test in a real (headless) Chromium: boots the game, plays an offline match and
// exercises the core loop. Run with `npm run e2e` (needs `npx playwright install chromium` once).
// The offline match runs on the page thread (?noworker) so the test can stage situations.
import { chromium } from 'playwright';
import { startGameServer } from '../../lib/server.js';

const results = [];
const ok = (c, msg) => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); };
const srv = await startGameServer({ port: 0, host: '127.0.0.1', log: () => {} });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);

try {
  await page.goto(`http://127.0.0.1:${srv.port}/?noworker`);
  ok(await wait(() => window.__game && window.__game.state === 'menu' && window.__game.sound.ready, null, 90000), 'boots to the menu with the sound bank ready');
  await page.evaluate(() => { const b = document.getElementById('bots'); b.value = 3; b.oninput(); document.getElementById('btnOffline').click(); });
  ok(await wait(() => window.__game.state === 'game' && window.__game.me.alive, null, 90000), 'offline match starts');
  await page.evaluate(() => {
    const g = window.__game;
    g.locked = true; g.net.setPaused(false); document.getElementById('pause').classList.add('hidden');
    g.net.core.botThink = () => {}; // frozen bots: we stage the fights
  });

  // put a bot `dist` meters in front of us; face = 1 looks at us, -1 turns its back
  const stage = (dist, face, primary) => page.evaluate(async ({ dist, face, primary }) => {
    const M = await import('/js/shared/map.js');
    const g = window.__game, c = g.net.core, me = g.me;
    let a = null;
    for (let t = 0; t < 6.28; t += 0.2) if (M.raycast(g.map, me.pos.x, me.pos.z, -Math.sin(t), -Math.cos(t), dist + 1.5) >= dist + 1.4) { a = t; break; }
    const b = [...c.players.values()].find((p) => p.bot && p.alive);
    Object.assign(b, { x: me.pos.x - Math.sin(a) * dist, z: me.pos.z - Math.cos(a) * dist, protect: 0, hp: 100, armor: 0, primary, weapon: primary || 'pistol', yaw: face > 0 ? a + Math.PI : a });
    me.yaw = a; me.pitch = Math.atan2(1.15 - 1.42, dist);
    c.players.get(g.myId).protect = 1e9;
    return b.id;
  }, { dist, face, primary });
  const alive = (id) => page.evaluate((i) => window.__game.net.core.players.get(i).alive, id);

  let id = await stage(5, 1, 'm4');
  await wait((i) => { const g = window.__game, r = g.remotes.get(i), b = g.net.core.players.get(i); return r && Math.hypot(r.x - b.x, r.z - b.z) < 0.05; }, id);
  for (let i = 0; i < 10 && (await alive(id)); i++) {
    const mag = await page.evaluate(() => window.__game.cur().mag);
    await page.evaluate(() => { window.__game.fresh.l = true; });
    await wait((m) => window.__game.cur().mag < m, mag, 15000);
  }
  const shot = await page.evaluate((i) => { const g = window.__game; return { kills: g.me.kills, mag: g.cur().mag, feed: document.getElementById('feed').textContent, hp: g.net.core.players.get(i).hp }; }, id);
  ok(shot.kills > 0 || shot.hp <= 0, `pistol kills a bot (${JSON.stringify(shot)})`);
  ok(await wait(() => document.getElementById('feed').textContent.length > 0, null, 10000), 'kill feed updates');

  const picked = await page.evaluate(async () => {
    const g = window.__game, d = [...g.drops.values()].find((x) => x.w === 'm4');
    if (!d) return null;
    g.me.pos.x = d.x + 0.6; g.me.pos.z = d.z; Object.assign(g.net.core.players.get(g.myId), { x: g.me.pos.x, z: g.me.pos.z });
    g.me.yaw = Math.PI / 2; g.me.pitch = -0.6;
    for (let i = 0; i < 100 && !g.nearDrop; i++) await new Promise((r) => setTimeout(r, 100));
    g.lastUse = -9; g.interact();
    for (let i = 0; i < 100 && g.me.inv.primary?.w !== 'm4'; i++) await new Promise((r) => setTimeout(r, 100));
    return g.me.inv.primary?.w;
  });
  ok(picked === 'm4', 'dropped weapon can be picked up');

  await page.evaluate(() => window.__game.equip('melee'));
  await wait(() => window.__game.me.slot === 'melee' && !window.__game.vm.animName);
  id = await stage(1.1, -1, null);
  await wait((i) => { const g = window.__game, r = g.remotes.get(i), b = g.net.core.players.get(i); return r && Math.hypot(r.x - b.x, r.z - b.z) < 0.05; }, id);
  await page.evaluate(() => { window.__game.mouse.l = true; });
  await wait(() => window.__game.vm.animName === 'knife_light');
  await page.evaluate(() => { window.__game.mouse.l = false; });
  ok(await wait((i) => !window.__game.net.core.players.get(i).alive, id, 20000), 'knife backstab kills');

  await wait(() => [...window.__game.net.core.players.values()].filter((p) => p.bot && p.alive).length > 0, null, 30000);
  await stage(4, 1, null);
  await wait(() => !window.__game.vm.animName);
  await page.evaluate(() => { const g = window.__game; g.me.pitch = -0.35; g.me.inv.nades = 1; g.nadePress(); });
  await wait(() => window.__game.vm.animName === 'nade_pull' || window.__game.vm.animName === 'nade_hold');
  await page.evaluate(() => { window.__game.me.nadeHeld = false; });
  ok(await wait(() => window.__game.scorch.mesh.count > 0, null, 40000), 'grenade is thrown and explodes');

  await page.evaluate(() => window.__game.quitToMenu());
  ok(await wait(() => window.__game.state === 'menu' && !document.getElementById('menu').classList.contains('hidden')), 'quits back to the menu');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  ok(false, `exception: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
  await srv.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
