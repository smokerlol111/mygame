const fs = require("fs");
const path = require("path");

function registerChooseTileHandler(socket, {
  rooms, getRoomGame, emitState, getRoom, isHost, resetQuestionState, rootDir
}) {
  socket.on("chooseTile", ({ code: c, ci, qi }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.phase !== "board") return cb({ ok: false, error: "Зараз не можна обирати питання." });
    if (room.selectedTile) return cb({ ok: false, error: "Зачекайте: вибране питання відкривається." });
    const pid = socket.data.playerId;
    const host = isHost(socket, room);
    if (!host && pid !== room.turnPlayerId) return cb({ ok: false, error: "Зараз питання обирає інший гравець." });
    ci = Number(ci);
    qi = Number(qi);
    const game = getRoomGame(room);
    const q = game.rounds[room.round]?.categories[ci]?.questions[qi];
    if (!q) return cb({ ok: false, error: "Невірна клітинка." });
    const key = `${room.round}:${ci}:${qi}`;
    if (room.used[key]) return cb({ ok: false, error: "Цю клітинку вже зіграно." });
    // Show the chosen cell for one second before starting question/media/BUZZ logic.
    const selection = { round: room.round, ci, qi };
    room.selectedTile = selection;
    emitState(room);
    setTimeout(function openSelectedTile() {
      if (rooms.get(room.code) !== room || room.selectedTile !== selection) return;
      if (room.paused) {
        setTimeout(openSelectedTile, 100);
        return;
      }
      room.selectedTile = null;
      if (room.phase !== "board" || room.round !== selection.round) {
        cb({ ok: false, error: "Вибір питання скасовано." });
        emitState(room);
        return;
      }
      resetQuestionState(room);
      room.players.forEach(p => (p.falseStartUntil = 0));
      // Question-defined formats (emoji, Triplet, numeric/media) must never be replaced
      // by a randomly assigned special cell. Otherwise their payload/mechanic disappears.
      const formatLocked =
        ["emoji", "triplet", "numericClosest", "audio", "audioReveal", "video", "imageReveal"].includes(q.type)
        && !(q.type === "emoji" && (["cat", "va_bank"].includes(room.specialCells[key])
          || (game.specialSetup?.allowEmojiSpecials === true && room.specialCells[key] === "duel")));
      const special =
        room.gameId === "media-test" || formatLocked
          ? "normal"
          : q.cat && room.round === 1
            ? "cat"
            : room.specialCells[key] || "normal";
      // Check that test assets actually exist before marking a cell as used.
      if (room.gameId === "media-test" && String(q.media || "").startsWith("/media/")) {
        const mediaPath = path.resolve(rootDir, "public", String(q.media).replace(/^\//, ""));
        if (!mediaPath.startsWith(path.join(rootDir, "public", "media") + path.sep) || !fs.existsSync(mediaPath))
          return cb({ ok: false, error: "Медіафайл не встановлено на сервері: " + q.media });
      }
      room.current = { type: special, ci, qi, value: q.value, q: q.cat ? q.cat.q : q.q, a: q.cat ? q.cat.a : q.a };
      if (special === "normal" && q.sponsorDouble === true && q.value === 600) {
        room.current.sponsorDouble = true;
        room.current.answerAudio = q.answerAudio;
      }
      if (special === "normal" && typeof q.answerImage === "string" && /^\/media\/[a-zA-Z0-9._-]+$/.test(q.answerImage))
        room.current.answerImage = q.answerImage;
      if (special === "normal" && typeof q.answerVideo === "string" && /^\/media\/[a-zA-Z0-9._-]+$/.test(q.answerVideo))
        room.current.answerVideo = q.answerVideo;
      // Optional answer sound is disclosed only after the answer is shown.
      if (special === "normal" && typeof q.answerAudioFile === "string" && /^\/media\/[a-zA-Z0-9._-]+\.mp3$/.test(q.answerAudioFile))
        room.current.answerAudioFile = q.answerAudioFile;
      // Audio questions can also display a simultaneous non-spoiler visual clue.
      if (special === "normal" && q.type === "audio" && typeof q.image === "string" && /^\/media\/[a-zA-Z0-9._-]+\.(jpg|png|webp)$/.test(q.image))
        room.current.image = q.image;
      // Media questions: direct HTTPS links or same-origin files under /media/.
      if (special === "normal" && ["audio", "audioReveal", "video"].includes(q.type)) {
        const source = String(q.media || q.audio || q.video || "");
        const valid = source.startsWith("/media/") || /^https:\/\/[^\s]+$/i.test(source);
        if (!valid) return cb({ ok: false, error: "Для медіапитання потрібне HTTPS-посилання або файл /media/…" });
        room.current.questionType = q.type;
        room.current.media = source;
        if (q.type === "video") {
          room.current.videoTime = 0;
          room.current.videoPlaying = false;
          room.current.videoUpdatedAt = Date.now();
          if (Number(q.pauseAt ?? q.stopAt) > 0) {
            room.current.pauseAt = Number(q.pauseAt ?? q.stopAt);
            room.current.videoContinued = false;
          }
        }
        if (q.type === "audio" || q.type === "audioReveal") {
          room.current.audioTime = 0;
          room.current.audioPlaying = false;
          room.current.audioUpdatedAt = Date.now();
        }
        if (q.type === "audioReveal") {
          const values =
            Array.isArray(q.revealValues) && q.revealValues.length
              ? q.revealValues
              : [
                  q.value,
                  Math.round(q.value * 0.8),
                  Math.round(q.value * 0.6),
                  Math.round(q.value * 0.4),
                  Math.round(q.value * 0.2),
                ];
          room.current.revealValues = values.map(v => Number(v));
          room.current.revealSeconds =
            Array.isArray(q.revealSeconds) && q.revealSeconds.length === values.length
              ? q.revealSeconds.map(v => (String(v).toLowerCase() === "full" ? "full" : Math.max(1, Number(v) || 1)))
              : [2, 5, 10, 17, 25].slice(0, values.length);
          room.current.revealStage = 0;
          room.current.value = room.current.revealValues[0];
        }
      }
      if (q.type === "emoji" && ["normal", "cat", "va_bank", "duel"].includes(special)) {
        room.current.questionType = "emoji";
        room.current.emoji = String(q.emoji || "").trim();
        if (!room.current.emoji) return cb({ ok: false, error: "Для emoji-питання потрібне поле emoji." });
      }
      if (q.type === "imageReveal" && special === "normal") {
        room.current.questionType = "imageReveal";
        room.current.image = q.image;
        room.current.revealValues = Array.isArray(q.revealValues) && q.revealValues.length ? q.revealValues : [q.value];
        room.current.revealStage = 0;
        room.current.value = room.current.revealValues[0];
      }

      if (special === "cat") {
        room.phase = "cat_choose";
        room.catChooser = room.turnPlayerId;
      } else if (special === "va_bank") {
        room.phase = "va_bank_bet";
        room.vaBankPlayer = room.turnPlayerId;
      } else if (special === "duel") {
        room.phase = "duel_choose";
        room.duelPlayers = room.turnPlayerId ? [room.turnPlayerId] : [];
      } else if (q.type === "triplet" && special === "normal") {
        const items = Array.isArray(q.triplet) ? q.triplet : [];
        if (items.length < 3) return cb({ ok: false, error: "ТРИПЛЕТ має містити щонайменше 3 питання." });
        const first = items[0];
        room.current.questionType = "triplet";
        room.current.triplet = {
          index: 0,
          total: items.length,
          baseValue: q.value,
          items: items.map(x => ({ value: Number(x.value), q: String(x.q || ""), a: String(x.a || "") })),
          answererId: room.turnPlayerId,
          results: [],
        };
        room.current.value = Number(first.value);
        room.current.q = String(first.q || "");
        room.current.a = String(first.a || "");
        room.phase = "triplet_question";
      } else if (q.type === "numericClosest" && special === "normal") {
        room.numericChallenge = {
          question: q.q,
          answer: Number(q.numericAnswer),
          unit: q.unit || "",
          value: q.value,
          seconds: Number(q.seconds || 30),
          answerImage: typeof q.answerImage === "string" && /^\/media\/[a-zA-Z0-9._-]+$/.test(q.answerImage) ? q.answerImage : "",
        };
        room.numericAnswers = {};
        room.numericSubmittedAt = {};
        room.numericResults = null;
        room.numericRevealCount = 0;
        room.numericEndsAt = null;
        room.phase = "numeric_ready";
        clearTimeout(room.numericTimer);
        room.numericTimer = null;
      } else if (
        room.current.questionType
        && ["audio", "audioReveal", "video"].includes(room.current.questionType)
      ) {
        // Audio and video preserve automatic BUZZ; photo + text questions stay in the question phase
        // with their image already visible, until the HOST manually opens BUZZ.
        room.phase = "buzz";
        room.buzzer = null;
        room.buzzOpensAt = Date.now();
        room.answeringLocked = new Set();
        room.buzzCandidates = [];
      } else {
        room.phase = "question";
      }
      cb({ ok: true });
      emitState(room);
    }, 1000);
  });
}

module.exports = { registerChooseTileHandler };
