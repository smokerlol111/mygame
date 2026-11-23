function registerBoardMediaHandlers(socket, { emitState, getRoom, isHost }) {
  socket.on("finishVideoResult", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room?.phase !== "video_result")
      return cb({ ok: false, error: "Немає продовження відео" });
    room.phase = "result";
    cb({ ok: true });
    emitState(room);
  });

  socket.on("continueVideo", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room?.phase !== "video_result" || room.current?.questionType !== "video")
      return cb({ ok: false, error: "Відео недоступне" });
    room.current.videoContinued = true;
    room.current.videoPlaying = false;
    room.current.videoUpdatedAt = Date.now();
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealAudioStep", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (
      !isHost(socket, room)
      || !["question", "buzz"].includes(room?.phase)
      || room.current?.questionType !== "audioReveal"
    )
      return cb({ ok: false, error: "Аудіо можна відкривати лише до BUZZ." });
    if (room.current.revealStage >= room.current.revealValues.length - 1)
      return cb({ ok: false, error: "Усі фрагменти відкриті." });
    room.current.revealStage++;
    room.current.value = room.current.revealValues[room.current.revealStage];
    room.current.audioTime = 0;
    room.current.audioPlaying = false;
    room.current.audioUpdatedAt = Date.now();
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealImageStep", ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current || room.current.questionType !== "imageReveal")
      return cb({ ok: false, error: "Це не питання із зображенням." });
    if (!["question", "buzz"].includes(room.phase) || room.buzzer)
      return cb({ ok: false, error: "Зображення можна відкривати лише до відповіді гравця." });
    const values = room.current.revealValues || [room.current.value];
    if (room.current.revealStage >= values.length - 1)
      return cb({ ok: false, error: "Зображення вже повністю відкрите." });
    room.current.revealStage += 1;
    room.current.value = values[room.current.revealStage];
    cb({ ok: true, value: room.current.value, stage: room.current.revealStage });
    emitState(room);
  });
}

module.exports = { registerBoardMediaHandlers };
