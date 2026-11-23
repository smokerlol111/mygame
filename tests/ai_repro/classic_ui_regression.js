// Real headless Edge, isolated server, synthetic prompts only. No approved trivia added.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');
const { startEdge } = require('./lib/edge');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const artifacts = process.env.QUIZ_TEST_ARTIFACT_DIR || path.join(REPO_ROOT, 'archive/audits/classic-quiz-2026-11-22', 'ui-' + Date.now());
fs.mkdirSync(artifacts, {recursive:true});

async function until(page, expression) {
  const deadline = Date.now()+10000;
  while (!await page.evaluate(expression)) {
    if (Date.now()>deadline) {
      console.error(await page.evaluate('JSON.stringify({phase:window.ClassicUI?.state?.phase,notice:document.getElementById("notice")?.textContent,media:[...document.querySelectorAll("audio,video")].map(x=>({src:x.src,ready:x.readyState,network:x.networkState,error:x.error?.message}))})'));
      throw new Error('UI timeout: '+expression);
    }
    await sleep(60);
  }
}
async function main() {
  const server = await startServer({HOST_KEY:'classic-ui'});
  let edge, second;
  const extraTeams=[];
  const pages=[];
  try {
    edge = await startEdge({muteAudio:true});
    async function page(route,width=1440,height=1000) {
      const value=await edge.page(server.url+route,width,height,{ready:'document.readyState === "complete" && !!window.ClassicUI?.socket.connected'});
      pages.push(value);return value;
    }
    let host=await page('/classic/host?key=classic-ui');
    const beforeLegacy = host.sentFrames.filter(frame=>frame.includes('"classicRandomPool"')).length;
    await host.evaluate(`window.originalFetch=window.fetch;window.fetch=(resource,options)=>resource==='/api/capabilities'?Promise.resolve(new Response('',{status:404})):window.originalFetch(resource,options);document.getElementById('randomPool').click()`);
    await until(host,'document.getElementById("notice").textContent.toLowerCase().includes("перезапустіть")');
    assert.equal(host.sentFrames.filter(frame=>frame.includes('"classicRandomPool"')).length,beforeLegacy,'old server gets no unsupported socket request');
    assert.equal(await host.evaluate('document.getElementById("randomPool").disabled'),false,'retry remains available');
    await host.evaluate(`window.fetch=window.originalFetch;document.getElementById('randomCount').value='30';document.getElementById('randomPool').click()`);
    await until(host,'document.querySelectorAll("#poolQuestions li").length === 30 && !document.getElementById("create").disabled');
    assert.equal(await host.evaluate('!!ClassicUI.state'),false,'generating a pool does not create a room');
    assert.equal(await host.evaluate('document.querySelectorAll("#poolQuestions small").length'),30,'original IDs shown for preview');
    assert.ok(await host.evaluate('Number(document.getElementById("randomCount").max)')>=100);
    await host.evaluate(`document.getElementById('poolPreview').open=true`);
    await host.screenshot(path.join(artifacts,'random-pool-preview.png'));
    const fixture={title:'UI TEST FIXTURE',questions:[
      {id:'ui-text',q:'FIXTURE TEXT PROMPT <script>',a:'PRIVATE TEXT ANSWER',points:2},
      {id:'ui-audio',q:'FIXTURE AUDIO PROMPT',a:'PRIVATE AUDIO ANSWER',type:'audio',media:'/media/halloween_music_results.wav'},
      {id:'ui-image',q:'FIXTURE IMAGE PROMPT',a:'PRIVATE IMAGE ANSWER',type:'image',media:'/media/ads.jpg'},
      {id:'ui-video',q:'FIXTURE VIDEO PROMPT',a:'PRIVATE VIDEO ANSWER',type:'video',media:'/media/GrandFinal_MemeForensics_Chipmunk_800_STOP.mp4'},
    ]};
    await host.evaluate(`(async()=>{const input=document.getElementById('poolFile');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.json',{type:'application/json'}));input.files=transfer.files;await input.onchange();document.getElementById('create').click();})()`);
    await until(host,'!!ClassicUI.state');
    const code=await host.evaluate('ClassicUI.room');
    assert.equal(await host.evaluate('location.search'),'','HOST key removed from URL');
    const captain=await page('/play?room='+code,390,844);
    assert.equal(await captain.evaluate('location.pathname'),'/classic/play','regular player entrance detects the classic room');
    await captain.activate();
    await captain.evaluate(`document.getElementById('name').value='UI CAPTAIN';document.getElementById('joinForm').requestSubmit()`,{userGesture:true});
    await until(captain,'!!ClassicUI.team');
    second=io(server.url,{transports:['websocket'],reconnection:false});
    await new Promise((resolve,reject)=>{second.once('connect',resolve);second.once('connect_error',reject);});
    const call=(event,payload={})=>second.timeout(4000).emitWithAck(event,{code,...payload});
    const joined=await call('classicJoinTeam',{name:'SOCKET CAPTAIN'});assert.equal(joined.ok,true);
    for(let i=0;i<6;i++) {
      const team=io(server.url,{transports:['websocket'],reconnection:false});extraTeams.push(team);
      await new Promise((resolve,reject)=>{team.once('connect',resolve);team.once('connect_error',reject);});
      assert.equal((await team.timeout(4000).emitWithAck('classicJoinTeam',{code,name:'FIXTURE TEAM '+i})).ok,true);
    }
    const screen=await page('/screen/'+code,1920,1080);
    await until(screen,'!!ClassicUI.state');
    assert.equal(await screen.evaluate('location.pathname'),'/classic/screen/'+code);
    await until(host,'ClassicUI.state.teams.length === 8');
    assert.equal(await screen.evaluate('document.getElementById("teams").hidden'),true,'no permanent scoreboard');
    await host.evaluate(`document.getElementById('start').click()`);
    await until(captain,'ClassicUI.state.phase === "classic_ready"');
    assert.equal(await captain.evaluate('document.getElementById("questionText").textContent'),fixture.questions[0].q,'prompt escaped as text');
    assert.equal(await captain.evaluate('document.body.textContent.includes("PRIVATE TEXT ANSWER")'),false);
    assert.equal(await screen.evaluate('JSON.stringify(ClassicUI.state).includes("PRIVATE AUDIO ANSWER")'),false);
    await host.evaluate(`document.getElementById('open').click()`);
    await until(captain,'!document.getElementById("send").disabled');
    await captain.evaluate(`const answer=document.getElementById('answer');answer.focus();answer.value='UI PRIVATE RESPONSE';answer.dispatchEvent(new Event('input'))`);
    const key=await host.evaluate('ClassicUI.state.questionKey');
    assert.equal((await call('classicSubmitAnswer',{questionKey:key,answer:'SOCKET PRIVATE RESPONSE'})).ok,true);
    await until(host,'ClassicUI.host.answers.filter(x=>x.submitted).length === 1');
    assert.deepEqual(await captain.evaluate(`({value:document.getElementById('answer').value,focus:document.activeElement.id})`),{value:'UI PRIVATE RESPONSE',focus:'answer'},'draft and keyboard focus survive other team updates');
    assert.equal(await captain.evaluate('document.body.textContent.includes("SOCKET PRIVATE RESPONSE")'),false);
    await host.evaluate(`document.getElementById('pause').click()`);
    await until(captain,'ClassicUI.state.phase === "classic_paused"');
    assert.equal(await captain.evaluate('document.getElementById("send").disabled'),true);
    await host.screenshot(path.join(artifacts,'host-paused.png'));
    await host.evaluate(`document.getElementById('pause').click()`);
    await until(captain,'!document.getElementById("send").disabled');
    await captain.evaluate(`document.getElementById('answerForm').requestSubmit()`);
    await until(captain,'!!ClassicUI.team.submitted');
    await captain.evaluate('ClassicUI.socket.disconnect();ClassicUI.socket.connect();true');
    await until(captain,'ClassicUI.socket.connected && !!ClassicUI.team.submitted');
    assert.equal(await captain.evaluate('document.getElementById("answer").value'),'UI PRIVATE RESPONSE');
    await host.close();
    host=await page('/classic/host');
    await until(host,'ClassicUI.host?.answers.filter(x=>x.submitted).length === 2');
    await host.evaluate(`document.getElementById('closeAnswers').click()`);
    await until(host,'ClassicUI.state.phase === "classic_review"');
    await until(host,'document.querySelectorAll("[data-team]").length === 4');
    assert.equal(await host.evaluate('document.getElementById("reveal").disabled'),true);
    await host.evaluate(`document.querySelector('[data-correct="true"]').click()`);
    await until(host,'ClassicUI.host.answers.filter(x=>x.correct === true).length === 1');
    await host.evaluate(`document.querySelector('[data-correct="false"]:not([disabled])').click()`);
    // Choose decisions by team ID explicitly because rows can re-render between clicks.
    const ownId=await captain.evaluate('ClassicUI.team.teamId');
    await host.evaluate(`(async()=>{for(const answer of ClassicUI.host.answers)if(answer.submitted)await ClassicUI.request('classicJudgeAnswer',{teamId:answer.teamId,correct:answer.teamId===${JSON.stringify(ownId)}})})()`);
    await until(host,'!document.getElementById("reveal").disabled');
    await host.screenshot(path.join(artifacts,'host-review.png'));
    await host.evaluate(`document.getElementById('reveal').click()`);
    await until(captain,'ClassicUI.state.phase === "classic_result"');
    assert.equal(await captain.evaluate('document.getElementById("revealedAnswer").textContent'),'PRIVATE TEXT ANSWER');
    assert.equal(await host.evaluate('ClassicUI.host.standings[0].score'),2);
    assert.equal(await captain.evaluate('ClassicUI.state.teams.find(x=>x.id===ClassicUI.team.teamId).score'),undefined);
    assert.equal(await captain.evaluate('document.getElementById("presentation").hidden'),true,'no table after a non-boundary question');
    await captain.screenshot(path.join(artifacts,'captain-result-390.png'));
    await screen.screenshot(path.join(artifacts,'screen-result-1920.png'));
    assert.equal(await captain.evaluate('document.documentElement.scrollWidth > innerWidth'),false,'mobile has no horizontal overflow');
    await host.evaluate(`document.getElementById('next').click()`);
    await captain.activate();
    await until(captain,'!!document.querySelector("audio")');
    await until(captain,'document.querySelector("audio").readyState >= 1');
    assert.equal(await captain.evaluate('document.querySelector("audio").controls'),false);
    assert.equal(await captain.evaluate('document.querySelector("audio").paused'),true);
    await captain.evaluate(`document.getElementById('allowSound').click()` ,{userGesture:true});
    assert.equal(await captain.evaluate('document.querySelector("audio").paused'),true,'unlock does not start media without HOST');
    await host.evaluate(`document.getElementById('mediaPlay').click()`,{userGesture:true});
    await until(captain,'ClassicUI.state.media.playing');
    await captain.evaluate(`document.getElementById('allowSound').click()`,{userGesture:true});
    await until(captain,'!document.querySelector("audio").paused');
    await host.evaluate(`document.getElementById('mediaPause').click()`);
    await until(captain,'document.querySelector("audio").paused && !ClassicUI.state.media.playing');
    await host.evaluate(`document.getElementById('mediaPosition').value='0.2';document.getElementById('mediaSeek').click()`);
    await until(captain,'Math.abs(document.querySelector("audio").currentTime-0.2)<0.04');
    assert.equal(await captain.evaluate(`(()=>{const media=document.querySelector('audio');for(let i=0;i<50;i++)ClassicUI.setState(ClassicUI.state);return media===document.querySelector('audio')&&media.paused&&Math.abs(media.currentTime-0.2)<0.04})()`),true,'routine states preserve media and small explicit seek');
    await host.evaluate(`document.getElementById('open').click()`);
    await until(host,'ClassicUI.state.phase === "classic_question"');
    await until(captain,'!document.getElementById("send").disabled');
    await captain.evaluate(`document.getElementById('answer').value='AUTOMATIC UNSENT RESPONSE';document.getElementById('answer').dispatchEvent(new Event('input'))`);
    await until(captain,'document.getElementById("answerStatus").textContent.includes("Чернетку збережено")');
    await captain.evaluate(`localStorage.removeItem('classicDraft:'+ClassicUI.room+':'+ClassicUI.state.questionKey);document.getElementById('answer').value='';ClassicUI.socket.disconnect();ClassicUI.socket.connect();true`);
    await until(captain,'ClassicUI.socket.connected && document.getElementById("answer").value === "AUTOMATIC UNSENT RESPONSE"');
    await host.evaluate(`document.getElementById('closeAnswers').click()`);
    await until(host,'ClassicUI.state.phase === "classic_review"');
    await until(captain,'ClassicUI.team.autoSubmitted === true');
    assert.equal(await captain.evaluate('document.getElementById("answer").value'),'AUTOMATIC UNSENT RESPONSE');
    assert.equal(await host.evaluate('ClassicUI.host.answers.find(x=>x.submitted).autoSubmitted'),true);
    await host.evaluate(`document.querySelector('[data-correct="false"]').click()`);
    await until(host,'!document.getElementById("reveal").disabled');
    await host.evaluate(`document.getElementById('reveal').click()`);
    await until(host,'ClassicUI.state.phase === "classic_result"');
    for (const type of ['image','video']) {
      await host.evaluate(`document.getElementById('next').click()`);
      await until(host,'ClassicUI.state.phase === "classic_standings"');
      await until(screen,'ClassicUI.state.phase === "classic_standings"');
      assert.equal(await screen.evaluate('document.querySelectorAll("#presentation tbody tr").length'),8);
      assert.equal(await screen.evaluate('document.getElementById("question").hidden'),true,'standalone table replaces the question');
      assert.equal(await screen.evaluate('scrollY === 0 && document.documentElement.scrollHeight <= innerHeight'),true,'standings fit the OBS viewport');
      await screen.screenshot(path.join(artifacts,'standings-after-'+(type==='image'?2:3)+'-1920.png'));
      await captain.screenshot(path.join(artifacts,'standings-after-'+(type==='image'?2:3)+'-390.png'));
      await host.evaluate(`document.getElementById('continue').click()`);
      const tag=type==='image'?'img':'video';
      await until(captain,`ClassicUI.state.question?.type === '${type}' && !!document.querySelector('#media ${tag}')`);
      await captain.screenshot(path.join(artifacts,'captain-'+type+'-390.png'));
      await until(screen,`ClassicUI.state.question?.type === '${type}'`);
      await screen.screenshot(path.join(artifacts,'screen-'+type+'-1920.png'));
      assert.equal(await screen.evaluate('document.documentElement.scrollHeight > innerHeight'),false,'OBS '+type+' fits 1080p');
      await host.evaluate(`document.getElementById('open').click()`);
      await until(host,'ClassicUI.state.phase === "classic_question"');
      await host.evaluate(`document.getElementById('closeAnswers').click()`);
      await until(host,'ClassicUI.state.phase === "classic_review"');
      await host.evaluate(`document.getElementById('reveal').click()`);
      await until(host,'ClassicUI.state.phase === "classic_result"');
    }
    await host.evaluate(`document.getElementById('next').click()`);
    await until(host,'ClassicUI.state.phase === "classic_final"');
    await until(screen,'ClassicUI.state.phase === "classic_final"');
    assert.equal(await screen.evaluate('ClassicUI.state.teams.every(x=>x.score===undefined)'),true,'ceremony does not leak scores');
    await host.evaluate(`document.getElementById('revealPlace').click()`);
    await until(screen,'ClassicUI.state.ceremony.revealCount === 1');
    assert.equal(await screen.evaluate('ClassicUI.state.ceremony.latest[0].place'),2);
    assert.equal(await screen.evaluate('document.getElementById("presentation").textContent.includes("UI CAPTAIN")'),false,'winner is hidden until its turn');
    await screen.screenshot(path.join(artifacts,'final-last-place-1920.png'));
    await host.close();host=await page('/classic/host');
    await until(host,'ClassicUI.state?.ceremony?.revealCount === 1');
    await host.evaluate(`document.getElementById('revealPlace').click()`);
    await until(host,'ClassicUI.state.phase === "classic_finished"');
    await until(screen,'ClassicUI.state.phase === "classic_finished"');
    assert.equal(await screen.evaluate('document.querySelector(".ceremony-winner .ceremony-name").textContent'),'UI CAPTAIN');
    assert.equal(await screen.evaluate('scrollY === 0 && document.documentElement.scrollHeight <= innerHeight'),true,'winner and header fit the OBS viewport');
    await screen.screenshot(path.join(artifacts,'final-winner-1920.png'));
    assert.equal(await host.evaluate('document.getElementById("export").hidden'),false);
    assert.equal(await host.evaluate('ClassicUI.host.history.length'),4);
    const exported=await host.evaluate(`(async()=>{let exported;URL.createObjectURL=blob=>{exported=blob;return 'blob:fixture'};HTMLAnchorElement.prototype.click=function(){};document.getElementById('export').click();return JSON.parse(await exported.text())})()`);
    assert.equal(exported.questions.length,4);assert.equal(exported.teams.length,8);
    assert.equal(exported.teams[0].score,2);
    assert.equal(exported.questions[1].results.find(x=>x.name==='UI CAPTAIN').autoSubmitted,true);
    assert.equal(JSON.stringify(exported).includes('hostToken'),false);
    const narrow=await page('/classic/play?room='+code,320,740);
    await until(narrow,'ClassicUI.state?.phase === "classic_finished"');
    assert.equal(await narrow.evaluate('document.documentElement.scrollWidth > innerWidth'),false,'320px mobile has no horizontal overflow');
    await narrow.screenshot(path.join(artifacts,'captain-finished-320.png'));
    for (const item of pages) assert.deepEqual(item.errors,[],'no browser runtime exceptions');
    fs.writeFileSync(path.join(artifacts,'summary.json'),JSON.stringify({status:'PASS',code,checks:['JSON file upload','HOST reload','captain reconnect','draft/focus','server draft restoration','automatic unsent answer','separate thirds tables','hidden ordinary scores','last-to-first final ceremony','ceremony HOST reload','private responses','judging','scores','text/image/audio/video','HOST-only media','mobile layout','1080p OBS layout','finished export'],screenshots:fs.readdirSync(artifacts).filter(x=>x.endsWith('.png'))},null,2));
    console.log('PASS: random existing-question preview, real Edge HOST/captain/OBS flow, JSON upload, draft/focus preservation, reconnect, judging, scores, native media control and responsive layout');
    console.log('ARTIFACTS: '+path.relative(REPO_ROOT,artifacts));
  } finally {
    second?.disconnect();
    extraTeams.forEach(team=>team.disconnect());
    for(const item of pages) {try{await item.close();}catch{}}
    edge?.stop();server.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
