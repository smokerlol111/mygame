function registerBuzzHandlers(socket, {
  io, rooms, emitState, getRoom, isHost, resetEligibleBuzzReactions, finishTile
}) {
  socket.on("openBuzz", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current) return;
    const unready = room.players.filter(
      p => p.connected && (Number(p.syncSamples || 0) < 3 || Date.now() - Number(p.lastSyncAt || 0) >= 12000),
    );
    if (unready.length) return cb({ ok: false, error: "Очікуємо SYNC: " + unready.map(p => p.name).join(", ") });
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
      if (
        rooms.get(room.code) === room
        && room.phase === "buzz"
        && !room.buzzer
        && room.buzzOpensAt
        && Date.now() >= room.buzzOpensAt - 20
      )
        io.to(room.code).emit("cue", { type: "buzz_open", at: room.buzzOpensAt });
    }, leadMs);
    cb({ ok: true, opensAt: room.buzzOpensAt });
    emitState(room);
  });

  // v3.0.3 Fair Press Engine: compare validated synchronized press timestamps,
  // not just packet arrival order. A short collection window lets near-simultaneous
  // presses arrive before the server chooses a winner.

  socket.on("buzz", ({ code: c, pressedAtServerTime }, cb = () => {}) => {
    const receivedAt = Date.now();
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || !room.current) return cb({ ok: false, error: "Питання зараз неактивне." });
    const duel = room.current?.type === "duel";
    if (duel && !room.duelPlayers.includes(p.id)) return cb({ ok: false, error: "Ви не берете участі в цій дуелі." });

    const claimed = Number(pressedAtServerTime);
    const beforeScheduledOpen = room.phase === "buzz" && Number(room.buzzOpensAt || 0) > receivedAt;
    const claimedBeforeOpen =
      Number.isFinite(claimed) && Number(room.buzzOpensAt || 0) > 0 && claimed < Number(room.buzzOpensAt) - 35;
    if (room.phase === "question" || room.phase === "duel_question" || beforeScheduledOpen || claimedBeforeOpen) {
      if (Number(p.falseStartUntil || 0) <= receivedAt) p.falseStartUntil = receivedAt + 3000;
      emitState(room);
      return cb({ ok: false, falseStart: true, until: p.falseStartUntil });
    }
    if (room.phase !== "buzz" || room.buzzer || room.answeringLocked.has(p.id)) return cb({ ok: false });
    if (Number(p.falseStartUntil || 0) > receivedAt)
      return cb({ ok: false, falseStart: true, until: p.falseStartUntil });

    // Anti-spoof sanity check: a real press cannot be in the future, and it should
    // not predate packet receipt by much more than the player's observed RTT.
    const observedRtt = Number.isFinite(p.networkRttMs) ? Math.max(0, p.networkRttMs) : 300;
    const maxAge = Math.min(1200, Math.max(180, observedRtt * 1.5 + 80));
    let pressTime = claimed;
    if (!Number.isFinite(pressTime) || pressTime > receivedAt + 40 || pressTime < receivedAt - maxAge) {
      // Safe fallback for an old/stale client: estimate one-way transit as RTT/2.
      pressTime = receivedAt - Math.min(300, observedRtt / 2);
    }
    pressTime = Math.max(Number(room.buzzOpensAt || 0), pressTime);

    room.buzzCandidates = room.buzzCandidates || [];
    if (!room.buzzCandidates.some(x => x.playerId === p.id)) {
      room.buzzCandidates.push({
        playerId: p.id,
        pressTime,
        receivedAt,
        reactionMs: Math.round(Math.max(0, pressTime - Number(room.buzzOpensAt || 0))),
      });
    }
    cb({ ok: true, pending: true });

    if (!room.buzzResolveTimer) {
      const FAIR_WINDOW_MS = 90;
      room.buzzResolveTimer = setTimeout(() => {
        room.buzzResolveTimer = null;
        if (rooms.get(room.code) !== room || room.phase !== "buzz" || room.buzzer) return;
        const candidates = (room.buzzCandidates || []).filter(x => {
          const player = room.players.find(p => p.id === x.playerId);
          return player && !room.answeringLocked.has(player.id) && Number(player.falseStartUntil || 0) <= Date.now();
        });
        room.buzzCandidates = [];
        if (!candidates.length) return;
        room.buzzReactions = room.buzzReactions || {};
        for (const candidate of candidates) room.buzzReactions[candidate.playerId] = candidate.reactionMs;
        candidates.sort((a, b) => a.pressTime - b.pressTime || a.receivedAt - b.receivedAt);
        const winner = candidates[0];
        room.buzzer = winner.playerId;
        room.buzzOpensAt = null;
        room.phase = "answering";
        emitState(room);
      }, FAIR_WINDOW_MS);
    }
  });

  socket.on("judge", ({ code: c, correct, sponsorBonus }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "answering" || !room.current || !room.buzzer) return;
    const p = room.players.find(x => x.id === room.buzzer);
    if (!p) return;
    const value = room.current.value;
    const awarded = correct && room.current.sponsorDouble === true && sponsorBonus === true ? value * 2 : value;
    p.score += correct ? awarded : -value;
    // Duel is zero-sum on a correct answer: winner gains the question value,
    // loser loses the same value. If the opponent already answered wrong,
    // their normal wrong-answer penalty has already been applied, so do not deduct twice.
    if (correct && room.current?.type === "duel") {
      const loser = room.players.find(x => room.duelPlayers.includes(x.id) && x.id !== p.id);
      if (loser && !room.answeringLocked.has(loser.id)) loser.score -= value;
    }
    if (correct) {
      room.revealAnswer = true;
      room.resultReason = "correct";
      if (room.current.questionType === "video") {
        room.current.videoContinued = true;
        room.current.videoPlaying = false;
        room.current.videoUpdatedAt = Date.now();
      }
      room.phase = "result";
    } else {
      room.answeringLocked.add(p.id);
      resetEligibleBuzzReactions(room);
      room.buzzer = null;
      // Important: do not auto-finish just because another player is temporarily disconnected.
      // Auto-reveal only when EVERY player in the room has already answered incorrectly.
      const eligiblePlayers =
        room.current?.type === "duel" ? room.players.filter(x => room.duelPlayers.includes(x.id)) : room.players;
      const everyoneWrong = eligiblePlayers.length > 0 && eligiblePlayers.every(x => room.answeringLocked.has(x.id));
      if (everyoneWrong) {
        room.revealAnswer = true;
        room.resultReason = "all_wrong";
        if (room.current.questionType === "video") {
          room.current.videoContinued = true;
          room.current.videoPlaying = false;
          room.current.videoUpdatedAt = Date.now();
        }
        room.phase = "result";
      } else {
        room.phase = "buzz";
        room.buzzCandidates = [];
        if (room.buzzResolveTimer) {
          clearTimeout(room.buzzResolveTimer);
          room.buzzResolveTimer = null;
        }
        room.buzzOpensAt = Date.now() + 800;
        io.to(room.code).emit("buzzScheduled", { opensAt: room.buzzOpensAt });
        const opensAt = room.buzzOpensAt; // RULE-04: play the same "buzz open" sound as the first opening
        setTimeout(() => {
          if (rooms.get(room.code) === room && room.phase === "buzz" && !room.buzzer && room.buzzOpensAt === opensAt)
            io.to(room.code).emit("cue", { type: "buzz_open", at: opensAt });
        }, 800);
      }
    }
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealAnswer", ({ code: c }) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current) return;
    room.buzzer = null;
    room.revealAnswer = true;
    room.resultReason = "no_answer";
    if (room.current.questionType === "video") {
      room.current.videoContinued = true;
      room.current.videoPlaying = false;
      room.current.videoUpdatedAt = Date.now();
    }
    room.phase = "result";
    emitState(room);
  });

  socket.on("nextFromResult", ({ code: c }) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== "result") return;
    finishTile(room);
    emitState(room);
  });
}

module.exports = { registerBuzzHandlers };
