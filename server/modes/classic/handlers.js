function registerActions(socket, context) {
  const { on, rooms, publish, engine, hostRoom, currentRoom } = context;
  function captain(room) {
    const team = room.players.find(team => team.id === socket.data.classicTeamId);
    if (!team || team.socketId !== socket.id || socket.data.roomCode !== room.code) throw new Error('Потрібна активна сесія капітана.');
    return team;
  }
  on('classicStart', payload => {
    const room = hostRoom(payload, ['classic_lobby']);
    if (!room.players.length) throw new Error('Спочатку підключіть хоча б одну команду.');
    engine.prepare(room);
  });
  on('classicOpenAnswers', payload => { engine.open(hostRoom(payload, ['classic_ready'], true)); });
  on('classicCloseAnswers', payload => { engine.close(hostRoom(payload, ['classic_question'], true)); });
  on('classicTogglePause', payload => { engine.pause(hostRoom(payload, ['classic_question', 'classic_paused'], true)); });
  on('classicSaveDraft', payload => {
    const room = currentRoom(payload, ['classic_question']), team = captain(room);
    if (room.classic.answers[team.id]) throw new Error('Відповідь уже надіслана.');
    if (typeof payload.answer !== 'string' || payload.answer.length > 1000) throw new Error('Чернетка — до 1000 символів.');
    room.classic.drafts[team.id] = { text: payload.answer, receivedAt: engine.now() };
    return { draft: payload.answer };
  });
  on('classicSubmitAnswer', payload => {
    const room = currentRoom(payload, ['classic_question']);
    const team = captain(room);
    if (room.classic.answers[team.id]) throw new Error('Відповідь уже надіслана.');
    const text = typeof payload.answer === 'string' ? payload.answer.trim() : '';
    if (!text || text.length > 1000) throw new Error('Відповідь має містити від 1 до 1000 символів.');
    room.classic.answers[team.id] = { text, correct: null, receivedAt: engine.now(), autoSubmitted: false };
    publish(room);
  });
  on('classicJudgeAnswer', payload => {
    const room = hostRoom(payload, ['classic_review'], true);
    const answer = room.classic.answers[payload.teamId];
    if (!answer || typeof payload.correct !== 'boolean') throw new Error('Оберіть надіслану відповідь і рішення.');
    answer.correct = payload.correct;
    publish(room);
  });
  on('classicReveal', payload => { engine.reveal(hostRoom(payload, ['classic_review'], true)); });
  on('classicNextQuestion', payload => { engine.next(hostRoom(payload, ['classic_result'], true)); });
  on('classicContinue', payload => { engine.prepare(hostRoom(payload, ['classic_standings'], true)); });
  on('classicRevealNextPlace', payload => {
    engine.revealNextPlace(hostRoom(payload, ['classic_final'], true), payload.revealCount);
  });
  on('classicMediaControl', payload => {
    const room = hostRoom(payload, ['classic_ready', 'classic_question', 'classic_review', 'classic_result'], true);
    if (!['audio', 'video'].includes(room.classic.pool.questions[room.classic.index].type)) throw new Error('Це питання не містить аудіо чи відео.');
    const time = Number(payload.time);
    if (!['play', 'pause', 'seek'].includes(payload.action) || !Number.isFinite(time) || time < 0 || time > 86400) throw new Error('Невірна команда медіа.');
    room.classic.media = { time, playing: payload.action === 'play' ? true : payload.action === 'pause' ? false : room.classic.media.playing, updatedAt: engine.now(), revision: room.classic.media.revision + 1 };
    publish(room);
  });
  on('classicCloseRoom', payload => {
    const room = hostRoom(payload);
    engine.stop(room); rooms.delete(room.code);
    context.io.to(room.code).emit('roomClosed', { code: room.code, reason: 'Ведучий закрив квіз.' });
    socket.data.roomCode = null;
  });
}

module.exports = { registerActions };
