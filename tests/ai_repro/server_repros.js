// Live reproductions of bugs in found_bugs.md, against an isolated copy of server.js.
// Usage: node tests/ai_repro/server_repros.js [R01,R04,...]   (no argument = run all; R11/R21 take ~31 s)
// Exit code 1 = at least one bug still reproduces. 0 = none reproduced.
const { io } = require('socket.io-client');
const { startServer } = require('./lib/server');

const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
let URL = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sockets = [];

function connect() {
  return new Promise(resolve => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.lastState = null;
    s.on('state', st => { s.lastState = st; });
    s.on('connect', () => resolve(s));
    sockets.push(s);
  });
}
function emit(s, ev, payload = {}) {
  return new Promise(resolve => {
    let done = false;
    s.emit(ev, payload, res => { if (!done) { done = true; resolve(res); } });
    setTimeout(() => { if (!done) { done = true; resolve('<<no callback>>'); } }, 1500);
  });
}
async function makeRoom(gameId, playerNames) {
  const host = await connect();
  const r = await emit(host, 'createRoom', { hostToken: 'tok-' + Math.random(), gameId });
  const code = r.code;
  const players = [];
  for (const name of playerNames) {
    const s = await connect();
    const j = await emit(s, 'joinPlayer', { code, name, playerId: '' });
    s.playerId = j.playerId; s.name = name;
    await emit(s, 'reportNetworkStats', { code, rttMs: 20, jitterMs: 1, samples: 5 });
    players.push(s);
  }
  await sleep(50);
  return { host, code, players };
}
const scoreOf = (st, id) => st.players.find(p => p.id === id)?.score;
// Core recipe: board -> chooseTile -> openBuzz -> player buzz -> phase 'answering'.
async function toAnswering(room, ci, qi, buzzerIdx = 0) {
  const { host, code, players } = room;
  const c = await emit(host, 'chooseTile', { code, ci, qi });
  if (!c?.ok) throw new Error('chooseTile failed: ' + JSON.stringify(c));
  for (const p of players) await emit(p, 'reportNetworkStats', { code, rttMs: 20, jitterMs: 1, samples: 5 });
  const o = await emit(host, 'openBuzz', { code });
  if (!o?.ok) throw new Error('openBuzz failed: ' + JSON.stringify(o));
  await sleep(o.opensAt - Date.now() + 30);
  await emit(players[buzzerIdx], 'buzz', { code, pressedAtServerTime: Date.now() });
  await sleep(200);
  return host.lastState;
}
async function activeSeason() {
  const seasons = await (await fetch(`${URL}/api/seasons`)).json();
  return seasons.seasons.find(s => s.status === 'active');
}

const results = [];
function report(id, bug, title, expected, actual, reproduced) {
  results.push({ id, bug, reproduced });
  console.log(`\n[${id}] (${bug}) ${title}\n  expected: ${expected}\n  actual:   ${actual}\n  => ${reproduced ? 'REPRODUCED' : 'NOT REPRODUCED'}`);
}

