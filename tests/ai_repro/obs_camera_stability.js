// Real Edge geometry audit. Camera streams and the OBS compositor are NOT simulated.
// Usage: node tests/ai_repro/obs_camera_stability.js [--report]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');
const { startEdge } = require('./lib/edge');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = path.join(REPO_ROOT, 'archive/audits/obs-cameras-2026-10-30');
const report = process.argv.includes('--report');

const measure = `(() => {
  const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  const windows = [...document.querySelectorAll('#halloweenCameras .camera-window,#halloweenBroadcast .broadcast-window')];
  const regions = windows.map(el => ({
    key: el.closest('[data-camera-slot]')?.dataset.cameraSlot ?? el.closest('[data-obs-slot]').dataset.obsSlot,
    ...rect(el), visible: getComputedStyle(el).visibility !== 'hidden' && el.checkVisibility(),
  }));
  return {regions, main:rect(document.querySelector('body > .wrap')),
    owners:[...document.querySelectorAll('[data-camera-slot]')].map(el => el.dataset.playerId || null),
    stableColumn:document.getElementById('halloweenBroadcast') === window.auditColumn,
    stableHeader:document.getElementById('halloweenHeader') === window.auditHeader,
    navigations:performance.getEntriesByType('navigation').length,
    text:document.getElementById('app').textContent.trim()};
})()`;

function compareRegions(actual, baseline, label) {
  assert.equal(actual.regions.length, 7, `${label}: four players + host/chat/donations`);
  assert.deepEqual(actual.owners, baseline.owners, `${label}: fixed player ownership`);
  assert.ok(actual.stableColumn && actual.stableHeader, `${label}: column and header survive`);
  assert.equal(actual.navigations, baseline.navigations, `${label}: no document navigation`);
  for (let i = 0; i < actual.regions.length; i++) {
    const a = actual.regions[i], b = baseline.regions[i];
    assert.equal(a.key, b.key, `${label}: window ordering`);
    assert.ok(a.visible, `${label}/${a.key}: visible`);
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(a[key] - b[key]) < 0.5, `${label}/${a.key}/${key}: ${a[key]} vs ${b[key]}`);
    const m = actual.main;
    const overlap = Math.min(a.x+a.width,m.x+m.width)-Math.max(a.x,m.x) > 0.5
      && Math.min(a.y+a.height,m.y+m.height)-Math.max(a.y,m.y) > 0.5;
    assert.equal(overlap, false, `${label}/${a.key}: reserved game area stays outside windows`);
  }
  assert.ok(actual.text.length > 0, `${label}: game content rendered`);
}

