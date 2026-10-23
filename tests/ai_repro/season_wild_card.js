// Isolated server + real HOST/public pages. Never reads .env or the real database.
// Usage: node tests/ai_repro/season_wild_card.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer, REPO_ROOT } = require('./lib/server');

const KEY = 'isolated-wild-card-key';
const VIEWER = 'Глядач & <вибір> "4"';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await sleep(25);
  }
}

async function main() {
  const server = await startServer({ HOST_KEY: KEY });
  const sockets = [], pages = [], errors = [];
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    socket.on('state', state => { socket.state = state; socket.states = (socket.states || 0) + 1; });
    return socket;
  };
  const emit = (socket, event, payload = {}) => socket.timeout(3000).emitWithAck(event, payload);
  const ok = async (socket, event, payload) => {
    const result = await emit(socket, event, payload);
    assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
    return result;
  };
  const loadPage = async route => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => errors.push(error.detail?.message || error.message));
    const dom = await JSDOM.fromURL(server.url + route, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
        win.fetch = (url, options) => fetch(new URL(url, server.url), options);
        win.HTMLMediaElement.prototype.play = () => Promise.resolve();
        win.HTMLMediaElement.prototype.pause = () => {};
        win.HTMLMediaElement.prototype.load = () => {};
        win.alert = message => errors.push(`Unexpected alert: ${message}`);
      },
    });
    pages.push(dom);
    return dom;
  };
  let currentHost, currentCode;
  const play = async (seasonId, names, isGrandFinal = false) => {
    const host = await connect();
    const { code } = await ok(host, 'createRoom', { hostKey: KEY, hostToken: `wc-${Date.now()}`, gameId: 'general-knowledge' });
    for (const name of names) await ok(await connect(), 'joinPlayer', { code, name });
    await ok(host, 'testGrandFinal', { code });
    await ok(host, 'saveSeasonResult', { code, seasonId, isGrandFinal });
    currentHost = host;
    currentCode = code;
  };
  const data = async () => (await (await fetch(server.url + '/api/seasons')).json()).seasons;
  try {
    const admin = await connect();
    assert.equal((await emit(admin, 'seasonAdminInit', { hostKey: 'wrong' })).ok, false);
    const { adminToken, seasons } = await ok(admin, 'seasonAdminInit', { hostKey: KEY });
    await play(seasons[0].id, ['Перший сезон']);
    assert.equal((await emit(admin, 'setSeasonWildCard', { adminToken, seasonId: seasons[0].id, mode: 'audience' })).ok, false);
    await ok(admin, 'seasonAdminSetStatus', { adminToken, seasonId: seasons[0].id, status: 'completed' });
    const { id: seasonId } = await ok(admin, 'seasonAdminCreate', { adminToken, name: 'Сезон 2' });
    const getSeason = async () => (await data()).find(s => s.id === seasonId);
    const bad = payload => emit(admin, 'setSeasonWildCard', { adminToken, seasonId, ...payload });
    assert.equal((await bad({ mode: 'unknown' })).ok, false);
    assert.equal((await bad({ mode: 'audience', name: VIEWER })).ok, false);
    await play(seasonId, ['Переможець 1', 'Лідер балів', 'Учасник 1', VIEWER]);
    await play(seasonId, ['Переможець 2', 'Учасник 2', 'Учасник 3', VIEWER]);

    // The start-page control works before the third game, without creating a room.
    const startPage = await loadPage('/host?key=' + KEY);
    const doc = startPage.window.document;
    await waitFor(() => doc.querySelector('.seasonWildCardChoice'), 'start-page selection');
    assert.equal(doc.querySelectorAll('.seasonWildCardChoice option').length, 1);
    assert.equal(doc.querySelector('.seasonWildCardChoice').value, 'pending');
    assert.match(doc.querySelector('#startSeasonAdmin').textContent, /очікуємо результат голосування/);
    assert.equal((await getSeason()).wildCardSelection, undefined);
    await play(seasonId, ['Переможець 3', 'Учасник 4', 'Учасник 5', VIEWER]);
    let season = await getSeason();
    assert.equal(season.qualification.wildCardMode, 'audience');
    assert.equal(season.qualification.wildCard, null);
    assert.equal(season.qualification.wildCardLeader, null);
    assert.equal(season.qualification.grandFinalists.length, 3);
    const originalGames = JSON.stringify(season.games);
    const originalLeaderboard = JSON.stringify(season.leaderboard);
    const winners = season.qualification.qualifiers.map(p => p.name);

    // Scores can never assign the fourth spot, including old clients requesting points mode.
    assert.equal((await bad({ mode: 'points' })).ok, false);
    season = await getSeason();
    assert.equal(season.qualification.wildCard, null);
    const outsider = await connect();
    for (const payload of [{}, { code: currentCode }, { adminToken: 'fake' }]) {
      assert.equal((await emit(outsider, 'setSeasonWildCard', { seasonId, mode: 'audience', name: VIEWER, ...payload })).ok, false);
    }
    for (const name of ['Переможець 1', 'Немає в сезоні', '', {}])
      assert.equal((await bad({ mode: 'audience', name })).ok, false);

    // Real room HOST control, using room authorization, changes no room state.
    const roomState = JSON.stringify(currentHost.state);
    const stateEvents = currentHost.states;
    await ok(currentHost, 'setSeasonWildCard', { code: currentCode, seasonId, mode: 'audience', name: VIEWER });
    await sleep(40);
    assert.equal(JSON.stringify(currentHost.state), roomState);
    assert.equal(currentHost.states, stateEvents);
    season = await getSeason();
    assert.deepEqual(season.qualification.grandFinalists.map(p => p.name), [...winners, VIEWER]);
    assert.equal(JSON.stringify(season.games), originalGames);
    assert.equal(JSON.stringify(season.leaderboard), originalLeaderboard);

    // Persisted selection survives loading storage again in a fresh process.
    const env = { ...process.env, DATA_DIR: server.dataDir };
    delete env.DATABASE_URL;
    const reloaded = spawnSync(process.execPath, ['-e', `const s=require('./storage');s.init().then(()=>s.seasonDetails(${JSON.stringify(seasonId)})).then(x=>{require('node:assert/strict').equal(x.qualification.wildCard.name,${JSON.stringify(VIEWER)});console.log('persisted')})`], { cwd: REPO_ROOT, env, encoding: 'utf8' });
    assert.equal(reloaded.status, 0, reloaded.stderr);
    assert.match(reloaded.stdout, /persisted/);

    await startPage.window.loadStartSeasonAdmin();
    await waitFor(() => doc.querySelector('.seasonWildCardChoice')?.value === `player:${VIEWER}`, 'saved candidate on HOST');
    assert.equal(doc.querySelector('.seasonQualification img'), null);
    doc.querySelector('.seasonWildCardChoice').value = 'pending';
    doc.querySelector('.saveSeasonWildCard').click();
    await waitFor(() => /очікуємо результат голосування/.test(doc.querySelector('#startSeasonAdmin').textContent), 'clear selected candidate');
    const publicPending = await loadPage('/seasons');
    await waitFor(() => /очікуємо результат голосування/.test(publicPending.window.document.getElementById('app').textContent), 'public pending state');
    doc.querySelector('.seasonWildCardChoice').value = `player:${VIEWER}`;
    doc.querySelector('.saveSeasonWildCard').click();
    await waitFor(() => /Wild Card — вибір глядачів/.test(doc.querySelector('#startSeasonAdmin').textContent), 'UI saves viewer winner');
    const publicPage = await loadPage('/seasons');
    await waitFor(() => /Wild Card — вибір глядачів/.test(publicPage.window.document.getElementById('app').textContent), 'public selected candidate');
    assert.ok(publicPage.window.document.getElementById('app').textContent.includes(VIEWER));
    assert.equal(publicPage.window.document.querySelector('.historyResults img'), null);

    // A new connection gets a new admin token; the start page must renew it automatically.
    const oldToken = startPage.window.eval('seasonAdminToken');
    startPage.window.eval('socket.disconnect(); socket.connect();');
    await waitFor(() => startPage.window.eval('seasonAdminToken') !== oldToken, 'renewed admin token');
    await waitFor(() => doc.querySelector('.seasonWildCardChoice')?.value === `player:${VIEWER}`, 'panel after reconnect');
    doc.querySelector('.seasonWildCardChoice').value = 'pending';
    doc.querySelector('.saveSeasonWildCard').click();
    await waitFor(() => /очікуємо результат голосування/.test(doc.querySelector('#startSeasonAdmin').textContent), 'save after reconnect');
    doc.querySelector('.seasonWildCardChoice').value = `player:${VIEWER}`;
    doc.querySelector('.saveSeasonWildCard').click();
    await waitFor(() => /Wild Card — вибір глядачів/.test(doc.querySelector('#startSeasonAdmin').textContent), 'restore viewer after reconnect');
    assert.equal(doc.querySelector('option[value="points"]'), null);

    // Result edits/deletion cannot make an ineligible manual choice fall back to points.
    // Use a separate season through a fresh isolated storage instance to avoid changing the live fixture.
    const storageSource = fs.readFileSync(path.join(REPO_ROOT, 'storage.js'), 'utf8');
    let fixture = JSON.stringify({ seasons: [{ id: 's', name: 'Сезон 2', status: 'active', wildCardSelection: { mode: 'audience', name: VIEWER } }], games: season.games.map(g => ({ ...g, seasonId: 's' })) });
    const sandbox = { module: { exports: {} }, __dirname: REPO_ROOT, console: { log() {} }, process: { env: { DATA_DIR: '/isolated' } }, require(id) {
      if (id === 'fs') return { mkdirSync() {}, existsSync: () => true, readFileSync: () => fixture, writeFileSync: (_, value) => { fixture = value; } };
      return require(id);
    } };
    vm.runInNewContext(storageSource, sandbox);
    const isolated = sandbox.module.exports;
    const legacy = JSON.parse(fixture);
    legacy.seasons[0].wildCardSelection = { mode: 'points' };
    fixture = JSON.stringify(legacy);
    await isolated.init();
    assert.equal((await isolated.seasonDetails('s')).qualification.wildCard, null);
    legacy.seasons[0].wildCardSelection = { mode: 'audience', name: VIEWER };
    fixture = JSON.stringify(legacy);
    await isolated.init();
    await isolated.updateGameResults(season.games[0].id, [{ name: VIEWER, score: 9000 }, { name: 'Other', score: 0 }]);
    assert.equal((await isolated.seasonDetails('s')).qualification.wildCard, null);
    await isolated.deleteGame(season.games[0].id);
    assert.equal((await isolated.seasonDetails('s')).qualification.wildCard, null);

    await play(seasonId, [...winners, VIEWER], true);
    assert.equal((await bad({ mode: 'points' })).ok, false);
    await ok(admin, 'seasonAdminSetStatus', { adminToken, seasonId, status: 'completed' });
    assert.equal((await bad({ mode: 'audience', name: VIEWER })).ok, false);
    assert.equal((await getSeason()).qualification.wildCard.name, VIEWER);
    assert.deepEqual(errors, []);
    console.log('PASS: audience-only default before/after game 3, points mode rejected, manual winner, HOST token renewal after reconnect, authorization, validation, persistence, unchanged results/leaderboard/room, real HOST/public UI, invalidation and final/archive lock');
  } finally {
    for (const page of pages) page.window.close();
    for (const socket of sockets) socket.disconnect();
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
