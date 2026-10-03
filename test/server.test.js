// Integration test: HTTP + WebSocket server end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startGameServer } from '../lib/server.js';

test('server serves the game and runs a multiplayer session', async () => {
  const srv = await startGameServer({ port: 0, host: '127.0.0.1', bots: 3, log: () => {} });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const html = await (await fetch(base + '/')).text();
    assert.ok(html.includes('BACKROOMS'), 'index served');
    assert.equal((await fetch(base + '/js/../../server.js')).status, 404, 'no path traversal');
    const info = await (await fetch(base + '/info')).json();
    assert.equal(info.port, srv.port);
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const msgs = [];
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.send(JSON.stringify({ t: 'join', name: 'Test<script>' }));
    await new Promise((r) => setTimeout(r, 400));
    const welcome = msgs.find((m) => m.t === 'welcome');
    assert.ok(welcome && welcome.seed != null, 'welcome received');
    assert.ok(msgs.some((m) => m.t === 'snap'), 'snapshots stream');
    const roster = msgs.filter((m) => m.t === 'roster').pop();
    assert.equal(roster.list.length, 3, 'bots fill the remaining slots');
    assert.ok(!roster.list.some((p) => p.name.includes('<')), 'names are sanitized');
    ws.close();
  } finally {
    await srv.close();
  }
});

test('web clients see and keep the selected online bot count', async () => {
  const srv = await startGameServer({ port: 0, host: '127.0.0.1', bots: 3, log: () => {} });
  const sockets = [];
  const base = `http://127.0.0.1:${srv.port}`;
  const waitFor = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail('timed out waiting for server state');
  };
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    const messages = [];
    ws.on('message', (d) => messages.push(JSON.parse(d)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { ws, messages };
  };
  try {
    const a = await connect();
    a.ws.send(JSON.stringify({ t: 'join', name: 'A', bots: 2, mode: 'tdm', layout: 'arena', light: 'dim',
      appearance: { head: 'respirator', chest: 'jacket', legs: 'armored', palette: 'slate' } }));
    await waitFor(() => a.messages.some((m) => m.t === 'welcome') && a.messages.some((m) => m.t === 'spawn'));
    assert.equal(a.messages.find((m) => m.t === 'welcome').bots, 2);
    const firstInfo = await (await fetch(base + '/info')).json();
    assert.equal(firstInfo.players, 1);
    assert.equal(firstInfo.bots, 2);
    assert.equal(firstInfo.selectedBots, 2);
    assert.equal(firstInfo.mode, 'tdm'); assert.equal(firstInfo.layout, 'arena'); assert.equal(firstInfo.light, 'dim');
    assert.equal(firstInfo.capacity, 10); assert.equal(firstInfo.teamSlots, 5);
    const firstSpawn = a.messages.find((m) => m.t === 'spawn');
    assert.equal(firstSpawn.inv.p, 'm4'); assert.equal(firstSpawn.armor, 100);
    assert.equal(firstSpawn.appearance.head, 'respirator');

    const b = await connect();
    b.ws.send(JSON.stringify({ t: 'join', name: 'B', bots: 10, mode: 'escape', layout: 'escape', light: 'dark' }));
    await waitFor(() => b.messages.some((m) => m.t === 'welcome'));
    assert.equal(b.messages.find((m) => m.t === 'welcome').bots, 2);
    const info = await (await fetch(base + '/info')).json();
    assert.equal(info.players, 2);
    assert.equal(info.bots, 2);
    assert.equal(info.mode, 'tdm'); assert.equal(info.layout, 'arena'); assert.equal(info.light, 'dim', 'occupied room keeps its choices');
    b.ws.close();
    a.ws.close();
    await waitFor(() => srv.core.onlineBotCount === null);
  } finally {
    for (const ws of sockets) ws.terminate();
    await srv.close();
  }
});

test('escape role, correction, outcome and reset travel through the multiplayer protocol', async () => {
  const srv = await startGameServer({ port: 0, host: '127.0.0.1', bots: 0, mode: 'escape', log: () => {} });
  const sockets = [];
  const waitFor = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('timed out waiting for escape protocol');
  };
  const connect = async (name, role) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ t: 'join', name, role, mode: 'escape', layout: 'escape', light: 'normal', bots: 0 }));
    await waitFor(() => messages.some((m) => m.t === 'welcome') && messages.some((m) => m.t === 'spawn'));
    return { ws, messages, id: messages.find((m) => m.t === 'welcome').id };
  };
  try {
    const monster = await connect('Creature', 'monster');
    const survivor = await connect('Survivor', 'survivor');
    const welcome = survivor.messages.find((m) => m.t === 'welcome');
    assert.equal(welcome.mode, 'escape'); assert.equal(welcome.layout, 'escape'); assert.equal(welcome.light, 'dark');
    assert.equal(welcome.role, 'survivor'); assert.equal(welcome.esc.monster, monster.id); assert.equal(welcome.esc.total, 1);
    assert.equal(monster.messages.find((m) => m.t === 'spawn').inv.s, null, 'human creature is actually unarmed');
    const info = await (await fetch(`http://127.0.0.1:${srv.port}/info`)).json();
    assert.equal(info.esc.monster, monster.id); assert.equal(info.mode, 'escape'); assert.equal(info.layout, 'escape');
    const p = srv.core.players.get(monster.id), zone = srv.core.map.safeZones[0];
    Object.assign(p, { x: zone.x0 - 0.6, z: zone.z, y: 0 });
    monster.ws.send(JSON.stringify({ t: 'in', p: [zone.x0 + 0.6, 0, zone.z], yw: 0, f: 8, w: 'knife' }));
    await waitFor(() => monster.messages.some((m) => m.t === 'correct'));
    assert.equal(p.x, zone.x0 - 0.6, 'server rejects sanctuary entry');

    const human = srv.core.players.get(survivor.id), exit = srv.core.map.exit;
    Object.assign(human, { x: exit.x, z: exit.z, y: 0 });
    survivor.ws.send(JSON.stringify({ t: 'in', p: [exit.x, 0, exit.z], yw: 0, f: 0, w: 'pistol' }));
    await waitFor(() => survivor.messages.some((m) => m.t === 'match'));
    const match = survivor.messages.find((m) => m.t === 'match');
    assert.equal(match.outcome, 'escaped'); assert.equal(match.escaped, 1); assert.equal(match.total, 1);
    assert.equal(human.alive, false);
    assert.ok(survivor.messages.some((m) => m.t === 'escape' && m.action === 'escaped' && m.id === survivor.id));
    srv.core.intermission = srv.core.time + 0.01;
    await waitFor(() => survivor.messages.some((m) => m.t === 'reset'));
    const reset = survivor.messages.find((m) => m.t === 'reset');
    assert.equal(reset.mode, 'escape'); assert.equal(reset.layout, 'escape'); assert.equal(reset.esc.status, 'running');
    assert.equal(human.alive, true);
    const resetIndex = survivor.messages.findIndex((m) => m.t === 'reset');
    await waitFor(() => survivor.messages.slice(resetIndex + 1).some((m) => m.t === 'snap' && m.esc?.status === 'running'));
  } finally {
    for (const ws of sockets) ws.terminate();
    await srv.close();
  }
});
