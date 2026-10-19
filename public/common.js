window.GameUI = (() => {
  function publicUrl(path) {
    return new URL(path, window.PUBLIC_GAME_URL || location.origin).href;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
  function answererId(state) {
    if (!state) return null;
    if (state.phase === "answering") return state.buzzer || null;
    if (state.phase === "cat_question") return state.catReceiver || null;
    if (state.phase === "va_bank_question") return state.vaBankPlayer || null;
    if (state.phase === "triplet_question") return state.current?.triplet?.answererId || null;
    return null;
  }
  function showBuzzReactions(state) {
    return (
      !!state?.current
      && ["normal", "duel"].includes(state.current.type)
      && ["question", "duel_question", "buzz", "answering", "result", "video_result"].includes(state.phase)
      && !state.current.triplet
      && state.current.questionType !== "numericClosest"
    );
  }
  function reactionHTML(p, state, compareToAnswerer = false) {
    if (!showBuzzReactions(state)) return "";
    if (state.current.type === "duel" && !(state.duelPlayers || []).includes(p.id)) return "";
    const reactionMs = Number.isFinite(p.reactionMs) ? Math.max(0, Math.round(p.reactionMs)) : null;
    const value = reactionMs !== null ? `${reactionMs} мс` : compareToAnswerer ? "-" : "—";
    const answerer = compareToAnswerer && ["answering", "result", "video_result"].includes(state.phase)
      ? state.players?.find(player => player.id === state.buzzer)
      : null;
    // Locked players retain a reaction from an earlier BUZZ attempt, so it cannot be compared.
    const difference = reactionMs !== null && !p.reactionWrong && answerer?.id !== p.id && Number.isFinite(answerer?.reactionMs)
      ? reactionMs - Math.max(0, Math.round(answerer.reactionMs))
      : 0;
    const delta = difference > 0
      ? `<span class="player-reaction late" aria-label="На ${difference} мс пізніше за гравця, який відповідає">(+${difference} мс)</span>`
      : "";
    return `<span class="player-reaction ${p.reactionWrong ? "wrong" : ""}" aria-label="Час реакції${p.reactionWrong ? ", неправильна відповідь" : ""}">${value}</span>${delta}`;
  }
  function wrongAnswerClass(p, state) {
    if (!state?.current || state.current.triplet) return "";
    if (!["normal", "duel", "cat", "va_bank"].includes(state.current.type)) return "";
    if (
      !["question", "buzz", "answering", "cat_question", "va_bank_question", "result", "video_result"].includes(
        state.phase,
      )
    )
      return "";
    if (state.current.type === "duel" && !(state.duelPlayers || []).includes(p.id)) return "";
    return (state.answeringLocked || []).includes(p.id) ? "answer-wrong" : "";
  }
  function playersHTML(players, buzzer, state) {
    return `<div class="scorebar">${players.map(p => `<div class="player ${p.id === buzzer ? "active" : ""} ${wrongAnswerClass(p, state)}"><div><b>${esc(p.name)}</b> ${p.connected ? "🟢" : "⚫"} ${reactionHTML(p, state)}</div><div class="score">${p.score}</div></div>`).join("")}</div>`;
  }
  function boardHTML(data, state, clickable = true) {
    const r = data.rounds[state.round];
    let h = '<div class="grid">';
    r.categories.forEach(c => (h += `<div class="cat">${esc(c.name)}</div>`));
    for (let qi = 0; qi < 5; qi++) {
      r.categories.forEach((c, ci) => {
        const q = c.questions[qi],
          key = `${state.round}:${ci}:${qi}`,
          used = state.used[key],
          selected =
            state.selectedTile?.round === state.round && state.selectedTile.ci === ci && state.selectedTile.qi === qi;
        h += `<button class="tile ${used ? "used" : ""} ${selected ? "tile-selecting" : ""}" data-ci="${ci}" data-qi="${qi}" ${!clickable || used || state.selectedTile ? "disabled" : ""}>${q.value}</button>`;
      });
    }
    return h + "</div>";
  }
  return { esc, playersHTML, boardHTML, answererId, reactionHTML, showBuzzReactions, wrongAnswerClass, publicUrl };
})();
