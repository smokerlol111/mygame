// A clock can be supplied for deterministic checks of the existing timing rules.
function createBoardTimers({ rooms, emitState, clock = globalThis }) {
  const { Date, setTimeout, clearTimeout, setInterval, clearInterval } = clock;

  function expireFirstTurn(room) {
    room.firstTurnTimer = null;
    room.firstTurnTimerStatus = "expired";
    room.firstTurnEndsAt = null;
    emitState(room);
  }
  function startFirstTurnCountdown(room, ms) {
    const duration = Math.max(0, Number(ms) || 0);
    clearTimeout(room.firstTurnTimer);
    room.firstTurnTimerStatus = "running";
    room.firstTurnEndsAt = Date.now() + duration;
    room.firstTurnTimer = setTimeout(() => expireFirstTurn(room), duration);
  }
  function startFinalCountdown(room) {
    clearInterval(room.finalTimer);
    room.finalGraceTicks = 0;
    room.finalTimer = setInterval(() => {
      if (room.paused) return;
      if (room.finalSeconds > 0) {
        room.finalSeconds--;
        emitState(room); // at 0, player pages send any answer that was typed but not sent
        return;
      }
      // WORK-01: keep accepting answers for 2 s after everyone sees 0 (server 32 s, players see 30 s).
      if (++room.finalGraceTicks < 2) return;
      clearInterval(room.finalTimer);
      room.finalTimer = null;
      room.phase = "final_review";
      emitState(room);
    }, 1000);
  }
  function startNumericCountdown(room, ms) {
    clearTimeout(room.numericTimer);
    room.numericEndsAt = Date.now() + ms;
    room.numericTimer = setTimeout(() => {
      room.numericTimer = null;
      if (rooms.get(room.code) === room && room.phase === "numeric_question") {
        room.numericEndsAt = null;
        emitState(room);
      }
    }, ms);
  }
  function startAudienceCountdown(room, ms) {
    clearTimeout(room.audienceTimer);
    room.audienceEndsAt = Date.now() + ms;
    room.audienceTimer = setTimeout(() => {
      room.audienceTimer = null;
      if (rooms.get(room.code) === room && room.phase === "audience_question") {
        room.audienceEndsAt = null;
        room.phase = "audience_result";
        emitState(room);
      }
    }, ms);
  }
  function pauseRoom(room) {
    if (room.paused) return;
    room.paused = true;
    room.pausedPhase = room.phase;
    room.pauseStartedAt = Date.now();
    room.pauseNumericRemaining = room.phase === "numeric_question" && room.numericEndsAt
      ? Math.max(0, room.numericEndsAt - Date.now()) : null;
    room.pauseAudienceRemaining = room.phase === "audience_question" && room.audienceEndsAt
      ? Math.max(0, room.audienceEndsAt - Date.now()) : null;
    clearTimeout(room.numericTimer);
    clearTimeout(room.audienceTimer);
    room.numericTimer = null;
    room.audienceTimer = null;
    if (room.pauseNumericRemaining !== null) room.numericEndsAt = null;
    if (room.pauseAudienceRemaining !== null) room.audienceEndsAt = null;

    if (room.firstTurnTimerStatus === "running") {
      room.pauseFirstTurnRemaining = Math.max(0, Number(room.firstTurnEndsAt || 0) - Date.now());
      clearTimeout(room.firstTurnTimer);
      room.firstTurnTimer = null;
      room.firstTurnEndsAt = null;
      room.firstTurnTimerStatus = "paused";
    } else room.pauseFirstTurnRemaining = null;

    if (room.phase === "final_question" && room.finalTimer) {
      room.pauseFinalRemaining = Math.max(0, Number(room.finalSeconds) || 0);
      clearInterval(room.finalTimer);
      room.finalTimer = null;
    } else room.pauseFinalRemaining = null;

    room.phase = "paused";
  }
  function resumeRoom(room) {
    if (!room.paused) return;
    const previous = room.pausedPhase || "board";
    room.paused = false;
    room.pausedPhase = null;
    room.phase = previous;
    if (previous === "numeric_question" && room.pauseNumericRemaining !== null)
      startNumericCountdown(room, room.pauseNumericRemaining);
    if (previous === "audience_question" && room.pauseAudienceRemaining !== null) {
      room.audienceStartedAt += Math.max(0, Date.now() - room.pauseStartedAt);
      startAudienceCountdown(room, room.pauseAudienceRemaining);
    }
    room.pauseNumericRemaining = null;
    room.pauseAudienceRemaining = null;
    room.pauseStartedAt = null;

    if (room.firstTurnTimerStatus === "paused") {
      const ms = Math.max(0, Number(room.pauseFirstTurnRemaining) || 0);
      room.pauseFirstTurnRemaining = null;
      if (ms <= 0) expireFirstTurn(room);
      else startFirstTurnCountdown(room, ms);
    }

    if (previous === "final_question" && room.pauseFinalRemaining !== null) {
      room.finalSeconds = Math.max(0, Number(room.pauseFinalRemaining) || 0);
      room.pauseFinalRemaining = null;
      startFinalCountdown(room); // at 0 this only runs the 2 s answer window (WORK-01)
    }
  }
  return { expireFirstTurn, startFirstTurnCountdown, startFinalCountdown, startNumericCountdown,
    startAudienceCountdown, pauseRoom, resumeRoom };
}

module.exports = { createBoardTimers };
