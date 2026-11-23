function registerFirstTurnHandlers(socket, {
  io, getRoomGame, emitState, getRoom, isHost, startFirstTurnCountdown, randomSpecialCells
}) {
  socket.on("startGame", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "lobby") return cb({ ok: false, error: "Гру можна почати лише з лобі." });
    if (room.players.length < 1) return cb({ ok: false, error: "Потрібен хоча б один гравець." });
    clearTimeout(room.firstTurnTimer);
    room.firstTurnTimer = null;
    room.round = 0;
    room.used = {};
    room.finalResults = null;
    room.finalRevealCount = 0;
    room.specialCells = randomSpecialCells(room);
    room.selectedTile = null;
    room.turnPlayerId = null;
    room.firstTurnQuiz = getRoomGame(room).firstTurnQuiz || null;
    room.firstTurnAnswers = {};
    room.firstTurnResults = null;
    room.firstTurnTimerStatus = "ready";
    room.firstTurnEndsAt = null;
    room.firstTurnRevealCount = 0;
    room.players.forEach(p => {
      p.score = 0;
      p.bet = null;
      p.finalAnswer = "";
    });
    room.paused = false;
    room.isTestResult = false;
    room.pausedPhase = null;
    room.pauseFirstTurnRemaining = null;
    room.pauseFinalRemaining = null;
    room.phase = room.firstTurnQuiz ? "first_turn_quiz" : "board";
    if (!room.firstTurnQuiz) room.turnPlayerId = room.players[0]?.id || null;
    cb({ ok: true, specialCells: room.specialCells || {} });
    emitState(room);
  });

  socket.on("startFirstTurnTimer", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "first_turn_quiz" || !room.firstTurnQuiz)
      return cb({ ok: false, error: "Розіграш зараз недоступний." });
    if (room.firstTurnTimerStatus === "running") return cb({ ok: false, error: "Таймер уже запущено." });
    if (room.firstTurnTimerStatus === "expired") return cb({ ok: false, error: "Час уже вийшов." });

    startFirstTurnCountdown(room, 30000);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("submitFirstTurnAnswer", ({ code: c, answer }, cb = () => {}) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== "first_turn_quiz" || !room.firstTurnQuiz)
      return cb({ ok: false, error: "Розіграш зараз недоступний." });
    if (room.firstTurnTimerStatus !== "running")
      return cb({
        ok: false,
        error:
          room.firstTurnTimerStatus === "expired"
            ? "Час вийшов."
            : room.firstTurnTimerStatus === "paused"
              ? "Гра на паузі."
              : "Дочекайтеся запуску таймера.",
      });
    if (Date.now() >= Number(room.firstTurnEndsAt || 0)) {
      clearTimeout(room.firstTurnTimer);
      room.firstTurnTimer = null;
      room.firstTurnTimerStatus = "expired";
      room.firstTurnEndsAt = null;
      emitState(room);
      return cb({ ok: false, error: "Час вийшов." });
    }
    if (Object.prototype.hasOwnProperty.call(room.firstTurnAnswers, p.id))
      return cb({ ok: false, error: "Відповідь уже зафіксована." });
    const numericText = String(answer ?? "").trim();
    const n = /^\d+$/.test(numericText) ? Number(numericText) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 1000000000)
      return cb({ ok: false, error: "Введіть коректне невід’ємне число." });

    room.firstTurnAnswers[p.id] = n;
    const submittedPlayerIds = Object.keys(room.firstTurnAnswers);
    cb({ ok: true, submittedPlayerIds });
    // Не перебудовуємо UI телефонів інших гравців під час введення:
    // прогрес слухають тільки HOST/OBS.
    io.to(room.code).emit("firstTurnProgress", {
      code: room.code,
      submittedPlayerIds,
      remainingMs: room.firstTurnEndsAt ? Math.max(0, room.firstTurnEndsAt - Date.now()) : 0,
      timerStatus: room.firstTurnTimerStatus,
    });
  });

  socket.on("revealFirstTurnResults", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "first_turn_quiz" || !room.firstTurnQuiz)
      return cb({ ok: false, error: "Розіграш зараз недоступний." });

    const allAnswered = room.players.every(p => Object.prototype.hasOwnProperty.call(room.firstTurnAnswers, p.id));
    if (!allAnswered && room.firstTurnTimerStatus !== "expired")
      return cb({ ok: false, error: "Ще не всі гравці відповіли, а час не завершився." });

    clearTimeout(room.firstTurnTimer);
    room.firstTurnTimer = null;
    room.firstTurnTimerStatus = "done";
    room.firstTurnEndsAt = null;

    const correct = Number(room.firstTurnQuiz.answer);
    const collator = new Intl.Collator("uk", { sensitivity: "base" });
    const answered = room.players
      .filter(p => Object.prototype.hasOwnProperty.call(room.firstTurnAnswers, p.id))
      .map(p => {
        const answer = room.firstTurnAnswers[p.id];
        return {
          id: p.id,
          name: p.name,
          answer,
          diff: Math.abs(answer - correct),
          delta: answer - correct,
          noAnswer: false,
        };
      })
      .sort((x, y) => x.diff - y.diff || collator.compare(x.name, y.name));

    const unanswered = room.players
      .filter(p => !Object.prototype.hasOwnProperty.call(room.firstTurnAnswers, p.id))
      .map(p => ({ id: p.id, name: p.name, answer: null, diff: null, delta: null, noAnswer: true }))
      .sort((x, y) => collator.compare(x.name, y.name));

    room.firstTurnResults = [...answered, ...unanswered];

    // Порядок результатів стає реальним порядком ходів на всю гру.
    const order = new Map(room.firstTurnResults.map((r, i) => [r.id, i]));
    room.players.sort((x, y) => (order.get(x.id) ?? 999) - (order.get(y.id) ?? 999));
    room.turnPlayerId = room.players[0]?.id || null;

    room.firstTurnRevealCount = 0;
    room.phase = "first_turn_result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealNextFirstTurnResult", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "first_turn_result" || !room.firstTurnResults)
      return cb({ ok: false, error: "Результати розіграшу зараз недоступні." });
    const total = room.firstTurnResults.length;
    if ((room.firstTurnRevealCount || 0) >= total) return cb({ ok: false, error: "Усі результати вже відкриті." });
    room.firstTurnRevealCount = (room.firstTurnRevealCount || 0) + 1;
    cb({ ok: true, revealCount: room.firstTurnRevealCount, total });
    emitState(room);
  });

  socket.on("beginRoundOne", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "first_turn_result")
      return cb({ ok: false, error: "Спочатку відкрийте результати розіграшу." });
    if ((room.firstTurnRevealCount || 0) < (room.firstTurnResults?.length || 0))
      return cb({ ok: false, error: "Спочатку відкрийте всі місця від останнього до першого." });
    room.phase = "board";
    room.round = 0;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("skipFirstTurnQuiz", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !["lobby", "first_turn_quiz"].includes(room.phase))
      return cb({ ok: false, error: "Розіграш зараз не можна пропустити." });
    clearTimeout(room.firstTurnTimer);
    room.firstTurnTimer = null;
    room.firstTurnTimerStatus = "ready";
    room.firstTurnEndsAt = null;
    room.isTestResult = false;
    room.firstTurnAnswers = {};
    room.firstTurnResults = null;
    room.firstTurnRevealCount = 0;
    room.turnPlayerId = room.players[0]?.id || null;
    room.phase = "board";
    room.round = 0;
    room.used = {};
    room.finalResults = null;
    room.finalRevealCount = 0;
    room.specialCells = randomSpecialCells(room);
    room.players.forEach(p => {
      p.score = 0;
      p.bet = null;
      p.finalAnswer = "";
    });
    cb({ ok: true });
    emitState(room);
  });
}

module.exports = { registerFirstTurnHandlers };
