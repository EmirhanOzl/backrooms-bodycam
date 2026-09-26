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
