// RULE-03: numeric questions always advance the turn, regardless of the winner.
// Usage: node tests/ai_repro/numeric_turn_regression.js (about 32 seconds).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { io } = require('../../node_modules/socket.io/client-dist/socket.io.js');
const { startServer } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function checkTurnCases() {
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.search(/  socket\.on\(["']finishNumericResult["']/);
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  assert.ok(start >= 0 && end > start);
  const advance = source.slice(source.indexOf('function advanceTurn('), source.indexOf('function finishTile('));
  for (const [ids, chooser, results, expected] of [
    [['A', 'B', 'C'], 'A', [], 'B'],
    [['A', 'B', 'C'], 'B', [], 'C'],
    [['A', 'B', 'C'], 'C', [], 'A'],
    [['A'], 'A', [], 'A'],
    [[], null, [], null],
    [['A', 'B', 'C'], 'A', [{ id: 'B', diff: 0 }], 'B'],
    [['A', 'B', 'C'], 'B', [{ id: 'A', diff: 1 }], 'C'],
    [['A', 'B', 'C'], 'A', [{ id: 'A', diff: 0 }], 'B'],
    [['A', 'B', 'C'], 'C', [{ id: 'B', diff: 0 }], 'A'],
  ]) {
    let handler;
    const room = {
      phase: 'numeric_result', round: 0, current: { ci: 1, qi: 3 }, used: {},
      players: ids.map(id => ({ id, score: 0 })), turnPlayerId: chooser,
      numericResults: [...results, ...ids.filter(id => !results.some(r => r.id === id)).map(id => ({ id, noAnswer: true }))],
    };
    room.numericRevealCount = room.numericResults.length;
    vm.runInNewContext(advance + source.slice(start, end), {
      socket: { on: (_, callback) => { handler = callback; } },
      getRoom: () => room, isHost: () => true, emitState: () => {},
    });
    let response;
    const finish = () => handler({ code: 'TEST' }, result => { response = result; });
    // Revealing all places remains required.
    if (room.numericRevealCount) {
      room.numericRevealCount--;
      finish();
      assert.equal(response.ok, false);
      assert.equal(room.turnPlayerId, chooser);
      room.numericRevealCount++;
    }
    finish();
    assert.equal(response.ok, true);
    assert.equal(room.turnPlayerId, expected, `chooser ${chooser}, answers ${results.length}`);
    assert.equal(room.phase, 'board');
    assert.equal(room.used['0:1:3'], true);
    assert.equal(room.current, null);
    assert.equal(room.numericChallenge, null);
    finish();
    assert.equal(response.ok, false, 'repeat finish is rejected');
    assert.equal(room.turnPlayerId, expected, 'repeat finish cannot advance the turn twice');
  }
  console.log('PASS: turn rotation with/without a winner, wraparound, one/zero players and repeated-finish guards');
}

async function main() {
  checkTurnCases();
  const server = await startServer();
  const sockets = [];
  try {
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
    const emit = async (socket, event, payload) => {
      const result = await socket.timeout(3000).emitWithAck(event, payload);
      assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
      return result;
    };
    const host = await connect();
    const { code } = await emit(host, 'createRoom', { hostToken: 'numeric-turn-test', gameId: 'general-knowledge' });
    const ids = [], players = [];
    for (const name of ['A', 'B', 'C']) {
      const player = await connect();
      const joined = await emit(player, 'joinPlayer', { code, name });
      ids.push(joined.playerId);
      players.push(player);
    }
    await emit(host, 'skipFirstTurnQuiz', { code });
    await emit(host, 'chooseTile', { code, ci: 1, qi: 3 });
    await emit(host, 'startNumericTimer', { code });
    console.log('Waiting for the real 30-second numeric timer with no submissions...');
    await sleep(30100);
    await emit(host, 'finishNumericQuestion', { code });
    for (const id of ids) await emit(host, 'revealNextNumeric', { code });
    await emit(host, 'finishNumericResult', { code });
    const deadline = Date.now() + 3000;
    while (host.state?.phase !== 'board') {
      assert.ok(Date.now() < deadline, 'board state arrives');
      await sleep(20);
    }
    assert.equal(host.state.turnPlayerId, ids[1]);
    assert.equal(host.state.used['0:1:3'], true);
    assert.equal(host.state.current, null);
    assert.equal(host.state.numericChallenge, null);
    assert.ok(host.state.players.every(player => player.score === 0));
    console.log('PASS: isolated server, real timer, nobody answers -> next player chooses, tile used, scores unchanged');

    // B chooses, A wins the next numeric question, and the next chooser must be C.
    await emit(host, 'chooseTile', { code, ci: 2, qi: 2 });
    await emit(host, 'startNumericTimer', { code });
    for (let i = 0; i < players.length; i++) {
      await emit(players[i], 'submitNumericAnswer', { code, answer: i === 0 ? 435 : i });
    }
    await emit(host, 'finishNumericQuestion', { code });
    for (let i = 0; i < ids.length; i++) await emit(host, 'revealNextNumeric', { code });
    await emit(host, 'finishNumericResult', { code });
    const winnerDeadline = Date.now() + 3000;
    while (host.state?.phase !== 'board') {
      assert.ok(Date.now() < winnerDeadline, 'board state after winner arrives');
      await sleep(20);
    }
    assert.equal(host.state.turnPlayerId, ids[2], 'choice follows B -> C even when A wins');
    assert.equal(host.state.players.find(player => player.id === ids[0]).score, 300, 'winner gets the points');
    assert.ok(host.state.players.filter(player => player.id !== ids[0]).every(player => player.score === 0));
    assert.equal(host.state.used['0:2:2'], true);
    console.log('PASS: isolated server, B chooses -> A wins +300 -> C chooses next');
  } finally {
    for (const socket of sockets) socket.disconnect();
    server.stop();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
