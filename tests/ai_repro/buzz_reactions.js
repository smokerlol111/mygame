const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Use the client already bundled with Socket.IO and Node's built-in WebSocket.
const { io } = require('../../node_modules/socket.io/client-dist/socket.io.js');
const { startServer } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const server = await startServer();
  const sockets = [];
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  };
  const emit = (socket, event, data) => new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, data, (error, result) => error ? reject(error) : resolve(result));
  });
  try {
    const host = await connect();
    const created = await emit(host, 'createRoom', { hostToken: 'reaction-test', gameId: 'kinohardkor' });
    const code = created.code;
    const players = [];
    for (const name of ['A', 'B', 'C']) {
      const socket = await connect();
      const joined = await emit(socket, 'joinPlayer', { code, name });
      socket.playerId = joined.playerId;
      await emit(socket, 'reportNetworkStats', { code, rttMs: 20, jitterMs: 1, samples: 5 });
      players.push(socket);
    }
    await emit(host, 'skipFirstTurnQuiz', { code });
    await emit(host, 'chooseTile', { code, ci: 0, qi: 0 });
    const opened = await emit(host, 'openBuzz', { code });
    assert.equal(opened.ok, true);
    const early = await emit(players[2], 'buzz', { code, pressedAtServerTime: Date.now() });
    assert.equal(early.falseStart, true);
    await sleep(Math.max(0, opened.opensAt - Date.now()) + 50);
    const firstPress = Date.now();
    await emit(players[0], 'buzz', { code, pressedAtServerTime: firstPress });
    await sleep(15);
    const secondPress = Date.now();
    await emit(players[1], 'buzz', { code, pressedAtServerTime: secondPress });
    await sleep(130);
    const get = i => host.state.players.find(p => p.id === players[i].playerId);
    assert.equal(host.state.phase, 'answering');
    assert.equal(get(0).reactionMs, firstPress - opened.opensAt);
    assert.equal(get(1).reactionMs, secondPress - opened.opensAt);
    assert.equal(get(2).reactionMs, null);
    assert.equal((await emit(players[1], 'buzz', { code, pressedAtServerTime: Date.now() })).ok, false);
    const firstReaction = get(0).reactionMs;
    await emit(host, 'judge', { code, correct: false });
    await sleep(30);
    assert.equal(get(0).reactionMs, firstReaction);
    assert.equal(get(0).reactionWrong, true);
    assert.equal(get(1).reactionMs, null);
    const reopenedAt = host.state.buzzOpensAt;
    await sleep(Math.max(0, reopenedAt - Date.now()) + 40);
    assert.equal((await emit(players[0], 'buzz', { code, pressedAtServerTime: Date.now() })).ok, false);
    const retryPress = Date.now();
    await emit(players[1], 'buzz', { code, pressedAtServerTime: retryPress });
    await sleep(130);
    assert.equal(get(1).reactionMs, retryPress - reopenedAt);
    await emit(host, 'judge', { code, correct: false });
    await sleep(30);
    assert.equal(get(0).reactionWrong, true);
    assert.equal(get(1).reactionWrong, true);
    assert.equal(get(1).reactionMs, retryPress - reopenedAt);
    await sleep(Math.max(0, Math.max(get(2).falseStartUntil, host.state.buzzOpensAt) - Date.now()) + 40);
    await emit(players[2], 'buzz', { code, pressedAtServerTime: Date.now() });
    await sleep(130);
    assert.equal(typeof get(2).reactionMs, 'number');
    await emit(host, 'judge', { code, correct: true });
    await sleep(30);
    assert.equal(host.state.phase, 'result');
    assert.equal(get(0).reactionMs, firstReaction);
    assert.equal(get(1).reactionWrong, true);
    host.emit('nextFromResult', { code });
    await sleep(80);
    assert.equal(host.state.phase, 'board');
    for (const p of host.state.players) {
      assert.equal(p.reactionMs, null);
      assert.equal(p.reactionWrong, false);
    }

    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync('public/common.js', 'utf8'), context);
    const ui = context.window.GameUI;
    const buzzState = { phase: 'buzz', current: { type: 'normal' } };
    assert.match(ui.reactionHTML({ reactionMs: null }, buzzState), />—<\/span>/);
    assert.match(ui.reactionHTML({ reactionMs: 0 }, buzzState), />0 мс<\/span>/);
    assert.match(ui.reactionHTML({ reactionMs: 123, reactionWrong: true }, buzzState), /player-reaction wrong/);
    assert.match(ui.playersHTML([{ name: 'A', reactionMs: 123 }], null, buzzState), />123 мс<\/span>/);
    const comparedState = {
      phase: 'answering', current: { type: 'normal' }, buzzer: 'A',
      players: [{ id: 'A', reactionMs: 100 }, { id: 'B', reactionMs: 150 }],
    };
    assert.doesNotMatch(ui.reactionHTML(comparedState.players[1], comparedState), /late/);
    assert.doesNotMatch(ui.playersHTML(comparedState.players, 'A', comparedState), /late/);
    assert.match(ui.reactionHTML(comparedState.players[1], comparedState, true), /player-reaction late[^>]*>\(\+50 мс\)/);
    for (const phase of ['lobby','board','first_turn_quiz','first_turn_result','numeric_ready','numeric_question','numeric_result','final_ready','final_question','final_review','final_result','triplet_question','triplet_result']) {
      assert.equal(ui.reactionHTML({ reactionMs: 123 }, { ...buzzState, phase }), '');
    }
    for (const type of ['cat','va_bank','final']) {
      assert.equal(ui.reactionHTML({ reactionMs: 123 }, { phase: 'result', current: { type } }), '');
    }
    for (const type of ['normal','duel']) {
      for (const phase of ['question','buzz','answering','result']) {
        assert.match(ui.reactionHTML({ id: 'A', reactionMs: 123 }, { phase, current: { type }, duelPlayers: ['A','B'] }), /player-reaction/);
      }
    }
    const duelState = { phase: 'buzz', current: { type: 'duel' }, duelPlayers: ['A','B'] };
    assert.equal(ui.reactionHTML({ id: 'C', reactionMs: null }, duelState), '');
    assert.equal(ui.reactionHTML({ id: 'C', reactionMs: 123 }, duelState), '');
    assert.match(ui.reactionHTML({ id: 'B', reactionMs: null }, duelState), />—<\/span>/);
    const wrongPlayer = { id: 'A' };
    for (const type of ['normal','duel','cat','va_bank']) {
      const state = { phase: 'result', current: { type }, answeringLocked: ['A'], duelPlayers: ['A','B'] };
      assert.equal(ui.wrongAnswerClass(wrongPlayer, state), 'answer-wrong');
      assert.equal(ui.wrongAnswerClass({ id: 'C' }, state), '');
      assert.equal(ui.wrongAnswerClass(wrongPlayer, { ...state, phase: 'board' }), '');
      assert.match(ui.playersHTML([wrongPlayer], null, state), /class="player\s+answer-wrong"/);
    }
    for (const phase of ['numeric_ready','numeric_question','numeric_result','first_turn_quiz','first_turn_result','final_question','final_result','triplet_question','triplet_result']) {
      assert.equal(ui.wrongAnswerClass(wrongPlayer, { phase, current: { type: 'normal' }, answeringLocked: ['A'] }), '');
    }
    assert.equal(ui.wrongAnswerClass(wrongPlayer, { phase: 'result', current: { type: 'normal', triplet: {} }, answeringLocked: ['A'] }), '');
    assert.equal(ui.wrongAnswerClass(wrongPlayer, { phase: 'result', current: { type: 'final' }, answeringLocked: ['A'] }), '');

    // Exercise the actual special-question judging handlers without starting another game.
    const serverSource = fs.readFileSync('server.js', 'utf8');
    for (const event of ['judgeCat','judgeVaBank']) {
      const start = serverSource.search(new RegExp(`  socket\\.on\\(["']${event}["']`));
      const end = serverSource.indexOf('\n  });', start) + '\n  });'.length;
      assert.ok(start >= 0 && end > start);
      for (const correct of [false,true]) {
        let handler;
        const room = { phase: event === 'judgeCat' ? 'cat_question' : 'va_bank_question', catReceiver: 'A', vaBankPlayer: 'A', vaBankBet: 100, current: { value: 100 }, players: [{ id: 'A', score: 200 }], answeringLocked: new Set() };
        vm.runInNewContext(serverSource.slice(start,end), {
          socket: { on: (_, fn) => { handler = fn; } }, getRoom: () => room,
          isHost: () => true, emitState: () => {}
        });
        handler({ code: 'TEST', correct });
        assert.equal(room.answeringLocked.has('A'), !correct);
        assert.equal(room.players[0].score, correct ? 300 : 100);
        assert.equal(room.phase, 'result');
      }
    }
    for (const file of ['public/host.html', 'public/play.html', 'public/screen.html']) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        new vm.Script(match[1], { filename: file });
      }
    }
    console.log('PASS: reaction timing, multiple presses, false start, late/locked presses, repeated resets, red markers, result retention, board reset, UI and script syntax');
  } finally {
    for (const socket of sockets) socket.disconnect();
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
