function registerFinalHandlers(socket, {
  getRoomGame, emitState, getRoom, isHost, resetQuestionState, startFinalCountdown
}) {
  socket.on("nextRound", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.round !== 0) return;
    if (room.selectedTile) return cb({ ok: false, error: "Спочатку дочекайтеся відкриття вибраного питання." });
    room.round = 1;
    room.phase = "board";
    room.current = null;
    resetQuestionState(room);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("startFinalBets", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "board")
      return cb({ ok: false, error: "Ставки можна почати лише з дошки питань." });
    if (room.selectedTile) return cb({ ok: false, error: "Спочатку дочекайтеся відкриття вибраного питання." });
    room.phase = "final_bets";
    room.current = null;
    room.finalResults = null;
    room.finalRevealCount = 0;
    room.players.forEach(p => {
      p.bet = null;
      p.finalAnswer = "";
    });
    cb({ ok: true });
    emitState(room);
  });

  socket.on("submitBet", ({ code: c, bet }, cb = () => {}) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== "final_bets") return;
    const max = Math.max(0, p.score);
    let n = Math.floor(Number(bet));
    if (!Number.isFinite(n)) n = 0;
    n = Math.max(0, Math.min(max, n));
    p.bet = n;
    cb({ ok: true, bet: n });
    emitState(room);
  });

  socket.on("startFinalQuestion", ({ code: c, fillMissingBets = false }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "final_bets") return cb({ ok: false, error: "Етап ставок уже завершено." });
    const missing = room.players.filter(p => p.bet === null);
    if (missing.length && fillMissingBets !== true)
      return cb({ ok: false, error: "Не всі гравці зробили ставки.", missingBets: missing.map(p => p.name) });
    const game = getRoomGame(room);
    if (!game.final?.q || !game.final?.a) return cb({ ok: false, error: "Фінальне питання не налаштовано." });
    missing.forEach(p => { p.bet = 0; });
    room.current = { type: "final", q: game.final.q, a: game.final.a };
    room.phase = "final_ready";
    room.finalSeconds = 30;
    clearInterval(room.finalTimer);
    room.finalTimer = null;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("startFinalTimer", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "final_ready") return;
    room.phase = "final_question";
    room.finalSeconds = 30;
    startFinalCountdown(room);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("submitFinalAnswer", ({ code: c, answer }, cb = () => {}) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== "final_question") return;
    p.finalAnswer = String(answer || "")
      .trim()
      .slice(0, 240);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("finishFinalNow", ({ code: c }) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "final_question") return;
    // WORK-01: if someone hasn't pressed Send, jump to 0 and keep the 2 s window for typed answers.
    if (room.phase === "final_question" && room.players.some(p => !p.finalAnswer)) {
      room.finalSeconds = 0;
      startFinalCountdown(room);
      emitState(room);
      return;
    }
    clearInterval(room.finalTimer);
    room.finalTimer = null;
    room.phase = "final_review";
    emitState(room);
  });

  socket.on("scoreFinal", ({ code: c, results }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "final_review") return cb({ ok: false, error: "Фінал зараз не очікує оцінювання." });
    const map = new Map((results || []).map(r => [r.playerId, !!r.correct]));
    const details = room.players.map(p => {
      const correct = map.get(p.id) || false;
      const beforeScore = p.score;
      const bet = p.bet || 0;
      p.score += correct ? bet : -bet;
      return { id: p.id, name: p.name, beforeScore, bet, correct, finalAnswer: p.finalAnswer || "", score: p.score };
    });
    room.finalResults = details.sort((a, b) => b.score - a.score);
    room.finalRevealCount = 0;
    room.revealAnswer = true;
    room.phase = "final_result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("testGrandFinal", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може запускати тест." });
    if (room.phase !== "lobby") return cb({ ok: false, error: "Тест доступний лише в лобі, до початку гри." });
    if (!room.players.length) return cb({ ok: false, error: "Додайте хоча б одного тестового гравця." });
    room.isTestResult = true;
    clearInterval(room.finalTimer);
    room.finalTimer = null;
    const ordered = room.players
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        beforeScore: 4000 - i * 700,
        bet: 500,
        correct: i % 2 === 0,
        finalAnswer: i % 2 === 0 ? "Тестова правильна відповідь" : "Тестова відповідь",
        score: 4500 - i * 700,
      }))
      .sort((a, b) => b.score - a.score);
    ordered.forEach(r => {
      const p = room.players.find(x => x.id === r.id);
      if (p) {
        p.score = r.score;
        p.bet = r.bet;
        p.finalAnswer = r.finalAnswer;
      }
    });
    room.finalResults = ordered;
    room.finalRevealCount = 0;
    room.revealAnswer = true;
    room.phase = "final_result";
    room.savedSeasonGameId = null;
    room.savedSeasonId = null;
    room.seasonFinal = null;
    room.seasonCeremonyActive = false;
    room.seasonRevealCount = 0;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealNextFinalResult", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "final_result" || !Array.isArray(room.finalResults))
      return cb({ ok: false, error: "Фінальні результати ще не готові." });
    const total = room.finalResults.length;
    if ((room.finalRevealCount || 0) < total) room.finalRevealCount = (room.finalRevealCount || 0) + 1;
    cb({ ok: true, revealCount: room.finalRevealCount, total });
    emitState(room);
  });
}

module.exports = { registerFinalHandlers };
