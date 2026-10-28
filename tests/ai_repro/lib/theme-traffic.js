// Real Edge tabs + real Socket.IO room: measure theme traffic, not unrelated
// pre-existing clock synchronization / Engine.IO heartbeats.
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const themeRequest = request => /\/themes\//.test(new URL(request.url).pathname);
const themeFrame = frame => frame.includes('"setUiTheme"') || frame.includes('"getRoomTheme"');

async function checkThemeTraffic(browser, { url, host, room, player, enforce = true }) {
  const tabs = [];
  const waitFor = async (check, label) => {
    const deadline = Date.now() + 6000;
    while (!await check()) { assert.ok(Date.now() < deadline, label); await sleep(25); }
  };
  try {
    const hostTab = await browser.page(url + '/host', 1280, 1080, { session: { sgHostKey: 'theme-regression', sgHostToken: room.hostToken, sgRoomCode: room.code } });
    tabs.push(hostTab);
    const playerTab = await browser.page(url + '/play?room=' + room.code, 390, 844, { session: { sgCode: room.code, sgPlayerKey: player.playerKey, sgPlayerId: player.playerId, sgPlayerName: 'Theme player' } });
    tabs.push(playerTab);
    const obsTab = await browser.page(url + '/screen/' + room.code, 1920, 1080);
    tabs.push(obsTab);
    await sleep(500);
    const beforeIdle = tabs.map(tab => ({ requests: tab.requests.length, frames: tab.sentFrames.length }));
    await sleep(3500);
    const metrics = {
      idleMs: 3500,
      idleThemeHttpRequests: tabs.map((tab, i) => tab.requests.slice(beforeIdle[i].requests).filter(themeRequest).length),
      idleThemeCommands: tabs.map((tab, i) => tab.sentFrames.slice(beforeIdle[i].frames).filter(themeFrame).length + tab.requests.slice(beforeIdle[i].requests).filter(request=>themeFrame(request.postData || '')).length),
    };
    const baseline = obsTab.requests.length;
    metrics.noopRendering = await obsTab.evaluate(`(() => {
      const nodes = [document.getElementById('halloweenHeader'), document.getElementById('halloweenCameras')];
      const emblem = document.querySelector('#halloweenHeader img');
      const observers = nodes.map(node => { const observer = new MutationObserver(() => {}); observer.observe(node, {subtree:true, childList:true, attributes:true, characterData:true}); return observer; });
      const started = performance.now();
      for (let i=0; i<500; i++) QuizTheme.renderOBS(state, app);
      const elapsedMs = performance.now()-started;
      const mutations = observers.reduce((sum, observer) => { const count=observer.takeRecords().length;observer.disconnect();return sum+count; }, 0);
      return { iterations:500, elapsedMs:Math.round(elapsedMs*100)/100, mutations, sameEmblem:emblem===document.querySelector('#halloweenHeader img') };
    })()`);
    await sleep(300);
    metrics.noopThemeHttpRequests = obsTab.requests.slice(baseline).filter(themeRequest).length;
    const photoTab = await browser.page(url + '/screen?preview=halloween&view=photo', 1920, 1080);
    tabs.push(photoTab);
    const photoBefore = photoTab.requests.length;
    metrics.photoRendering = await photoTab.evaluate(`(() => {
      QuizTheme.renderOBS(state, app);
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, {subtree:true, childList:true, attributes:true, characterData:true});
      const image = document.querySelector('.imageRevealImg');
      const started = performance.now();
      for(let i=0;i<500;i++) QuizTheme.renderOBS(state, app);
      const elapsedMs = performance.now()-started;
      const mutations = observer.takeRecords().length;observer.disconnect();
      return {iterations:500,elapsedMs:Math.round(elapsedMs*100)/100,mutations,sameImage:image===document.querySelector('.imageRevealImg')};
    })()`);
    await sleep(100);
    metrics.photoThemeHttpRequests = photoTab.requests.slice(photoBefore).filter(themeRequest).length;
    // The remaining counts are only for the three real room clients.
    const clients = tabs.slice(0,3);
    const beforeRepeat = clients.map(tab => tab.receivedFrames.length);
    for (let i=0;i<20;i++) {
      const result = await host.timeout(3000).emitWithAck('setUiTheme', { code:room.code, uiTheme:'halloween' });
      assert.equal(result.ok, true);
    }
    await sleep(100);
    metrics.duplicateThemeBroadcasts = clients.map((tab,i) => tab.receivedFrames.slice(beforeRepeat[i]).filter(frame=>frame.includes('"uiThemeChanged"')).length);
    const sentBefore = hostTab.sentFrames.length;
    const receivedBefore = clients.map(tab => tab.receivedFrames.length);
    await hostTab.evaluate('document.getElementById("toggleTheme").click()');
    await waitFor(async () => (await Promise.all(clients.map(tab => tab.evaluate('!document.body.dataset.uiTheme')))).every(Boolean), 'theme switch reaches all tabs');
    metrics.commandsPerClick = hostTab.sentFrames.slice(sentBefore).filter(themeFrame).length;
    const updates = clients.map((tab,i) => tab.receivedFrames.slice(receivedBefore[i]).filter(frame=>frame.includes('"uiThemeChanged"')));
    metrics.updatesPerScreen = updates.map(frames=>frames.length);
    metrics.maxThemeEventBytes = Math.max(...updates.flat().map(frame=>Buffer.byteLength(frame)));
    metrics.fullStateBroadcastsOnClick = clients.map((tab,i) => tab.receivedFrames.slice(receivedBefore[i]).filter(frame=>/\["state",/.test(frame)).length);
    for (const tab of tabs) assert.deepEqual(tab.errors, []);
    if (enforce) {
      assert.deepEqual(metrics.idleThemeHttpRequests, [0,0,0], 'theme has no idle HTTP polling');
      assert.deepEqual(metrics.idleThemeCommands, [0,0,0], 'theme has no idle socket polling');
      assert.equal(metrics.noopRendering.sameEmblem, true);
      assert.equal(metrics.noopRendering.mutations, 0, 'unchanged OBS does not rebuild its themed header/cameras');
      assert.equal(metrics.noopThemeHttpRequests, 0, '500 unchanged updates reload no theme assets');
      assert.equal(metrics.photoRendering.mutations, 0, 'photo layout and fitting are unchanged across identical updates');
      assert.equal(metrics.photoRendering.sameImage, true);
      assert.equal(metrics.photoThemeHttpRequests, 0);
      assert.deepEqual(metrics.duplicateThemeBroadcasts, [0,0,0], 'already selected theme is not broadcast again');
      assert.equal(metrics.commandsPerClick, 1);
      assert.deepEqual(metrics.updatesPerScreen, [1,1,1]);
      assert.deepEqual(metrics.fullStateBroadcastsOnClick, [0,0,0]);
      assert.ok(metrics.maxThemeEventBytes < 128, 'theme update is a small event, not the full game');
    }
    console.log('THEME_TRAFFIC: ' + JSON.stringify(metrics));
  } finally {
    // Restore the room for any following checks.
    await host.timeout(3000).emitWithAck('setUiTheme', { code:room.code, uiTheme:'halloween' });
    for (const tab of tabs) await tab.close();
  }
}
module.exports = { checkThemeTraffic };
