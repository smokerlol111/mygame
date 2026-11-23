function registerNumericHandlers(socket, { emitState, getRoom, isHost, advanceTurn, startNumericCountdown }) {
  socket.on("startNumericTimer", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "numeric_ready" || !room.numericChallenge)
      return cb({ ok: false, error: "Числове питання не готове." });
    room.numericAnswers = {};
    room.numericSubmittedAt = {};
    room.phase = "numeric_question";
    startNumericCountdown(room, 30000);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("submitNumericAnswer", ({ code: c, answer }, cb = () => {}) => {
    const room = getRoom(c),
      p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== "numeric_question" || !room.numericChallenge)
      return cb({ ok: false, error: "Числове питання зараз неактивне." });
    if (!room.numericEndsAt || Date.now() > room.numericEndsAt) return cb({ ok: false, error: "Час вийшов." });
    if (Object.prototype.hasOwnProperty.call(room.numericAnswers, p.id))
      return cb({ ok: false, error: "Відповідь уже зафіксована." });
    const numericText = String(answer ?? "").trim();
    const n = /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(numericText) ? Number(numericText.replace(",", ".")) : NaN;
    if (!Number.isFinite(n)) return cb({ ok: false, error: "Введіть коректне число без літер." });
    room.numericAnswers[p.id] = n;
    room.numericSubmittedAt[p.id] = Date.now();
    cb({ ok: true });
    emitState(room);
  });

  socket.on("finishNumericQuestion", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "numeric_question" || !room.numericChallenge) return cb({ ok: false });
    const all = room.players.every(p => Object.prototype.hasOwnProperty.call(room.numericAnswers, p.id));
    if (!all && room.numericEndsAt && Date.now() < room.numericEndsAt)
      return cb({ ok: false, error: "Ще є час і не всі відповіли." });
    clearTimeout(room.numericTimer);
    room.numericTimer = null;
    room.numericEndsAt = null;
    const correct = room.numericChallenge.answer;
    const answered = room.players
      .filter(p => Object.prototype.hasOwnProperty.call(room.numericAnswers, p.id))
      .map(p => ({
        id: p.id,
        name: p.name,
        answer: room.numericAnswers[p.id],
        diff: Math.abs(room.numericAnswers[p.id] - correct),
        at: room.numericSubmittedAt[p.id],
      }))
      .sort((a, b) => a.diff - b.diff || a.at - b.at);
    const missing = room.players
      .filter(p => !Object.prototype.hasOwnProperty.call(room.numericAnswers, p.id))
      .map(p => ({ id: p.id, name: p.name, noAnswer: true, diff: null }));
    room.numericResults = [...answered, ...missing];
    if (answered[0]) {
      const w = room.players.find(p => p.id === answered[0].id);
      if (w) w.score += room.numericChallenge.value;
    }
    room.revealAnswer = true;
    room.phase = "numeric_result";
    room.numericRevealCount = 0;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealNextNumeric", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "numeric_result") return cb({ ok: false });
    const total = room.numericResults?.length || 0;
    if (room.numericRevealCount < total) room.numericRevealCount++;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("finishNumericResult", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "numeric_result") return cb({ ok: false });
    if ((room.numericRevealCount || 0) < (room.numericResults?.length || 0))
      return cb({ ok: false, error: "Спочатку відкрийте всі місця." });
    const key = `${room.round}:${room.current.ci}:${room.current.qi}`;
    room.used[key] = true;
    advanceTurn(room);
    room.phase = "board";
    room.current = null;
    room.numericChallenge = null;
    room.numericAnswers = {};
    room.numericResults = null;
    cb({ ok: true });
    emitState(room);
  });
}

module.exports = { registerNumericHandlers };
