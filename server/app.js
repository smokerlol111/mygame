const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const storage = require("../storage");
const { loadGameCatalog } = require("./game-catalog");
const { registerHttpRoutes } = require("./routes");
const { createBoardState } = require("./modes/board/state");
const { createStatePublisher } = require("./transport/publish-state");
const { createRoomStore } = require("./rooms/store");
const { createBoardHelpers } = require("./modes/board/helpers");
const { createBoardTimers } = require("./modes/board/timers");
const { createSpecialCells } = require("./modes/board/special-cells");
const { createDiscordIntegration } = require("./features/discord");
const { registerShutdown } = require("./lifecycle");
const { registerRoomHandlers } = require("./rooms/handlers");
const { registerThemeHandlers } = require("./features/themes");
const { registerNetworkHandlers, startPresenceMonitor } = require("./rooms/network");
const { registerBoardControlHandlers } = require("./modes/board/control");
const { registerMediaHandlers } = require("./features/media");
const { registerFirstTurnHandlers } = require("./modes/board/first-turn");
const { registerChooseTileHandler } = require("./modes/board/choose-tile");
const { registerNumericHandlers } = require("./modes/board/numeric");
const { registerBoardMediaHandlers } = require("./modes/board/media");
const { registerBuzzHandlers } = require("./modes/board/buzz");
const { registerSpecialQuestionHandlers } = require("./modes/board/special-questions");
const { registerAudienceHandlers } = require("./audience/handlers");
const { registerFinalHandlers } = require("./modes/board/final");
const { registerSeasonHandlers } = require("./seasons/handlers");
const { createClassicMode } = require("./modes/classic");
const { registerRandomBoardHandlers } = require('./modes/board/random');

function createApplication({ rootDir, env = process.env }) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: true, credentials: true }, pingInterval: 5000, pingTimeout: 20000 });
  const PORT = env.PORT || 3000;
  const HOST_KEY = String(env.HOST_KEY || "").trim();
  const HOST_KEY_ERROR = "Потрібен ключ ведучого: відкрийте /host за посиланням із ключем.";
  const hostKeyOk = key => !HOST_KEY || key === HOST_KEY;
  const { gamesIndex, games, DEFAULT_GAME_ID, getGameById, getRoomGame } = loadGameCatalog(rootDir, env.GAMES_INDEX_FILE);
  const { rooms, code, getRoom, isHost } = createRoomStore();
  const boardState = createBoardState({ getRoomGame });
  const classic = createClassicMode({ io, rooms, code, hostKeyOk, rootDir });
  const publicState = room => room.gameType === 'classic' ? classic.publicState(room) : boardState(room);
  const getBoardRoom = value => { const room = getRoom(value); return room?.gameType === 'classic' ? undefined : room; };
  const { emitState, emitPlayerPresence } = createStatePublisher({ io, publicState, getRoomGame });
  const { resetQuestionState, resetEligibleBuzzReactions, advanceTurn, finishTile } = createBoardHelpers();
  const { startFirstTurnCountdown, startFinalCountdown, startNumericCountdown, startAudienceCountdown,
    pauseRoom, resumeRoom } = createBoardTimers({ rooms, emitState });
  const randomSpecialCells = createSpecialCells({ getRoomGame });
  const voice = createDiscordIntegration({ rootDir, rooms, io, getRoom: getBoardRoom, isHost, emitState, env });

  registerHttpRoutes(app, { rootDir, gamesIndex, games, hostKeyOk, rooms, storage });
  io.on("connection", socket => {
    socket.data.seasonAdminToken = crypto.randomUUID();
    registerRoomHandlers(socket, {
      io, rooms, HOST_KEY_ERROR, DEFAULT_GAME_ID, getGameById, hostKeyOk, publicState, emitState,
      emitPlayerPresence, code, getRoom: getBoardRoom, isHost, onDisconnect: classic.disconnect
    });
    registerThemeHandlers(socket, { io, getRoomGame, getRoom, isHost });
    registerNetworkHandlers(socket, { io, getRoom });
    registerBoardControlHandlers(socket, {
      io, rooms, getRoomGame, emitState, getRoom: getBoardRoom, isHost, resetEligibleBuzzReactions, finishTile, pauseRoom,
      resumeRoom
    });
    registerMediaHandlers(socket, { io, getRoom: getBoardRoom, isHost });
    registerFirstTurnHandlers(socket, {
      io, getRoomGame, emitState, getRoom: getBoardRoom, isHost, startFirstTurnCountdown, randomSpecialCells
    });
    registerChooseTileHandler(socket, { rooms, getRoomGame, emitState, getRoom: getBoardRoom, isHost, resetQuestionState, rootDir });
    registerNumericHandlers(socket, { emitState, getRoom: getBoardRoom, isHost, advanceTurn, startNumericCountdown });
    registerBoardMediaHandlers(socket, { emitState, getRoom: getBoardRoom, isHost });
    registerBuzzHandlers(socket, { io, rooms, emitState, getRoom: getBoardRoom, isHost, resetEligibleBuzzReactions, finishTile });
    registerSpecialQuestionHandlers(socket, { io, rooms, emitState, getRoom: getBoardRoom, isHost, resetQuestionState, advanceTurn });
    registerAudienceHandlers(socket, {
      io, getRoomGame, publicState, emitState, getRoom: getBoardRoom, isHost, startAudienceCountdown
    });
    registerFinalHandlers(socket, { getRoomGame, emitState, getRoom: getBoardRoom, isHost, resetQuestionState, startFinalCountdown });
    registerSeasonHandlers(socket, { HOST_KEY_ERROR, getRoomGame, hostKeyOk, emitState, getRoom: getBoardRoom, isHost, storage });
    voice.registerHandlers(socket);
    classic.register(socket);
    registerRandomBoardHandlers(socket,{rootDir,hostKeyOk,games,rooms});
  });
  const stopPresenceMonitor = startPresenceMonitor({ rooms, io, emitState });
  return { app, server, io, rooms, voice, stopPresenceMonitor, PORT, HOST_KEY };
}

function startApplication(options) {
  const runtime = createApplication(options);
  const { server, voice, PORT, HOST_KEY } = runtime;
  registerShutdown(runtime);
  return storage.init().then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`SMOKERLOL v3.0.0-rc: http://0.0.0.0:${PORT}`);
      if (!HOST_KEY) console.warn("HOST_KEY is not set: anyone can create rooms, manage seasons and read game answers.");
      voice.start();
    });
    return runtime;
  }).catch(err => {
    console.error("Storage init failed:", err);
    process.exit(1);
  });
}

module.exports = { createApplication, startApplication };
