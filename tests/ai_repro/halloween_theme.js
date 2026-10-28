// Real isolated server + actual OBS page. Never touches the user's rooms or database.
// Usage: node tests/ai_repro/halloween_theme.js [--screenshots]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
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
  const loadPage = async route => {
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => errors.push(error.detail?.message || error.message));
    const page = await JSDOM.fromURL(server.url + route, {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
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

    if (process.argv.includes('--screenshots')) {
      const browser = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
      assert.ok(fs.existsSync(browser), 'Microsoft Edge is required for optional screenshots');
      const directory = path.join(REPO_ROOT, 'themes/halloween/previews');
      fs.mkdirSync(directory, { recursive: true });
      for (const view of ['board', 'photo']) {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smokerlol-theme-edge-'));
        const target = path.join(directory, `obs-${view}.png`);
        const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`, '--window-size=1920,1080', '--force-device-scale-factor=1', '--virtual-time-budget=2500', `--screenshot=${target}`, `${server.url}/screen?preview=halloween&view=${view}`], { windowsHide: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { child.kill(); reject(new Error('Screenshot timeout')); }, 30000);
          child.on('error', error => { clearTimeout(timeout); reject(error); });
          child.on('exit', result => { clearTimeout(timeout); result === 0 ? resolve() : reject(new Error(`Edge exit ${result}`)); });
        });
        assert.ok(fs.statSync(target).size > 10000, 'screenshot was written');
        const resolvedProfile = path.resolve(profile);
        if (!resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolvedProfile).startsWith('smokerlol-theme-edge-'))
          throw new Error('Unexpected browser profile path');
        try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* Edge may still hold a helper process. */ }
        console.log(`SCREENSHOT: ${target}`);
      }
    }
  } finally {
    pages.forEach(page => page.window.close());
    sockets.forEach(socket => socket.disconnect());
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
