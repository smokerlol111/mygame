// Traverse every enabled game through its real Socket.IO protocol, with four players.
// Three independent rooms run at once on an isolated server; no saved season results.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = 'all-games-isolated';
const known = new Set([undefined, 'normal', 'text', 'emoji', 'triplet', 'numericClosest', 'audio', 'audioReveal', 'video', 'imageReveal']);

async function waitFor(check, label) {
  const deadline = Date.now() + 6000;
  while (!check()) { assert.ok(Date.now() < deadline, label); await sleep(15); }
}

async function play(server, meta, preparedGame) {
  const game = preparedGame || JSON.parse(fs.readFileSync(path.join(path.dirname(server.catalogPath), meta.file), 'utf8'));
  const sockets = [], formats = new Set(), fallbacks = [];
  let host, code, checked = 0, audienceQuestions = 0, firstTurn = false;
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };
  const ok = async (socket, event, payload = {}) => {
    const result = await socket.timeout(6000).emitWithAck(event, { code, ...payload });
    assert.equal(result.ok, true, `${meta.id}/${event}: ${JSON.stringify(result)}`);
    return result;
  };
  try {
    const assets = new Set();
    const collect = object => {
      for (const [field, value] of Object.entries(object || {})) {
        if (typeof value === 'string' && value.startsWith('/') && /^(media|image|audio|video|answerImage|answerVideo|answerAudio|answerAudioFile)$/.test(field)) assets.add(value);
        else if (value && typeof value === 'object') collect(value);
      }
    };
    collect(game);
    for (const asset of assets) {
      assert.ok(fs.statSync(path.join(REPO_ROOT, 'public', asset.slice(1))).size > 0, asset);
      assert.equal((await fetch(server.url + asset, { method: 'HEAD' })).status, 200, asset);
    }
    host = await connect();
    ({ code } = await ok(host, 'createRoom', { hostKey: key, gameId: meta.id }));
    const players = [];
    for (let i = 0; i < 4; i++) {
      const socket = await connect();
      socket.playerId = (await ok(socket, 'joinPlayer', { name: `Team${i}` })).playerId;
      players.push(socket);
    }
    const sync = async () => {
      for (const socket of players) await ok(socket, 'reportNetworkStats', { rttMs: 20, jitterMs: 1, samples: 5 });
    };
    await ok(host, 'startGame');
    if (game.firstTurnQuiz) {
      firstTurn = true;
      await ok(host, 'startFirstTurnTimer');
      for (const [i, socket] of players.entries()) await ok(socket, 'submitFirstTurnAnswer', { answer: Number(game.firstTurnQuiz.answer) + i });
      await ok(host, 'revealFirstTurnResults');
      for (const socket of players) await ok(host, 'revealNextFirstTurnResult');
      await ok(host, 'beginRoundOne');
    }
    for (const socket of players) await ok(host, 'adjustScore', { playerId: socket.playerId, amount: 10000 });
    for (let ri = 0; ri < game.rounds.length; ri++) {
      if (ri) await ok(host, 'nextRound');
      let normalBuzzChecked = false;
      for (const [ci, category] of game.rounds[ri].categories.entries()) for (const [qi, q] of category.questions.entries()) {
        const tile = `${ri}:${ci}:${qi}`;
        await ok(host, 'chooseTile', { ci, qi });
        await waitFor(() => host.state?.phase !== 'board' && host.state?.current?.ci === ci && host.state.current.qi === qi, meta.id + '/' + tile);
        const current = host.state.current;
        assert.equal(current.a, '', tile + ': answer hidden');
        assert.equal(host.state.activeQuestion.a, '', tile + ': active answer hidden');
        formats.add(current.type === 'normal' ? q.type || 'text' : current.type);
        if (!known.has(q.type)) fallbacks.push({ tile, type: q.type, observedPhase: host.state.phase });
        if (current.type === 'cat') {
          const receiver = players.find(socket => socket.playerId !== host.state.catChooser);
          const correct = qi % 2 === 0;
          const before = host.state.players.find(player => player.id === receiver.playerId).score;
          await ok(host, 'selectCatReceiver', { playerId: receiver.playerId });
          await ok(host, 'judgeCat', { correct });
          await waitFor(() => host.state.phase === 'result', tile + '/cat');
          assert.equal(host.state.players.find(player => player.id === receiver.playerId).score, before + (correct ? current.value : -current.value));
        } else if (current.type === 'va_bank') {
          const chooser = players.find(socket => socket.playerId === host.state.vaBankPlayer);
          const before = host.state.players.find(player => player.id === chooser.playerId).score;
          const bet = Math.min(100, Math.max(0, before)), correct = qi % 2 === 0;
          await ok(chooser, 'submitVaBankBet', { bet });
          await ok(host, 'judgeVaBank', { correct });
          await waitFor(() => host.state.phase === 'result', tile + '/va_bank');
          assert.equal(host.state.players.find(player => player.id === chooser.playerId).score, before + (correct ? bet : -bet));
        } else if (current.type === 'duel') {
          const opponent = players.find(socket => socket.playerId !== host.state.turnPlayerId);
          await ok(host, 'selectDuelOpponent', { playerId: opponent.playerId });
          await sync();
          const opened = await ok(host, 'openDuelBuzz');
          await sleep(Math.max(0, opened.opensAt - Date.now() + 35));
          await ok(opponent, 'buzz', { pressedAtServerTime: Date.now() });
          await waitFor(() => host.state.phase === 'answering', tile + '/duel');
          await ok(host, 'judge', { correct: true });
        } else if (q.type === 'numericClosest') {
          await ok(host, 'startNumericTimer');
          const before = host.state.players.find(player => player.id === players[0].playerId).score;
          for (const [i, socket] of players.entries()) await ok(socket, 'submitNumericAnswer', { answer: Number(q.numericAnswer) + i });
          await ok(host, 'finishNumericQuestion');
          for (const socket of players) await ok(host, 'revealNextNumeric');
          await ok(host, 'finishNumericResult');
          await waitFor(() => host.state.phase === 'board', tile + '/numeric');
          assert.equal(host.state.players.find(player => player.id === players[0].playerId).score, before + q.value);
        } else if (q.type === 'triplet') {
          for (const [i, part] of q.triplet.entries()) {
            assert.equal(host.state.current.q, part.q);
            await ok(host, 'judgeTriplet', { correct: i % 2 === 0 });
            await waitFor(() => host.state.phase === 'triplet_result', tile + '/triplet');
            assert.equal(host.state.current.a, part.a);
            await ok(host, 'nextTriplet');
            await waitFor(() => ['triplet_question', 'board'].includes(host.state.phase), tile + '/next-part');
          }
        } else {
          if (['imageReveal', 'audioReveal'].includes(q.type)) {
            const event = q.type === 'imageReveal' ? 'revealImageStep' : 'revealAudioStep';
            for (let stage = 1; stage < current.revealValues.length; stage++) {
              await ok(host, event);
              await waitFor(() => host.state.current.revealStage === stage, tile + '/reveal-stage');
              assert.equal(host.state.current.value, current.revealValues[stage]);
            }
          }
          if (!normalBuzzChecked && [undefined, 'text', 'normal', 'emoji'].includes(q.type)) {
            await sync();
            const opened = await ok(host, 'openBuzz');
            await sleep(Math.max(0, opened.opensAt - Date.now() + 35));
            await ok(players[0], 'buzz', { pressedAtServerTime: Date.now() });
            await waitFor(() => host.state.phase === 'answering', tile + '/buzz');
            await ok(host, 'judge', { correct: true });
            normalBuzzChecked = true;
          } else host.emit('revealAnswer', { code });
        }
        if (!(current.type === 'normal' && ['numericClosest', 'triplet'].includes(q.type))) {
          await waitFor(() => host.state.phase === 'result', tile + '/result');
          assert.equal(host.state.current.a, q.cat ? q.cat.a : q.a);
          host.emit('nextFromResult', { code });
        }
        await waitFor(() => host.state.phase === 'board' && host.state.used[tile], tile + '/board');
        assert.equal(host.state.current, null);
        checked++;
      }
      if (game.audienceRounds?.[ri]) {
        const viewer = await connect();
        await ok(host, 'openAudienceRound', { roundIndex: ri });
        await ok(viewer, 'joinAudience', { name: 'Viewer' + ri });
        for (const q of game.audienceRounds[ri].questions) {
          await ok(host, 'startAudienceQuestion');
          await ok(viewer, 'submitAudienceAnswer', { option: q.correct });
          await ok(host, 'finishAudienceQuestion');
          audienceQuestions++;
        }
        await ok(host, 'finishAudienceRound');
        await ok(host, 'revealNextAudience');
        await ok(host, 'closeAudienceRound');
      }
      console.log(`PASS ${meta.id}: round ${ri + 1}, ${checked} cumulative cells`);
    }
    await ok(host, 'startFinalBets');
    for (const socket of players) await ok(socket, 'submitBet', { bet: 100 });
    await ok(host, 'startFinalQuestion');
    await ok(host, 'startFinalTimer');
    for (const socket of players) await ok(socket, 'submitFinalAnswer', { answer: String(game.final.a) });
    host.emit('finishFinalNow', { code });
    await waitFor(() => host.state.phase === 'final_review', meta.id + '/final-review');
    await ok(host, 'scoreFinal', { results: players.map((socket, i) => ({ playerId: socket.playerId, correct: i % 2 === 0 })) });
    await waitFor(() => host.state.phase === 'final_result', meta.id + '/final-result');
    for (const row of host.state.finalResults) assert.equal(row.score, row.beforeScore + (row.correct ? row.bet : -row.bet));
    assert.equal(host.state.finalResults.length, 4);
    return { gameId: meta.id, passed: true, checked, firstTurn, audienceQuestions, assets: assets.size, formats: [...formats], fallbacks };
  } catch (error) {
    console.error('FAIL ' + meta.id + ': ' + error.stack);
    return { gameId: meta.id, passed: false, checked, error: error.message, fallbacks };
  } finally {
    if (host?.connected && code) await ok(host, 'closeRoom').catch(() => {});
    sockets.forEach(socket => socket.disconnect());
  }
}

async function main() {
  const server = await startServer({ HOST_KEY: key });
  const pending = JSON.parse(fs.readFileSync(server.catalogPath, 'utf8')).filter(meta => meta.enabled !== false);
  const results = [];
  try {
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (;;) { const meta = pending.shift(); if (!meta) break; results.push(await play(server, meta)); }
    }));
    assert.equal((await (await fetch(server.url + '/health')).json()).rooms, 0, 'all test rooms closed');
    if (process.env.QUIZ_TEST_ARTIFACT_DIR) fs.writeFileSync(path.join(process.env.QUIZ_TEST_ARTIFACT_DIR, 'all-games-summary.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('GAME SUMMARY: ' + JSON.stringify(results));
    assert.ok(results.every(result => result.passed), 'at least one game traversal failed');
    console.log(`PASS: ${results.length} enabled games, ${results.reduce((sum, result) => sum + result.checked, 0)} cells, ${results.reduce((sum, result) => sum + result.audienceQuestions, 0)} audience questions, first turns/finals, four players per room, no saved seasons`);
    if (results.some(result => result.fallbacks.length)) console.log('DATA FINDING: unsupported legacy types use the existing normal-question fallback; see all-games-summary.json and validate_games.log');
  } finally { server.stop(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports={play,key};