const repros = {
  async R01() {
    const room = await makeRoom('kinohardkor', ['Alice', 'Bob']);
    await emit(room.host, 'skipFirstTurnQuiz', { code: room.code });
    const st = await toAnswering(room, 0, 0);
    const before = scoreOf(st, room.players[0].playerId);
    room.host.emit('judge', { code: room.code, correct: true }, () => {});
    room.host.emit('judge', { code: room.code, correct: true }, () => {});
    await sleep(200);
    const after = scoreOf(room.host.lastState, room.players[0].playerId);
    report('R01', 'EASY-01', 'Double "judge correct" (host double-click) awards points twice',
      `score ${before} -> ${before + 100} (question value 100)`, `score ${before} -> ${after}`, after === before + 200);
  },
  async R02() {
    const room = await makeRoom('kinohardkor', ['P1', 'P2', 'P3']);
    await emit(room.host, 'skipFirstTurnQuiz', { code: room.code });
    await sleep(100);
    const turnBefore = room.host.lastState.turnPlayerId;
    await toAnswering(room, 0, 0);
    await emit(room.host, 'judge', { code: room.code, correct: true });
    room.host.emit('nextFromResult', { code: room.code });
    room.host.emit('nextFromResult', { code: room.code });
    await sleep(200);
    const names = Object.fromEntries(room.players.map(p => [p.playerId, p.name]));
    const turnAfter = room.host.lastState.turnPlayerId;
    report('R02', 'EASY-02', 'Double "До дошки" (nextFromResult) skips the next player\'s turn',
      `turn ${names[turnBefore]} -> P2`, `turn ${names[turnBefore]} -> ${names[turnAfter]}`, names[turnAfter] === 'P3');
  },
  async R03() {
    const room = await makeRoom('kinohardkor', ['Victim', 'Other']);
    const spy = await connect(); // = anyone who knows the room code (shown on OBS / audience QR)
    await emit(spy, 'getAudienceState', { code: room.code });
    await sleep(50);
    const victimId = spy.lastState.players.find(p => p.name === 'Victim').id;
    const attacker = await connect();
    const j = await emit(attacker, 'joinPlayer', { code: room.code, name: 'HACKED', playerId: victimId });
    await sleep(100);
    const renamed = room.host.lastState.players.find(p => p.id === victimId)?.name;
    report('R03', 'PARK-03', 'Anyone with the room code can read player IDs from broadcast state and take over a player seat',
      'joinPlayer with another player\'s ID is rejected', `joinPlayer ok=${j?.ok}; victim now named "${renamed}"`, j?.ok === true && renamed === 'HACKED');
    await emit(room.host, 'skipFirstTurnQuiz', { code: room.code });
    await emit(room.host, 'chooseTile', { code: room.code, ci: 0, qi: 0 });
    for (const s of [attacker, ...room.players]) await emit(s, 'reportNetworkStats', { code: room.code, rttMs: 20, jitterMs: 1, samples: 5 });
    const o = await emit(room.host, 'openBuzz', { code: room.code });
    await sleep(o.opensAt - Date.now() + 30);
    const b1 = await emit(room.players[0], 'buzz', { code: room.code, pressedAtServerTime: Date.now() });
    report('R03b', 'PARK-03', 'After takeover, the ORIGINAL device of that player can still buzz (two devices = one player)',
      'old socket is rejected', `old socket buzz -> ${JSON.stringify(b1)}`, b1?.ok === true);
  },
  async R04() {
    const host = await connect();
    const { code } = await emit(host, 'createRoom', { hostToken: 'tok-aud', gameId: 'general-knowledge' });
    await emit(host, 'skipFirstTurnQuiz', { code });
    await emit(host, 'openAudienceRound', { code, roundIndex: 0 });
    const winner = await connect(); const thief = await connect();
    let prizeSeenByWinner = '';
    winner.on('audiencePrize', x => { prizeSeenByWinner = x.code; });
    await emit(winner, 'joinAudience', { code, name: 'RealWinner', audienceId: '' });
    await emit(thief, 'joinAudience', { code, name: 'Thief', audienceId: '' });
    const correct = [1, 0, 1]; // games/general_knowledge.json audienceRounds[0]
    for (let i = 0; i < 3; i++) {
      await emit(host, 'startAudienceQuestion', { code });
      await emit(winner, 'submitAudienceAnswer', { code, option: correct[i] });
      await emit(thief, 'submitAudienceAnswer', { code, option: (correct[i] + 1) % 4 });
      await emit(host, 'finishAudienceQuestion', { code });
    }
    await emit(host, 'finishAudienceRound', { code });
    await sleep(100);
    const winnerId = thief.lastState.audience.ranking.find(x => x.name === 'RealWinner')?.id; // broadcast to every audience phone
    const thief2 = await connect();
    const stolen = await emit(thief2, 'joinAudience', { code, name: 'RealWinner', audienceId: winnerId });
    report('R04', 'PARK-04', 'Audience prize code can be stolen: ranking broadcast contains audience IDs; joinAudience with that ID returns the prize code',
      'only the real winner\'s device gets the code', `winner got "${prizeSeenByWinner}", thief got "${stolen?.prizeCode}"`, !!prizeSeenByWinner && stolen?.prizeCode === prizeSeenByWinner);
  },
  async R05_R06() {
    const a = await makeRoom('kinohardkor', ['Forger']);
    await emit(a.host, 'testGrandFinal', { code: a.code });
    const active = await activeSeason();
    const saved = await emit(a.host, 'saveSeasonResult', { code: a.code, seasonId: active.id, isGrandFinal: false });
    report('R06a', 'EASY-06', 'Fake "TEST GRAND FINAL" results can be saved into the real season',
      'test results cannot be saved', `saveSeasonResult -> ${JSON.stringify({ ok: saved.ok, id: saved.id })}`, saved?.ok === true);
    const b = await makeRoom('kinohardkor', []); // a different, unrelated room
    const corr = await emit(b.host, 'correctSavedSeasonResult', { code: b.code, gameId: saved.id, results: [{ name: 'Mallory', score: 999999 }] });
    const g1 = (await (await fetch(`${URL}/api/seasons`)).json()).seasons.flatMap(s => s.games).find(g => g.id === saved.id);
    report('R06b', 'PARK-02', 'Host of an UNRELATED room can rewrite any saved game\'s results (gameId is public in /api/seasons)',
      'rejected: not your game', `ok=${corr?.ok}; stored results now: ${JSON.stringify(g1?.results)}`, corr?.ok === true && g1?.results?.[0]?.name === 'Mallory');
    const del = await emit(b.host, 'deleteSavedSeasonResult', { code: b.code, gameId: saved.id });
    const still = (await (await fetch(`${URL}/api/seasons`)).json()).seasons.flatMap(s => s.games).some(g => g.id === saved.id);
    report('R06c', 'PARK-02', 'Host of an UNRELATED room can delete any saved game',
      'rejected: not your game', `ok=${del?.ok}; game still exists=${still}`, del?.ok === true && !still);
    await emit(a.host, 'saveSeasonResult', { code: a.code, seasonId: active.id }); // re-save so the season can be completed
    const anon = await connect(); // no room at all
    const init = await emit(anon, 'seasonAdminInit', {});
    const done = await emit(anon, 'seasonAdminSetStatus', { adminToken: init.adminToken, seasonId: active.id, status: 'completed' });
    const created = await emit(anon, 'seasonAdminCreate', { adminToken: init.adminToken, name: 'Hacked season' });
    report('R05', 'PARK-01', 'Season admin has no authentication: any socket gets an admin token from seasonAdminInit and can complete/create seasons',
      'anonymous socket rejected', `seasonAdminInit ok=${init?.ok}; complete season ok=${done?.ok}; create season ok=${created?.ok}`, !!(init?.ok && done?.ok && created?.ok));
  },
  async R07_R08() {
    const { host, code, players } = await makeRoom('kinohardkor', ['Alice', 'Bob']);
    const playFinal = async () => {
      await emit(host, 'skipFirstTurnQuiz', { code });
      await emit(host, 'adjustScore', { code, playerId: players[0].playerId, amount: 1000 });
      await emit(host, 'adjustScore', { code, playerId: players[1].playerId, amount: 500 });
      await emit(host, 'startFinalBets', { code });
      for (const p of players) await emit(p, 'submitBet', { code, bet: 100 });
      await emit(host, 'startFinalQuestion', { code });
      await emit(host, 'startFinalTimer', { code });
      await emit(players[0], 'submitFinalAnswer', { code, answer: 'my answer' });
      host.emit('finishFinalNow', { code });
      await sleep(100);
      return emit(host, 'scoreFinal', { code, results: [{ playerId: players[0].playerId, correct: true }] });
    };
    await playFinal();
    await sleep(100);
    const keysBefore = Object.keys(host.lastState.finalResults[0]).sort().join(',');
    await emit(host, 'adjustScore', { code, playerId: players[0].playerId, amount: 100 });
    await sleep(100);
    const keysAfter = Object.keys(host.lastState.finalResults[0]).sort().join(',');
    report('R08', 'EASY-08', 'Adjusting a score after the final wipes bet/answer/correct/beforeScore from finalResults',
      `keys stay: ${keysBefore}`, `keys now: ${keysAfter}`, keysAfter !== keysBefore);
    const active = await activeSeason();
    const s1 = await emit(host, 'saveSeasonResult', { code, seasonId: active.id });
    await emit(host, 'restartSameGame', { code });
    await playFinal();
    const s2 = await emit(host, 'saveSeasonResult', { code, seasonId: active.id });
    report('R07', 'WORK-03', '"Нова гра з цими гравцями" keeps the room code, so the 2nd game\'s result can never be saved',
      'second game saves', `first save ok=${s1?.ok}; second save -> ${JSON.stringify(s2)}`, s1?.ok === true && s2?.ok === false);
  },
  async R09() {
    const g = await (await fetch(`${URL}/games/kinohardkor.json`)).json();
    let answers = 0; g.rounds.forEach(r => r.categories.forEach(c => c.questions.forEach(q => { if (q.a || q.cat?.a) answers++; })));
    report('R09', 'PARK-05', 'Public URL /games/<id>.json returns every answer (no login needed)',
      'answers not public', `${answers} question answers + final answer "${String(g.final?.a).slice(0, 30)}..." + first-turn answer ${g.firstTurnQuiz?.answer}`, answers > 0 && !!g.final?.a);
  },
  async R10() {
    const room = await makeRoom('kinohardkor', ['Leaver', 'Stayer']);
    await emit(room.host, 'skipFirstTurnQuiz', { code: room.code });
    await emit(room.host, 'adjustScore', { code: room.code, playerId: room.players[0].playerId, amount: 700 });
    await emit(room.players[0], 'leavePlayer', { code: room.code });
    const again = await emit(room.players[0], 'joinPlayer', { code: room.code, name: 'Leaver', playerId: '' });
    const again2 = await emit(room.players[0], 'joinPlayer', { code: room.code, name: 'Leaver', playerId: room.players[0].playerId });
    report('R10', 'EASY-03', '"Вийти з кімнати" during a game deletes the player and score permanently; rejoin is impossible',
      'player can come back', `rejoin as new -> ${JSON.stringify(again)}; rejoin with old id -> ${JSON.stringify(again2)}`, again?.ok === false && again2?.ok === false);
  },
  async R13() {
    const room = await makeRoom('kinohardkor', ['Here', 'PhoneDied']);
    await emit(room.host, 'skipFirstTurnQuiz', { code: room.code });
    room.players[1].disconnect();
    await sleep(100);
    await emit(room.host, 'startFinalBets', { code: room.code });
    await emit(room.players[0], 'submitBet', { code: room.code, bet: 0 });
    const r = await emit(room.host, 'startFinalQuestion', { code: room.code });
    report('R13', 'WORK-02', 'A disconnected player who never bets blocks the final forever (no host override/kick exists)',
      'host can continue', `startFinalQuestion -> ${JSON.stringify(r)}`, r?.ok === false);
  },
  async R17() {
    const host = await connect();
    const r = await emit(host, 'createRoom', { hostToken: 'tok-sync', gameId: 'kinohardkor' });
    const p = await connect();
    await emit(p, 'joinPlayer', { code: r.code, name: 'SleepyPhone', playerId: '' }); // never sends clock sync
    await emit(host, 'skipFirstTurnQuiz', { code: r.code });
    await emit(host, 'chooseTile', { code: r.code, ci: 0, qi: 0 });
    const o = await emit(host, 'openBuzz', { code: r.code });
    report('R17', 'WORK-05', 'One connected-but-not-synced phone (e.g. backgrounded) blocks the main "Відкрити BUZZ" button',
      'buzz opens', `openBuzz -> ${JSON.stringify(o)}`, o?.ok === false);
  },
  async R18() {
    const { host, code, players } = await makeRoom('kinohardkor', ['Honest', 'Cheater']);
    await emit(host, 'skipFirstTurnQuiz', { code });
    await emit(host, 'chooseTile', { code, ci: 0, qi: 0 });
    for (const p of players) await emit(p, 'reportNetworkStats', { code, rttMs: 20, jitterMs: 1, samples: 5 });
    const o = await emit(host, 'openBuzz', { code });
    await sleep(o.opensAt - Date.now() + 20);
    players[0].emit('buzz', { code, pressedAtServerTime: Date.now() }, () => {}); // honest, first
    await sleep(40);
    players[1].emit('buzz', { code, pressedAtServerTime: o.opensAt }, () => {});  // later, lies about press time
    await sleep(250);
    const winner = host.lastState.players.find(p => p.id === host.lastState.buzzer)?.name;
    report('R18', 'PARK-07', 'Buzz winner is decided by the client-supplied timestamp; a modified client that presses LATER can still win',
      'Honest (pressed 40 ms earlier) wins', `winner: ${winner}`, winner === 'Cheater');
  },
  async R20() {
    const { host, code, players } = await makeRoom('kinohardkor', ['P']);
    await emit(host, 'skipFirstTurnQuiz', { code });
    await emit(host, 'chooseTile', { code, ci: 2, qi: 4 }); // kinohardkor imageReveal tile
    await sleep(150);
    const aq = players[0].lastState.activeQuestion;
    const r = await fetch(URL + aq.image);
    report('R20', 'PARK-06', 'imageReveal sends the unblurred original to phones at the first stage (blur is only CSS)',
      'phone only gets the current stage', `stage ${aq.revealStage}/${aq.revealValues.length}: image ${aq.image} -> HTTP ${r.status} ${r.headers.get('content-type')}`, aq.revealStage === 0 && r.status === 200);
  },
  async R11_R21() {
    // Both need the hard-coded 30 s numeric timer, so they share one wait.
    const roomA = await makeRoom('general-knowledge', ['A1', 'A2']);
    const roomB = await makeRoom('general-knowledge', ['B1', 'B2', 'B3']);
    for (const room of [roomA, roomB]) {
      await emit(room.host, 'skipFirstTurnQuiz', { code: room.code });
      await emit(room.host, 'chooseTile', { code: room.code, ci: 1, qi: 3 }); // numericClosest
      await emit(room.host, 'startNumericTimer', { code: room.code });
    }
    await emit(roomA.host, 'togglePause', { code: roomA.code });
    await sleep(100);
    const turnBefore = roomB.host.lastState.turnPlayerId;
    console.log('\n  ...waiting 31 s for the hard-coded numeric timer (R11, R21)');
    await sleep(31000);
    await emit(roomA.host, 'togglePause', { code: roomA.code });
    const ans = await emit(roomA.players[0], 'submitNumericAnswer', { code: roomA.code, answer: 5 });
    report('R11', 'WORK-04', 'Pause does not pause the numeric-question timer; after Resume nobody can answer',
      'timer frozen during pause, answers accepted after resume', `answer after resume -> ${JSON.stringify(ans)}`, ans?.ok === false);
    await emit(roomB.host, 'finishNumericQuestion', { code: roomB.code });
    for (let i = 0; i < 3; i++) await emit(roomB.host, 'revealNextNumeric', { code: roomB.code });
    await emit(roomB.host, 'finishNumericResult', { code: roomB.code });
    await sleep(100);
    const names = Object.fromEntries(roomB.players.map(p => [p.playerId, p.name]));
    report('R21', 'RULE-03', 'Numeric question with NO answers: turn does not advance (goes to first non-answerer = same player)',
      `turn ${names[turnBefore]} -> B2 (normal advance)`, `turn ${names[turnBefore]} -> ${names[roomB.host.lastState.turnPlayerId]}`, roomB.host.lastState.turnPlayerId === turnBefore);
  },
};

(async () => {
  const srv = await startServer();
  URL = srv.url;
  console.log(`Isolated server: ${URL} (DATA_DIR=${srv.dataDir})`);
  try {
    for (const [id, fn] of Object.entries(repros)) {
      if (ONLY.length && !ONLY.some(x => id.includes(x))) continue;
      try { await fn(); } catch (e) { console.log(`\n[${id}] ERROR ${e.stack}`); results.push({ id, bug: '?', reproduced: 'error' }); }
    }
  } finally {
    sockets.forEach(s => s.close());
    srv.stop();
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(r.id.padEnd(5), r.bug.padEnd(8), r.reproduced === true ? 'REPRODUCED' : r.reproduced === false ? 'NOT REPRODUCED' : r.reproduced);
  process.exitCode = results.some(r => r.reproduced !== false) ? 1 : 0;
})();
