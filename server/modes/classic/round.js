const crypto = require('node:crypto');
const { checkpoints, finalGroups } = require('./standings');

function createRoundEngine({ rooms, publish, clock = globalThis }) {
  const now = () => clock.Date.now();
  const stop = room => { clock.clearTimeout(room.classic.timer); room.classic.timer = null; };
  function close(room) {
    stop(room);
    for (const team of room.players) {
      const draft = room.classic.drafts[team.id];
      if (!room.classic.answers[team.id] && draft?.text.trim()) {
        room.classic.answers[team.id] = { text: draft.text.trim(), correct: null,
          receivedAt: draft.receivedAt, autoSubmitted: true };
      }
    }
    const media = room.classic.media;
    if (media?.playing) media.time += (now() - media.updatedAt) / 1000;
    if (media) { media.playing = false; media.updatedAt = now(); media.revision++; }
    room.classic.endsAt = null;
    room.classic.remainingMs = 0;
    room.phase = 'classic_review';
    publish(room);
  }
  function expire(room) {
    if (room.phase === 'classic_question' && now() >= room.classic.endsAt) { close(room); return true; }
    return false;
  }
  function arm(room, duration) {
    stop(room);
    room.classic.endsAt = now() + duration;
    room.classic.remainingMs = duration;
    room.classic.timer = clock.setTimeout(() => {
      if (rooms.get(room.code) === room && room.phase === 'classic_question') close(room);
    }, duration);
  }
  function prepare(room) {
    stop(room);
    const c = room.classic;
    c.index++;
    c.questionKey = crypto.randomUUID();
    c.answers = Object.create(null);
    c.drafts = Object.create(null);
    c.endsAt = null;
    c.remainingMs = 60000;
    c.media = { time: 0, playing: false, updatedAt: now(), revision: 0 };
    room.phase = 'classic_ready';
    publish(room);
  }
  function next(room) {
    const c = room.classic;
    if (c.index + 1 === c.pool.questions.length) {
      stop(room);
      c.media.playing = false; c.finalRevealCount = 0;
      room.phase = 'classic_final';
    } else if (checkpoints(c.pool.questions.length).includes(c.index + 1)) room.phase = 'classic_standings';
    else return prepare(room);
    publish(room);
  }
  function revealNextPlace(room, expectedCount) {
    const c = room.classic;
    if (expectedCount !== c.finalRevealCount) throw new Error('Це місце вже відкрито.');
    c.finalRevealCount++;
    if (c.finalRevealCount === finalGroups(room).length) room.phase = 'classic_finished';
    publish(room);
  }
  function open(room) { room.phase = 'classic_question'; arm(room, 60000); publish(room); }
  function pause(room) {
    if (expire(room)) throw new Error('Час відповідей уже завершено.');
    const c = room.classic;
    if (room.phase === 'classic_question') {
      c.remainingMs = Math.max(0, c.endsAt - now());
      stop(room); c.endsAt = null;
      c.resumePlaying = c.media.playing;
      if (c.media.playing) c.media.time += (now() - c.media.updatedAt) / 1000;
      c.media.playing = false; c.media.updatedAt = now();
      room.phase = 'classic_paused';
    } else if (room.phase === 'classic_paused') {
      room.phase = 'classic_question';
      c.media.playing = !!c.resumePlaying; c.media.updatedAt = now();
      arm(room, c.remainingMs);
    } else throw new Error('Пауза доступна під час приймання відповідей.');
    c.media.revision++;
    publish(room);
  }
  function reveal(room) {
    const c = room.classic, question = c.pool.questions[c.index];
    if (room.players.some(team => c.answers[team.id] && typeof c.answers[team.id].correct !== 'boolean'))
      throw new Error('Спочатку перевірте всі надіслані відповіді.');
    const results = room.players.map(team => {
      const answer = c.answers[team.id];
      const delta = answer?.correct === true ? question.points : 0;
      team.score += delta;
      return { teamId: team.id, name: team.name, answer: answer?.text || '', correct: answer?.correct === true,
        awarded: delta, autoSubmitted: !!answer?.autoSubmitted };
    });
    c.history.push({ questionId: question.id, questionNumber: c.index + 1, q: question.q, a: question.a, points: question.points, results });
    room.phase = 'classic_result';
    publish(room);
  }
  return { now, stop, expire, prepare, next, revealNextPlace, open, close, pause, reveal };
}

module.exports = { createRoundEngine };
