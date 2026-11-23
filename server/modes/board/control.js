function registerBoardControlHandlers(socket, {
  io, rooms, getRoomGame, emitState, getRoom, isHost, resetEligibleBuzzReactions, finishTile, pauseRoom,
  resumeRoom
}) {
  socket.on("togglePause", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    if (room.phase === "lobby" || room.phase === "final_result")
      return cb({ ok: false, error: "Пауза на цьому етапі не потрібна." });
    if (room.paused) resumeRoom(room);
    else pauseRoom(room);
    cb({ ok: true, paused: room.paused });
    emitState(room);
  });

  socket.on("emergencyReopenBuzz", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current) return cb({ ok: false, error: "Немає активного питання." });
    if (room.paused) return cb({ ok: false, error: "Спочатку зніміть паузу." });
    if (room.current.type === "final" || ["cat_question", "va_bank_question"].includes(room.phase))
      return cb({ ok: false, error: "Для цього типу питання BUZZ не використовується." });
    const leadMs = 1200;
    resetEligibleBuzzReactions(room);
    room.buzzer = null;
    room.phase = "buzz";
    room.resultReason = null;
    room.buzzCandidates = [];
    if (room.buzzResolveTimer) {
      clearTimeout(room.buzzResolveTimer);
      room.buzzResolveTimer = null;
    }
    room.buzzOpensAt = Date.now() + leadMs;
    io.to(room.code).emit("buzzScheduled", { opensAt: room.buzzOpensAt });
    setTimeout(() => {
      if (rooms.get(room.code) === room && room.phase === "buzz" && !room.buzzer)
        io.to(room.code).emit("cue", {
          type: "buzz_open",
          at: room.buzzOpensAt,
          playerIds: [...(room.duelPlayers || [])],
        });
    }, leadMs);
    cb({ ok: true, opensAt: room.buzzOpensAt });
    emitState(room);
  });

  socket.on("emergencyRevealQuestion", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current || room.current.type === "final")
      return cb({ ok: false, error: "Немає активного звичайного питання." });
    if (room.paused) return cb({ ok: false, error: "Спочатку зніміть паузу." });
    room.buzzer = null;
    room.revealAnswer = true;
    room.resultReason = "host_emergency";
    if (room.current?.questionType === "video") {
      room.current.videoContinued = true;
      room.current.videoPlaying = false;
      room.current.videoUpdatedAt = Date.now();
    }
    room.phase = "result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("emergencyFinishTile", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current || room.current.type === "final")
      return cb({ ok: false, error: "Немає активного питання." });
    if (room.paused) return cb({ ok: false, error: "Спочатку зніміть паузу." });
    finishTile(room);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("adjustScore", ({ code: c, playerId, amount } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу до цієї кімнати." });
    if (room.savedSeasonGameId)
      return cb({ ok: false, error: "Результат уже збережено в сезон. Спочатку видаліть його з сезону, потім скоригуйте бали й збережіть знову." });
    const player = room.players.find(p => p.id === playerId);
    if (!player) return cb({ ok: false, error: "Гравця не знайдено." });

    const delta = Number(amount);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000)
      return cb({ ok: false, error: "Вкажіть ціле число від -100000 до 100000, крім 0." });

    player.score += delta;

    // Якщо коригування зроблено вже після фінального підрахунку —
    // одразу оновлюємо й фінальну таблицю.
    if (room.phase === "final_result" && Array.isArray(room.finalResults)) {
      const entry = room.finalResults.find(r => r.id === player.id);
      if (entry) entry.score = player.score;
      room.finalResults.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "uk"));
    }

    cb({ ok: true, playerId: player.id, score: player.score, delta });
    emitState(room);
  });

  socket.on("restartSameGame", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може перезапустити гру." });
    clearInterval(room.finalTimer);
    room.finalTimer = null;
    clearTimeout(room.firstTurnTimer);
    room.firstTurnTimer = null;
    room.phase = "lobby";
    room.isTestResult = false;
    room.paused = false;
    room.pausedPhase = null;
    room.pauseFirstTurnRemaining = null;
    room.pauseFinalRemaining = null;
    room.round = 0;
    room.used = {};
    room.current = null;
    room.buzzer = null;
    room.revealAnswer = false;
    room.answeringLocked = new Set();
    room.buzzReactions = {};
    room.catChooser = null;
    room.catReceiver = null;
    room.turnPlayerId = null;
    room.specialCells = {};
    room.vaBankPlayer = null;
    room.vaBankBet = null;
    room.duelPlayers = [];
    room.finalSeconds = 30;
    room.finalResults = null;
    room.finalRevealCount = 0;
    room.savedSeasonGameId = null;
    room.savedSeasonId = null;
    room.seasonFinal = null;
    room.seasonCeremonyActive = false;
    room.seasonRevealCount = 0;
    room.firstTurnQuiz = getRoomGame(room).firstTurnQuiz || null;
    room.firstTurnAnswers = {};
    room.firstTurnResults = null;
    clearTimeout(room.audienceTimer);
    room.audienceTimer = null;
    room.audienceRoundIndex = null;
    room.audienceQuestionIndex = 0;
    room.audienceAnswers = {};
    room.audienceStartedAt = null;
    room.audienceEndsAt = null;
    room.audienceRanking = [];
    room.audienceRevealCount = 0;
    room.audienceWinners = [];
    room.audience.forEach(a => {
      a.roundStats = {};
    });
    room.players.forEach(p => {
      p.score = 0;
      p.bet = null;
      p.finalAnswer = "";
    });
    cb({ ok: true });
    emitState(room);
  });
}

module.exports = { registerBoardControlHandlers };
