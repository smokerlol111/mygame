// Desktop Edge + isolated real server; silent playback, no live rooms or Discord.
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { startServer } = require('./lib/server');
const { startEdge } = require('./lib/edge');
const game = require('../../games/halloween_special_2026.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const server = await startServer(), tabs = [];
  let browser, control;
  const until = async (page, expression, label) => {
    const deadline = Date.now() + 9000;
    while (!await page.evaluate(expression)) {
      assert.ok(Date.now() < deadline, label);
      await sleep(25);
    }
  };
  try {
    control = io(server.url, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => { control.once('connect', resolve); control.once('connect_error', reject); });
    const room = await control.timeout(5000).emitWithAck('createRoom', { hostToken: 'player-audio-check', gameId: game.id });
    assert.ok(room.ok);
    browser = await startEdge({ muteAudio: true });
    const host = await browser.page(server.url + '/host', 1280, 900, {
      ready: 'document.readyState === "complete" && typeof state !== "undefined" && state?.phase === "lobby"', session: { sgHostToken: room.hostToken, sgRoomCode: room.code },
    });
    tabs.push(host);
    const player = await browser.page(server.url + '/play?room=' + room.code, 1280, 900, {
      ready: 'document.getElementById("join") !== null',
    });
    tabs.push(player);
    // A real login click supplies the normal desktop user interaction.
    await player.activate();
    await player.evaluate(`document.getElementById('name').value='Desktop audio';document.getElementById('join').click();true`, { userGesture: true });
    await until(player, 'joined && state?.phase === "lobby"', 'player login');
    console.log('PASS: desktop player joined');
    const command = async (event, extra = {}) => {
      const result = await host.evaluate(`socket.timeout(5000).emitWithAck(${JSON.stringify(event)},${JSON.stringify({ code: room.code, ...extra })})`);
      assert.ok(result.ok, event);
    };
    await command('skipFirstTurnQuiz');
    const ci = game.rounds[0].categories.findIndex(c => c.questions.some(q => q.type === 'audio'));
    const qi = game.rounds[0].categories[ci].questions.findIndex(q => q.type === 'audio');
    await command('chooseTile', { ci, qi });
    await until(player, 'state.current?.questionType === "audio" && playerAudio.readyState >= 2', 'audio loaded');
    const native = async expression => { await host.activate(); return host.evaluate(expression, { userGesture: true }); };
    const play = () => native("document.querySelector('audio.quizAudio').play().then(()=>true)");
    const pause = () => native("document.querySelector('audio.quizAudio').pause();true");
    const seek = time => native(`(async()=>{const e=document.querySelector('audio.quizAudio');e.currentTime=${time};await new Promise(r=>e.addEventListener('seeked',r,{once:true}));return true;})()`);

    await player.evaluate('playerAudio.volume=0.37;true');
    assert.ok(await player.evaluate("!playerAudio.controls && !playerAudio.checkVisibility()"), 'PLAYER has no visible audio player or native controls');
    assert.ok(await player.evaluate("(async()=>{await playerAudio.play().catch(()=>{});await new Promise(r=>setTimeout(r,50));return playerAudio.paused;})()", { userGesture: true }), 'local play is stopped until HOST permits playback');
    await player.evaluate('playerAudioEnable.click();true', { userGesture: true });
    assert.ok(await player.evaluate('playerAudio.paused'), 'sound permission button cannot start audio while HOST is paused');
    const rejected = await player.evaluate("socket.timeout(3000).emitWithAck('hostAudioControl',{code,action:'play',time:0})");
    assert.equal(rejected.ok, false, 'PLAYER cannot send HOST playback commands');
    await play();
    await until(player, '!playerAudio.paused && playerAudio.currentTime > 0', 'host starts desktop audio without a player play click');
    await pause();
    await until(player, 'playerAudio.paused', 'host pause');
    await seek(0.7);
    await until(player, 'Math.abs(playerAudio.currentTime-0.7)<0.08', 'host seek');
    await seek(0.8);
    await until(player, 'Math.abs(playerAudio.currentTime-0.8)<0.04', 'small explicit seek must not be discarded');
    assert.equal(await player.evaluate('playerAudio.volume'), 0.37, 'host preserves player volume');
    console.log('PASS: HOST-only audio, no PLAYER controls/local start, server authorization, play/pause/seek');

    await play();
    await until(player, '!playerAudio.paused', 'playing before routine states');
    assert.ok(await player.evaluate(`(async()=>{const e=playerAudio,t=e.currentTime,v=playerAudioControlVersion;for(let i=0;i<50;i++)await socket.listeners('state')[0](JSON.parse(JSON.stringify(state)));return e===playerAudio&&!e.paused&&e.currentTime>=t&&playerAudioControlVersion===v;})()`), 'routine states preserve playing node, position and command version');
    await player.evaluate('socket.disconnect();true');
    await pause();
    await seek(2);
    await player.evaluate('socket.connect();true');
    await until(player, 'socket.connected && playerAudio.paused && Math.abs(playerAudio.currentTime-2)<0.12', 'rejoin catches missed pause/seek');
    await player.evaluate('socket.disconnect();true');
    await play();
    await player.evaluate('socket.connect();true');
    await until(player, '!playerAudio.paused && playerAudio.currentTime>=2', 'rejoin recovers playing snapshot');
    console.log('PASS: 50 routine states and actual PLAYER reconnect paused/playing');

    await pause();
    await until(player, 'playerAudio.paused', 'paused before autoplay rejection');
    await player.evaluate("window.originalAudioPlay=playerAudio.play;playerAudio.play=()=>Promise.reject(new DOMException('Test autoplay denial','NotAllowedError'));true");
    await play();
    await until(player, '!playerAudioEnable.hidden && playerAudio.paused', 'autoplay refusal exposes recovery button');
    assert.ok(await player.evaluate("getComputedStyle(playerAudioEnable).display!=='none'"), 'recovery button visible');
    await sleep(500); // Recovery must catch up with HOST instead of starting from the rejected position.
    await player.activate();
    await player.evaluate('playerAudio.play=window.originalAudioPlay;playerAudioEnable.click();true', { userGesture: true });
    await until(player, '!playerAudio.paused && playerAudioEnable.hidden', 'recovery click starts the host-selected recording');
    const hostTime = await host.evaluate("document.querySelector('audio.quizAudio').currentTime");
    assert.ok(Math.abs(await player.evaluate('playerAudio.currentTime') - hostTime) < 0.35, 'recovery catches up with HOST');
    await pause();
    await until(player, 'playerAudio.paused && playerAudioEnable.hidden', 'host pause clears recovery notice');
    await player.evaluate('playerAudioEnable.click();true', { userGesture: true });
    assert.ok(await player.evaluate('playerAudio.paused'), 'permission click cannot replay audio after HOST pauses');
    console.log('PASS: controlled autoplay denial and click recovery');

    assert.ok(await player.evaluate(`(()=>{
      const receive=socket.listeners('audioControl')[0],cur=state.current;
      const command={code,media:cur.media,stage:Number(cur.revealStage||0),action:'play',time:0,sentAt:Date.now()};
      const version=playerAudioControlVersion;
      for(const change of [{code:'WRONG'},{media:'/media/wrong.mp3'},{stage:99},{action:'invalid'},{time:-1}])receive({...command,...change});
      if(playerAudioControlVersion!==version||!playerAudio.paused)return false;
      Object.defineProperty(playerAudio,'readyState',{configurable:true,get:()=>0});
      receive({...command,action:'pause',time:1});
      receive({...command,action:'pause',time:3});
      delete playerAudio.readyState;
      playerAudio.dispatchEvent(new Event('loadedmetadata'));
      return playerAudio.paused&&Math.abs(playerAudio.currentTime-3)<0.04;
    })()`), 'invalid/stale context and superseded metadata callbacks cannot override latest command');
    console.log('PASS: command context checks and superseded metadata callbacks');
    for (const page of tabs) assert.deepEqual(page.errors, [], 'no browser exceptions');
    console.log('PASS: desktop audio recovery checks (isolated Edge; physical audio/OBS not tested)');
  } finally {
    for (const page of tabs) await page.close().catch(() => {});
    browser?.stop();
    control?.disconnect();
    server.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