async function main() {
  const server = await startServer({ HOST_KEY:'camera-audit' });
  const sockets = [], pages = [], results = {sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO_ROOT,encoding:'utf8'}).trim(), fixtures:[], live:[]};
  let browser;
  const connect = async () => {
    const s = io(server.url,{transports:['websocket'],reconnection:false}); sockets.push(s);
    await new Promise((resolve,reject) => {s.once('connect',resolve);s.once('connect_error',reject);});
    return s;
  };
  const ok = async (s,event,payload) => {
    const r = await s.timeout(5000).emitWithAck(event,payload);
    assert.equal(r.ok,true,`${event}: ${JSON.stringify(r)}`); return r;
  };
  const wait = async (page,expression,label) => {
    const end = Date.now()+8000;
    while (!await page.evaluate(expression)) { assert.ok(Date.now()<end,`Timeout: ${label}`); await sleep(25); }
  };
  try {
    if (report) fs.mkdirSync(directory,{recursive:true});
    browser = await startEdge({muteAudio:true});
    const host = await connect();
    const {code} = await ok(host,'createRoom',{hostKey:'camera-audit',hostToken:'camera-audit',gameId:'season2-grand-final'});
    const players = [];
    for (let i=0;i<4;i++) {
      const socket = await connect();
      players.push({socket,...await ok(socket,'joinPlayer',{code,name:`Camera ${i+1}`})});
    }
    await ok(host,'setUiTheme',{code,uiTheme:'halloween'});
    const live = await browser.page(server.url+'/screen/'+code,1920,1080,{ready:'document.readyState === "complete" && typeof state !== "undefined" && state?.players?.length === 4 && !!document.getElementById("halloweenCameras")'});
    pages.push(live);
    await live.evaluate('window.auditColumn=document.getElementById("halloweenBroadcast");window.auditHeader=document.getElementById("halloweenHeader");true');
    const liveBaseline = await live.evaluate(measure);
    const liveCheck = async label => { compareRegions(await live.evaluate(measure),liveBaseline,label); results.live.push(label); };
    await ok(host,'startGame',{code});
    await wait(live,'state.phase === "first_turn_quiz"','start'); await liveCheck('live-start');
    await ok(host,'togglePause',{code});
    await wait(live,'state.phase === "paused"','pause'); await liveCheck('live-pause');
    await ok(host,'togglePause',{code});
    await wait(live,'state.phase === "first_turn_quiz"','resume'); await liveCheck('live-resume');
    players[1].socket.disconnect();
    await wait(live,`!state.players.find(p=>p.id===${JSON.stringify(players[1].playerId)}).connected`,'player offline');
    await liveCheck('live-player-offline');
    await ok(await connect(),'joinPlayer',{code,playerKey:players[1].playerKey});
    await wait(live,`state.players.find(p=>p.id===${JSON.stringify(players[1].playerId)}).connected`,'player reconnect');
    await liveCheck('live-player-reconnect');
    await live.evaluate('socket.disconnect();true'); await liveCheck('live-screen-disconnect');
    await live.evaluate('socket.connect();true');
    await wait(live,'socket.connected','screen reconnect');
    const screenRejoin = await live.evaluate('new Promise(resolve=>socket.emit("joinScreen",{code},resolve))');
    assert.equal(screenRejoin.ok,true,'screen rejoins the same room');
    await liveCheck('live-screen-reconnect');
    await ok(host,'closeRoom',{code});
    await wait(live,'state === null && app.textContent.includes("ГРУ ЗАВЕРШЕНО")','closed');
    await liveCheck('live-room-closed');
    assert.deepEqual(live.errors,[],'live browser errors');
    console.log(`PASS: ${results.live.length} live transitions, player and screen reconnect, room close; fixed windows`);

    for (const [width,height] of [[1920,1080],[1280,720]]) {
      const page = await browser.page(server.url+'/screen?preview=halloween&view=board',width,height);
      pages.push(page); await page.activate();
      await page.evaluate('data.rounds.push(JSON.parse(JSON.stringify(data.rounds[0])));true');
      const base = await page.evaluate('JSON.parse(JSON.stringify(state))');
      const current = {type:'normal',questionType:'text',ci:0,qi:0,value:300,q:'Перевірка переходу питання',a:''};
      const ranking = base.players.map((p,i)=>({...p,answer:100+i,diff:i,score:1000-i*100,beforeScore:1000,bet:100,correct:true,finalAnswer:'Відповідь'}));
      const first = {question:'Розіграш',timerStatus:'running',remainingMs:30000,results:ranking,revealCount:4,submittedPlayerIds:[]};
      const numeric = {...first,question:'Числове питання',value:300,correctAnswer:100};
      const audience = {title:'Глядачі',joined:4,submitted:4,questionIndex:0,totalQuestions:3,question:'Питання глядачам',options:['А','Б','В','Г'],counts:[1,2,1,0],correct:1,remainingMs:15000,ranking:[],revealCount:0};
      const cases = [];
      const add = (label,patch={}) => cases.push([label,{...base,phase:'question',current,activeQuestion:current,firstTurnQuiz:first,numericChallenge:numeric,audience,finalResults:ranking,finalRevealCount:4,...patch}]);
      for (const phase of ['lobby','first_turn_quiz','first_turn_result','board','question','buzz','answering','result','paused','numeric_ready','numeric_question','numeric_result','audience_lobby','audience_question','audience_result','audience_podium','cat_choose','cat_question','va_bank_bet','va_bank_question','duel_choose','duel_question','final_bets','final_ready','final_question','final_review','final_result'])
        add(phase,{phase,paused:phase==='paused',revealAnswer:phase==='result'});
      add('long-question-and-answer',{phase:'result',revealAnswer:true,current:{...current,q:'Довге питання '.repeat(120),a:'Довга відповідь '.repeat(100)}});
      for (const revealStage of [0,1,2]) add('photo-'+revealStage,{current:{...current,questionType:'imageReveal',image:'/media/surprise_tibetan_fox.jpg',revealStage,revealValues:[300,200,100]}});
      for (const phase of ['question','buzz','answering','video_result']) add('video-'+phase,{phase,revealAnswer:phase==='video_result',current:{...current,questionType:'video',media:'/media/SMOKERLOL_GrandFinal_Ukrnet_Shtany_40_500_STOP.mp4',pauseAt:8,videoTime:0,videoPlaying:false}});
      add('audio',{current:{...current,questionType:'audio',media:'/media/halloween_r1_c3_100_thriller_excerpt.mp3',audioPlaying:false}});
      add('emoji',{current:{...current,questionType:'emoji',q:'🎃 👻 🦇'}});
      for (const phase of ['triplet_question','triplet_result']) add(phase,{phase,current:{...current,triplet:{index:1,total:3,baseValue:300,answererId:base.players[0].id,steps:[100,200,300],results:[]}}});
      add('round-2-board',{phase:'board',round:1});
      add('reordered-players',{players:[...base.players].reverse()});
      add('changed-names-scores',{players:base.players.map((p,i)=>({...p,name:'Довгеімягравця'.repeat(2).slice(0,20),score:i%2?-999999:999999}))});
      add('speaking',{voice:{speakingPlayerIds:base.players.map(p=>p.id)}});
      add('season-champion',{phase:'final_result',seasonCeremonyActive:true,seasonRevealCount:4,seasonFinal:{name:'СЕЗОН',championshipRule:'grand_final',leaderboard:ranking}});
      await page.evaluate('window.auditColumn=document.getElementById("halloweenBroadcast");window.auditHeader=document.getElementById("halloweenHeader");true');
      const baseline = await page.evaluate(measure);
      for (const r of baseline.regions) assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+0.5&&r.y+r.height<=height+0.5,`${width}/${r.key}: on screen`);
      for (const [label,snapshot] of cases) {
        await page.evaluate(`state=${JSON.stringify(snapshot)};render();true`);
        await page.evaluate('(async()=>{await document.fonts.ready;await Promise.allSettled([...document.images].map(img=>img.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})()');
        const result = await page.evaluate(measure);
        compareRegions(result,baseline,`${width}/${label}`);
        results.fixtures.push({width,height,label,regions:result.regions});
        if (report&&width===1920&&['board','photo-0','paused','final_result'].includes(label)) await page.screenshot(path.join(directory,label+'.png'));
      }
      // Switching the theme deliberately removes all Halloween frames. Independent
      // OBS sources must be repositioned or switched together with a scene preset.
      await page.evaluate('state.uiTheme=null;state.phase="board";render();true');
      assert.equal(await page.evaluate('document.querySelectorAll("#halloweenCameras,#halloweenBroadcast").length'),0);
      const standard = await page.evaluate('JSON.stringify(document.querySelector(".cameraSafe").getBoundingClientRect().toJSON())');
      for (const phase of ['question','paused','final_result']) {
        await page.evaluate(`state.phase=${JSON.stringify(phase)};render();true`);
        assert.equal(await page.evaluate('JSON.stringify(document.querySelector(".cameraSafe").getBoundingClientRect().toJSON())'),standard,`standard/${phase}: host camera area stays fixed`);
      }
      assert.deepEqual(page.errors,[],`${width}: no browser exceptions`);
      console.log(`PASS: ${width}x${height}: ${cases.length} layouts with unchanged window coordinates/owners, standard host area stable; theme change removes frames`);
    }
    results.passed = true;
    results.scope = 'Isolated Edge layout and Socket.IO only; no OBS compositor, real webcams, VDO.Ninja streams, audio routing or independent networks.';
    if (report) fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2)+'\n');
  } finally {
    for (const page of pages) await page.close().catch(()=>{});
    browser?.stop(); sockets.forEach(s=>s.disconnect()); server.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
