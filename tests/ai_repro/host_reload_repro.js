// R19 (EASY-07): HOST page reloaded on the audience podium crashes with ReferenceError.
// Loads the real public/host.html in jsdom against an isolated copy of server.js.
// Usage: node tests/ai_repro/host_reload_repro.js        Exit code 1 = bug still reproduces.
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { startServer, REPO_ROOT } = require('./lib/server');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await startServer();
  const BASE = srv.url;
  const connect = () => new Promise(r => { const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false }); s.on('connect', () => r(s)); });
  const emit = (s, ev, p = {}) => new Promise(r => s.emit(ev, p, r));
  const errors = [];
  let dom = null, w = null;
  try {
    // 1. Drive a real room to the audience podium with a revealed winner.
    const token = 'TOK-RELOAD-' + Date.now();
    const host = await connect();
    const { code } = await emit(host, 'createRoom', { hostToken: token, gameId: 'general-knowledge' });
    await emit(host, 'skipFirstTurnQuiz', { code });
    await emit(host, 'openAudienceRound', { code, roundIndex: 0 });
    w = await connect();
    await emit(w, 'joinAudience', { code, name: 'Winner', audienceId: '' });
    for (const correct of [1, 0, 1]) { // games/general_knowledge.json audienceRounds[0]
      await emit(host, 'startAudienceQuestion', { code });
      await emit(w, 'submitAudienceAnswer', { code, option: correct });
      await emit(host, 'finishAudienceQuestion', { code });
    }
    await emit(host, 'finishAudienceRound', { code });
    await emit(host, 'revealNextAudience', { code });
    host.close(); // the host's tab is gone (F5)
    await sleep(200);

    // 2. Re-open host.html with the saved host token, as F5 would.
    // The crash happens inside an async socket callback; in jsdom it surfaces as a Node-level error.
    process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + (e?.message || e)));
    process.on('uncaughtException', e => errors.push('uncaughtException: ' + (e?.message || e)));
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message + ' ' + (e.detail?.message || '')); });
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'host.html'), 'utf8');
    dom = new JSDOM(html, {
      url: `${BASE}/host`, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
        win.localStorage.setItem('sgHostToken', token);
        win.localStorage.setItem('sgRoomCode', code);
        win.fetch = (u, o) => fetch(new URL(u, BASE), o); // jsdom has no fetch
        win.addEventListener('error', e => errors.push('error: ' + e.message));
      },
    });
    await sleep(3000);
  } finally {
    try { dom?.window.close(); } catch { /* ignore */ }
    w?.close();
    srv.stop();
  }
  const crashed = errors.some(e => /hostAudienceWinner is not defined/.test(e));
  console.log('[R19] (EASY-07) Host page reload during audience podium');
  console.log('  errors:', errors.length ? errors : 'none');
  console.log(crashed ? '  => REPRODUCED' : '  => NOT REPRODUCED');
  process.exit(crashed ? 1 : 0);
})();
