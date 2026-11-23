const crypto = require("crypto");

function registerRoomHandlers(socket, {
  io, rooms, HOST_KEY_ERROR, DEFAULT_GAME_ID, getGameById, hostKeyOk, publicState, emitState,
  emitPlayerPresence, code, getRoom, isHost, onDisconnect = () => {}
}) {
  socket.on("createRoom", ({ hostToken, gameId, hostKey } = {}, cb = () => {}) => {
    if (!hostKeyOk(hostKey)) return cb({ ok:false, error:HOST_KEY_ERROR });
    const selectedGame = getGameById(gameId);
    if (!selectedGame) return cb({ ok: false, error: "Гру не знайдено." });
    const roomCode = code();
    const token = hostToken || crypto.randomUUID();
    const room = {
      code: roomCode,
      hostToken: token,
      hostSocket: socket.id,
      gameId: selectedGame.id || gameId || DEFAULT_GAME_ID,
      gameData: selectedGame,
      voiceMappings: {},
      voiceSpeaking: [],
      voiceUpdatedAt: 0,
      players: [],
      phase: "lobby",
      round: 0,
      used: {},
      selectedTile: null,
      current: null,
      buzzer: null,
      revealAnswer: false,
      answeringLocked: new Set(),
      catChooser: null,
      catReceiver: null,
      turnPlayerId: null,
      specialCells: {},
      vaBankPlayer: null,
      vaBankBet: null,
      duelPlayers: [],
      finalSeconds: 30,
      finalTimer: null,
      finalResults: null,
      finalRevealCount: 0,
      savedSeasonGameId: null,
      savedSeasonId: null,
      seasonFinal: null,
      seasonCeremonyActive: false,
      seasonRevealCount: 0,
      firstTurnQuiz: selectedGame.firstTurnQuiz || null,
      firstTurnAnswers: {},
      firstTurnResults: null,
      firstTurnTimerStatus: "ready",
      firstTurnEndsAt: null,
      firstTurnTimer: null,
      firstTurnRevealCount: 0,
      numericChallenge: null,
      numericAnswers: {},
      numericSubmittedAt: {},
      numericResults: null,
      numericEndsAt: null,
      numericTimer: null,
      numericRevealCount: 0,
      audience: [],
      audienceRoundIndex: null,
      audienceQuestionIndex: 0,
      audienceAnswers: {},
      audienceStartedAt: null,
      audienceEndsAt: null,
      audienceTimer: null,
      audienceReturnPhase: null,
      audienceRevealCount: 0,
      audienceWinners: [],
      paused: false,
      pausedPhase: null,
      pauseFirstTurnRemaining: null,
      pauseFinalRemaining: null,
      buzzCandidates: [],
      buzzResolveTimer: null,
      buzzReactions: {},
    };
    rooms.set(roomCode, room);
    socket.data.hostToken = token;
    socket.data.roomCode = roomCode;
    socket.join(roomCode);
    cb({
      ok: true,
      code: roomCode,
      hostToken: token,
      gameId: room.gameId,
      state: publicState(room),
      specialCells: room.specialCells || {},
      voiceMappings: room.voiceMappings || {},
    });
    emitState(room);
  });

  socket.on("rejoinHost", ({ code: c, hostToken }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.hostToken !== hostToken)
      return cb({ ok: false, error: "Кімнату або ключ ведучого не знайдено." });
    room.hostSocket = socket.id;
    socket.data.hostToken = hostToken;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({
      ok: true,
      code: room.code,
      gameId: room.gameId,
      state: publicState(room),
      specialCells: room.specialCells || {},
    });
    // Rejoining HOST already receives the full room state in the callback.
    // Do not rebroadcast it and rebuild active media on every client.
  });

  socket.on("joinPlayer", ({ code: c, name, playerKey }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: "Кімнату не знайдено." });
    // Rejoin only with the secret key: player ids are public (state.players).
    let p = playerKey ? room.players.find(x => x.key === playerKey) : null;
    const reconnectingExistingPlayer = !!p;
    if (!p) {
      if (room.phase !== "lobby")
        return cb({ ok: false, error: "Гра вже почалася. Поверніться з того самого пристрою/профілю." });
      if (room.players.length >= 4) return cb({ ok: false, error: "У кімнаті вже 4 гравці." });
      const clean =
        String(name || "").trim().slice(0, 20) || `Гравець ${room.players.length + 1}`;
      p = { id: crypto.randomUUID(), key: crypto.randomBytes(16).toString('hex'), name: clean,
        cameraSlot: [0, 1, 2, 3].find(slot => !room.players.some(player => player.cameraSlot === slot)),
        score: 0,
        socketId: socket.id,
        connected: true,
        bet: null,
        finalAnswer: "",
        falseStartUntil: 0,
        networkRttMs: null,
        networkJitterMs: null,
        syncSamples: 0,
        lastSyncAt: 0,
      };
      room.players.push(p);
    } else {
      p.socketId = socket.id;
      p.connected = true;
      p.syncSamples = 0;
      p.lastSyncAt = 0;
      if (name) p.name = String(name).trim().slice(0, 20) || p.name;
    }
    socket.data.playerId = p.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, playerId: p.id, playerKey: p.key, code: room.code, name: p.name, state: publicState(room) });
    if (reconnectingExistingPlayer && room.phase !== "lobby") {
      // Refreshing a player phone must not reset HOST/OBS/video on the rest of the room.
      emitPlayerPresence(room, p);
    } else {
      emitState(room);
    }
  });

  socket.on("leavePlayer", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c || socket.data.roomCode);
    if (!room) {
      socket.data.playerId = null;
      socket.data.roomCode = null;
      return cb({ ok: true });
    }
    const pid = socket.data.playerId;
    const idx = room.players.findIndex(x => x.id === pid);
    if (idx >= 0) {
      const wasTurn = room.turnPlayerId === pid;
      room.players.splice(idx, 1);
      if (wasTurn)
        room.turnPlayerId = room.players.length ? room.players[Math.min(idx, room.players.length - 1)].id : null;
    }
    socket.leave(room.code);
    socket.data.playerId = null;
    socket.data.roomCode = null;
    cb({ ok: true });
    emitState(room);
  });

  // v3.0.1 — lightweight NTP-style clock sync. The client measures RTT and
  // estimates server clock offset from the midpoint of the request.

  socket.on("closeRoom", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу до цієї кімнати." });
    if (room.finalTimer) clearInterval(room.finalTimer);
    if (room.firstTurnTimer) clearTimeout(room.firstTurnTimer);
    if (room.audienceTimer) clearTimeout(room.audienceTimer);
    io.to(room.code).emit("roomClosed", { code: room.code, message: "Ведучий закрив кімнату." });
    rooms.delete(room.code);
    socket.leave(room.code);
    socket.data.roomCode = null;
    cb({ ok: true });
  });

  // VIDEO and AUDIO use separate commands. Both OBS and PLAYER follow HOST;
  // PLAYER has no local playback controls.

  socket.on("joinScreen", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: "Кімнату не знайдено." });
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code });
    // OBS receives its own current snapshot. Its reload must not make HOST/PLAYER rerender media.
    socket.emit("state", publicState(room));
  });

  // HOST-only Discord Active Speaker controls and player mappings.

  socket.on("returnToGameMenu", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може закрити кімнату." });
    clearInterval(room.finalTimer);
    clearTimeout(room.firstTurnTimer);
    clearTimeout(room.audienceTimer);
    io.to(room.code).emit("roomClosed", { code: room.code, reason: "Ведучий повернувся в головне меню." });
    rooms.delete(room.code);
    socket.data.roomCode = null;
    cb({ ok: true });
  });

  socket.on("disconnect", () => {
    onDisconnect(socket);
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find(x => x.id === socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
      p.syncSamples = 0;
      p.lastSyncAt = 0;
    }
    const a = room.audience.find(x => x.id === socket.data.audienceId);
    const audienceDisconnected = !!(a && a.socketId === socket.id);
    if (audienceDisconnected) {
      a.connected = false;
      a.socketId = null;
    }
    if (p && !p.connected) {
      if (room.phase === "lobby") emitState(room);
      else emitPlayerPresence(room, p);
    }
    if (audienceDisconnected)
      io.to(room.code).emit("audienceProgress", {
        code: room.code,
        joined: room.audience.filter(x => x.connected).length,
        submitted: Object.keys(room.audienceAnswers || {}).length,
        roundIndex: room.audienceRoundIndex,
        questionIndex: room.audienceQuestionIndex,
        remainingMs: room.audienceEndsAt ? Math.max(0, room.audienceEndsAt - Date.now()) : 0,
      });
  });
}

module.exports = { registerRoomHandlers };
