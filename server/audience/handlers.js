const crypto = require("crypto");

function registerAudienceHandlers(socket, {
  io, getRoomGame, publicState, emitState, getRoom, isHost, startAudienceCountdown
}) {
  socket.on("getAudienceState", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: "Кімнату не знайдено." });
    socket.data.roomCode = room.code;
    socket.join(room.code);
    socket.emit("state", publicState(room));
    cb({ ok: true, code: room.code });
  });

  socket.on("joinAudience", ({ code: c, name, audienceKey } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: "Кімнату не знайдено." });
    // Rejoin only with the secret key: audience ids are public (ranking, submittedPlayerIds).
    let a = audienceKey ? room.audience.find(x => x.key === audienceKey) : null;
    if (!a) {
      if (room.phase !== "audience_lobby") return cb({ ok: false, error: "Зараз реєстрація глядачів закрита." });
      const clean = String(name || "")
        .trim()
        .slice(0, 24);
      if (!clean) return cb({ ok: false, error: "Введіть нік." });
      a = {
        id: crypto.randomUUID(),
        key: crypto.randomBytes(16).toString("hex"),
        name: clean,
        socketId: socket.id,
        connected: true,
        roundStats: {},
      };
      room.audience.push(a);
    } else {
      a.socketId = socket.id;
      a.connected = true;
      if (name) a.name = String(name).trim().slice(0, 24) || a.name;
    }
    socket.data.audienceId = a.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    const ownWin = [...(room.audienceWinners || [])].reverse().find(x => x.id === a.id) || null;
    cb({
      ok: true,
      audienceId: a.id,
      audienceKey: a.key,
      name: a.name,
      code: room.code,
      joined: room.audience.filter(x => x.connected).length,
      prizeCode: ownWin?.code || "",
    });
    io.to(room.code).emit("audienceProgress", {
      code: room.code,
      joined: room.audience.filter(x => x.connected).length,
      submitted: Object.keys(room.audienceAnswers || {}).length,
      roundIndex: room.audienceRoundIndex,
      questionIndex: room.audienceQuestionIndex,
      remainingMs: room.audienceEndsAt ? Math.max(0, room.audienceEndsAt - Date.now()) : 0,
    });
  });

  socket.on("openAudienceRound", ({ code: c, roundIndex } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false });
    const rounds = getRoomGame(room).audienceRounds || [];
    const ri = Number(roundIndex);
    if (!rounds[ri]) return cb({ ok: false, error: "Глядацький раунд не налаштований." });
    room.audienceRoundIndex = ri;
    room.audienceQuestionIndex = 0;
    room.audienceAnswers = {};
    room.audienceRanking = [];
    room.audienceRevealCount = 0;
    room.audienceReturnPhase = "board";
    room.audienceEndsAt = null;
    room.audience.forEach(a => {
      a.roundStats[ri] = { correct: 0, timeMs: 0, answered: 0 };
    });
    room.phase = "audience_lobby";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("startAudienceQuestion", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !["audience_lobby", "audience_result"].includes(room.phase))
      return cb({ ok: false, error: "Питання зараз не готове." });
    if (room.phase === "audience_lobby" && room.audience.filter(x => x.connected).length < 1)
      return cb({ ok: false, error: "Спочатку має приєднатися хоча б один глядач." });
    const ar = (getRoomGame(room).audienceRounds || [])[room.audienceRoundIndex];
    if (!ar) return cb({ ok: false });
    if (room.phase === "audience_result" && room.audienceQuestionIndex < ar.questions.length - 1)
      room.audienceQuestionIndex++;
    const audienceDurationMs = getRoomGame(room).audienceQuestionSeconds === 30 ? 30000 : 15000;
    room.audienceAnswers = {};
    room.audienceStartedAt = Date.now();
    room.phase = "audience_question";
    startAudienceCountdown(room, audienceDurationMs);
    cb({ ok: true });
    emitState(room);
  });

  socket.on("submitAudienceAnswer", ({ code: c, option } = {}, cb = () => {}) => {
    const room = getRoom(c);
    const a = room?.audience.find(x => x.id === socket.data.audienceId);
    if (!room || !a || room.phase !== "audience_question") return cb({ ok: false, error: "Питання неактивне." });
    if (!room.audienceEndsAt || Date.now() > room.audienceEndsAt) return cb({ ok: false, error: "Час вийшов." });
    if (room.audienceAnswers[a.id]) return cb({ ok: false, error: "Відповідь уже зафіксована." });
    const ar = (getRoomGame(room).audienceRounds || [])[room.audienceRoundIndex],
      q = ar?.questions?.[room.audienceQuestionIndex];
    const o = Number(option);
    if (!q || !Number.isInteger(o) || o < 0 || o >= q.options.length) return cb({ ok: false });
    const ms = Math.max(0, Date.now() - room.audienceStartedAt);
    room.audienceAnswers[a.id] = { option: o, ms };
    const st =
      a.roundStats[room.audienceRoundIndex]
      || (a.roundStats[room.audienceRoundIndex] = { correct: 0, timeMs: 0, answered: 0 });
    st.answered++;
    if (o === q.correct) {
      st.correct++;
      st.timeMs += ms;
    }
    cb({ ok: true, remainingMs: room.audienceEndsAt ? Math.max(0, room.audienceEndsAt - Date.now()) : 0 });
    io.to(room.code).emit("audienceProgress", {
      code: room.code,
      joined: room.audience.filter(x => x.connected).length,
      submitted: Object.keys(room.audienceAnswers || {}).length,
      roundIndex: room.audienceRoundIndex,
      questionIndex: room.audienceQuestionIndex,
      remainingMs: room.audienceEndsAt ? Math.max(0, room.audienceEndsAt - Date.now()) : 0,
    });
  });

  socket.on("finishAudienceQuestion", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "audience_question") return cb({ ok: false });
    clearTimeout(room.audienceTimer);
    room.audienceTimer = null;
    room.audienceEndsAt = null;
    room.phase = "audience_result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("finishAudienceRound", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "audience_result") return cb({ ok: false });
    const ar = (getRoomGame(room).audienceRounds || [])[room.audienceRoundIndex];
    if (room.audienceQuestionIndex !== ar.questions.length - 1) return cb({ ok: false, error: "Ще є питання." });
    const prev = new Set(room.audienceWinners.map(x => x.id));
    const ranked = room.audience
      .map(a => {
        const st = a.roundStats[room.audienceRoundIndex] || { correct: 0, timeMs: 0 };
        return {
          id: a.id,
          name: a.name,
          correct: st.correct,
          timeMs: st.timeMs,
          eligible: !prev.has(a.id) && st.answered > 0,
        };
      })
      .filter(x => x.eligible)
      .sort((a, b) => b.correct - a.correct || a.timeMs - b.timeMs || a.name.localeCompare(b.name, "uk"));
    const win = ranked.find(x => x.correct > 0) || null;
    if (win) {
      win.code = crypto.randomBytes(3).toString("hex").toUpperCase();
      room.audienceWinners.push({ id: win.id, name: win.name, code: win.code, roundIndex: room.audienceRoundIndex });
    }
    room.audienceRanking = ranked;
    room.audienceRevealCount = 0;
    room.phase = "audience_podium";
    if (win) {
      const wa = room.audience.find(x => x.id === win.id);
      if (wa?.socketId)
        io.to(wa.socketId).emit("audiencePrize", { code: win.code, roundIndex: room.audienceRoundIndex });
    }
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealNextAudience", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "audience_podium") return cb({ ok: false });
    const n = Math.min(5, room.audienceRanking?.length || 0);
    if (room.audienceRevealCount < n) room.audienceRevealCount++;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("closeAudienceRound", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "audience_podium") return cb({ ok: false });
    room.phase = "board";
    room.audienceRoundIndex = null;
    room.audienceQuestionIndex = 0;
    room.audienceAnswers = {};
    room.audienceEndsAt = null;
    cb({ ok: true });
    emitState(room);
  });
}

module.exports = { registerAudienceHandlers };
