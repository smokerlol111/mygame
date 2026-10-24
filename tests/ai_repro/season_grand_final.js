// Isolated season rules + real HOST/public/OBS pages; never uses .env or production data.
// Usage: node tests/ai_repro/season_grand_final.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer, REPO_ROOT } = require('./lib/server');

const KEY = 'isolated-grand-final';
const WINNER = 'Фіналіст & <чемпіон>';
const LEADER = 'Лідер статистики';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const deadline = Date.now() + 7000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await sleep(25);
  }
}

async function checkStorageCompatibility() {
  let fixture = JSON.stringify({
    seasons: [
      { id: 'legacy', name: 'Сезон 1', status: 'completed' },
      { id: 'qualifiers', name: 'Сезон 2', status: 'completed' },
    ],
    games: [
      { id: 'old', seasonId: 'legacy', results: [{ name: LEADER, score: 10, place: 1, seasonPoints: 40 }] },
      { id: 'old-final', seasonId: 'legacy', isGrandFinal: true, results: [{ name: WINNER, score: 20, place: 1, seasonPoints: 20 }] },
    ],
  });
  const original = fixture;
  const sandbox = {
    module: { exports: {} }, __dirname: REPO_ROOT, console: { log() {} }, process: { env: { DATA_DIR: '/isolated' } },
    require(id) {
      if (id === 'fs') return {
        mkdirSync() {}, existsSync: () => true, readFileSync: () => fixture,
        writeFileSync: (_, value) => { fixture = value; },
      };
      return require(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(REPO_ROOT, 'storage.js'), 'utf8'), sandbox);
  const storage = sandbox.module.exports;
  await storage.init();
  assert.equal((await storage.seasonDetails('legacy')).champion.name, LEADER);
  assert.equal((await storage.seasonDetails('legacy')).championshipRule, 'points');
  assert.equal((await storage.seasonDetails('qualifiers')).championshipRule, 'grand_final');
  assert.equal(fixture, original, 'reading old history must not rewrite it');
  const id = await storage.createSeason('Осінній кубок');
  assert.equal((await storage.seasonDetails(id)).championshipRule, 'grand_final');
  const game = await storage.saveGame({ seasonId: id, roomCode: 'custom', isGrandFinal: true, results: [{ name: WINNER, score: 9 }] });
  await assert.rejects(storage.updateGameResults(game, [{ name: WINNER, score: 9 }, { name: LEADER, score: 9 }]), /нічия/);
  await assert.rejects(storage.updateGameResults(game, []), /Немає результатів/);
  await storage.setSeasonStatus(id, 'completed');
  assert.equal((await storage.seasonDetails(id)).champion.name, WINNER);
  await assert.rejects(storage.saveGame({ seasonId: id, roomCode: 'archive', results: [{ name: 'X', score: 1 }] }), /активний/);
  await storage.init();
  assert.equal((await storage.seasonDetails(id)).championshipRule, 'grand_final', 'rule survives reload');
  console.log('PASS: legacy history, existing Season 2, arbitrary future season name, persistence, archive and tie validation');
}

async function main() {
  for (const file of ['public/host.html', 'public/screen.html', 'public/seasons.html']) {
    for (const match of fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      new vm.Script(match[1], { filename: file });
  }
  await checkStorageCompatibility();
  const server = await startServer({ HOST_KEY: KEY });
  const sockets = [], pages = [], errors = [];
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.on('state', state => { socket.state = state; });
    return socket;
  };
  const emit = (socket, event, payload = {}) => socket.timeout(4000).emitWithAck(event, payload);
  const ok = async (socket, event, payload) => {
    const result = await emit(socket, event, payload);
    assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
    return result;
  };
  const loadPage = async (route, token, code) => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => errors.push(error.detail?.message || error.message));
    const page = await JSDOM.fromURL(server.url + route, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
        win.fetch = (url, options) => fetch(new URL(url, server.url), options);
        win.HTMLMediaElement.prototype.play = () => Promise.resolve();
        win.HTMLMediaElement.prototype.pause = () => {};
        win.HTMLMediaElement.prototype.load = () => {};
        win.alert = message => errors.push(`Unexpected alert: ${message}`);
        if (token) {
          win.localStorage.setItem('sgHostToken', token);
          win.localStorage.setItem('sgRoomCode', code);
        }
      },
    });
    pages.push(page);
    return page;
  };
  const room = async (names, gameId = 'general-knowledge') => {
    const host = await connect(), token = `gf-${Date.now()}-${Math.random()}`;
    const { code } = await ok(host, 'createRoom', { hostKey: KEY, hostToken: token, gameId });
    for (const name of names) await ok(await connect(), 'joinPlayer', { code, name });
    await waitFor(() => host.state?.players.length === names.length, 'players');
    assert.ok(host.state.players.every(p => p.score === 0), 'every separate game starts at zero');
    await ok(host, 'skipFirstTurnQuiz', { code });
    for (let i = 0; i < host.state.players.length; i++)
      await ok(host, 'adjustScore', { code, playerId: host.state.players[i].id, amount: 4500 - i * 700 });
    await ok(host, 'startFinalBets', { code });
    const activePlayers = sockets.filter(s => s.state?.code === code && s !== host);
    for (const s of activePlayers) await ok(s, 'submitBet', { code, bet: 0 });
    await ok(host, 'startFinalQuestion', { code });
    await ok(host, 'startFinalTimer', { code });
    for (const s of activePlayers) await ok(s, 'submitFinalAnswer', { code, answer: 'Answer' });
    host.emit('finishFinalNow', { code });
    await waitFor(() => host.state.phase === 'final_review', 'final review');
    await ok(host, 'scoreFinal', { code, results: [] });
    await waitFor(() => host.state?.phase === 'final_result', 'final results');
    return { host, token, code };
  };
  const getSeason = async id => (await (await fetch(server.url + '/api/seasons')).json()).seasons.find(s => s.id === id);
  try {
    const admin = await connect();
    const { adminToken, seasons } = await ok(admin, 'seasonAdminInit', { hostKey: KEY });
    const initial = await room(['Початковий чемпіон']);
    await ok(initial.host, 'saveSeasonResult', { code: initial.code, seasonId: seasons[0].id, isGrandFinal: true });
    await ok(admin, 'seasonAdminSetStatus', { adminToken, seasonId: seasons[0].id, status: 'completed' });
    const { id: seasonId } = await ok(admin, 'seasonAdminCreate', { adminToken, name: 'Сезон 2' });
    for (const name of [WINNER, 'Відбір 2', 'Відбір 3']) {
      const qualifier = await room([name, LEADER]);
      if (name === WINNER) {
        const early = await emit(qualifier.host, 'saveSeasonResult', { code: qualifier.code, seasonId, isGrandFinal: true });
        assert.equal(early.ok, false);
        assert.match(early.error, /трьох/);
      }
      await ok(qualifier.host, 'saveSeasonResult', { code: qualifier.code, seasonId });
      await sleep(5);
    }
    const earlyClose = await emit(admin, 'seasonAdminSetStatus', { adminToken, seasonId, status: 'completed' });
    assert.equal(earlyClose.ok, false);
    assert.match(earlyClose.error, /Grand Final/);
    const final = await room([WINNER, LEADER, 'Відбір 2', 'Відбір 3'], 'season2-grand-final');
    const runner = final.host.state.players.find(p => p.name === LEADER);
    await ok(final.host, 'adjustScore', { code: final.code, playerId: runner.id, amount: 700 });
    const tied = await emit(final.host, 'saveSeasonResult', { code: final.code, seasonId, isGrandFinal: false });
    assert.equal(tied.ok, false);
    assert.match(tied.error, /нічия/);
    assert.equal((await getSeason(seasonId)).games.length, 3);
    await ok(final.host, 'adjustScore', { code: final.code, playerId: runner.id, amount: -1 });

    // Real HOST automatically selects Grand Final, including after page reload.
    const hostPage = await loadPage('/host?key=' + KEY, final.token, final.code);
    const hostDoc = hostPage.window.document;
    await waitFor(() => hostDoc.getElementById('grandFinal'), 'HOST save controls');
    assert.equal(hostDoc.getElementById('grandFinal').checked, true);
    assert.equal(hostDoc.getElementById('grandFinal').disabled, true);
    final.host = hostPage.window.eval('socket');
    const saved = await ok(final.host, 'saveSeasonResult', { code: final.code, seasonId, isGrandFinal: false });
    let season = await getSeason(seasonId);
    assert.equal(season.leaderboard[0].name, LEADER, 'statistics must really disagree with Grand Final');
    assert.equal(season.grandFinalResults[0].name, WINNER);
    assert.ok(season.grandFinalResults.every(p => p.seasonPoints === 0));
    assert.equal(saved.seasonFinal.leaderboard.length, 4);
    assert.equal(saved.seasonFinal.leaderboard[0].name, WINNER);
    const lateAdjustment = await emit(final.host, 'adjustScore', { code: final.code, playerId: runner.id, amount: 10000 });
    assert.equal(lateAdjustment.ok, false, 'saved champion cannot diverge from the room via score controls');
    assert.equal((await getSeason(seasonId)).grandFinalResults[0].name, WINNER);
    await waitFor(() => hostDoc.getElementById('startSeasonCeremony'), 'HOST ceremony');
    assert.ok(hostDoc.getElementById('app').textContent.includes('балів у Grand Final'));
    assert.ok(!hostDoc.getElementById('app').textContent.includes('подвійними очками'));
    assert.equal(hostDoc.querySelector('.finalList img'), null, 'escape champion name');
    const duplicate = await emit(final.host, 'saveSeasonResult', { code: final.code, seasonId, isGrandFinal: true });
    assert.equal(duplicate.ok, false);
    const extra = await room(['Зайва гра']);
    assert.equal((await emit(extra.host, 'saveSeasonResult', { code: extra.code, seasonId })).ok, false);
    await ok(final.host, 'startSeasonCeremony', { code: final.code });
    const screen = await loadPage('/screen/' + final.code);
    await waitFor(() => screen.window.document.getElementById('app').textContent.includes('вирішальна гра сезону'), 'OBS ceremony intro');
    for (let i = 0; i < 4; i++) await ok(final.host, 'revealNextSeasonResult', { code: final.code });
    await waitFor(() => screen.window.document.querySelector('.seasonChampionStage'), 'OBS champion');
    assert.equal(screen.window.document.querySelector('.seasonChampionStage .winner').textContent, WINNER);
    assert.ok(screen.window.document.getElementById('app').textContent.includes('БАЛІВ У GRAND FINAL'));
    assert.ok(!screen.window.document.getElementById('app').textContent.includes('СЕЗОННИХ БАЛІВ'));
    await ok(admin, 'seasonAdminSetStatus', { adminToken, seasonId, status: 'completed' });
    season = await getSeason(seasonId);
    assert.equal(season.champion.name, WINNER);
    const publicPage = await loadPage('/seasons');
    await waitFor(() => publicPage.window.document.getElementById('app').textContent.includes('Статистика всіх ігор сезону'), 'public season');
    assert.ok(publicPage.window.document.querySelector('.huge').textContent.includes(WINNER));
    assert.equal(publicPage.window.document.querySelector('.huge img'), null);

    // Corrections feed the same saved result to champion, HOST and OBS; removal stops the ceremony.
    const corrected = season.grandFinalResults.map((p, i) => ({ name: p.name, score: i === 1 ? 9000 : p.score }));
    await ok(final.host, 'correctSavedSeasonResult', { code: final.code, gameId: saved.id, results: corrected });
    assert.equal((await getSeason(seasonId)).champion.name, LEADER);
    await waitFor(() => screen.window.document.querySelector('.seasonChampionStage .winner')?.textContent === LEADER, 'corrected OBS champion');
    const tiedEdit = await emit(final.host, 'correctSavedSeasonResult', { code: final.code, gameId: saved.id, results: [{ name: 'A', score: 1 }, { name: 'B', score: 1 }] });
    assert.equal(tiedEdit.ok, false);
    assert.equal((await getSeason(seasonId)).champion.name, LEADER);
    await ok(final.host, 'deleteSavedSeasonResult', { code: final.code, gameId: saved.id });
    assert.equal((await getSeason(seasonId)).champion, null);
    assert.equal((await emit(final.host, 'startSeasonCeremony', { code: final.code })).ok, false);
    assert.deepEqual(errors, []);
    console.log('PASS: three qualifiers, zero starting scores, automatic Grand Final, tie resolution, no double points, canonical champion on HOST/public/OBS, duplicate/extra game guards, correction/deletion');
  } finally {
    for (const page of pages) page.window.close();
    for (const socket of sockets) socket.disconnect();
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
