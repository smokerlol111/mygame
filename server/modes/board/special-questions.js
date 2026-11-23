function registerSpecialQuestionHandlers(socket, {
  io, rooms, emitState, getRoom, isHost, resetQuestionState, advanceTurn
}) {
  socket.on("submitVaBankBet", ({ code: c, bet }, cb = () => {}) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== "va_bank_bet" || p.id !== room.vaBankPlayer)
      return cb({ ok: false, error: "Ставку зараз зробити не можна." });
    const max = Math.max(0, p.score);
    const n = Math.floor(Number(bet));
    if (!Number.isFinite(n) || n < 0 || n > max) return cb({ ok: false, error: `Ставка має бути від 0 до ${max}.` });
    room.vaBankBet = n;
    room.phase = "va_bank_question";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("judgeVaBank", ({ code: c, correct }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "va_bank_question" || !room.vaBankPlayer) return;
    const p = room.players.find(x => x.id === room.vaBankPlayer);
    if (!p) return;
    p.score += correct ? room.vaBankBet : -room.vaBankBet;
    if (!correct) room.answeringLocked.add(p.id);
    room.revealAnswer = true;
    room.resultReason = correct ? "correct" : "va_bank_wrong";
    room.phase = "result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("selectDuelOpponent", ({ code: c, playerId }, cb = () => {}) => {
    const room = getRoom(c);
    const chooser = room?.players.find(x => x.id === socket.data.playerId);
    const host = isHost(socket, room);
    if (!room || room.phase !== "duel_choose") return cb({ ok: false, error: "Дуель зараз недоступна." });
    if (!host && (!chooser || chooser.id !== room.turnPlayerId))
      return cb({ ok: false, error: "Суперника обирає гравець, чия черга." });
    if (playerId === room.turnPlayerId) return cb({ ok: false, error: "Не можна обрати себе." });
    if (!room.players.some(p => p.id === playerId)) return cb({ ok: false, error: "Гравця не знайдено." });
    room.duelPlayers = [room.turnPlayerId, playerId];
    room.phase = "duel_question";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("openDuelBuzz", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "duel_question") return;
    const leadMs = 1200;
    room.phase = "buzz";
    room.buzzer = null;
    room.answeringLocked = new Set();
    room.buzzReactions = {};
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
        io.to(room.code).emit("cue", { type: "buzz_open", at: room.buzzOpensAt });
    }, leadMs);
    cb({ ok: true, opensAt: room.buzzOpensAt });
    emitState(room);
  });

  socket.on("judgeTriplet", ({ code: c, correct }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "triplet_question" || room.current?.questionType !== "triplet")
      return cb({ ok: false, error: "ТРИПЛЕТ зараз неактивний." });
    const t = room.current.triplet,
      p = room.players.find(x => x.id === t?.answererId);
    if (!t || !p) return cb({ ok: false, error: "Гравця ТРИПЛЕТА не знайдено." });
    const value = Number(room.current.value) || 0;
    p.score += correct ? value : -value;
    // UI-06: capture completed stages for the OBS progress display only.
    t.results.push({ correct: !!correct, value });
    room.revealAnswer = true;
    room.resultReason = correct ? "triplet_correct" : "triplet_wrong";
    room.phase = "triplet_result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("nextTriplet", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "triplet_result" || room.current?.questionType !== "triplet")
      return cb({ ok: false, error: "Немає завершеного етапу ТРИПЛЕТА." });
    const t = room.current.triplet;
    if (t.index < t.total - 1) {
      t.index += 1;
      const item = t.items[t.index];
      room.current.value = Number(item.value) || 0;
      room.current.q = item.q;
      room.current.a = item.a;
      room.revealAnswer = false;
      room.resultReason = null;
      room.buzzer = null;
      room.answeringLocked = new Set();
      room.phase = "triplet_question";
    } else {
      const key = `${room.round}:${room.current.ci}:${room.current.qi}`;
      room.used[key] = true;
      advanceTurn(room);
      room.current = null;
      resetQuestionState(room);
      room.phase = "board";
    }
    cb({ ok: true });
    emitState(room);
  });

  socket.on("selectCatReceiver", ({ code: c, playerId }, cb = () => {}) => {
    const room = getRoom(c);
    const chooser = room?.players.find(x => x.id === socket.data.playerId);
    const host = isHost(socket, room);
    if (!room || room.phase !== "cat_choose" || !room.current || (!host && chooser?.id !== room.catChooser)) return;
    const p = room.players.find(x => x.id === playerId);
    if (!p) return cb({ ok: false, error: "Гравця не знайдено." });
    if (p.id === room.catChooser && room.players.length > 1)
      return cb({ ok: false, error: "Кота в мішку треба передати іншому гравцеві." });
    room.catReceiver = p.id;
    room.phase = "cat_question";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("judgeCat", ({ code: c, correct }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "cat_question" || !room.catReceiver) return;
    const p = room.players.find(x => x.id === room.catReceiver);
    if (!p) return;
    p.score += correct ? room.current.value : -room.current.value;
    if (!correct) room.answeringLocked.add(p.id);
    room.revealAnswer = true;
    room.phase = "result";
    cb({ ok: true });
    emitState(room);
  });
}

module.exports = { registerSpecialQuestionHandlers };
