// The pre-refactor Socket.IO protocol must remain complete and registered once per socket.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { createApplication } = require('../../server/app');
const { REPLAY_CATALOG } = require('./lib/server');
const rootDir = path.resolve(__dirname, '../..');
const expectedEvents = [
  "adjustScore",
  "beginRoundOne",
  "buzz",
  "chooseTile",
  "closeAudienceRound",
  "closeRoom",
  "closeSeasonCeremony",
  "continueVideo",
  "correctSavedSeasonResult",
  "createRoom",
  "createSeason",
  "deleteSavedSeasonResult",
  "disconnect",
  "emergencyFinishTile",
  "emergencyReopenBuzz",
  "emergencyRevealQuestion",
  "finishAudienceQuestion",
  "finishAudienceRound",
  "finishFinalNow",
  "finishNumericQuestion",
  "finishNumericResult",
  "finishVideoResult",
  "getAudienceState",
  "getRoomTheme",
  "hostAudioControl",
  "hostVideoControl",
  "joinAudience",
  "joinPlayer",
  "joinScreen",
  "judge",
  "judgeCat",
  "judgeTriplet",
  "judgeVaBank",
  "leavePlayer",
  "nextFromResult",
  "nextRound",
  "nextTriplet",
  "openAudienceRound",
  "openBuzz",
  "openDuelBuzz",
  "playCue",
  "rejoinHost",
  "reportNetworkStats",
  "restartSameGame",
  "returnToGameMenu",
  "revealAnswer",
  "revealAudioStep",
  "revealFirstTurnResults",
  "revealImageStep",
  "revealNextAudience",
  "revealNextFinalResult",
  "revealNextFirstTurnResult",
  "revealNextNumeric",
  "revealNextSeasonResult",
  "saveSeasonResult",
  "scoreFinal",
  "seasonAdminCreate",
  "seasonAdminInit",
  "seasonAdminSetStatus",
  "seasonListHost",
  "selectCatReceiver",
  "selectDuelOpponent",
  "setSeasonStatus",
  "setSeasonWildCard",
  "setUiTheme",
  "skipFirstTurnQuiz",
  "startAudienceQuestion",
  "startFinalBets",
  "startFinalQuestion",
  "startFinalTimer",
  "startFirstTurnTimer",
  "startGame",
  "startNumericTimer",
  "startSeasonCeremony",
  "submitAudienceAnswer",
  "submitBet",
  "submitFinalAnswer",
  "submitFirstTurnAnswer",
  "submitNumericAnswer",
  "submitVaBankBet",
  "testGrandFinal",
  "timeSync",
  "togglePause",
  "voiceGetStatus",
  "voiceSetEnabled",
  "voiceSetMapping",
  "voiceTestSpeaking"
];

function runtime(t, key) {
  const value = createApplication({ rootDir, env: { HOST_KEY: key, GAMES_INDEX_FILE: REPLAY_CATALOG } });
  t.after(async () => {
    value.voice.stop();
    value.stopPresenceMonitor();
    await value.io.close();
  });
  return value;
}

function socketHandlers(value) {
  const handlers = new Map();
  const socket = {
    id: 'isolated-registration', data: {}, join() {}, leave() {},
    on(event, handler) {
      assert.equal(handlers.has(event), false, event + ': duplicate registration');
      handlers.set(event, handler);
    },
  };
  const registrations = value.io.sockets.listeners('connection');
  assert.equal(registrations.length, 1);
  registrations[0](socket);
  return {
    handlers,
    call(event, payload) {
      let response;
      handlers.get(event)(payload, result => { response = result; });
      return response;
    },
  };
}

test('all 87 existing, 18 classic and 2 board-generation commands are registered exactly once without listening or starting the bot', t => {
  const signals = ['SIGTERM', 'SIGINT'].map(signal => process.listenerCount(signal));
  const value = runtime(t, 'registration-only');
  assert.equal(value.server.address(), null, 'construction must not open a listening port');
  const { handlers } = socketHandlers(value);
  const classicEvents = ['classicCreateRoom', 'classicRejoinHost', 'classicJoinTeam', 'classicJoinScreen',
    'classicStart', 'classicOpenAnswers', 'classicCloseAnswers', 'classicTogglePause',
    'classicSubmitAnswer', 'classicJudgeAnswer', 'classicReveal', 'classicNextQuestion',
    'classicMediaControl', 'classicCloseRoom', 'classicSaveDraft', 'classicContinue', 'classicRevealNextPlace', 'classicRandomPool'];
  assert.equal(expectedEvents.length, 87);
  assert.deepEqual([...handlers.keys()].sort(), [...expectedEvents, ...classicEvents, 'boardRandomOptions','boardRandomPreview'].sort());
  assert.deepEqual(['SIGTERM', 'SIGINT'].map(signal => process.listenerCount(signal)), signals,
    'construction must not install process shutdown hooks');
});

test('separate server instances keep independent rooms, HOST access and Discord status', t => {
  const first = runtime(t, 'first-key');
  const second = runtime(t, 'second-key');
  const a = socketHandlers(first);
  const b = socketHandlers(second);
  assert.equal(a.call('createRoom', { hostKey: 'second-key' }).ok, false);
  const created = a.call('createRoom', { hostKey: 'first-key' });
  assert.equal(created.ok, true);
  assert.equal(first.rooms.size, 1);
  assert.equal(second.rooms.size, 0);
  assert.equal(b.call('rejoinHost', { code: created.code, hostToken: created.hostToken }).ok, false);

  const other = b.call('createRoom', { hostKey: 'second-key' });
  assert.equal(other.ok, true);
  first.voice.handleMessage({ type: 'voiceStatus', status: 'connecting', error: 'fixture' });
  assert.equal(a.call('voiceGetStatus', { code: created.code }).status, 'connecting');
  assert.equal(b.call('voiceGetStatus', { code: other.code }).status, 'unavailable');
  assert.equal(a.call('closeRoom', { code: created.code }).ok, true);
  assert.equal(second.rooms.size, 1, 'closing a room cannot affect another server instance');
});
