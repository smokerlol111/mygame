// Local preflight: actual Edge pages, actual Grand Final content, isolated data.
// Rendering fixtures complement grand_final_smoke.js; they do not play a real match.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { startServer, REPO_ROOT } = require('./lib/server');
const { startEdge } = require('./lib/edge');
const game = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'games/season2_grand_final.json'), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const appearance = `(() => [...document.querySelectorAll('body,.wrap,#app,#app *')]
  .filter(el => !el.matches('script')).map(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return [el.tagName,el.id,el.className,[r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10),
      ...['color','backgroundColor','backgroundImage','fontFamily','fontSize','fontWeight','lineHeight',
      'display','position','padding','border','gap','overflow','maxWidth'].map(key=>s[key])];
  }))()`;

async function main() {
  const server = await startServer({ HOST_KEY: 'standard-preflight' });
  const sockets = [], pages = [];
  let browser;
  const connect = async () => {
    const s = io(server.url, { transports:['websocket'], reconnection:false }); sockets.push(s);
    await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
    return s;
  };
  const ok = async (s,event,payload) => {
    const r = await s.timeout(5000).emitWithAck(event,payload);
    assert.equal(r.ok,true,`${event}: ${JSON.stringify(r)}`);return r;
  };
  try {
    const host = await connect();
    const room = await ok(host,'createRoom',{hostKey:'standard-preflight',hostToken:'standard-preflight',gameId:game.id});
    const participants = [];
    for(let i=0;i<4;i++) participants.push(await ok(await connect(),'joinPlayer',{code:room.code,name:['Андрій','Олена','Макс','Іра'][i]}));
    browser = await startEdge();
    const configs = [
      {role:'host',route:'/host',width:1280,height:900,session:{sgHostKey:'standard-preflight',sgHostToken:'standard-preflight',sgRoomCode:room.code}},
      {role:'player',route:'/play?room='+room.code,width:390,height:844,session:{sgCode:room.code,sgPlayerId:participants[0].playerId,sgPlayerKey:participants[0].playerKey,sgPlayerName:'Андрій'}},
      {role:'obs',route:'/screen/'+room.code,width:1920,height:1080},
    ];
    for(const c of configs) {
      const page = await browser.page(server.url+c.route,c.width,c.height,{session:c.session,touch:c.role==='player',
        ready:'document.readyState === "complete" && typeof state !== "undefined" && state?.phase === "lobby" && document.getElementById("app").textContent.trim().length > 0'});
      pages.push({page,...c});
      assert.equal(await page.evaluate('state.uiTheme === null && !document.body.dataset.uiTheme && !window.QuizPreview'),true,`${c.role}: real standard room`);
    }
    const hostPage = pages[0].page;
    // Use the browser's real authenticated HOST socket, after it reconnects.
    const command = async (event,extra={}) => {
      const result = await hostPage.evaluate(`socket.timeout(5000).emitWithAck(${JSON.stringify(event)},${JSON.stringify({code:room.code,...extra})})`);
      assert.equal(result.ok,true,`${event}: ${JSON.stringify(result)}`);return result;
    };
    for(const theme of ['halloween',null]) {
      await command('setUiTheme',{uiTheme:theme});
      for(const {page,role} of pages) {
        for(let i=0;i<80 && !await page.evaluate(`(state.uiTheme || null) === ${JSON.stringify(theme)}`);i++) await sleep(25);
        assert.equal(await page.evaluate('(state.uiTheme || null)'),theme,`${role}: live theme change`);
      }
    }
    await command('startGame');
    for(const {page,role} of pages) {
      for(let i=0;i<80 && !await page.evaluate('state.phase === "first_turn_quiz"');i++) await sleep(25);
      assert.equal(await page.evaluate('state.phase'),'first_turn_quiz',`${role}: actual game starts`);
      // Freeze transport while rendering fixtures; actual command traversal is covered separately.
      await page.evaluate('socket.disconnect();true');
    }
    const base = await hostPage.evaluate('state');
    base.players.forEach((p,i)=>{p.score=1000+i*100;p.syncReady=true;p.connected=true;});
    base.turnPlayerId=base.players[0].id;
    const artifactDir = path.join(REPO_ROOT,'archive/audits/grand-final-standard-2026-10-28');
    if(process.argv.includes('--screenshots')) fs.mkdirSync(artifactDir,{recursive:true});
    let checks=0, images=0;
    const inspect = async (patch,label) => {
      const snapshot={...base,phase:'question',current:null,activeQuestion:null,firstTurnQuiz:null,...patch,uiTheme:null};
      for(const {page,role} of pages) {
        await page.activate();
        await page.evaluate(`state=${JSON.stringify(snapshot)};render();${role==='host'?'renderRoom();':''}`);
        const result = await page.evaluate(`(async()=>{
          await document.fonts.ready;
          const imgs=[...document.querySelectorAll('#app img,#playerImageRevealImg')];
          await Promise.all(imgs.map(img=>img.decode()));
          await Promise.all([...document.querySelectorAll('video,audio')].filter(el=>el.getAttribute('src')).map(el=>new Promise((resolve,reject)=>{
            if(el.readyState>=1)return resolve();
            const t=setTimeout(()=>reject(new Error('UI media metadata timeout: '+el.getAttribute('src'))),8000);
            el.addEventListener('loadedmetadata',()=>{clearTimeout(t);resolve();},{once:true});
            el.addEventListener('error',()=>{clearTimeout(t);reject(new Error('UI media decode error'));},{once:true});
          })));
          return {theme:document.body.dataset.uiTheme||null,
            decorations:!!document.querySelector('#halloweenHeader,#halloweenCameras,#halloweenBroadcast,#halloweenIdentity'),
            overflow:document.documentElement.scrollWidth>innerWidth+1,images:imgs.length,
            text:document.getElementById('app').textContent.trim()};
        })()`);
        assert.equal(result.theme,null,`${role}/${label}: standard theme`);
        assert.equal(result.decorations,false,`${role}/${label}: no Halloween decorations`);
        assert.ok(result.text.length,`${role}/${label}: visible UI`);
        assert.ok(!/undefined|NaN/.test(result.text),`${role}/${label}: complete display values`);
        assert.equal(result.overflow,false,`${role}/${label}: no horizontal page overflow`);
        // Both samples run in one JS task so video metadata/timers cannot change
        // layout between samples and masquerade as a stylesheet regression.
        const [before,without]=await page.evaluate(`(()=>{
          const capture=()=>${appearance};
          const sheet=document.querySelector('link[href="/themes/halloween/theme.css"]').sheet;
          const before=capture();sheet.disabled=true;
          try{return [before,capture()];}finally{sheet.disabled=false;}
        })()`);
        assert.deepEqual(before,without,`${role}/${label}: Halloween stylesheet leaves standard content unchanged`);
        assert.deepEqual(page.errors,[],`${role}/${label}: no browser exceptions`);
        images+=result.images;checks++;
        if(process.argv.includes('--screenshots') && ['board','photo','final-result'].includes(label)) await page.screenshot(path.join(artifactDir,`${role}-${label}.png`));
      }
    };
    await inspect({phase:'lobby'},'lobby');
    await inspect({phase:'board'},'board');
    await inspect({phase:'first_turn_quiz',firstTurnQuiz:{...base.firstTurnQuiz,timerStatus:'ready'}},'first-turn');
    await inspect({phase:'paused',paused:true,pausedPhase:'board'},'paused');
    let photoCaptured=false;
    for(let ri=0;ri<game.rounds.length;ri++) for(let ci=0;ci<5;ci++) for(let qi=0;qi<5;qi++) {
      const q=game.rounds[ri].categories[ci].questions[qi];
      const cur={...q,type:'normal',questionType:q.type||null,ci,qi,a:'',revealStage:0,videoTime:0,videoPlaying:false,audioPlaying:false};
      if(q.type==='numericClosest') {
        const n={question:q.q,unit:q.unit||'',value:q.value,remainingMs:30000,submittedPlayerIds:[],revealCount:4,
          correctAnswer:q.numericAnswer,results:base.players.map((p,i)=>({...p,answer:q.numericAnswer+i,diff:i,noAnswer:false}))};
        for(const phase of ['numeric_ready','numeric_question','numeric_result'])await inspect({phase,round:ri,current:cur,numericChallenge:n},phase);
        continue;
      }
      if(q.type==='triplet') {
        for(let index=0;index<q.triplet.length;index++) {
          const part=q.triplet[index],triplet={index,total:q.triplet.length,baseValue:q.value,answererId:base.players[0].id,steps:q.triplet.map(p=>p.value),results:[]};
          for(const phase of ['triplet_question','triplet_result'])await inspect({phase,round:ri,revealAnswer:phase==='triplet_result',
            current:{...cur,q:part.q,a:phase==='triplet_result'?part.a:'',value:part.value,triplet}},`${phase}-${index}`);
        }
        continue;
      }
      const label=!photoCaptured&&q.type==='imageReveal'?'photo':`${ri}:${ci}:${qi}`;
      if(label==='photo')photoCaptured=true;
      await inspect({round:ri,current:cur,activeQuestion:cur,board:game.rounds[ri].categories.map(c=>({name:c.name,questions:c.questions.map(q=>({value:q.value}))}))},label);
    }
    const finalCurrent={type:'normal',q:game.final.q||game.final.question,a:'',value:0};
    await inspect({phase:'final_bets'},'final-bets');
    await inspect({phase:'final_ready',current:finalCurrent},'final-ready');
    await inspect({phase:'final_question',current:finalCurrent,finalSeconds:30},'final-input');
    await inspect({phase:'final_review',current:{...finalCurrent,a:game.final.a||game.final.answer}},'final-review');
    await inspect({phase:'final_result',current:finalCurrent,finalRevealCount:4,
      finalResults:base.players.map((p,i)=>({...p,score:4000-i*500,beforeScore:4000-i*500+(i===0?-100:100),place:i+1,bet:100,correct:i===0,finalAnswer:'Тест'}))},'final-result');
    console.log(`PASS: ${checks} actual Edge HOST/PLAYER/OBS renders, ${images} decoded question images, standard colors/layout unchanged by Halloween CSS; live default room, start and two-way theme change`);

    // Decode images and the start of each recording, independently of UI fixture transport.
    const assets=new Set();
    const collect=obj=>Object.values(obj).forEach(v=>{if(typeof v==='string'&&v.startsWith('/')&&/\.(mp4|mp3|jpe?g|png)$/i.test(v))assets.add(v);else if(v&&typeof v==='object')collect(v);});
    collect(game);
    await hostPage.activate();
    const decoded=await hostPage.evaluate(`(async()=>{
      const out=[];
      for(const src of ${JSON.stringify([...assets])}) {
        if(/\\.(jpg|jpeg|png)$/i.test(src)){const img=new Image();img.src=src;await img.decode();out.push({src,width:img.naturalWidth,height:img.naturalHeight});continue;}
        const el=document.createElement(/\\.mp4$/i.test(src)?'video':'audio');el.muted=true;el.preload='auto';el.src=src;document.body.append(el);
        try {
          await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Media timeout: '+src+' ready='+el.readyState+' network='+el.networkState+' duration='+el.duration+' error='+el.error?.code)),12000);el.onloadeddata=()=>{clearTimeout(t);resolve();};el.onerror=()=>{clearTimeout(t);reject(new Error('Decode error '+src+': '+el.error?.code));};});
          await el.play();await new Promise(r=>setTimeout(r,120));
          if(!(el.currentTime>0))throw new Error('Playback did not advance: '+src);
          out.push({src,duration:el.duration,time:el.currentTime,width:el.videoWidth||0,height:el.videoHeight||0});
        }finally{el.pause();el.removeAttribute('src');el.load();el.remove();}
      }return out;
    })()`,{userGesture:true});
    for(const round of game.rounds)for(const c of round.categories)for(const q of c.questions)if(q.type==='video') {
      const item=decoded.find(v=>v.src===q.media);assert.ok(item&&item.duration>q.pauseAt,`${q.media}: STOP is inside video duration`);
    }
    console.log(`PASS: all ${decoded.length} Grand Final image/audio/video paths decode in Edge and each audio/video advances during muted playback; every configured STOP is inside its file`);
    const stops=[];
    for(let ri=0;ri<game.rounds.length;ri++)for(let ci=0;ci<5;ci++)for(let qi=0;qi<5;qi++) {
      const q=game.rounds[ri].categories[ci].questions[qi];if(q.type!=='video')continue;
      const cur={...q,type:'normal',questionType:'video',ci,qi,a:'',videoTime:0,videoPlaying:false};
      await hostPage.evaluate(`state=${JSON.stringify({...base,uiTheme:null,phase:'question',round:ri,current:cur,activeQuestion:cur})};render();true`);
      const stop=await hostPage.evaluate(`(async()=>{
        const el=document.querySelector('video.quizVideo');el.muted=true;el.preload='auto';
        await new Promise((resolve,reject)=>{if(el.readyState>=2)return resolve();const t=setTimeout(()=>reject(new Error('STOP media timeout')),8000);el.onloadeddata=()=>{clearTimeout(t);resolve();};el.onerror=()=>{clearTimeout(t);reject(new Error('STOP media decode error'));};});
        el.currentTime=${q.pauseAt}-0.3;
        await new Promise(resolve=>el.addEventListener('seeked',resolve,{once:true}));
        await el.play();const end=Date.now()+4000;
        while(!el.paused && Date.now()<end)await new Promise(r=>setTimeout(r,30));
        return {src:el.getAttribute('src'),expected:${q.pauseAt},actual:el.currentTime,paused:el.paused};
      })()`,{userGesture:true});
      assert.ok(stop.paused&&Math.abs(stop.actual-stop.expected)<0.08,`${q.media}: native playback stops at configured mark: ${JSON.stringify(stop)}`);
      stops.push(stop);
    }
    console.log(`PASS: all ${stops.length} actual HOST video players pause at their configured STOP during native Edge playback (seek to 0.3 s before the mark; tolerance 0.08 s)`);
    if(process.argv.includes('--screenshots')) fs.writeFileSync(path.join(artifactDir,'results.json'),JSON.stringify({sourceCommit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:REPO_ROOT,encoding:'utf8'}).trim(),renders:checks,imageRenders:images,decoded,stops},null,2)+'\n');
  } finally {
    for(const {page} of pages)await page.close().catch(()=>{});
    if(browser)browser.stop();sockets.forEach(s=>s.disconnect());server.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
