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
    let hostState, hostSecrets;
    let submittedPlayerIds = [];
    host.on('state', state => { hostState = state; });
    host.on('hostSecrets', secrets => { hostSecrets = secrets; });
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

    await emit(host, 'skipFirstTurnQuiz', { code });
    const game = require('../../games/general_knowledge.json');
    const tiles = game.rounds[0].categories.flatMap((category, ci) =>
      category.questions.map((question, qi) => ({ question, ci, qi })));
    const tile = tiles.find(({ question, ci, qi }) => !question.type && !hostSecrets.specialCells[`0:${ci}:${qi}`]);
    assert.ok(tile, 'ordinary text tile exists');
    await emit(host, 'chooseTile', { code, ci: tile.ci, qi: tile.qi });
    await waitFor(() => page.doc.querySelector('.question')?.textContent === tile.question.q, 'live question text on PLAYER', page.errors);
    assert.equal(hostState.activeQuestion.q, tile.question.q);
    assert.equal(hostState.activeQuestion.a, '');
    assert.equal(hostState.current.a, '');
    assert.equal(page.doc.querySelectorAll('.question').length, 1);
    await emit(host, 'openBuzz', { code });
    await waitFor(() => page.doc.getElementById('buzz'), 'BUZZ opens with question text', page.errors);
    assert.equal(page.doc.querySelector('.question').textContent, tile.question.q);
    console.log('PASS: live server sends the active prompt to PLAYER, keeps answers hidden and preserves the prompt during BUZZ');

    // Render server-shaped snapshots through the real PLAYER page in jsdom.
    // Disconnect first so live state updates cannot replace the UI fixtures.
    page.dom.window.eval('socket.disconnect()');
    const renderReaction = (phase, reactionMs, extra = {}) => {
      const snapshot = {
        ...hostState, phase, activeQuestion: null, current: { type: 'normal' },
        players: [
          { ...hostState.players[0], reactionMs, reactionWrong: false },
          { id: 'other-player', name: 'Other Player', score: 0, reactionMs: 999 },
        ],
        ...extra,
      };
      page.dom.window.eval(`state = ${JSON.stringify(snapshot)}; render();`);
      assert.equal(page.errors.length, 0, page.errors.join('; '));
      return page.doc.querySelector('.top .player-reaction');
    };
    assert.equal(renderReaction('buzz', null).textContent, '-');
    assert.equal(renderReaction('answering', 0).textContent, '0 мс');
    assert.equal(renderReaction('answering', 123.4).textContent, '123 мс');
    assert.match(page.doc.querySelector('.top').textContent, /Час реакції:/);
    assert.equal(page.doc.querySelectorAll('.player-reaction').length, 1);
    const wrongPlayers = [{ ...hostState.players[0], reactionMs: 234, reactionWrong: true }];
    assert.equal(renderReaction('buzz', null, { players: wrongPlayers }).classList.contains('wrong'), true);
    assert.equal(renderReaction('result', null, { players: wrongPlayers }).textContent, '234 мс');
    assert.equal(renderReaction('question', null).textContent, '-');
    assert.equal(renderReaction('buzz', 345, { current: { type: 'duel' }, duelPlayers: [playerId, 'other-player'] }).textContent, '345 мс');
    assert.equal(renderReaction('buzz', 345, { current: { type: 'duel' }, duelPlayers: ['other-player'] }), null);
    const delta = () => page.doc.querySelector('.top .player-reaction.late');
    const answerer = { id: 'other-player', name: 'Answerer', score: 0, reactionMs: 100 };
    const renderCompared = (reactionMs, extra = {}) => renderReaction('answering', reactionMs, {
      buzzer: answerer.id,
      players: [{ ...hostState.players[0], reactionMs, reactionWrong: false }, answerer],
      ...extra,
    });
    assert.equal(renderCompared(150).textContent, '150 мс');
    assert.equal(delta().textContent, '(+50 мс)');
    // jsdom preserves CSS variables rather than resolving them to RGB values.
    assert.equal(page.dom.window.getComputedStyle(delta()).color, 'var(--bad)');
    assert.equal(renderCompared(null).textContent, '-');
    assert.equal(delta(), null);
    for (const reactionMs of [0, 100]) {
      renderCompared(reactionMs);
      assert.equal(delta(), null);
    }
    renderCompared(150, { buzzer: playerId });
    assert.equal(delta(), null);
    renderCompared(150, { players: [{ ...hostState.players[0], reactionMs: 150, reactionWrong: true }, answerer] });
    assert.equal(delta(), null);
    renderCompared(150, { players: [{ ...hostState.players[0], reactionMs: 150 }, { ...answerer, reactionMs: null }] });
    assert.equal(delta(), null);
    renderCompared(150, { phase: 'result' });
    assert.equal(delta().textContent, '(+50 мс)');
    renderCompared(150, { phase: 'buzz', buzzer: null });
    assert.equal(delta(), null);
    renderCompared(150, { current: { type: 'duel' }, duelPlayers: [playerId, answerer.id] });
    assert.equal(delta().textContent, '(+50 мс)');
    for (const phase of ['lobby', 'paused', 'final_ready', 'numeric_result']) {
      assert.equal(renderReaction(phase, 123), null);
      assert.doesNotMatch(page.doc.querySelector('.top').textContent, /Час реакції:/);
    }
    assert.equal(renderReaction('result', 123, { current: { type: 'cat' } }), null);
    console.log('PASS: PLAYER shows its own reaction, red late-press difference, missing-time dash, resets and duel/phase visibility (simulated states)');

    const prompt = 'Текст запитання <img src=x onerror="alert(1)"> & друга частина\nНовий рядок';
    const activeQuestion = { q: prompt };
    for (const phase of ['question', 'buzz', 'answering', 'duel_question', 'cat_question', 'va_bank_question', 'triplet_question', 'triplet_result', 'result', 'video_result', 'final_ready', 'final_question', 'final_review']) {
      renderReaction(phase, null, { activeQuestion });
      assert.equal(page.doc.querySelectorAll('.question').length, 1, phase);
      assert.equal(page.doc.querySelector('.question').textContent, prompt, phase);
      assert.equal(page.doc.querySelector('.question img'), null, 'prompt is escaped');
    }
    renderReaction('question', null, { activeQuestion: { q: prompt, questionType: 'emoji', emoji: '🎬' } });
    assert.equal(page.doc.querySelectorAll('.question').length, 1);
    assert.match(page.doc.getElementById('app').textContent, /🎬/);
    for (const phase of ['lobby', 'board', 'paused', 'cat_choose', 'duel_choose', 'va_bank_bet', 'final_bets']) {
      renderReaction(phase, null, { activeQuestion });
      assert.equal(page.doc.querySelector('.question'), null, phase);
    }
    renderReaction('question', null, { activeQuestion: { q: '' } });
    assert.equal(page.doc.querySelector('.question'), null);
    console.log('PASS: prompt appears once across active question phases, escapes HTML and stays hidden during selection/bets (simulated states)');
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
