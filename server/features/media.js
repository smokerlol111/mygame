function registerMediaHandlers(socket, { io, getRoom, isHost }) {
  socket.on("hostVideoControl", (payload = {}, cb = () => {}) => {
    const room = getRoom(payload.code);
    if (!room || !isHost(socket, room) || room.current?.questionType !== "video") return cb({ ok: false });
    const action = String(payload.action || "");
    const time = Number(payload.time);
    if (!["play", "pause", "seek"].includes(action) || !Number.isFinite(time) || time < 0) return cb({ ok: false });
    room.current.videoTime = time;
    room.current.videoPlaying = action === "play" ? true : action === "pause" ? false : !!room.current.videoPlaying;
    room.current.videoUpdatedAt = Date.now();
    socket.to(room.code).emit("videoControl", {
      code: room.code,
      action,
      time,
      media: room.current.media,
      stopAt: Number(room.current.pauseAt || 0),
      continued: !!room.current.videoContinued,
      sentAt: room.current.videoUpdatedAt,
    });
    cb({ ok: true });
  });

  socket.on("hostAudioControl", (payload = {}, cb = () => {}) => {
    const room = getRoom(payload.code);
    if (!room || !isHost(socket, room) || !["audio", "audioReveal"].includes(room.current?.questionType))
      return cb({ ok: false });
    const action = String(payload.action || "");
    const time = Number(payload.time);
    if (!["play", "pause", "seek"].includes(action) || !Number.isFinite(time) || time < 0) return cb({ ok: false });
    room.current.audioTime = time;
    room.current.audioPlaying = action === "play" ? true : action === "pause" ? false : !!room.current.audioPlaying;
    room.current.audioUpdatedAt = Date.now();
    socket.to(room.code).emit("audioControl", {
      code: room.code,
      action,
      time,
      media: room.current.media,
      stage: Number(room.current.revealStage || 0),
      sentAt: room.current.audioUpdatedAt,
    });
    cb({ ok: true });
  });

  socket.on("playCue", ({ code: c, type } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    if (type === "murloc_answer") {
      if (
        room.phase !== "result"
        || room.current?.sponsorDouble !== true
        || room.current?.answerAudio !== "/media/murloc.mp3"
      )
        return cb({ ok: false, error: "Звук доступний лише після відповіді на запитання про мурлока." });
    } else if (type === "question_answer_audio") {
      if (
        room.phase !== "result"
        || room.revealAnswer !== true
        || !/^\/media\/[a-zA-Z0-9._-]+\.mp3$/.test(room.current?.answerAudioFile || "")
      )
        return cb({ ok: false, error: "Звук відповіді недоступний." });
    } else if (!["gong", "results_theme", "winner_theme", "final_music_stop"].includes(type))
      return cb({ ok: false, error: "Невідомий звук." });
    const cue = { type, at: Date.now() };
    if (type === "question_answer_audio") cue.media = room.current.answerAudioFile;
    if (
      type === "gong"
      && room.current?.type === "duel"
      && Array.isArray(room.duelPlayers)
      && room.duelPlayers.length
    ) {
      cue.playerIds = [...room.duelPlayers];
    }
    io.to(room.code).emit("cue", cue);
    cb({ ok: true });
  });
}

module.exports = { registerMediaHandlers };
