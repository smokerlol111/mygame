// Default: historical review proofs; --fixed: regression checks for the repairs.
// Isolated server/jsdom; no production/Discord/OBS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer, REPO_ROOT } = require('./lib/server');
// Pin the HEAD used during review; publishing the fix must not change the comparison.
const REVIEW_BASELINE = 'a0bf59e68827f661aab165c851ae8cb403d70e81';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const fixed = process.argv.includes('--fixed');
  const server = await startServer();
  const sockets = [];
  let dom;
  const findings = { scope: fixed ? 'Fixed behavior on isolated server/jsdom; no real Discord/OBS/phones' : 'Review reproductions on isolated server/jsdom; defects remain unfixed', findings: {} };
  const wait = async condition => {
    const end = Date.now() + 6000;
    while (!condition()) { assert.ok(Date.now() < end, 'HOST update timed out'); await sleep(20); }
  };
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };
  const ok = async (socket, event, args) => {
    const result = await socket.timeout(3000).emitWithAck(event, args);
    assert.equal(result.ok, true, event + JSON.stringify(result));
    return result;
  };
  try {
    const control = await connect();
    const room = await ok(control, 'createRoom', { hostToken: 'host-risk-review', gameId: 'general-knowledge' });
    const player = await connect();
    const joined = await ok(player, 'joinPlayer', { code: room.code, name: 'Review player' });
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => { if (!/Not implemented/.test(error.message)) errors.push(error.message); });
    dom = await JSDOM.fromURL(server.url + '/host', {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) {
        w.localStorage.setItem('sgHostToken', room.hostToken);
        w.localStorage.setItem('sgRoomCode', room.code);
        w.fetch = (url, options) => fetch(new URL(url, server.url), options);
        w.HTMLMediaElement.prototype.play = () => Promise.resolve();
        w.HTMLMediaElement.prototype.pause = () => {};
        w.HTMLMediaElement.prototype.load = () => {};
      },
    });
    const w = dom.window;
    await wait(() => w.document.querySelector('.scoreCustomInput') && w.eval('voiceBotStatus !== "unknown"'));
    await sleep(100);
    const baseline = execFileSync('git', ['show', REVIEW_BASELINE + ':public/host.html'], { cwd: REPO_ROOT, encoding: 'utf8' });
    const restoreStart = baseline.indexOf('function restoreHostConnection() {');
    const restoreEnd = baseline.indexOf('\n      socket.on("connect"', restoreStart);
    assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'HEAD reconnect function found');
    const headRestore = baseline.slice(restoreStart, restoreEnd).trim();

    findings.findings.failedGameLoad = await w.eval(`(async (headRestore) => {
      const oldFetch = window.fetch, oldData = data, oldSelected = selectedGameId;
      const oldEmit = socket.emit;
      let rejoinCallback;
      let attempts = 0, firstError = '';
      window.fetch = async (...args) => { attempts++; if (attempts === 1) throw new Error('simulated interrupted game HTTP'); return oldFetch(...args); };
      socket.emit = function(event, ...args) {
        if (event === 'rejoinHost') { rejoinCallback = args.at(-1); return this; }
        return oldEmit.call(this, event, ...args);
      };
      try {
        data = null; selectedGameId = '';
        try { await applyHostState(JSON.parse(JSON.stringify(state))); } catch (error) { firstError = error.message; }
        const retryButtonShown = !!document.getElementById('retryGameLoad');
        const response = { ok: true, state: JSON.parse(JSON.stringify(state)), gameId: state.gameId, specialCells: hostSpecialCells, voiceMappings };
        restoreHostConnection(); await rejoinCallback(response);
        const result = { attempts, firstError, dataMissing: data === null, retryButtonShown };
        headRestore(); await rejoinCallback(response);
        result.attemptsWithHeadReconnect = attempts;
        result.dataRestoredWithHeadReconnect = data !== null;
        return result;
      } finally { socket.emit = oldEmit; window.fetch = oldFetch; data = oldData; selectedGameId = oldSelected; render(); }
    })(${headRestore})`);
    assert.equal(findings.findings.failedGameLoad.attempts, fixed ? 2 : 1);
    assert.equal(findings.findings.failedGameLoad.dataMissing, !fixed);
    if (fixed) {
      assert.equal(findings.findings.failedGameLoad.firstError, '', 'fetch error is handled');
      assert.equal(findings.findings.failedGameLoad.retryButtonShown, true);
    }
    assert.equal(findings.findings.failedGameLoad.attemptsWithHeadReconnect, 2);
    assert.equal(findings.findings.failedGameLoad.dataRestoredWithHeadReconnect, true);

    if (fixed) {
      findings.findings.concurrentLoads = await w.eval(`(async () => {
        const oldFetch = window.fetch, oldData = data, oldLoaded = loadedGameId, oldCode = code;
        const requests = [];
        window.fetch = () => new Promise(resolve => requests.push(resolve));
        try {
          const old = loadGameData('review-old');
          const current = loadGameData('review-new'), duplicate = loadGameData('review-new');
          requests[1]({ ok: true, json: async () => ({ id: 'review-new' }) });
          await Promise.all([current, duplicate]);
          requests[0]({ ok: true, json: async () => ({ id: 'review-old' }) });
          const staleAccepted = await old;
          const requestsBeforeRoomChange = requests.length;
          const oldRoom = loadGameData('review-old-room');
          code = 'OTHER-REVIEW-ROOM';
          requests[2]({ ok: true, json: async () => ({ id: 'review-old-room' }) });
          const oldRoomAccepted = await oldRoom;
          return { requestsBeforeRoomChange, loaded: loadedGameId, dataId: data.id, staleAccepted, oldRoomAccepted };
        } finally { window.fetch = oldFetch; data = oldData; loadedGameId = oldLoaded; code = oldCode; }
      })()`);
      assert.deepEqual(JSON.parse(JSON.stringify(findings.findings.concurrentLoads)), {
        requestsBeforeRoomChange: 2, loaded: 'review-new', dataId: 'review-new', staleAccepted: false, oldRoomAccepted: false,
      });
      await w.eval(`(async () => {
        const oldFetch = window.fetch;
        window.reviewRetryAttempts = 0;
        window.fetch = async (...args) => {
          window.reviewRetryAttempts++;
          if (window.reviewRetryAttempts === 1) throw new Error('retry button HTTP interruption');
          return oldFetch(...args);
        };
        window.reviewOldFetch = oldFetch;
        loadedGameId = '';
        await applyHostState(JSON.parse(JSON.stringify(state)));
        document.getElementById('retryGameLoad').click();
      })()`);
      await wait(() => !w.document.getElementById('retryGameLoad'));
      assert.equal(w.reviewRetryAttempts, 2);
      w.fetch = w.reviewOldFetch;
      findings.findings.manualRetry = { attempts: w.reviewRetryAttempts, recovered: true };
    }

    await ok(w.eval('socket'), 'skipFirstTurnQuiz', { code: room.code });
    await wait(() => w.eval('state.phase === "board"'));
    const tile = w.eval(`(() => {
      for (let ci = 0; ci < data.rounds[0].categories.length; ci++) {
        const questions = data.rounds[0].categories[ci].questions;
        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];
          if (!hostSpecialCells['0:' + ci + ':' + qi] && !q.cat && (!q.type || q.type === 'text')) return { ci, qi };
        }
      }
      throw new Error('No ordinary review question');
    })()`);
    await ok(w.eval('socket'), 'chooseTile', { code: room.code, ...tile });
    await wait(() => w.document.getElementById('openBuzz'));
    assert.equal(w.document.getElementById('openBuzz').disabled, true, 'initial player is not synchronized');
    findings.findings.stuckBuzzButton = await w.eval(`(async () => {
      const next = JSON.parse(JSON.stringify(state));
      next.players.forEach(p => { p.connected = true; p.syncReady = true; });
      const keyUnchanged = hostViewKey(next) === hostViewKey(state);
      await applyHostState(next);
      return { keyUnchanged, allPlayersReady: state.players.every(p => p.connected && p.syncReady), disabled: document.getElementById('openBuzz').disabled };
    })()`);
    assert.equal(findings.findings.stuckBuzzButton.allPlayersReady, true);
    assert.equal(findings.findings.stuckBuzzButton.disabled, !fixed);
    // Run the real HEAD handler on the same DOM/state to distinguish regression from baseline.
    const marker = 'socket.on("state", ';
    const start = baseline.indexOf(marker + 'async s => {');
    const end = baseline.indexOf('\n      socket.on("hostSecrets"', start);
    assert.ok(start >= 0 && end > start, 'HEAD state handler found');
    const handler = baseline.slice(start + marker.length, end).trim().replace(/\);$/, '');
    await w.eval(`(${handler})(JSON.parse(JSON.stringify(state)))`);
    findings.findings.stuckBuzzButton.disabledWithHeadHandler = w.document.getElementById('openBuzz').disabled;
    assert.equal(findings.findings.stuckBuzzButton.disabledWithHeadHandler, false);

    if (fixed) {
      const field = w.document.querySelector('.scoreCustomInput');
      field.value = '275'; field.focus();
      await ok(player, 'reportNetworkStats', { code: room.code, rttMs: 150, jitterMs: 4, samples: 0 });
      await wait(() => w.document.getElementById('openBuzz').disabled);
      assert.ok(w.document.getElementById('openBuzz').title);
      assert.match(w.document.querySelector('.host-player-network').textContent, /150 ms/);
      await ok(player, 'reportNetworkStats', { code: room.code, rttMs: 50, jitterMs: 2, samples: 3 });
      await wait(() => !w.document.getElementById('openBuzz').disabled);
      assert.equal(w.document.getElementById('openBuzz').hasAttribute('title'), false);
      assert.match(w.document.querySelector('.host-player-network').textContent, /50 ms/);
      player.disconnect();
      await wait(() => !w.eval('state.players[0].connected'));
      const returning = await connect();
      await ok(returning, 'joinPlayer', { code: room.code, playerKey: joined.playerKey, name: 'Review player' });
      await wait(() => w.document.getElementById('openBuzz').disabled);
      await ok(returning, 'reportNetworkStats', { code: room.code, rttMs: 155, jitterMs: 3, samples: 3 });
      await wait(() => !w.document.getElementById('openBuzz').disabled);
      assert.match(w.document.querySelector('.host-player-network').textContent, /155 ms/);
      assert.equal(w.document.querySelector('.scoreCustomInput'), field);
      assert.equal(field.value, '275'); assert.equal(w.document.activeElement, field);
      findings.findings.networkRecovery = { readyToSyncToReady: true, playerRejoined: true, ping: 155, preservedField: true };
    }

    const checkbox = w.document.querySelector('.voiceTest');
    checkbox.checked = true;
    checkbox.dispatchEvent(new w.Event('change', { bubbles: true }));
    w.document.getElementById('voiceClear').click();
    await sleep(120);
    findings.findings.staleVoiceTestCheckbox = {
      selectedIds: w.eval('voiceTestIds.length'),
      checked: w.document.querySelector('.voiceTest').checked,
    };
    assert.equal(findings.findings.staleVoiceTestCheckbox.selectedIds, 0);
    assert.equal(findings.findings.staleVoiceTestCheckbox.checked, !fixed);
    await w.eval(`(${handler})(JSON.parse(JSON.stringify(state)))`);
    findings.findings.staleVoiceTestCheckbox.checkedWithHeadHandler = w.document.querySelector('.voiceTest').checked;
    assert.equal(findings.findings.staleVoiceTestCheckbox.checkedWithHeadHandler, false);
    if (fixed) {
      w.eval('socket.listeners("voiceBotStatus")[0]({code,status:"connecting"})');
      assert.equal(w.document.getElementById('voiceToggle').disabled, false);
      w.eval(`window.reviewOriginalEmit = socket.emit;
        socket.emit = function(event, ...args) {
          if (event === 'voiceSetEnabled') { window.reviewVoicePayload = args[0]; args[1]({ok:true,status:'disconnected'}); return this; }
          return window.reviewOriginalEmit.call(this, event, ...args);
        };`);
      w.document.getElementById('voiceToggle').click();
      assert.equal(w.reviewVoicePayload.enabled, false);
      w.eval('socket.emit = window.reviewOriginalEmit');
      findings.findings.voiceCancel = { enabledDuringRecovery: true, sentEnabled: false };
    }
    assert.deepEqual(errors, []);

    console.log(JSON.stringify(findings, null, 2));
    if (process.argv.includes('--report')) {
      fs.writeFileSync(path.join(REPO_ROOT, 'archive/audits/transport-review-2026-10-31', fixed ? 'recovery-fixes.json' : 'host-review-reproductions.json'), JSON.stringify(findings, null, 2) + '\n');
    }
  } finally {
    dom?.window.close();
    sockets.forEach(socket => socket.disconnect());
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
