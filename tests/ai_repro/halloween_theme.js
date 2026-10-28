// Real isolated server + actual OBS page. Never touches the user's rooms or database.
// Usage: node tests/ai_repro/halloween_theme.js [--screenshots]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer, REPO_ROOT } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, label) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await sleep(25);
  }
}

async function main() {
  for (const file of ['public/screen.html', 'public/host.html', 'public/play.html', 'public/themes/halloween/preview.html']) {
    for (const match of fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      new vm.Script(match[1], { filename: file });
  }
  // Check that arbitrary theme names cannot select arbitrary scripts/resources.
  const source = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
  let game = { title: 'Fixture', rounds: [] };
  const context = vm.createContext({ getRoomGame: () => game });
  vm.runInContext(source.slice(source.indexOf('function publicState('), source.indexOf('function emitState(')), context);
  const room = { players: [], audienceRoundIndex: null, answeringLocked: new Set(), gameId: 'fixture' };
  assert.equal(context.publicState(room).uiTheme, null);
  game.uiTheme = 'halloween';
  assert.equal(context.publicState(room).uiTheme, 'halloween');
  room.uiTheme = null;
  assert.equal(context.publicState(room).uiTheme, null, 'HOST can select standard over a Halloween game default');
  room.uiTheme = 'halloween';
  game.uiTheme = undefined;
  assert.equal(context.publicState(room).uiTheme, 'halloween', 'HOST can select Halloween over a standard game default');
  delete room.uiTheme;
  game.uiTheme = '../../untrusted';
  assert.equal(context.publicState(room).uiTheme, null);
  const presenceTargets = [];
  context.io = { to(target) { return { emit(event, payload) { presenceTargets.push({ target, event, payload }); } }; } };
  vm.runInContext(source.slice(source.indexOf('function emitPlayerPresence('), source.indexOf('function getRoom(')), context);
  const presenceRoom = { code: 'TEST', hostSocket: 'host' };
  context.emitPlayerPresence(presenceRoom, { id: 'player', connected: false });
  assert.equal(presenceTargets.at(-1).target, 'host', 'default presence still goes only to HOST');
  game.uiTheme = 'halloween';
  context.emitPlayerPresence(presenceRoom, { id: 'player', connected: true });
  assert.equal(presenceTargets.at(-1).target, 'TEST', 'Halloween OBS receives presence without full state updates');
  console.log('PASS: syntax and explicit allowlisted theme opt-in');

  const server = await startServer({ HOST_KEY: 'theme-regression' });
  const sockets = [], pages = [], errors = [];
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.on('state', value => { socket.state = value; });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };
  const ok = async (socket, event, payload) => {
    const result = await socket.timeout(5000).emitWithAck(event, payload);
    assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
    return result;
  };
  const loadPage = async (route, savedSession = {}) => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => errors.push(error.detail?.message || error.message));
    const page = await JSDOM.fromURL(server.url + route, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
        for (const [key, value] of Object.entries(savedSession)) win.localStorage.setItem(key, value);
        win.fetch = (url, options) => fetch(new URL(url, server.url), options);
        win.HTMLMediaElement.prototype.play = () => Promise.resolve();
        win.HTMLMediaElement.prototype.pause = () => {};
        win.HTMLMediaElement.prototype.load = () => {};
      },
    });
    pages.push(page);
    return page;
  };
  try {
    const host = await connect();
    const { code } = await ok(host, 'createRoom', {
      hostKey: 'theme-regression', hostToken: 'theme-regression', gameId: 'season2-grand-final',
    });
    const participants = [];
    for (let i = 0; i < 4; i++) {
      const socket = await connect();
      const joined = await ok(socket, 'joinPlayer', { code, name: `Player ${i}` });
      participants.push({ socket, ...joined });
      assert.equal(joined.state.players.find(p => p.id === joined.playerId).cameraSlot, i);
    }
    await ok(host, 'startGame', { code });
    await ok(host, 'startFirstTurnTimer', { code });
    const answer = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'games/season2_grand_final.json'), 'utf8')).firstTurnQuiz.answer;
    for (let i = 0; i < 4; i++)
      await ok(participants[i].socket, 'submitFirstTurnAnswer', { code, answer: Number(answer) + (3 - i) * 100 });
    await ok(host, 'revealFirstTurnResults', { code });
    await waitFor(() => host.state?.phase === 'first_turn_result', 'first-turn ranking');
    assert.deepEqual(host.state.players.map(p => p.cameraSlot), [3, 2, 1, 0], 'sorting turns must preserve camera slots');
    assert.ok(host.state.players.every(p => p.score === 0), 'camera metadata must not affect scores');
    assert.equal(host.state.uiTheme, null, 'Grand Final must keep the default theme');
    const priorId = participants[1].playerId;
    participants[1].socket.disconnect();
    const replacement = await connect();
    const rejoined = await ok(replacement, 'joinPlayer', { code, playerKey: participants[1].playerKey });
    assert.equal(rejoined.playerId, priorId);
    assert.equal(rejoined.state.players.find(p => p.id === priorId).cameraSlot, 1);
    console.log('PASS: real first-turn sorting and secret-key reconnect retain all camera slots and scores');

    // A manual exit leaves a hole; other cameras stay where they were.
    const lobby = await ok(host, 'createRoom', { hostKey: 'theme-regression', hostToken: 'lobby', gameId: 'kinohardkor' });
    const left = await connect(), right = await connect(), newcomer = await connect();
    await ok(left, 'joinPlayer', { code: lobby.code, name: 'Left' });
    const rightJoin = await ok(right, 'joinPlayer', { code: lobby.code, name: 'Right' });
    await ok(left, 'leavePlayer', { code: lobby.code });
    const newJoin = await ok(newcomer, 'joinPlayer', { code: lobby.code, name: 'New' });
    assert.equal(newJoin.state.players.find(p => p.id === rightJoin.playerId).cameraSlot, 1);
    assert.equal(newJoin.state.players.find(p => p.id === newJoin.playerId).cameraSlot, 0);
    console.log('PASS: leaving/replacing a player does not shift the other camera');

    const preview = await loadPage('/screen?preview=halloween&view=photo');
    await waitFor(() => preview.window.document.querySelectorAll('.halloween-camera').length === 4, 'photo preview');
    const win = preview.window, doc = win.document;
    assert.equal(doc.body.dataset.uiTheme, 'halloween');
    const broadcast = doc.getElementById('halloweenBroadcast');
    assert.ok(broadcast, 'dedicated host camera, chat and donation column');
    assert.deepEqual([...broadcast.querySelectorAll('[data-obs-slot]')].map(el => el.dataset.obsSlot), ['host-camera', 'chat', 'donations']);
    const chatContent = doc.createElement('div');
    chatContent.textContent = 'Persistent OBS content';
    broadcast.querySelector('[data-obs-slot="chat"] .broadcast-window').append(chatContent);
    assert.ok(doc.querySelector('link[href="/themes/halloween/theme.css"]').sheet.cssRules.length > 20, 'theme CSS parsed and loaded');
    assert.equal(doc.querySelector('.imageRevealImg').getAttribute('src'), '/media/surprise_tibetan_fox.jpg');
    assert.equal(doc.querySelector('.halloween-camera.is-answering').dataset.playerId, 'preview-2');
    assert.ok(!doc.querySelector('.obsSegmentAnswer').textContent.includes('Тибетська'), 'answer stays hidden');
    const stableEmblem = doc.querySelector('#halloweenHeader img');
    win.eval('state.players[0].score = 1337; state.round = 1; QuizTheme.renderOBS(state, app)');
    assert.ok(doc.querySelector('[data-camera-slot="0"] .camera-caption').textContent.includes('1337'), 'cached camera row still updates scores');
    assert.ok(doc.querySelector('.halloween-room').textContent.includes('РАУНД 2'), 'cached header still updates round label');
    assert.equal(doc.querySelector('#halloweenHeader img'), stableEmblem, 'score/round updates preserve the same emblem');
    win.eval('state.round = 0; QuizTheme.renderOBS(state, app)');
    win.eval('state.players.reverse(); render()');
    assert.deepEqual([...doc.querySelectorAll('.halloween-camera')].map(el => el.dataset.playerId), ['preview-0', 'preview-1', 'preview-2', 'preview-3']);
    win.eval('state.players = state.players.filter(p => p.id !== "preview-1"); render()');
    assert.ok(doc.querySelector('[data-camera-slot="1"]').classList.contains('is-empty'));
    assert.equal(doc.querySelector('[data-camera-slot="2"]').dataset.playerId, 'preview-2');
    win.eval('state.players[0].name = "<img src=x onerror=alert(1)>"; render()');
    assert.equal(doc.querySelector('#halloweenCameras img'), null, 'player names are escaped');
    // Presence must not replace a playing media element or rebuild the question.
    const image = doc.querySelector('.imageRevealImg');
    win.eval('state.players[0].connected = false; QuizTheme.renderOBS(state, app)');
    assert.equal(doc.querySelector('.imageRevealImg'), image);
    win.eval('state.current.questionType = "video"; state.current.media = "/media/SMOKERLOL_GrandFinal_Ukrnet_Shtany_40_500_STOP.mp4"; state.current.pauseAt = 5; render()');
    const video = doc.querySelector('video.quizVideo');
    assert.ok(video);
    win.eval('QuizTheme.renderOBS(state, app)');
    assert.equal(doc.querySelector('video.quizVideo'), video, 'theme/presence updates preserve the media node');
    assert.equal(doc.getElementById('halloweenBroadcast'), broadcast, 'presence update preserves the broadcast column');
    assert.ok(broadcast.contains(chatContent), 'presence update preserves widget contents');
    video.currentTime = 6;
    video.dispatchEvent(new win.Event('timeupdate'));
    assert.equal(video.currentTime, 5, 'existing STOP guard still clamps the preview');
    for (const phase of ['question', 'buzz', 'answering', 'result', 'video_result', 'va_bank_bet', 'va_bank_question', 'duel_choose', 'duel_question', 'cat_choose', 'cat_question', 'final_bets', 'final_ready', 'final_question', 'final_review', 'final_result', 'lobby', 'paused']) {
      win.eval(`state.phase = ${JSON.stringify(phase)}; render()`);
      assert.equal(doc.querySelectorAll('.halloween-camera').length, 4, `${phase}: fixed camera row`);
      assert.equal(doc.getElementById('halloweenBroadcast'), broadcast, `${phase}: persistent camera/chat/donations column`);
      assert.ok(broadcast.contains(chatContent), `${phase}: widget contents survive`);
    }
    win.eval('state.phase = "answering"; state.uiTheme = null; render()');
    assert.equal(doc.body.dataset.uiTheme, undefined);
    assert.equal(doc.getElementById('halloweenCameras'), null);
    assert.equal(doc.getElementById('halloweenHeader'), null);
    assert.equal(doc.getElementById('halloweenBroadcast'), null);
    console.log('PASS: actual OBS photo rendering, escaping, stable/empty slots, media preservation, 18 phases and theme cleanup');

    const session = { sgRoomCode: 'SAVED', sgHostToken: 'saved-host', sgCode: 'SAVED', sgPlayerKey: 'saved-player-key', sgPlayerId: 'saved-id', sgPlayerName: 'Saved player' };
    for (const [route, view, boardSelector] of [['/host', 'host', '.tile'], ['/play', 'player', '.phoneTile']]) {
      const page = await loadPage(`${route}?preview=halloween&view=board`, session);
      const win = page.window, doc = win.document;
      await waitFor(() => doc.querySelectorAll(boardSelector).length === 25, `${view}: actual board preview`);
      assert.ok(!doc.getElementById('app').textContent.includes('undefined'), 'fixture has the required display labels');
      assert.equal(doc.body.dataset.uiView, view);
      assert.equal(doc.body.dataset.uiTheme, 'halloween');
      if (view === 'host') assert.ok(doc.querySelector('#halloweenIdentity strong').textContent.includes('HALLOWEEN'));
      else {
        assert.equal(doc.getElementById('halloweenIdentity'), null, 'PLAYER keeps the standard header geometry');
        assert.ok(doc.querySelector('.wrap > .brand'), 'standard PLAYER brand is retained');
      }
      assert.equal(win.eval('socket === QuizPreview.socket'), true, 'preview never connects the real socket');
      const identity = doc.getElementById('halloweenIdentity'), emblem = identity?.querySelector('img');
      win.eval('render()');
      if (identity) assert.equal(identity.querySelector('img'), emblem, 'routine rendering keeps the decorative image');
      for (const phase of ['question', 'buzz', 'answering', 'result', 'paused']) {
        win.eval(`state.current = JSON.parse(JSON.stringify(QuizPreview.state.current || { type: "normal", questionType: "text", q: "Довге питання ".repeat(50), a: "", value: 300 })); state.phase = ${JSON.stringify(phase)}; render()`);
        assert.equal(doc.body.dataset.uiPhase, phase);
        assert.equal(doc.getElementById('halloweenIdentity'), identity);
        assert.equal(doc.querySelector('#halloweenCameras'), null, 'working screens have no OBS camera row');
      }
      if (view === 'player') {
        doc.getElementById('leaveRoom').click();
        assert.equal(win.eval('code'), 'DEMO', 'preview exit cannot change the saved session');
        win.eval('state.phase = "buzz"; render()');
        assert.ok(doc.querySelector('#buzz.ready'));
        win.eval('state.phase = "question"; render()');
        assert.ok(doc.querySelector('#buzz.waiting'));
      }
      for (const [key, value] of Object.entries(session)) assert.equal(win.localStorage.getItem(key), value, `${view}: ${key} unchanged`);
      assert.deepEqual(Object.keys(win.localStorage).sort(), Object.keys(session).sort(), 'preview adds no persisted settings');
      win.eval('state.uiTheme = null; render()');
      assert.equal(doc.body.dataset.uiTheme, undefined);
      assert.equal(doc.body.dataset.uiPhase, undefined);
      assert.equal(doc.getElementById('halloweenIdentity'), null);
      win.eval('state.uiTheme = "unknown"; render()');
      assert.equal(doc.getElementById('halloweenIdentity'), null);
    }
    const playerMedia = await loadPage('/play?preview=halloween&view=video');
    await waitFor(() => playerMedia.window.document.getElementById('playerVideo').getAttribute('src'), 'themed PLAYER video');
    const persistentVideo = playerMedia.window.document.getElementById('playerVideo');
    playerMedia.window.eval('state.phase = "buzz"; render()');
    assert.equal(playerMedia.window.document.getElementById('playerVideo'), persistentVideo);
    console.log('PASS: real HOST/PLAYER previews, 25 tiles, BUZZ states, theme reset, persistent PLAYER video and untouched saved sessions');

    // Preview parameters cannot replace an actual room/key-based page.
    const previewSource = fs.readFileSync(path.join(REPO_ROOT, 'public/themes/halloween/preview.js'), 'utf8');
    for (const url of ['/host?preview=halloween&key=test', '/play?preview=halloween&room=REAL', '/screen?preview=halloween&code=REAL', '/screen/REAL?preview=halloween']) {
      const location = new URL(url, 'http://example.test');
      const sandbox = { location, URLSearchParams, window: {} };
      vm.runInNewContext(previewSource, sandbox);
      assert.equal(sandbox.window.QuizPreview, undefined, url);
    }
    // Check gallery navigation without loading its iframe into jsdom: child
    // windows cannot inherit beforeParse's media stubs. Browsers render the frame normally.
    const gallery = await JSDOM.fromURL(server.url + '/themes/halloween/preview.html?target=player&view=photo', { runScripts: 'dangerously' });
    pages.push(gallery);
    assert.equal(gallery.window.document.getElementById('preview').getAttribute('src'), '/play?preview=halloween&view=photo&theme=halloween');
    assert.equal(gallery.window.document.body.dataset.target, 'player');
    const hostGallery = await JSDOM.fromURL(server.url + '/themes/halloween/preview.html?target=host&view=board', { runScripts: 'dangerously' });
    pages.push(hostGallery);
    const galleryWindow = hostGallery.window;
    const galleryFrame = galleryWindow.document.getElementById('preview');
    const originalFrameSrc = galleryFrame.getAttribute('src');
    galleryWindow.dispatchEvent(new galleryWindow.MessageEvent('message', { origin: server.url, source: galleryFrame.contentWindow, data: { type: 'quiz-theme-preview', theme: 'standard' } }));
    assert.equal(new URL(galleryWindow.location.href).searchParams.get('theme'), 'standard');
    assert.ok([...galleryWindow.document.querySelectorAll('#targets a, #views a')].every(a => a.href.includes('theme=standard')));
    assert.equal(galleryFrame.getAttribute('src'), originalFrameSrc, 'preview theme switch does not reload the active frame');
    galleryWindow.dispatchEvent(new galleryWindow.MessageEvent('message', { origin: 'https://untrusted.example', source: galleryFrame.contentWindow, data: { type: 'quiz-theme-preview', theme: 'halloween' } }));
    assert.equal(new URL(galleryWindow.location.href).searchParams.get('theme'), 'standard', 'untrusted preview messages are ignored');

    const ordinary = await loadPage(`/screen/${code}?preview=halloween`);
    await waitFor(() => ordinary.window.document.querySelector('.finalList'), 'ordinary Grand Final OBS');
    assert.equal(ordinary.window.QuizPreview, undefined);
    assert.equal(ordinary.window.document.body.dataset.uiTheme, undefined);
    assert.equal(ordinary.window.document.querySelector('#halloweenCameras'), null);
    assert.equal(ordinary.window.document.querySelector('#halloweenBroadcast'), null);
    for (const route of ['/themes/theme.js', '/themes/halloween/theme.css', '/themes/halloween/preview.js', '/themes/halloween/preview.html', '/themes/halloween/assets/haunted-night.png', '/themes/halloween/assets/pumpkin-candles.png', '/themes/halloween/assets/cobweb.svg', '/themes/halloween/fonts/Creepster-Regular.ttf', '/themes/halloween/fonts/OFL.txt'])
      assert.equal((await fetch(server.url + route)).status, 200, route);
    const pumpkin = fs.readFileSync(path.join(REPO_ROOT, 'public/themes/halloween/assets/pumpkin-candles.png'));
    assert.equal(pumpkin.toString('ascii', 1, 4), 'PNG');
    assert.equal(pumpkin[25], 6, 'pumpkin is an RGBA PNG with an alpha channel');
    assert.deepEqual(errors, [], 'no jsdom runtime errors');
    console.log('PASS: normal Grand Final OBS stays unthemed; static resources return HTTP 200');

    // HOST alone switches the whole room. Exercise actual browser page handlers,
    // authorization, isolation, reconnect and a focused answer input.
    const switchHost = await connect();
    const switchRoom = await ok(switchHost, 'createRoom', { hostKey: 'theme-regression', hostToken: 'theme-switch-host', gameId: 'general-knowledge' });
    const switchPlayer = await connect();
    const switchJoin = await ok(switchPlayer, 'joinPlayer', { code: switchRoom.code, name: 'Theme player' });
    const otherHost = await connect();
    const otherRoom = await ok(otherHost, 'createRoom', { hostKey: 'theme-regression', hostToken: 'other-theme-host', gameId: 'general-knowledge' });
    const otherThemeEvents = [];
    otherHost.on('uiThemeChanged', event => otherThemeEvents.push(event));
    for (const forbidden of [switchPlayer, otherHost]) {
      const result = await forbidden.timeout(3000).emitWithAck('setUiTheme', { code: switchRoom.code, uiTheme: 'halloween' });
      assert.equal(result.ok, false, 'players and hosts of another room cannot switch this room');
    }
    for (const uiTheme of ['unknown', '../../untrusted', {}, undefined]) {
      const result = await switchHost.timeout(3000).emitWithAck('setUiTheme', { code: switchRoom.code, uiTheme });
      assert.equal(result.ok, false, 'only standard/null and Halloween are accepted');
    }
    const hostPage = await loadPage('/host', { sgHostKey: 'theme-regression', sgHostToken: switchRoom.hostToken, sgRoomCode: switchRoom.code });
    const playerPage = await loadPage(`/play?room=${switchRoom.code}`, { sgCode: switchRoom.code, sgPlayerKey: switchJoin.playerKey, sgPlayerName: 'Theme player', sgPlayerId: switchJoin.playerId });
    const obsPage = await loadPage(`/screen/${switchRoom.code}`);
    await waitFor(() => hostPage.window.document.getElementById('toggleTheme') && playerPage.window.document.getElementById('leaveRoom'), 'real HOST and PLAYER joined');
    await waitFor(() => obsPage.window.document.querySelector('.roomCode'), 'real OBS lobby');
    for (const page of [playerPage, obsPage]) assert.equal(page.window.document.getElementById('toggleTheme'), null, 'no theme control on PLAYER/OBS');
    const phaseBefore = switchHost.state.phase;
    hostPage.window.document.getElementById('toggleTheme').click();
    await waitFor(() => [hostPage, playerPage, obsPage].every(page => page.window.document.body.dataset.uiTheme === 'halloween'), 'HOST theme broadcasts to all three screens');
    assert.equal(hostPage.window.document.getElementById('toggleTheme').getAttribute('aria-pressed'), 'true');
    const returning = await connect();
    const returnResult = await ok(returning, 'joinPlayer', { code: switchRoom.code, playerKey: switchJoin.playerKey });
    assert.equal(returnResult.state.uiTheme, 'halloween', 'reconnecting devices inherit the room theme');
    assert.equal(returnResult.state.phase, phaseBefore);
    assert.ok(returnResult.state.players.every(p => p.score === 0));
    const unrelated = await ok(otherHost, 'rejoinHost', { code: otherRoom.code, hostToken: otherRoom.hostToken });
    assert.equal(unrelated.state.uiTheme, null);
    assert.deepEqual(otherThemeEvents, [], 'theme events remain in the selected room');
    hostPage.window.document.getElementById('toggleTheme').click();
    await waitFor(() => [hostPage, playerPage, obsPage].every(page => !page.window.document.body.dataset.uiTheme), 'standard theme restored on all screens');
    assert.equal(obsPage.window.document.getElementById('halloweenCameras'), null);
    assert.equal(obsPage.window.document.getElementById('halloweenBroadcast'), null);
    // The PLAYER page's socket still receives state even when another socket has
    // rejoined its identity. Use it to enter the normal first-turn answer form.
    await ok(switchHost, 'startGame', { code: switchRoom.code });
    await ok(switchHost, 'startFirstTurnTimer', { code: switchRoom.code });
    await waitFor(() => playerPage.window.document.getElementById('firstTurnAnswer'), 'first-turn input');
    const input = playerPage.window.document.getElementById('firstTurnAnswer');
    input.value = '12345'; input.focus();
    hostPage.window.document.getElementById('toggleTheme').click();
    await waitFor(() => playerPage.window.document.body.dataset.uiTheme === 'halloween', 'theme applied while typing');
    assert.equal(playerPage.window.document.getElementById('firstTurnAnswer'), input);
    assert.equal(input.value, '12345');
    assert.equal(playerPage.window.document.activeElement, input);
    const resumed = await ok(switchHost, 'rejoinHost', { code: switchRoom.code, hostToken: switchRoom.hostToken });
    assert.equal(resumed.state.uiTheme, 'halloween', 'HOST reconnect retains selection');
    assert.equal(resumed.state.firstTurnQuiz.timerStatus, 'running');
    assert.ok(resumed.state.firstTurnQuiz.remainingMs > 0 && resumed.state.firstTurnQuiz.remainingMs <= 30000);

    const previewHost = await loadPage('/host?preview=halloween&view=photo', session);
    await waitFor(() => previewHost.window.document.getElementById('toggleTheme'), 'preview HOST toggle');
    const previewImage = previewHost.window.document.querySelector('.imageRevealImg');
    previewHost.window.document.getElementById('toggleTheme').click();
    assert.equal(previewHost.window.document.body.dataset.uiTheme, undefined);
    assert.equal(previewHost.window.document.querySelector('.imageRevealImg'), previewImage);
    assert.equal(new URL(previewHost.window.location.href).searchParams.get('theme'), 'standard');
    previewHost.window.document.getElementById('toggleTheme').click();
    assert.equal(previewHost.window.document.body.dataset.uiTheme, 'halloween');
    assert.deepEqual(Object.keys(previewHost.window.localStorage).sort(), Object.keys(session).sort());
    // Dedicated theme events must preserve the PLAYER video node and its playhead.
    playerMedia.window.eval('QuizTheme.bind({on: (_event, handler) => window.receiveTheme = handler}, () => state)');
    persistentVideo.currentTime = 2;
    for (const uiTheme of [null, 'halloween']) {
      playerMedia.window.receiveTheme({ code: 'DEMO', uiTheme });
      assert.equal(playerMedia.window.document.getElementById('playerVideo'), persistentVideo);
      assert.equal(persistentVideo.currentTime, 2);
    }
    assert.deepEqual(errors, [], 'no runtime errors after room-wide theme switching');
    console.log('PASS: HOST-only theme control, server authorization, room isolation, all three screens, reconnect, focused answers, running timer and media preservation');

    if (process.argv.some(arg => ['--screenshots', '--traffic', '--traffic-baseline', '--player-layout'].includes(arg))) {
      const { startEdge } = require('./lib/edge');
      const browser = await startEdge();
      const directory = path.join(REPO_ROOT, 'themes/halloween/previews');
      fs.mkdirSync(directory, { recursive: true });
      try {
        if (process.argv.includes('--player-layout') || process.argv.includes('--screenshots')) {
          const { checkPlayerThemeLayout } = require('./lib/player-theme-layout');
          await checkPlayerThemeLayout(browser, server.url, process.argv.includes('--screenshots') ? directory : null);
        }
        if (process.argv.includes('--traffic') || process.argv.includes('--traffic-baseline')) {
          const { checkThemeTraffic } = require('./lib/theme-traffic');
          await checkThemeTraffic(browser, { url:server.url, host:switchHost, room:switchRoom, player:switchJoin, enforce:!process.argv.includes('--traffic-baseline') });
        }
        const cases = process.argv.includes('--screenshots') ? [
          ['obs', '/screen', 'board', 1920, 1080], ['obs', '/screen', 'photo', 1920, 1080],
          ['host', '/host', 'board', 1280, 1080], ['host', '/host', 'photo', 1280, 1080],
          ['player', '/play', 'board', 390, 844], ['player', '/play', 'photo', 390, 844],
          ['player', '/play', 'buzz', 390, 844], ['player', '/play', 'long', 320, 740],
          ['player', '/play', 'photo', 320, 740],
          ['player', '/play', 'paused', 390, 844],
        ] : [];
        for (const [role, route, view, width, height] of cases) {
          const page = await browser.page(`${server.url}${route}?preview=halloween&view=${view}`, width, height);
          try {
            const layout = await page.evaluate(`(() => {
              const identity = document.getElementById('halloweenIdentity');
              const buzz = document.getElementById('buzz');
              const rect = identity?.getBoundingClientRect();
              return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
                identityFits: !rect || rect.left >= 0 && rect.right <= innerWidth + 1,
                buzzFits: !buzz || buzz.getBoundingClientRect().width <= innerWidth && buzz.getBoundingClientRect().height >= 120,
                role: document.body.dataset.uiView, theme: document.body.dataset.uiTheme };
            })()`);
            assert.equal(layout.role, role);
            assert.equal(layout.theme, 'halloween');
            assert.equal(await page.evaluate('!!document.getElementById("toggleTheme")'), role === 'host', 'theme control exists only on HOST');
            if (role === 'host') {
              assert.equal(await page.evaluate('document.getElementById("toggleTheme").click(); !document.body.dataset.uiTheme'), true);
              assert.equal(await page.evaluate('document.getElementById("toggleTheme").click(); document.body.dataset.uiTheme'), 'halloween');
            }
            assert.equal(layout.overflow, false, `${role}/${view}: no horizontal page scrolling`);
            assert.ok(layout.identityFits && layout.buzzFits, `${role}/${view}: header and BUZZ fit horizontally`);
            assert.deepEqual(page.errors, [], `${role}/${view}: no browser exceptions`);
            const target = path.join(directory, `${role}-${view}${view === 'photo' && width === 320 ? '-320' : ''}.png`);
            await page.screenshot(target);
            console.log(`SCREENSHOT: ${target}`);
          } finally { await page.close(); }
        }
        if (cases.length) console.log('PASS: Edge layouts at 320/390/1280/1920 px; PLAYER uses standard theme geometry');
      } finally { browser.stop(); }
    }
  } finally {
    pages.forEach(page => page.window.close());
    sockets.forEach(socket => socket.disconnect());
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
