// Verify archived content, real empty production menu, private files and new-game coexistence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer, REPO_ROOT, REPLAY_CATALOG } = require('./lib/server');
const archive = path.dirname(path.dirname(REPLAY_CATALOG));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = value => String(value ?? '').split(/\r?\n/).map(line => '> ' + line).join('\n');

async function connect(server) {
  const socket = io(server.url, { transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8'));
  const records = JSON.parse(fs.readFileSync(path.join(archive, 'question-records.json'), 'utf8'));
  const bank = fs.readFileSync(path.join(REPO_ROOT, 'archive/QUESTION_BANK.md'), 'utf8');
  assert.equal(manifest.games, 9);
  assert.equal(records.length, 516);
  assert.equal(new Set(records.map(record => record.id)).size, records.length);
  const games = new Map();
  for (const game of manifest.gameFiles) {
    const file = path.join(REPO_ROOT, game.archivedPath);
    assert.equal(sha(file), game.sha256, game.gameId + ': byte-exact snapshot');
    games.set(game.gameId, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  function checkText(item) {
    assert.ok(bank.includes(quote(item.q ?? item.question ?? '')), 'prompt preserved');
    const answer = item.options ? item.options[item.correct] : item.a ?? item.answer;
    if (answer !== undefined && answer !== '') assert.ok(bank.includes(quote(answer)), 'answer preserved');
    for (const part of item.triplet || []) checkText(part);
    if (item.cat) checkText(item.cat);
  }
  for (const record of records) {
    const original = record.pointer.split('/').slice(1).reduce((value, field) => value[field], games.get(record.gameId));
    assert.deepEqual(record.payload, original, record.id + ': all fields preserved');
    assert.ok(bank.includes('`' + record.id + '`'), 'searchable unique source ID');
    checkText(original);
  }
  assert.equal(sha(path.join(REPO_ROOT, manifest.questionBank.archivedPath)), manifest.questionBank.sha256);
  const archivedBank = fs.readFileSync(path.join(REPO_ROOT, manifest.questionBank.archivedPath), 'utf8');
  assert.ok(bank.startsWith(archivedBank), 'the immutable historical block stays intact while approved questions can be appended');
  process.stdout.write(execFileSync(process.execPath, ['scripts/archive-completed-games.js', '--verify'], { cwd: REPO_ROOT, encoding: 'utf8' }));
  console.log('PASS: nine original game packs, 516 records, all triplet/cat prompts and answers, immutable bank prefix with appendable approved entries and 152 verified ZIP entries');

  const hostKey = 'archive-menu-test';
  const server = await startServer({ HOST_KEY: hostKey, GAMES_INDEX_FILE: path.join(REPO_ROOT, 'games/index.json') });
  let socket, dom;
  try {
    const index = JSON.parse(fs.readFileSync(server.catalogPath, 'utf8'));
    assert.ok(index.every(meta => meta.enabled === false && meta.archived === true));
    assert.deepEqual(await (await fetch(server.url + '/games')).json(), []);
    socket = await connect(server);
    for (const game of index) {
      assert.equal((await fetch(server.url + '/games/' + game.id + '.json?key=' + hostKey)).status, 404);
      assert.equal((await socket.timeout(3000).emitWithAck('createRoom', { hostKey, gameId: game.id })).ok, false);
    }
    for (const route of ['/archive/QUESTION_BANK.md', '/archive/completed-games/2026-11-22/games-and-media.zip', '/QUESTION_BANK.md']) {
      assert.equal((await fetch(server.url + route)).status, 404, 'archive is not publicly served');
    }
    const errors = [], virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => { if (!/Not implemented/.test(error.message)) errors.push(error.message); });
    dom = await JSDOM.fromURL(server.url + '/host?key=' + hostKey, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole,
      beforeParse(window) {
        window.fetch = (url, options) => fetch(new URL(url, server.url), options);
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.HTMLMediaElement.prototype.pause = () => {};
      },
    });
    const deadline = Date.now() + 6000;
    while (!dom.window.document.getElementById('startSeasonAdmin')) {
      assert.ok(Date.now() < deadline, errors.join('; '));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(dom.window.document.querySelectorAll('.gameCard').length, 0);
    assert.ok(dom.window.document.body.textContent.includes('Поки немає активних ігор'));
    assert.ok(dom.window.document.body.textContent.includes('Завершені ігри збережено в архіві'));
    assert.deepEqual(errors, []);
    assert.equal((await (await fetch(server.url + '/health')).json()).rooms, 0);
    console.log('PASS: empty HOST catalog, season controls remain available, all archived IDs blocked, bank/ZIP private and server healthy');
  } finally { dom?.window.close(); socket?.disconnect(); server.stop(); }

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'smokerlol-future-catalog-'));
  const activeIndex = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'games/index.json'), 'utf8'));
  fs.copyFileSync(path.join(archive, 'games/kinohardkor.json'), path.join(fixture, 'new.json'));
  fs.writeFileSync(path.join(fixture, 'index.json'), JSON.stringify([...activeIndex, { id: 'future-game-fixture', title: 'Нова гра', file: 'new.json', enabled: true }]));
  const future = await startServer({ HOST_KEY: hostKey, GAMES_INDEX_FILE: path.join(fixture, 'index.json') });
  try {
    socket = await connect(future);
    assert.deepEqual((await (await fetch(future.url + '/games')).json()).map(game => game.id), ['future-game-fixture']);
    for (const game of activeIndex) assert.equal((await socket.timeout(3000).emitWithAck('createRoom', { hostKey, gameId: game.id })).ok, false, 'archived ID cannot fall back to a new game');
    const created = await socket.timeout(3000).emitWithAck('createRoom', { hostKey, gameId: 'future-game-fixture' });
    assert.equal(created.ok, true);
    assert.equal(created.gameId, 'future-game-fixture');
    assert.equal((await socket.timeout(3000).emitWithAck('closeRoom', { code: created.code })).ok, true);
    console.log('PASS: adding a future enabled game works alongside nine archived packs; archived IDs never start the fallback game');
  } finally {
    socket?.disconnect(); future.stop();
    const resolved = path.resolve(fixture), temp = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(temp) || !path.basename(resolved).startsWith('smokerlol-future-catalog-')) throw new Error('Unsafe temporary cleanup target');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
