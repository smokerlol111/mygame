// Real Edge HOST/PLAYER/OBS + isolated server; native silent playback, no live room/Discord.
// node tests/ai_repro/media_live_regression.js [--report]
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {io}=require('socket.io-client');
const {startServer,REPO_ROOT}=require('./lib/server');
const {startEdge}=require('./lib/edge');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const selector='video.quizVideo,audio.quizAudio';
async function main(){
 const server=await startServer(),sockets=[],tabs=[];let browser;
 const report={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:REPO_ROOT,encoding:'utf8'}).trim(),workingTree:true,checks:[]};
 const connect=async()=>{const s=io(server.url,{transports:['websocket'],reconnection:false});sockets.push(s);await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j);});return s;};
 const ok=async(s,e,p)=>{const r=await s.timeout(5000).emitWithAck(e,p);assert.equal(r.ok,true,e+JSON.stringify(r));return r;};
 const until=async(page,expr,label)=>{const end=Date.now()+9000;while(!await page.evaluate(expr)){assert.ok(Date.now()<end,label);await sleep(25);}};
 const native=async(page,expression)=>{await page.activate();return page.evaluate(expression,{userGesture:true});};
 try{
  browser=await startEdge({muteAudio:true});
  for(const file of ['halloween_special_2026','season2_grand_final']){
   const game=require('../../games/'+file+'.json'),control=await connect();
   const room=await ok(control,'createRoom',{hostToken:'media-'+file,gameId:game.id});
   const p=await ok(await connect(),'joinPlayer',{code:room.code,name:'Media player'});
   await ok(control,'skipFirstTurnQuiz',{code:room.code});
   const ready='document.readyState === "complete" && typeof state !== "undefined" && state?.phase === "board"';
   const host=await browser.page(server.url+'/host',1280,900,{ready,session:{sgHostToken:room.hostToken,sgRoomCode:room.code}});tabs.push(host);
   const player=await browser.page(server.url+'/play?room='+room.code,390,844,{ready,session:{sgCode:room.code,sgPlayerKey:p.playerKey,sgPlayerId:p.playerId,sgPlayerName:'Media player'}});tabs.push(player);
   const obs=await browser.page(server.url+'/screen/'+room.code,1920,1080,{ready});tabs.push(obs);
   const command=async(event,extra={})=>{
    const payload=JSON.stringify({code:room.code,...extra});
    if(['revealAnswer','nextFromResult'].includes(event))return host.evaluate(`socket.emit(${JSON.stringify(event)},${payload});true`);
    const r=await host.evaluate(`socket.timeout(5000).emitWithAck(${JSON.stringify(event)},${payload})`);assert.equal(r.ok,true,event+JSON.stringify(r));return r;
   };
   const read=page=>page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {paused:e.paused,time:e.currentTime,src:e.getAttribute('src')};})()`);
   for(let ri=0;ri<game.rounds.length;ri++){
    if(ri)await command('nextRound');
    for(let ci=0;ci<game.rounds[ri].categories.length;ci++)for(let qi=0;qi<game.rounds[ri].categories[ci].questions.length;qi++){
     const q=game.rounds[ri].categories[ci].questions[qi];if(!['audio','audioReveal','video'].includes(q.type))continue;
     if(process.argv.includes('--only-reveal')&&q.type!=='audioReveal')continue;
     if(process.argv.includes('--only-combined')&&!(q.type==='audio'&&q.image))continue;
     await command('chooseTile',{ci,qi});
     for(const page of [host,player,obs])await until(page,`state.current?.media === ${JSON.stringify(q.media)} && ["question","buzz"].includes(state.phase)`,'media question reaches all screens');
     if(q.image)for(const page of [host,obs])assert.ok(await page.evaluate(`(async()=>{const img=[...document.images].find(el=>el.getAttribute('src')===${JSON.stringify(q.image)});if(!img)throw new Error('Missing audio clue image');await img.decode();return img.naturalWidth>0;})()`),'audio clue image decodes');
     const framesBeforeOld=host.sentFrames.length;
     await host.evaluate(`if(window.previousMedia){previousMedia.dispatchEvent(new Event('play'));previousMedia.dispatchEvent(new Event('pause'));previousMedia.dispatchEvent(new Event('seeked'));}true`);
     await sleep(30);
     assert.equal(host.sentFrames.slice(framesBeforeOld).filter(f=>f.includes('"hostAudioControl"')||f.includes('"hostVideoControl"')).length,0,'detached old media cannot control the new question');
     const tag=q.type==='video'?'video':'audio',playerSelector=q.type==='video'?'#playerVideo':'#playerAudio';
     for(const [page,sel]of [[host,selector],[player,playerSelector],[obs,selector]]){
      const decoded=await native(page,`(async()=>{const e=document.querySelector(${JSON.stringify(sel)});e.muted=false;e.volume=0;await new Promise((r,j)=>{if(e.readyState>=2)return r();const t=setTimeout(()=>j(new Error('media load '+e.getAttribute('src'))),7000);e.addEventListener('loadeddata',()=>{clearTimeout(t);r();},{once:true});e.addEventListener('error',()=>j(new Error('media decode')),{once:true});});await e.play();await new Promise(r=>setTimeout(r,80));e.pause();return {duration:e.duration,time:e.currentTime};})()`);
      assert.ok(decoded.duration>0&&decoded.time>0,'native '+tag+' decode/playback');
     }
     await native(host,`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});e.currentTime=0.15;await new Promise(r=>e.addEventListener('seeked',r,{once:true}));await e.play();return true;})()`);
     await until(obs,`!document.querySelector(${JSON.stringify(selector)}).paused`,'HOST native play reaches OBS');
     if(q.type!=='video')await native(player,`document.querySelector('#playerAudio').play().then(()=>true)`);
     const before=await read(host),sent=host.sentFrames.length;
     const preserved=await host.evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});for(let i=0;i<50;i++){const s=JSON.parse(JSON.stringify(state));s.players.forEach(p=>{p.networkRttMs=i+30;p.syncReady=!!(i%2);});await socket.listeners('state')[0](s);}socket.listeners('voiceBotStatus')[0]({code,status:'connecting'});socket.listeners('voiceSpeaking')[0]({code,playerIds:state.players.map(p=>p.id)});return {same:e===document.querySelector(${JSON.stringify(selector)}),paused:e.paused,time:e.currentTime};})()`);
     assert.ok(preserved.same&&!preserved.paused&&preserved.time>=before.time-0.1,'service updates preserve playing media');
     assert.equal(host.sentFrames.slice(sent).filter(f=>f.includes('"hostAudioControl"')||f.includes('"hostVideoControl"')).length,0,'service updates send no media commands');
     await host.evaluate('restoreHostConnection();true');await sleep(120);
     const restored=await read(host);assert.ok(!restored.paused&&restored.time>=before.time-0.1,'HOST reconnect keeps playback position');
     await native(host,`document.querySelector(${JSON.stringify(selector)}).pause();true`);
     await until(obs,`document.querySelector(${JSON.stringify(selector)}).paused`,'HOST pause reaches OBS');
     if(q.type!=='video')assert.equal(await player.evaluate('document.querySelector("#playerAudio").paused'),false,'PLAYER audio remains locally controlled');
     await native(host,`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});e.currentTime=0.7;await new Promise(r=>e.addEventListener('seeked',r,{once:true}));return true;})()`);
     await until(obs,`Math.abs(document.querySelector(${JSON.stringify(selector)}).currentTime-0.7)<0.12`,'HOST seek reaches OBS');
     if(q.type==='audioReveal'){
      for(let stage=0;stage<q.revealValues.length;stage++){
       if(stage){
        if(stage===1)await native(host,"(async()=>{const e=document.querySelector('audio.quizAudio');e.currentTime=0.2;await new Promise(r=>e.addEventListener('seeked',r,{once:true}));await e.play();return true;})()");
        await command('revealAudioStep');for(const page of [host,player,obs])await until(page,`state.current.revealStage === ${stage}`,'next audio fragment');
        for(const page of [host,obs]){const v=await read(page);assert.ok(v.paused&&v.time<0.15,'new audio fragment starts paused from zero');}
        assert.ok(await player.evaluate("document.querySelector('#playerAudio').currentTime<0.15"),'PLAYER fragment resets too');
       }
       const last=stage===q.revealValues.length-1;
       const stopped=await native(host,`(async()=>{const e=document.querySelector('audio.quizAudio');e.muted=true;e.currentTime=${last?q.revealSeconds[stage-1]+0.2:q.revealSeconds[stage]-0.25};await new Promise(r=>e.addEventListener('seeked',r,{once:true}));await e.play();await new Promise(r=>setTimeout(r,800));return {paused:e.paused,time:e.currentTime,duration:e.duration};})()`);
       if(stage<q.revealValues.length-1)assert.ok(stopped.paused&&Math.abs(stopped.time-q.revealSeconds[stage])<0.12,'audio fragment STOP '+stage);
       else assert.ok(!stopped.paused&&stopped.time>q.revealSeconds[stage-1],'final audio fragment is unrestricted: '+JSON.stringify(stopped));
       await native(host,"document.querySelector('audio.quizAudio').pause();true");
      }
     }
     if(q.type==='video'){
      const stop=await native(host,`(async()=>{const e=document.querySelector('video.quizVideo');e.muted=true;e.currentTime=${q.pauseAt}-0.25;await new Promise(r=>e.addEventListener('seeked',r,{once:true}));await e.play();await new Promise(r=>setTimeout(r,800));return {paused:e.paused,time:e.currentTime};})()`);
      assert.ok(stop.paused&&Math.abs(stop.time-q.pauseAt)<0.12,'native video STOP');
     }
     if(q.type==='audio'){
      await native(host,`(async()=>{const e=document.querySelector('audio.quizAudio');e.currentTime=0.05;await new Promise(r=>e.addEventListener('seeked',r,{once:true}));await e.play();return true;})()`);
      await until(obs,"!document.querySelector('audio.quizAudio').paused",'OBS plays before answerer');
      const pressed=await player.evaluate(`socket.timeout(3000).emitWithAck('buzz',{code})`);assert.equal(pressed.ok,true,'PLAYER buzz');
      await until(host,'state.phase === "answering"','player begins answering');
      assert.equal((await read(host)).paused,true,'HOST automatically pauses audio for answerer');
      await until(obs,"document.querySelector('audio.quizAudio').paused",'answerer pause reaches OBS');
     }
     await command('revealAnswer');await until(host,'state.phase === "result"','answer phase');
     assert.equal(await host.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('src')`),q.media,'answer keeps question media');
     if(q.type==='video'&&q.resumeOnAnswer===true){
      await until(host,`!document.querySelector('video.quizVideo').paused && document.querySelector('video.quizVideo').currentTime>${q.pauseAt}`,'video resumes after answer');
      await until(obs,"!document.querySelector('video.quizVideo').paused",'OBS continues after answer');
     }
     if(q.answerAudioFile){
      await native(host,'document.getElementById("playQuestionAnswerAudio").click();true');
      await until(host,'hostQuestionAnswerAudio.currentTime>0 && !hostQuestionAnswerAudio.paused','HOST answer cue');
      await until(obs,'obsQuestionAnswerAudio.currentTime>0 && !obsQuestionAnswerAudio.paused','OBS answer cue');
      await host.evaluate('hostQuestionAnswerAudio.pause();true');await obs.evaluate('obsQuestionAnswerAudio.pause();true');
     }
     await host.evaluate(`window.previousMedia=document.querySelector(${JSON.stringify(selector)});true`);
     await command('nextFromResult');for(const page of [host,player,obs])await until(page,'state.phase === "board"','back to board');
     assert.equal(await host.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),false,'media removed on board');
     for(const page of [host,player,obs])assert.deepEqual(page.errors,[],'no browser exceptions');
     report.checks.push({gameId:game.id,round:ri,ci,qi,type:q.type,media:q.media,passed:true});
     console.log(`PASS ${game.id} ${ri}:${ci}:${qi} ${q.type}: native decode, controls, 50 service updates, reconnect, answer and board`);
    }
   }
   for(const page of [host,player,obs]){await page.close();tabs.splice(tabs.indexOf(page),1);}
  }
  report.passed=true;report.scope='Isolated real Edge, silent native playback and server commands; no actual OBS/audio output/phones/live Discord.';
  if(process.argv.includes('--report')){const dir=path.join(REPO_ROOT,'archive/audits/media-regression-2026-10-31');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(`PASS: all ${report.checks.length} media questions`);
 }finally{for(const tab of tabs)await tab.close().catch(()=>{});browser?.stop();sockets.forEach(s=>s.disconnect());server.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
