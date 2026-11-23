// Public payload for the existing board game. Keep hidden answers and HOST secrets out.
function createBoardState({ getRoomGame }) {
  function publicState(room) {
    return {
      code: room.code,
      title: getRoomGame(room).title,
      gameId: room.gameId,
      uiTheme: (room.uiTheme === undefined ? getRoomGame(room).uiTheme : room.uiTheme) === "halloween" ? "halloween" : null,
      isGrandFinal: getRoomGame(room).isGrandFinal === true,
      isTestResult: !!room.isTestResult,
      gameMenuTitle: getRoomGame(room).menuTitle || getRoomGame(room).title,
      phase: room.phase,
      paused: !!room.paused,
      pausedPhase: room.pausedPhase || null,
      round: room.round,
      used: room.used,
      selectedTile: room.phase === "board" ? room.selectedTile || null : null,
      board: (getRoomGame(room).rounds?.[room.round]?.categories || []).map(cat => ({
        name: cat.name,
        questions: (cat.questions || []).map(q => ({ value: q.value })),
      })),
      current: room.current
        ? {
            type: room.current.type,
            ci: room.current.ci,
            qi: room.current.qi,
            value: room.current.value,
            q: room.current.q,
            questionType: room.current.questionType || null,
            emoji: room.current.emoji || "",
            image: room.current.image || "",
            media: room.current.media || "",
            revealStage: room.current.revealStage,
            revealValues: room.current.revealValues,
            revealSeconds: room.current.revealSeconds,
            pauseAt: room.current.pauseAt,
            videoContinued: room.current.videoContinued,
            videoTime: Number(room.current.videoTime || 0),
            videoPlaying: !!room.current.videoPlaying,
            videoUpdatedAt: Number(room.current.videoUpdatedAt || 0),
            audioTime: Number(room.current.audioTime || 0),
            audioPlaying: !!room.current.audioPlaying,
            audioUpdatedAt: Number(room.current.audioUpdatedAt || 0),
            // Answers stay hidden until the server explicitly reveals them.
            a: room.revealAnswer ? room.current.a : "",
            answerImage: room.revealAnswer ? room.current.answerImage || "" : "",
            answerVideo: room.revealAnswer ? room.current.answerVideo || "" : "",
            answerAudioFile: room.revealAnswer ? room.current.answerAudioFile || "" : "",
            triplet: room.current.triplet
              ? {
                  index: room.current.triplet.index,
                  total: room.current.triplet.total,
                  baseValue: room.current.triplet.baseValue,
                  answererId: room.current.triplet.answererId,
                  // UI-06: only value and judged outcomes; prompts and answers are never exposed.
                  steps: room.current.triplet.items.map(x => Number(x.value) || 0),
                  results: (room.current.triplet.results || []).map(x => ({
                    correct: !!x.correct,
                    value: Number(x.value) || 0,
                  })),
                }
              : undefined,
          }
        : null,
      // Dedicated safe payload for PLAYER/OBS rendering of the currently active question.
      // This intentionally duplicates only public question fields so UI rendering does not depend
      // on the internal room.current object shape.
      activeQuestion: room.current
        ? {
            value: room.current.value,
            q: room.current.q || "",
            questionType: room.current.questionType || null,
            emoji: room.current.emoji || "",
            image: room.current.image || "",
            media: room.current.media || "",
            revealStage: room.current.revealStage,
            revealValues: room.current.revealValues,
            revealSeconds: room.current.revealSeconds,
            pauseAt: room.current.pauseAt,
            videoContinued: room.current.videoContinued,
            videoTime: Number(room.current.videoTime || 0),
            videoPlaying: !!room.current.videoPlaying,
            videoUpdatedAt: Number(room.current.videoUpdatedAt || 0),
            audioTime: Number(room.current.audioTime || 0),
            audioPlaying: !!room.current.audioPlaying,
            audioUpdatedAt: Number(room.current.audioUpdatedAt || 0),
            a: room.revealAnswer ? room.current.a || "" : "",
          }
        : null,
      buzzer: room.buzzer,
      catChooser: room.catChooser,
      catReceiver: room.catReceiver,
      turnPlayerId: room.turnPlayerId,
      vaBankPlayer: room.vaBankPlayer,
      vaBankBet: room.vaBankBet,
      duelPlayers: room.duelPlayers || [],
      voice: {
        speakingPlayerIds: (room.voiceSpeaking || []).filter(id => room.players.some(p => p.id === id)),
        updatedAt: room.voiceUpdatedAt || 0,
      },
      players: room.players.map(p => ({
        id: p.id,
        cameraSlot: p.cameraSlot,
        name: p.name,
        score: p.score,
        connected: p.connected,
        reactionMs: room.buzzReactions?.[p.id] ?? null,
        reactionWrong: !!room.answeringLocked?.has(p.id),
        falseStartUntil: Number(p.falseStartUntil || 0),
        falseStartRemainingMs: Math.max(0, Number(p.falseStartUntil || 0) - Date.now()),
        networkRttMs: Number.isFinite(p.networkRttMs) ? Math.round(p.networkRttMs) : null,
        networkJitterMs: Number.isFinite(p.networkJitterMs) ? Math.round(p.networkJitterMs) : null,
        syncReady: !!p.connected && Number(p.syncSamples || 0) >= 3 && Date.now() - Number(p.lastSyncAt || 0) < 12000,
        hasBet: p.bet !== null,
        hasFinalAnswer: !!p.finalAnswer,
        finalAnswer: ["final_review", "final_result"].includes(room.phase) ? p.finalAnswer : "",
      })),
      buzzOpensAt: room.buzzOpensAt || null,
      answeringLocked: Array.from(room.answeringLocked || []),
      finalSeconds: room.finalSeconds,
      revealAnswer: room.revealAnswer,
      finalResults: room.finalResults || null,
      finalRevealCount: room.finalRevealCount || 0,
      savedSeasonGameId: room.savedSeasonGameId || null,
      savedSeasonId: room.savedSeasonId || null,
      seasonFinal: room.seasonFinal || null,
      seasonCeremonyActive: !!room.seasonCeremonyActive,
      seasonRevealCount: room.seasonRevealCount || 0,
      numericChallenge: room.numericChallenge
        ? {
            question: room.numericChallenge.question,
            unit: room.numericChallenge.unit || "",
            value: room.numericChallenge.value,
            submittedPlayerIds: Object.keys(room.numericAnswers || {}),
            remainingMs: room.numericEndsAt ? Math.max(0, room.numericEndsAt - Date.now()) : 0,
            endsAt: null,
            results: room.phase === "numeric_result" ? room.numericResults : null,
            revealCount: room.numericRevealCount || 0,
            correctAnswer: room.phase === "numeric_result" ? room.numericChallenge.answer : null,
            answerImage: room.phase === "numeric_result" ? room.numericChallenge.answerImage || "" : "",
          }
        : null,
      audience:
        room.audienceRoundIndex !== null
          ? (() => {
              const rounds = getRoomGame(room).audienceRounds || [];
              const ar = rounds[room.audienceRoundIndex] || null;
              const aq = ar?.questions?.[room.audienceQuestionIndex] || null;
              const submitted = Object.keys(room.audienceAnswers || {});
              const counts = aq
                ? aq.options.map((_, i) => Object.values(room.audienceAnswers || {}).filter(x => x.option === i).length)
                : [];
              const ranking = (room.audienceRanking || []).map(x => ({
                id: x.id,
                name: x.name,
                correct: x.correct,
                timeMs: x.timeMs,
                eligible: x.eligible,
              }));
              const currentWinner =
                (room.audienceWinners || []).find(x => x.roundIndex === room.audienceRoundIndex) || null;
              return {
                roundIndex: room.audienceRoundIndex,
                title: ar?.title || "",
                questionIndex: room.audienceQuestionIndex,
                totalQuestions: ar?.questions?.length || 0,
                question: aq ? aq.q : "",
                options: aq ? aq.options : [],
                correct: ["audience_result", "audience_podium"].includes(room.phase) ? aq?.correct : null,
                fact: ["audience_result", "audience_podium"].includes(room.phase) ? aq?.fact : "",
                questionSeconds: Number(getRoomGame(room).audienceQuestionSeconds || 15),
                endsAt: room.audienceEndsAt || null,
                remainingMs: room.audienceEndsAt ? Math.max(0, room.audienceEndsAt - Date.now()) : 0,
                joined: room.audience.filter(x => x.connected).length,
                submitted: submitted.length,
                submittedPlayerIds: submitted,
                counts,
                ranking: room.phase === "audience_podium" ? ranking : [],
                revealCount: room.audienceRevealCount || 0,
                winner:
                  room.phase === "audience_podium"
                  && room.audienceRevealCount >= Math.min(5, ranking.length)
                  && currentWinner
                    ? ranking.find(x => x.id === currentWinner.id) || null
                    : null,
              };
            })()
          : null,
      firstTurnQuiz: room.firstTurnQuiz
        ? {
            title: room.firstTurnQuiz.title,
            question: room.firstTurnQuiz.question,
            unit: room.firstTurnQuiz.unit,
            submittedPlayerIds: Object.keys(room.firstTurnAnswers || {}),
            timerStatus: room.firstTurnTimerStatus || "ready",
            duration: 30,
            remainingMs:
              room.firstTurnTimerStatus === "running" && room.firstTurnEndsAt
                ? Math.max(0, room.firstTurnEndsAt - Date.now())
                : 0,
            endsAt: null,
            results: room.phase === "first_turn_result" ? room.firstTurnResults : null,
            revealCount: room.phase === "first_turn_result" ? room.firstTurnRevealCount || 0 : 0,
            correctAnswer: room.phase === "first_turn_result" ? room.firstTurnQuiz.answer : null,
          }
        : null,
    };
  }
  return publicState;
}

module.exports = { createBoardState };
