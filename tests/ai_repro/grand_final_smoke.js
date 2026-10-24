// Full Grand Final content traversal on an isolated server. Checks files/HTTP,
// not browser video decoding, audio output or the exact frame of STOP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');
const game = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'games/season2_grand_final.json'), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const end = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < end, label); await sleep(15); }
}
async function main() {
  const server = await startServer({ HOST_KEY: 'isolated-smoke' }), sockets = [];
  const connect = async () => {
    const s = io(server.url, { transports: ['websocket'], reconnection: false }); sockets.push(s);
    s.on('state', state => { s.state = state; });
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
    return s;
  };
  const ok = async (s, event, payload) => {
    const r = await s.timeout(5000).emitWithAck(event, payload);
    assert.equal(r.ok, true, `${event}: ${JSON.stringify(r)}`); return r;
  };
  try {
    const assets = new Set();
    const collect = obj => {
      for (const value of Object.values(obj)) {
        if (typeof value === 'string' && /^\/(media|images|sounds)\//.test(value)) assets.add(value);
        else if (value && typeof value === 'object') collect(value);
      }
    };
    collect(game);
    for (const asset of assets) {
      assert.ok(fs.statSync(path.join(REPO_ROOT, 'public', asset.slice(1))).size > 0, asset);
      assert.equal((await fetch(server.url + asset, { method: 'HEAD' })).status, 200, asset);
    }
    const host = await connect();
    const { code } = await ok(host, 'createRoom', { hostKey: 'isolated-smoke', hostToken: 'smoke', gameId: game.id });
    const players = [];
    for (let i = 0; i < 4; i++) {
      const s = await connect();
      const joined = await ok(s, 'joinPlayer', { code, name: `P${i}` });
      s.playerId = joined.playerId; players.push(s);
    }
    const started = await ok(host, 'startGame', { code });
    for (let ri = 0; ri < 2; ri++) {
      const keys = Object.keys(started.specialCells).filter(k => k.startsWith(ri + ':'));
      assert.equal(keys.length, 3);
      for (const kind of ['cat', 'duel', 'va_bank']) assert.equal(keys.filter(k => started.specialCells[k] === kind).length, 1);
    }
    assert.equal(started.specialCells['1:1:2'], 'va_bank');
    await ok(host, 'startFirstTurnTimer', { code });
    for (let i = 0; i < players.length; i++) await ok(players[i], 'submitFirstTurnAnswer', { code, answer: game.firstTurnQuiz.answer + i });
    await ok(host, 'revealFirstTurnResults', { code });
    for (let i = 0; i < 4; i++) await ok(host, 'revealNextFirstTurnResult', { code });
    await ok(host, 'beginRoundOne', { code });
    for (const p of players) await ok(host, 'adjustScore', { code, playerId: p.playerId, amount: 1000 });
    let checked = 0;
    const formats = new Set();
    for (let ri = 0; ri < 2; ri++) {
      if (ri) await ok(host, 'nextRound', { code });
      for (let ci = 0; ci < 5; ci++) for (let qi = 0; qi < 5; qi++) {
        const key = `${ri}:${ci}:${qi}`, q = game.rounds[ri].categories[ci].questions[qi];
        await ok(host, 'chooseTile', { code, ci, qi });
        await waitFor(() => host.state?.current?.ci === ci && host.state.current.qi === qi && host.state.phase !== 'board', key);
        const current = host.state.current;
        assert.equal(current.a, '', 'answer hidden before judging');
        formats.add(current.type === 'normal' ? (q.type || 'text') : current.type);
        if (q.media) assert.equal(current.media, q.media);
        if (q.type === 'imageReveal') {
          assert.equal(host.state.phase, 'question', 'photo BUZZ is manual');
          assert.equal(current.image, q.image);
        }
        if (q.type === 'video') assert.equal(current.pauseAt, q.pauseAt ?? q.stopAt);
        if (current.type === 'cat') {
          const receiver = players.find(p => p.playerId !== host.state.turnPlayerId);
          await ok(host, 'selectCatReceiver', { code, playerId: receiver.playerId });
          await ok(host, 'judgeCat', { code, correct: true });
        } else if (current.type === 'va_bank') {
          const chooser = players.find(p => p.playerId === host.state.vaBankPlayer);
          await ok(chooser, 'submitVaBankBet', { code, bet: 100 });
          await ok(host, 'judgeVaBank', { code, correct: true });
        } else if (current.type === 'duel') {
          const opponent = players.find(p => p.playerId !== host.state.turnPlayerId);
          await ok(host, 'selectDuelOpponent', { code, playerId: opponent.playerId });
          const opened = await ok(host, 'openDuelBuzz', { code });
          await sleep(Math.max(0, opened.opensAt - Date.now() + 30));
          await ok(opponent, 'buzz', { code, pressedAtServerTime: Date.now() });
          await waitFor(() => host.state.phase === 'answering', 'duel winner');
          await ok(host, 'judge', { code, correct: true });
        } else if (q.type === 'numericClosest') {
          await ok(host, 'startNumericTimer', { code });
          for (let i = 0; i < players.length; i++) await ok(players[i], 'submitNumericAnswer', { code, answer: q.numericAnswer + i });
          await ok(host, 'finishNumericQuestion', { code });
          for (let i = 0; i < 4; i++) await ok(host, 'revealNextNumeric', { code });
          await ok(host, 'finishNumericResult', { code });
        } else if (q.type === 'triplet') {
          for (const part of q.triplet) {
            assert.equal(host.state.current.q, part.q);
            await ok(host, 'judgeTriplet', { code, correct: true });
            await waitFor(() => host.state.phase === 'triplet_result', 'triplet result');
            assert.equal(host.state.current.a, part.a);
            await ok(host, 'nextTriplet', { code });
            await waitFor(() => ['triplet_question', 'board'].includes(host.state.phase), 'next triplet');
          }
        } else {
          host.emit('revealAnswer', { code });
        }
        if (!['numericClosest', 'triplet'].includes(q.type)) {
          await waitFor(() => host.state.phase === 'result', key + ' result');
          assert.equal(host.state.current.a, q.cat?.a || q.a);
          if (q.type === 'imageReveal') assert.equal(host.state.current.image, q.image, 'photo remains in result');
          host.emit('nextFromResult', { code });
        }
        await waitFor(() => host.state.phase === 'board' && host.state.used[key], key + ' back to board');
        checked++;
      }
      const viewer = await connect();
      await ok(host, 'openAudienceRound', { code, roundIndex: ri });
      await ok(viewer, 'joinAudience', { code, name: `Viewer${ri}` });
      for (const q of game.audienceRounds[ri].questions) {
        await ok(host, 'startAudienceQuestion', { code });
        await ok(viewer, 'submitAudienceAnswer', { code, option: q.correct });
        await ok(host, 'finishAudienceQuestion', { code });
      }
      await ok(host, 'finishAudienceRound', { code });
      await ok(host, 'revealNextAudience', { code });
      await ok(host, 'closeAudienceRound', { code });
      console.log(`PASS: round ${ri + 1}, 25 cells and 3 audience questions`);
    }
    await ok(host, 'startFinalBets', { code });
    for (const p of players) await ok(p, 'submitBet', { code, bet: 100 });
    await ok(host, 'startFinalQuestion', { code });
    await ok(host, 'startFinalTimer', { code });
    for (const p of players) await ok(p, 'submitFinalAnswer', { code, answer: 'Answer' });
    host.emit('finishFinalNow', { code });
    await waitFor(() => host.state.phase === 'final_review', 'final judging');
    await ok(host, 'scoreFinal', { code, results: [{ playerId: players[0].playerId, correct: true }] });
    await waitFor(() => host.state.phase === 'final_result', 'final results');
    assert.equal(host.state.finalResults.length, 4);
    assert.equal((await fetch(server.url + '/health')).ok, true);
    assert.equal(checked, 50);
    console.log(`PASS: ${checked} cells, formats ${[...formats].join(', ')}, ${assets.size} nonempty assets/HTTP 200, first turn, 6 audience questions, real final and server health`);
  } finally {
    sockets.forEach(s => s.disconnect()); server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
