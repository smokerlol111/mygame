const crypto = require('node:crypto');
const { validatePool } = require('./pool');
const { createRandomPool } = require('./random-pool');
const { publicState, hostState, teamState } = require('./state');

function registerSessions(socket, context) {
  const { on, rooms, code, hostKeyOk, rootDir, publish, engine, findRoom } = context;
  on('classicRandomPool', payload => {
    if (!hostKeyOk(payload.hostKey)) throw new Error('Потрібен ключ ведучого.');
    return createRandomPool(rootDir,payload.count);
  });
  function replace(previousId) {
    if (!previousId || previousId === socket.id) return;
    const previous = context.io.sockets.sockets.get(previousId);
    if (previous) {
      previous.emit('classicSessionReplaced');
      previous.data.hostToken = null; previous.data.classicTeamId = null;
      previous.leave(previous.data.roomCode); previous.data.roomCode = null;
    }
  }
  on('classicCreateRoom', payload => {
    if (!hostKeyOk(payload.hostKey)) throw new Error('Потрібен ключ ведучого.');
    const pool = validatePool(payload.pool, rootDir);
    const room = { code: code(), hostToken: crypto.randomUUID(), hostSocket: socket.id, gameType: 'classic',
      gameId: 'classic', gameData: { title: pool.title }, players: [], phase: 'classic_lobby',
      classic: { pool, index: -1, questionKey: null, answers: Object.create(null), drafts: Object.create(null),
        history: [], finalRevealCount: 0, endsAt: null, remainingMs: 0, timer: null, media: null } };
    room.dispose = () => engine.stop(room);
    rooms.set(room.code, room);
    socket.data.roomCode = room.code; socket.data.hostToken = room.hostToken;
    socket.join(room.code);
    publish(room);
    return { code: room.code, hostToken: room.hostToken, state: publicState(room, engine.now()), hostState: hostState(room, { includePool: true }) };
  });
  on('classicRejoinHost', payload => {
    const room = findRoom(payload.code);
    if (room.hostToken !== payload.hostToken) throw new Error('Ключ ведучого не підходить.');
    replace(room.hostSocket);
    room.hostSocket = socket.id;
    socket.data.roomCode = room.code; socket.data.hostToken = room.hostToken;
    socket.join(room.code);
    engine.expire(room);
    return { code: room.code, hostToken: room.hostToken, state: publicState(room, engine.now()), hostState: hostState(room, { includePool: true }) };
  });
  on('classicJoinTeam', payload => {
    const room = findRoom(payload.code);
    let team = payload.teamKey ? room.players.find(team => team.key === payload.teamKey) : null;
    if (!team) {
      if (room.phase !== 'classic_lobby') throw new Error('Гра вже почалася. Поверніться з пристрою капітана зі збереженим ключем.');
      if (room.players.length >= 200) throw new Error('Досягнуто ліміт команд у кімнаті.');
      const name = typeof payload.name === 'string' ? payload.name.trim().replace(/\s+/g, ' ') : '';
      if (!name || name.length > 40) throw new Error('Назва команди має містити від 1 до 40 символів.');
      if (room.players.some(team => team.name.normalize('NFKC').toLocaleLowerCase('uk') === name.normalize('NFKC').toLocaleLowerCase('uk')))
        throw new Error('Команда з такою назвою вже є.');
      team = { id: crypto.randomUUID(), key: crypto.randomUUID(), name, score: 0, connected: true, socketId: socket.id, syncSamples: 0 };
      room.players.push(team);
    } else replace(team.socketId);
    team.socketId = socket.id; team.connected = true;
    socket.data.roomCode = room.code; socket.data.classicTeamId = team.id;
    socket.join(room.code);
    engine.expire(room); publish(room);
    return { code: room.code, teamId: team.id, teamKey: team.key, name: team.name,
      state: publicState(room, engine.now()), teamState: teamState(room, team) };
  });
  on('classicJoinScreen', payload => {
    const room = findRoom(payload.code);
    socket.data.roomCode = room.code;
    socket.join(room.code);
    engine.expire(room);
    return { code: room.code, state: publicState(room, engine.now()) };
  });
}

module.exports = { registerSessions };
