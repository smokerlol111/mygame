// Safety checks against an isolated server and in-memory storage; no real database or .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function pausedTimers() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
  const start = source.indexOf('function startNumericCountdown(');
  const end = source.indexOf('function randomSpecialCells(');
  let now = 1000, nextTimer = 0;
  const timers = new Map(), rooms = new Map();
  const sandbox = {
    module: { exports: {} }, rooms, Date: { now: () => now }, emitState() {},
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval() {},
    expireFirstTurn() {}, startFirstTurnCountdown() {}, startFinalCountdown() {},
  };
  vm.runInNewContext(source.slice(start, end) + '\nmodule.exports={pauseRoom,resumeRoom,startNumericCountdown,startAudienceCountdown};', sandbox);
  const { pauseRoom, resumeRoom, startNumericCountdown, startAudienceCountdown } = sandbox.module.exports;
  const advance = ms => {
    const target = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = target;
  };
  const numeric = { code: 'N', phase: 'numeric_question', paused: false };
  rooms.set('N', numeric);
  startNumericCountdown(numeric, 30000);
  advance(4000); pauseRoom(numeric); pauseRoom(numeric);
  advance(40000);
  assert.equal(numeric.phase, 'paused');
  resumeRoom(numeric); resumeRoom(numeric);
  assert.equal(numeric.numericEndsAt - now, 26000, 'numeric time is preserved during pause');
  advance(25999); assert.ok(numeric.numericEndsAt > now);
  advance(1); assert.equal(numeric.numericEndsAt, null);
  const audience = { code: 'A', phase: 'audience_question', paused: false, audienceStartedAt: now };
  rooms.set('A', audience);
  startAudienceCountdown(audience, 30000);
  advance(5000); pauseRoom(audience); advance(60000); resumeRoom(audience);
  assert.equal(audience.audienceEndsAt - now, 25000);
  assert.equal(now - audience.audienceStartedAt, 5000, 'pause does not inflate audience response time');
  advance(25000); assert.equal(audience.phase, 'audience_result');
  const closed = { code: 'closed', phase: 'audience_question' };
  rooms.set('closed', closed); startAudienceCountdown(closed, 1000); rooms.delete('closed');
  advance(1000); assert.equal(closed.phase, 'audience_question', 'expired timer must not mutate a closed room');
  console.log('PASS: actual timer/pause functions preserve numeric and audience time, exclude paused response time, ignore closed rooms');
}

