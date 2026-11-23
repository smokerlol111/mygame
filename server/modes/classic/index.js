const { publicState, hostState, teamState } = require('./state');
const { createRoundEngine } = require('./round');
const { registerSessions } = require('./sessions');
const { registerActions } = require('./handlers');

function createClassicMode({ io, rooms, code, hostKeyOk, rootDir, clock = globalThis }) {
  function publish(room) {
    io.to(room.code).emit('state', publicState(room, engine.now()));
    if (room.hostSocket) io.to(room.hostSocket).emit('classicHostState', hostState(room));
    for (const team of room.players) if (team.connected && team.socketId)
      io.to(team.socketId).emit('classicTeamState', teamState(room, team));
  }
  const engine = createRoundEngine({ rooms, publish, clock });
  function findRoom(value) {
    const room = rooms.get(String(value || '').toUpperCase());
    if (!room || room.gameType !== 'classic') throw new Error('Кімнату класичного квізу не знайдено.');
    return room;
  }
  function register(socket) {
    const on = (event, action) => socket.on(event, (payload = {}, callback = () => {}) => {
      const reply = typeof callback === 'function' ? callback : () => {};
      try { reply({ ok: true, ...action(payload && typeof payload === 'object' ? payload : {}) }); }
      catch (error) { reply({ ok: false, error: error.message }); }
    });
    function currentRoom(payload, phases, requireKey = true) {
      const room = findRoom(payload.code);
      engine.expire(room);
      if (requireKey && payload.questionKey !== room.classic.questionKey) throw new Error('Це команда для іншого питання.');
      if (phases && !phases.includes(room.phase)) throw new Error('Дія недоступна на цьому етапі.');
      return room;
    }
    function hostRoom(payload, phases, requireKey = false) {
      const room = currentRoom(payload, phases, requireKey);
      if (socket.data.hostToken !== room.hostToken || room.hostSocket !== socket.id || socket.data.roomCode !== room.code)
        throw new Error('Дія доступна тільки ведучому цієї кімнати.');
      return room;
    }
    const context = { io, rooms, code, hostKeyOk, rootDir, on, publish, engine, findRoom, hostRoom, currentRoom };
    registerSessions(socket, context);
    registerActions(socket, context);
  }
  function disconnect(socket) {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.gameType !== 'classic') return;
    const team = room.players.find(team => team.id === socket.data.classicTeamId && team.socketId === socket.id);
    if (team) { team.connected = false; team.socketId = null; publish(room); }
    if (room.hostSocket === socket.id) room.hostSocket = null;
  }
  return { register, disconnect, publicState: room => publicState(room, engine.now()), engine };
}

module.exports = { createClassicMode };
