function createBoardHelpers() {
  function resetQuestionState(room) {
    room.buzzReactions = {};
    room.buzzer = null;
    room.revealAnswer = false;
    room.resultReason = null;
    room.answeringLocked = new Set();
    room.catChooser = null;
    room.catReceiver = null;
    room.vaBankPlayer = null;
    room.vaBankBet = null;
    room.duelPlayers = [];
    room.buzzOpensAt = null;
    room.buzzCandidates = [];
    if (room.buzzResolveTimer) clearTimeout(room.buzzResolveTimer);
    room.buzzResolveTimer = null;
  }
  function resetEligibleBuzzReactions(room) {
    for (const id of Object.keys(room.buzzReactions || {})) {
      if (!room.answeringLocked.has(id)) delete room.buzzReactions[id];
    }
  }
  function advanceTurn(room) {
    if (!room.players.length) {
      room.turnPlayerId = null;
      return;
    }
    const i = room.players.findIndex(p => p.id === room.turnPlayerId);
    room.turnPlayerId = room.players[i < 0 ? 0 : (i + 1) % room.players.length].id;
  }
  function finishTile(room) {
    if (room.current && room.current.type !== "final")
      room.used[`${room.round}:${room.current.ci}:${room.current.qi}`] = true;
    advanceTurn(room);
    room.current = null;
    resetQuestionState(room);
    room.phase = "board";
  }
  return { resetQuestionState, resetEligibleBuzzReactions, advanceTurn, finishTile };
}

module.exports = { createBoardHelpers };