async function storageRaces() {
  let fixture = JSON.stringify({ seasons: [{ id: 's', name: 'Кубок', status: 'active', championshipRule: 'grand_final' }], games: [] });
  const sandbox = {
    module: { exports: {} }, __dirname: REPO_ROOT, console: { log() {} }, process: { env: { DATA_DIR: '/isolated' } },
    require(id) {
      if (id === 'fs') return { mkdirSync() {}, existsSync: () => true, readFileSync: () => fixture, writeFileSync: (_, value) => { fixture = value; } };
      return require(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(REPO_ROOT, 'storage.js'), 'utf8'), sandbox);
  const storage = sandbox.module.exports;
  await storage.init();
  const results = await Promise.allSettled(['A', 'B'].map(roomCode => storage.saveGame({
    seasonId: 's', roomCode, gameId: 'x', title: roomCode, isGrandFinal: true, results: [{ name: roomCode, score: 10 }],
  })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'only one simultaneous Grand Final may be saved');
  assert.equal((await storage.seasonDetails('s')).games.length, 1);
  await storage.setSeasonStatus('s', 'completed');
  const creates = await Promise.allSettled(['Наступний A', 'Наступний B'].map(name => storage.createSeason(name)));
  assert.equal(creates.filter(r => r.status === 'fulfilled').length, 1, 'only one active season may be created concurrently');
  console.log('PASS: concurrent Grand Final saves and season creation');
}

async function finalSafety() {
  const server = await startServer({ HOST_KEY: 'isolated-safety' });
  const sockets = [];
  const connect = async () => {
    const s = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
    s.on('state', state => { s.state = state; });
    return s;
  };
  const emit = (s, event, payload) => s.timeout(4000).emitWithAck(event, payload);
  const ok = async (s, event, payload) => {
    const result = await emit(s, event, payload);
    assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
    return result;
  };
  try {
    const host = await connect(), p1 = await connect(), p2 = await connect();
    const { code } = await ok(host, 'createRoom', { hostKey: 'isolated-safety', gameId: 'season2-grand-final', hostToken: 'safety-host' });
    const j1 = await ok(p1, 'joinPlayer', { code, name: 'Перший' });
    const j2 = await ok(p2, 'joinPlayer', { code, name: 'Другий' });
    host.emit('finishFinalNow', { code });
    await sleep(30);
    assert.equal(host.state.phase, 'lobby', 'stale finish cannot create a final review with no question');
    await ok(host, 'skipFirstTurnQuiz', { code });
    await ok(host, 'adjustScore', { code, playerId: j1.playerId, amount: 1000 });
    await ok(host, 'adjustScore', { code, playerId: j2.playerId, amount: 500 });
    await ok(host, 'startFinalBets', { code });
    await ok(p1, 'submitBet', { code, bet: 100 });
    const repeated = await emit(host, 'startFinalBets', { code });
    assert.equal(repeated.ok, false, 'double start cannot erase bets');
    p2.disconnect();
    await sleep(50);
    assert.equal((await emit(host, 'startFinalQuestion', { code })).ok, false);
    await ok(host, 'startFinalQuestion', { code, fillMissingBets: true });
    await sleep(30);
    assert.equal(host.state.players.find(p => p.id === j2.playerId).hasBet, true);
    await ok(host, 'startFinalTimer', { code });
    await ok(p1, 'submitFinalAnswer', { code, answer: 'Відповідь' });
    const rejoined = await connect();
    await ok(rejoined, 'joinPlayer', { code, playerKey: j2.playerKey, name: 'Другий' });
    await ok(rejoined, 'submitFinalAnswer', { code, answer: 'Інша відповідь' });
    host.emit('finishFinalNow', { code });
    await sleep(30);
    await ok(host, 'scoreFinal', { code, results: [{ playerId: j1.playerId, correct: true }] });
    await sleep(30);
    const scores = host.state.finalResults.map(p => p.score);
    host.emit('finishFinalNow', { code });
    await sleep(30);
    assert.equal(host.state.phase, 'final_result', 'stale finish cannot reopen judging');
    assert.equal((await emit(host, 'scoreFinal', { code, results: [{ playerId: j1.playerId, correct: true }] })).ok, false);
    assert.deepEqual(host.state.finalResults.map(p => p.score), scores);
    assert.equal((await emit(host, 'startGame', { code })).ok, false, 'stale start cannot reset scores');
    await sleep(30);
    assert.deepEqual(host.state.finalResults.map(p => p.score), scores);
    const testHost = await connect(), testPlayer = await connect();
    const testRoom = await ok(testHost, 'createRoom', { hostKey: 'isolated-safety', gameId: 'season2-grand-final', hostToken: 'test-only' });
    await ok(testPlayer, 'joinPlayer', { code: testRoom.code, name: 'Test' });
    await ok(testHost, 'testGrandFinal', { code: testRoom.code });
    const { seasons } = await ok(testHost, 'seasonAdminInit', { hostKey: 'isolated-safety' });
    const testSave = await emit(testHost, 'saveSeasonResult', { code: testRoom.code, seasonId: seasons[0].id, isGrandFinal: true });
    assert.equal(testSave.ok, false, 'test shortcut cannot pollute season results');
    assert.match(testSave.error, /Тестові/);
    assert.equal((await fetch(server.url + '/health')).ok, true);
    console.log('PASS: stale/double final/start buttons, missing-bet recovery, PLAYER reconnect, no repeated scoring, test results cannot enter the season, server health');
  } finally {
    sockets.forEach(s => s.disconnect());
    server.stop();
  }
}

async function main() {
  const selected = process.argv[2];
  pausedTimers();
  if (selected !== 'final') await storageRaces();
  if (selected !== 'storage') await finalSafety();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
