// Actual desktop Edge geometry, inert preview and isolated server; no live room/OBS.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { io } = require('socket.io-client');
const { startServer } = require('./lib/server');
const { startEdge } = require('./lib/edge');
const game = require('../../games/halloween_special_2026.json');
const measure = `(() => {
  const app = document.getElementById('app'), frame = app.getBoundingClientRect();
  const outside = [];
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
    const node = walker.currentNode;
    if(!node.textContent.trim() || !node.parentElement.checkVisibility())continue;
    const range = document.createRange();range.selectNodeContents(node);
    const local = node.parentElement.closest('.obsFitViewport')?.getBoundingClientRect() || frame;
    for(const r of range.getClientRects())if(r.width && r.height && [frame,local].some(box=>r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>box.bottom+1))outside.push(node.textContent.slice(0,70));
  }
  const scrollable = [app,...app.querySelectorAll('*')].filter(e=>e.checkVisibility()&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).map(e=>e.className);
  const windows = [...document.querySelectorAll('#halloweenCameras .camera-window,#halloweenBroadcast .broadcast-window')].map(e=>e.getBoundingClientRect().toJSON());
  return {outside,scrollable,windows,question:app.querySelector('.question')?.textContent,timer:app.querySelector('#firstTurnTimer')?.textContent};
})()`;
async function main() {
  const server = await startServer(), pages = [], sockets = [];
  let browser;
  try {
    browser = await startEdge({ muteAudio: true });
    for(const [width,height] of [[1920,1080],[1280,720],[1024,576]]) {
      const page = await browser.page(server.url+'/screen?preview=halloween&view=text',width,height);
      pages.push(page);
      const base = await page.evaluate('JSON.parse(JSON.stringify(state))');
      const firstTurnQuiz = {...game.firstTurnQuiz,remainingMs:30000,timerStatus:'ready',submittedPlayerIds:[]};
      const numericResults = [1,3,0,2].map((index,place)=>({id:base.players[index].id,name:base.players[index].name,answer:[1430,1430,1400,1500][place],diff:[1.5,1.5,31.5,68.5][place]}));
      const numericResult = {correctAnswer:1431.5,unit:'кг',value:400,answerImage:'/media/halloween_r1_c4_400_pumpkin_reveal.jpg',results:numericResults};
      const cases = [
        ['first-turn-ready',{phase:'first_turn_quiz',firstTurnQuiz}],
        ['first-turn-running',{phase:'first_turn_quiz',firstTurnQuiz:{...firstTurnQuiz,timerStatus:'running'}}],
        ['first-turn-expired',{phase:'first_turn_quiz',firstTurnQuiz:{...firstTurnQuiz,timerStatus:'expired'}}],
        ['long-question',{phase:'question',current:{...base.current,questionType:'text',image:'',q:'Довге запитання з усіма подробицями. '.repeat(45)}}],
        ['long-result',{phase:'result',revealAnswer:true,current:{...base.current,questionType:'text',image:'',q:'Довге запитання. '.repeat(45),a:'Пояснення правильної відповіді. '.repeat(35)}}],
        ['numeric',{phase:'numeric_question',numericChallenge:{question:game.firstTurnQuiz.question,remainingMs:30000,value:400,submittedPlayerIds:[]}}],
        ...[0,1,2,3,4].map(revealCount=>['numeric-result-'+revealCount,{phase:'numeric_result',numericChallenge:{...numericResult,revealCount}}]),
        ['numeric-no-answers',{phase:'numeric_result',numericChallenge:{...numericResult,revealCount:4,results:base.players.map(p=>({id:p.id,name:p.name,noAnswer:true,diff:null}))}}],
        ['audience',{phase:'audience_question',audience:{question:game.firstTurnQuiz.question,remainingMs:30000,options:['Перший варіант','Другий варіант','Третій варіант','Четвертий варіант']}}],
      ];
      const baseline = (await page.evaluate(measure)).windows;
      for(const [label,patch] of cases) {
        await page.evaluate(`state=${JSON.stringify({...base,...patch})};render();true`);
        await page.evaluate('render();true'); // Identical state renders create fresh content too.
        await page.evaluate('(async()=>{await document.fonts.ready;await Promise.allSettled([...document.images].map(img=>img.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})()');
        const result = await page.evaluate(measure);
        assert.deepEqual(result.outside,[],`${width}/${label}: every text line stays inside question window`);
        assert.deepEqual(result.scrollable,[],`${width}/${label}: no scrolling`);
        assert.deepEqual(result.windows,baseline,`${width}/${label}: camera/chat/donation windows stay fixed`);
        if(label.startsWith('first-turn'))assert.equal(result.question,game.firstTurnQuiz.question,'full original question retained');
        if(label==='first-turn-running')assert.match(result.timer,/^(29|30)$/,'timer remains visible');
        if(label.startsWith('numeric-result-')) {
          const count=Number(label.slice(-1));
          assert.equal(await page.evaluate("document.querySelectorAll('.numericResultRow').length"),count,'only HOST-revealed rows are shown');
          assert.equal(await page.evaluate("!!document.querySelector('.numericWinner')"),count===4,'winner is announced on HOST final reveal');
          if(count===4)assert.ok(await page.evaluate(`document.querySelector('.numericWinner').textContent.includes(${JSON.stringify(numericResults[0].name)}) && document.querySelector('.numericWinner').textContent.includes('+400') && document.querySelector('.numericTie').textContent.includes('раніше')`),'winner banner shows server-selected name, award and tie rule');
          else assert.equal(await page.evaluate(`document.querySelector('.numericResult').textContent.includes(${JSON.stringify(numericResults[0].name)})`),false,'winner name stays hidden before reveal');
        }
        if(label==='numeric-no-answers')assert.ok(await page.evaluate("!document.querySelector('.numericWinner') && document.querySelector('.numericResult').textContent.includes('бали не нараховано')"),'no invented winner when nobody answered');
        if(label==='first-turn-ready'&&width===1280&&process.argv.includes('--screenshot')) {
          const file=path.join(os.tmpdir(),'smokerlol-obs-first-turn-fit.png');await page.screenshot(file);console.log('SCREENSHOT '+file);
        }
        if(label==='numeric-result-4'&&width===1280&&process.argv.includes('--screenshot')) {
          const file=path.join(os.tmpdir(),'smokerlol-obs-numeric-winner.png');await page.screenshot(file);console.log('SCREENSHOT '+file);
        }
        console.log(`PASS ${width}x${height} ${label}: all text fits, no scrolling, fixed camera windows`);
      }
      // A resize must refit the existing content, without replacing it or rerendering state.
      await page.evaluate("window.originalQuestion=document.querySelector('.question');window.originalPanel=document.querySelector('.obsFitContent');document.querySelector('body>.wrap').style.bottom='40vh';true");
      await page.evaluate('new Promise(r=>setTimeout(r,100))');
      const resized=await page.evaluate(measure);
      assert.deepEqual(resized.outside,[],`${width}: refit after available area changes`);
      assert.ok(await page.evaluate("originalQuestion===document.querySelector('.question') && originalPanel===document.querySelector('.obsFitContent')"),'refit preserves content nodes');
      assert.deepEqual(page.errors,[],'no browser exceptions');
    }
    // Traverse the real numeric lifecycle, including equal-distance answers.
    const connect = async () => {
      const socket=io(server.url,{transports:['websocket'],reconnection:false});sockets.push(socket);
      await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;
    };
    const ok = async (socket,event,payload) => {const result=await socket.timeout(5000).emitWithAck(event,payload);assert.ok(result.ok,event);return result;};
    const host=await connect(),room=await ok(host,'createRoom',{hostToken:'numeric-winner-check',gameId:game.id});
    const players=[];
    for(let i=0;i<4;i++){const socket=await connect();const joined=await ok(socket,'joinPlayer',{code:room.code,name:'Numeric '+i});players.push({socket,...joined});}
    await ok(host,'skipFirstTurnQuiz',{code:room.code});
    const ci=game.rounds[0].categories.findIndex(c=>c.questions.some(q=>q.numericAnswer===1431.5));
    const qi=game.rounds[0].categories[ci].questions.findIndex(q=>q.numericAnswer===1431.5);
    await ok(host,'chooseTile',{code:room.code,ci,qi});
    await ok(host,'startNumericTimer',{code:room.code});
    for(let i=0;i<4;i++){await ok(players[i].socket,'submitNumericAnswer',{code:room.code,answer:[1400,1430,1500,1430][i]});await new Promise(r=>setTimeout(r,5));}
    await ok(host,'finishNumericQuestion',{code:room.code});
    const live=await browser.page(server.url+'/screen/'+room.code,1280,720,{ready:'document.readyState === "complete" && !!document.querySelector(".numericResult")'});pages.push(live);
    for(let count=0;count<=4;count++){
      if(count)await ok(host,'revealNextNumeric',{code:room.code});
      const deadline=Date.now()+5000;
      while(!await live.evaluate(`state.numericChallenge.revealCount===${count}`)){assert.ok(Date.now()<deadline,'live reveal reaches OBS');await new Promise(r=>setTimeout(r,20));}
      assert.equal(await live.evaluate('document.querySelectorAll(".numericResultRow").length'),count);
      assert.equal(await live.evaluate('!!document.querySelector(".numericWinner")'),count===4);
    }
    assert.ok(await live.evaluate(`state.numericChallenge.results[0].id===${JSON.stringify(players[1].playerId)} && state.players.find(p=>p.id===${JSON.stringify(players[1].playerId)}).score===400 && document.querySelector('.numericWinner').textContent.includes('Numeric 1') && !!document.querySelector('.numericTie')`),'OBS announces actual server winner and existing 400-point award; earlier equal answer wins');
    assert.deepEqual((await live.evaluate(measure)).outside,[],'live numeric winner fully fits');
    assert.deepEqual(live.errors,[],'no live browser exceptions');
    console.log('PASS real numeric question: 4 submissions, HOST reveals, server tie winner and award match OBS');
  } finally {
    for(const page of pages)await page.close().catch(()=>{});
    browser?.stop();sockets.forEach(s=>s.disconnect());server.stop();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
