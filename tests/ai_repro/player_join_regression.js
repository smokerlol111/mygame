// Real PLAYER page + isolated server: manual join, reload and Socket.IO reconnect.
// Requires the same socket.io-client/jsdom dependencies as host_reload_repro.js.
// Usage: node tests/ai_repro/player_join_regression.js
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer } = require('./lib/server');

// Socket.IO invokes async browser callbacks outside jsdom's error event handling.
// Record them so assertions can fail while still closing the isolated server.
const callbackErrors = [];
process.on('uncaughtException', error => callbackErrors.push(error.message));
process.on('unhandledRejection', error => callbackErrors.push(error?.message || String(error)));

async function waitFor(check, label, errors = []) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.equal(callbackErrors.length, 0, callbackErrors.join('; '));
    assert.equal(errors.length, 0, `${label}: ${errors.join('; ')}`);
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(callbackErrors.length, 0, callbackErrors.join('; '));
  assert.equal(errors.length, 0, errors.join('; '));
}

async function emit(socket, event, payload) {
  const result = await socket.timeout(3000).emitWithAck(event, payload);
  assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
  return result;
}

async function loadPlayer(url, savedSession = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.detail?.message || error.message));
  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole,
    beforeParse(win) {
      for (const [key, value] of Object.entries(savedSession)) win.localStorage.setItem(key, value);
      // jsdom has no media playback. Keep the real elements and event handlers.
      win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      win.HTMLMediaElement.prototype.pause = function () {};
      win.HTMLMediaElement.prototype.load = function () {};
      win.alert = message => errors.push(`Unexpected alert: ${message}`);
    },
  });
  return { dom, errors, doc: dom.window.document };
}

(async () => {
  let server, host, page;
  try {
    server = await startServer();
    host = io(server.url, { transports: ['websocket'], reconnection: false });
    let hostState;
    let submittedPlayerIds = [];
    host.on('state', state => { hostState = state; });
    host.on('firstTurnProgress', progress => { submittedPlayerIds = progress.submittedPlayerIds; });
    await waitFor(() => host.connected, 'host connection');
    const { code } = await emit(host, 'createRoom', { hostToken: 'player-join-regression', gameId: 'general-knowledge' });
    const url = `${server.url}/play?room=${code}`;
    page = await loadPlayer(url);
    await waitFor(() => page.doc.getElementById('join'), 'login form', page.errors);
    page.doc.getElementById('name').value = 'Test Player';
    page.doc.getElementById('join').click();
    await waitFor(() => page.doc.getElementById('leaveRoom'), 'manual join renders lobby', page.errors);
    assert.match(page.doc.getElementById('app').textContent, /Ви в грі/);
    await waitFor(() => hostState?.players.length === 1, 'host sees player');
    const playerId = hostState.players[0].id;
    const video = page.doc.getElementById('playerVideo');
    const audio = page.doc.getElementById('playerAudio');
    await emit(host, 'startGame', { code });
    await waitFor(() => /Розіграш першого ходу/.test(page.doc.getElementById('app').textContent), 'first-turn screen', page.errors);
    assert.equal(page.doc.getElementById('playerVideo'), video);
    assert.equal(page.doc.getElementById('playerAudio'), audio);
    console.log('PASS: manual join and game start render; persistent media elements survive');

    const session = Object.fromEntries(['sgCode', 'sgPlayerId', 'sgPlayerKey', 'sgPlayerName']
      .map(key => [key, page.dom.window.localStorage.getItem(key)]));
    page.dom.window.eval('socket.disconnect()');
    page.dom.window.close();
    page = await loadPlayer(url, session);
    await waitFor(() => /Розіграш першого ходу/.test(page.doc.getElementById('app').textContent), 'reload restores game', page.errors);
    assert.equal(page.dom.window.localStorage.getItem('sgPlayerId'), playerId);
    assert.equal(hostState.players.length, 1);
    console.log('PASS: reload restores the same player during the game');

    page.dom.window.eval('socket.disconnect(); socket.connect()');
    await waitFor(() => page.doc.getElementById('netBadge').textContent.includes('Онлайн'), 'socket reconnect', page.errors);
    await emit(host, 'startFirstTurnTimer', { code });
    await waitFor(() => page.doc.getElementById('firstTurnAnswer'), 'answer input after reconnect', page.errors);
    page.doc.getElementById('firstTurnAnswer').value = '123';
    page.doc.getElementById('sendFirstTurn').click();
    await waitFor(() => /Відповідь зафіксовано/.test(page.doc.getElementById('app').textContent), 'answer confirmation', page.errors);
    await waitFor(() => submittedPlayerIds.includes(playerId), 'host receives answer');
    assert.equal(hostState.players.length, 1);
    console.log('PASS: reconnect restores the session and the host receives the answer');
  } finally {
    if (page) {
      page.dom.window.eval('socket.disconnect()');
      page.dom.window.close();
    }
    host?.close();
    server?.stop();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
