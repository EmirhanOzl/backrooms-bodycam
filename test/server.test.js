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
    a.ws.send(JSON.stringify({ t: 'join', name: 'A', bots: 2 }));
    await waitFor(() => a.messages.some((m) => m.t === 'welcome'));
    assert.equal(a.messages.find((m) => m.t === 'welcome').bots, 2);
    const firstInfo = await (await fetch(base + '/info')).json();
    assert.equal(firstInfo.players, 1);
    assert.equal(firstInfo.bots, 2);
    assert.equal(firstInfo.selectedBots, 2);

    const b = await connect();
    b.ws.send(JSON.stringify({ t: 'join', name: 'B', bots: 10 }));
    await waitFor(() => b.messages.some((m) => m.t === 'welcome'));
    assert.equal(b.messages.find((m) => m.t === 'welcome').bots, 2);
    const info = await (await fetch(base + '/info')).json();
    assert.equal(info.players, 2);
    assert.equal(info.bots, 2);
    b.ws.close();
    a.ws.close();
    await waitFor(() => srv.core.onlineBotCount === null);
    assert.equal((await (await fetch(base + '/info')).json()).bots, 3);
  } finally {
    for (const ws of sockets) ws.terminate();
    await srv.close();
  }
});
