// HTTP compatibility checks against an isolated server, before/after module extraction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');

async function main() {
  const hostKey = 'isolated-module-regression';
  const server = await startServer({ HOST_KEY: hostKey });
  let socket;
  try {
    for (const [route, file] of [
      ['/', 'index.html'], ['/host', 'host.html'], ['/play', 'play.html'],
      ['/screen', 'screen.html'], ['/screen/TEST', 'screen.html'],
      ['/audience', 'audience.html'], ['/audience/TEST', 'audience.html'],
      ['/seasons', 'seasons.html'], ['/common.js', 'common.js'],
    ]) {
      const response = await fetch(server.url + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('cache-control'), /no-store/, route);
      assert.equal(await response.text(), fs.readFileSync(path.join(REPO_ROOT, 'public', file), 'utf8'), route);
    }

    const index = JSON.parse(fs.readFileSync(server.catalogPath, 'utf8'));
    const capabilities = await fetch(server.url + '/api/capabilities');
    assert.match(capabilities.headers.get('cache-control'),/no-store/);
    assert.deepEqual(await capabilities.json(),{ok:true,classicRandomPool:true,randomBoard:true});
    const enabled = index.filter(game => game.enabled !== false);
    assert.deepEqual(await (await fetch(server.url + '/games')).json(), enabled.map(({ file, ...meta }) => meta));
    for (const meta of enabled) {
      const route = server.url + '/games/' + encodeURIComponent(meta.id) + '.json';
      const source = JSON.parse(fs.readFileSync(path.join(path.dirname(server.catalogPath), meta.file), 'utf8'));
      const board = {
        id: meta.id,
        rounds: (source.rounds || []).map(round => ({
          categories: (round.categories || []).map(category => ({
            name: category.name, questions: (category.questions || []).map(question => ({ value: question.value })),
          })),
        })),
      };
      assert.deepEqual(await (await fetch(route)).json(), board, meta.id + ': anonymous response has no prompts/answers');
      assert.deepEqual(await (await fetch(route + '?key=wrong')).json(), board, meta.id + ': wrong key');
      const response = await fetch(route + '?key=' + hostKey);
      assert.equal(response.status, 200);
      const full = await response.json();
      assert.equal(full.id, meta.id);
      assert.deepEqual(full.rounds, source.rounds, meta.id + ': HOST retains full questions');
      assert.equal(Object.hasOwn(full, 'specialSetup'), false);
      assert.equal(Object.hasOwn(full, 'specialPools'), false);
    }
    for (const id of ['missing-module-test-game', ...index.filter(game => game.enabled === false).map(game => game.id)]) {
      assert.equal((await fetch(server.url + '/games/' + encodeURIComponent(id) + '.json?key=' + hostKey)).status, 404);
    }
    console.log('PASS: page/static routes, no-cache headers, catalog, HOST access and public answer/special-cell secrecy');

    socket = io(server.url, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const create = payload => socket.timeout(3000).emitWithAck('createRoom', payload);
    assert.equal((await create({})).ok, false, 'HOST key is still required');
    for (const payload of [{}, { gameId: 'missing-module-test-game' }, { gameId: enabled.at(-1).id }]) {
      const result = await create({ ...payload, hostKey });
      assert.equal(result.ok, true);
      assert.equal(result.gameId, payload.gameId === enabled.at(-1).id ? enabled.at(-1).id : enabled[0].id);
      assert.equal(result.state.gameId, result.gameId);
      assert.deepEqual(await (await fetch(server.url + '/health')).json(), { ok: true, version: '3.1.0-dev', rooms: 1 });
      assert.equal((await socket.timeout(3000).emitWithAck('closeRoom', { code: result.code })).ok, true);
      assert.equal((await (await fetch(server.url + '/health')).json()).rooms, 0);
    }
    const seasons = await (await fetch(server.url + '/api/seasons')).json();
    assert.ok(Array.isArray(seasons.seasons));
    console.log('PASS: HOST authorization, default/unknown/explicit game selection, live health room count and seasons API');
  } finally {
    socket?.disconnect();
    server.stop();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
