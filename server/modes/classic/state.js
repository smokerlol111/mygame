const { checkpoints, standings, finalGroups } = require('./standings');

function publicState(room, now = Date.now()) {
  const c = room.classic;
  const question = c.pool.questions[c.index];
  const revealed = room.phase === 'classic_result';
  const final = ['classic_final', 'classic_finished'].includes(room.phase);
  const showStandings = ['classic_standings', 'classic_finished'].includes(room.phase);
  const groups = final ? finalGroups(room) : [], shown = groups.slice(0, c.finalRevealCount);
  const published = showStandings ? standings(room) : shown.flat();
  const byId = new Map(published.map(team => [team.id, team]));
  return {
    gameType: 'classic', code: room.code, title: c.pool.title, phase: room.phase,
    questionNumber: Math.min(c.index + 1, c.pool.questions.length), totalQuestions: c.pool.questions.length, questionKey: c.questionKey,
    standingsAfter: checkpoints(c.pool.questions.length), showStandings,
    standings: showStandings ? published : [],
    ceremony: final ? { revealCount: c.finalRevealCount, totalSteps: groups.length,
      latest: shown.at(-1) || [], revealed: shown.flat(), complete: room.phase === 'classic_finished' } : null,
    seconds: 60, serverNow: now, endsAt: c.endsAt,
    remainingMs: room.phase === 'classic_question' ? Math.max(0, c.endsAt - now) : c.remainingMs,
    question: question && !final && room.phase !== 'classic_standings' ? {
      id: question.id, q: question.q, type: question.type, media: question.media, points: question.points,
      answer: revealed ? question.a : '',
    } : null,
    media: c.media ? { ...c.media } : null,
    // Registration order does not disclose unrevealed rankings.
    teams: room.players.map(team => {
      const answer = c.answers[team.id], standing = byId.get(team.id);
      return { id: team.id, name: team.name, score: standing?.score, place: standing?.place, connected: !!team.connected,
        submitted: !!answer, answer: revealed ? answer?.text || '' : '',
        correct: revealed ? answer?.correct === true : null,
        awarded: revealed && answer?.correct ? question.points : 0 };
    }),
  };
}

function hostState(room, { includePool = false } = {}) {
  const c = room.classic, final = ['classic_final', 'classic_finished'].includes(room.phase);
  return {
    code: room.code, questionKey: c.questionKey, pool: includePool ? c.pool : undefined,
    questionAnswer: c.pool.questions[c.index]?.a || '', standings: standings(room),
    nextRevealPlace: finalGroups(room)[c.finalRevealCount]?.[0].place ?? null,
    answers: room.players.map(team => ({ teamId: team.id, name: team.name,
      answer: c.answers[team.id]?.text || '', submitted: !!c.answers[team.id],
      autoSubmitted: !!c.answers[team.id]?.autoSubmitted, correct: c.answers[team.id]?.correct ?? null })),
    history: final ? c.history : undefined,
  };
}

function teamState(room, team) {
  const answer = room.classic.answers[team.id];
  return { code: room.code, questionKey: room.classic.questionKey, teamId: team.id,
    draft: room.classic.drafts[team.id]?.text || '', autoSubmitted: !!answer?.autoSubmitted,
    answer: answer?.text || '', submitted: !!answer };
}

module.exports = { publicState, hostState, teamState };
