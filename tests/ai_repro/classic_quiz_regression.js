// Synthetic labels only: these are not new trivia or approved question-bank content.
const assert = require('node:assert/strict');
const path = require('node:path');
const { io: client } = require('socket.io-client');
const { createClassicMode } = require('../../server/modes/classic');
const { validatePool } = require('../../server/modes/classic/pool');
const { checkpoints } = require('../../server/modes/classic/standings');
const { startServer, REPO_ROOT } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pool = (count=2) => ({title:'CLASSIC TEST FIXTURE',questions:Array.from({length:count},(_,i)=>({id:'fixture-'+i,q:'FIXTURE_PROMPT_'+i,a:'FIXTURE_PRIVATE_ANSWER_'+i}))});

function clockChecks() {
  for (const [count, expected] of [[1,[]],[2,[1]],[3,[1,2]],[4,[2,3]],[10,[4,7]],[47,[16,32]]])
    assert.deepEqual(checkpoints(count),expected,'thirds for pool size '+count);
  assert.equal(validatePool(pool(47),REPO_ROOT).questions.length,47,'pool is not limited to 30');
  assert.throws(()=>validatePool({title:'x',questions:[]},REPO_ROOT));
  assert.throws(()=>validatePool({title:'x',questions:[{q:'x',a:'y',points:-1}]},REPO_ROOT));
  assert.throws(()=>validatePool({title:'x',questions:[{q:'x',a:'y',type:'video',media:'/../.env'}]},REPO_ROOT));
  let now=10000, sequence=0, roomSequence=0;
  const timers=new Map(),rooms=new Map(),events=[];
  const clock={Date:{now:()=>now},setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);}};
  const advance=ms=>{const target=now+ms;for(;;){const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=target;};
  const io={sockets:{sockets:new Map()},to:target=>({emit:(event,value)=>events.push({target,event,value})})};
  const mode=createClassicMode({io,rooms,code:()=>String(++roomSequence).padStart(4,'X'),hostKeyOk:key=>key==='test',rootDir:REPO_ROOT,clock});
  function socket(id){const handlers=new Map();const value={id,data:{},on:(event,fn)=>handlers.set(event,fn),join(){},leave(){},emit(){}};io.sockets.sockets.set(id,value);mode.register(value);return{value,call(event,payload={}){let result;handlers.get(event)(payload,answer=>{result=answer;});return result;}};}
  const host=socket('host'),stranger=socket('stranger');
  const created=host.call('classicCreateRoom',{hostKey:'test',pool:pool()});assert.equal(created.ok,true);
  const code=created.code,room=rooms.get(code);
  const teams=Array.from({length:5},(_,i)=>{const s=socket('team'+i);const joined=s.call('classicJoinTeam',{code,name:'T'+i});assert.equal(joined.ok,true);return{...s,...joined};});
  assert.equal(stranger.call('classicStart',{code}).ok,false);
  assert.equal(host.call('classicStart',{code}).ok,true);
  let questionKey=room.classic.questionKey;
  const invoke=(s,event,extra={})=>s.call(event,{code,questionKey,...extra});
  assert.equal(invoke(teams[0],'classicSubmitAnswer',{answer:'early'}).ok,false);
  assert.equal(invoke(host,'classicOpenAnswers').ok,true);
  assert.equal(room.classic.endsAt-now,60000);
  assert.equal(invoke(teams[0],'classicSubmitAnswer',{answer:'TEAM_ZERO_PRIVATE'}).ok,true);
  assert.equal(invoke(teams[0],'classicSubmitAnswer',{answer:'replace'}).ok,false);
  assert.equal(invoke(teams[0],'classicSaveDraft',{answer:'replace final'}).ok,false);
  assert.equal(invoke(teams[2],'classicSaveDraft',{answer:'DRAFT OLD'}).ok,true);
  assert.equal(invoke(teams[3],'classicSaveDraft',{answer:'REMOVED'}).ok,true);
  assert.equal(invoke(teams[3],'classicSaveDraft',{answer:''}).ok,true);
  assert.equal(invoke(teams[4],'classicSaveDraft',{answer:'   '}).ok,true);
  for(const event of events.filter(event=>event.target===code&&event.event==='state')) {
    assert.equal(JSON.stringify(event.value).includes('FIXTURE_PRIVATE_ANSWER_'),false);
    assert.equal(JSON.stringify(event.value).includes('TEAM_ZERO_PRIVATE'),false);
  }
  advance(20000);assert.equal(invoke(host,'classicTogglePause').ok,true);advance(100000);
  assert.equal(room.phase,'classic_paused');assert.equal(room.classic.remainingMs,40000);
  assert.equal(invoke(teams[1],'classicSubmitAnswer',{answer:'paused'}).ok,false);
  assert.equal(invoke(teams[2],'classicSaveDraft',{answer:'paused change'}).ok,false);
  assert.equal(invoke(host,'classicTogglePause').ok,true);advance(39999);
  assert.equal(invoke(teams[1],'classicSubmitAnswer',{answer:'LAST_MILLISECOND'}).ok,true);
  assert.equal(invoke(teams[2],'classicSaveDraft',{answer:'DRAFT LAST MILLISECOND'}).ok,true);
  advance(1);assert.equal(room.phase,'classic_review');
  assert.equal(room.classic.answers[teams[2].teamId].text,'DRAFT LAST MILLISECOND');
  assert.equal(room.classic.answers[teams[2].teamId].autoSubmitted,true);
  assert.equal(room.classic.answers[teams[3].teamId],undefined);
  assert.equal(room.classic.answers[teams[4].teamId],undefined);
  assert.equal(invoke(teams[2],'classicSaveDraft',{answer:'late draft overwrite'}).ok,false);
  assert.equal(invoke(teams[2],'classicSubmitAnswer',{answer:'late'}).ok,false);
  assert.equal(invoke(host,'classicReveal').ok,false,'unjudged submitted answers block scoring');
  assert.equal(invoke(host,'classicJudgeAnswer',{teamId:teams[0].teamId,correct:true}).ok,true);
  assert.equal(invoke(host,'classicJudgeAnswer',{teamId:teams[1].teamId,correct:false}).ok,true);
  assert.equal(invoke(host,'classicJudgeAnswer',{teamId:teams[2].teamId,correct:false}).ok,true);
  assert.equal(room.players[0].score,0,'judgment changes do not apply points prematurely');
  assert.equal(invoke(host,'classicReveal').ok,true);assert.equal(room.players[0].score,1);
  assert.equal(invoke(host,'classicReveal').ok,false);assert.equal(room.players[0].score,1,'double reveal never doubles points');
  const oldKey=questionKey;assert.equal(invoke(host,'classicNextQuestion').ok,true);
  assert.equal(room.phase,'classic_standings');assert.equal(mode.publicState(room).standings.length,5);
  assert.equal(invoke(host,'classicNextQuestion').ok,false,'duplicate next cannot skip the separate table');
  assert.equal(invoke(host,'classicContinue').ok,true);questionKey=room.classic.questionKey;
  assert.notEqual(questionKey,oldKey);
  assert.equal(invoke(host,'classicOpenAnswers',{questionKey:oldKey}).ok,false);
  invoke(host,'classicOpenAnswers');
  assert.equal(invoke(teams[0],'classicSubmitAnswer',{questionKey:oldKey,answer:'stale'}).ok,false);
  invoke(teams[1],'classicSubmitAnswer',{answer:'SECOND'});invoke(host,'classicCloseAnswers');
  invoke(host,'classicJudgeAnswer',{teamId:teams[1].teamId,correct:true});invoke(host,'classicReveal');invoke(host,'classicNextQuestion');
  assert.equal(room.phase,'classic_final');
  assert.equal(mode.publicState(room).teams.every(team=>team.score===undefined),true,'final scores not leaked before opening');
  assert.equal(invoke(stranger,'classicRevealNextPlace',{revealCount:0}).ok,false);
  assert.equal(invoke(host,'classicRevealNextPlace',{revealCount:0}).ok,true);
  assert.equal(invoke(host,'classicRevealNextPlace',{revealCount:0}).ok,false,'duplicate reveal is rejected');
  assert.equal(mode.publicState(room).ceremony.latest[0].place,3,'last tied place opens first');
  assert.equal(invoke(host,'classicRevealNextPlace',{revealCount:1}).ok,true);
  const final=mode.publicState(room);assert.equal(final.phase,'classic_finished');assert.equal(final.questionNumber,2);
  assert.deepEqual(final.teams.filter(team=>team.place===1).map(team=>team.score),[1,1],'ties share place');
  assert.equal(room.classic.history.length,2);
  invoke(host,'classicCloseRoom');assert.equal(timers.size,0);
  // A late packet must be rejected even if the event loop has not run the timeout callback yet.
  const second=host.call('classicCreateRoom',{hostKey:'test',pool:pool(1)}),secondCode=second.code;
  const p=socket('deadline-team');p.call('classicJoinTeam',{code:secondCode,name:'Deadline'});
  host.call('classicStart',{code:secondCode});const key=rooms.get(secondCode).classic.questionKey;
  host.call('classicOpenAnswers',{code:secondCode,questionKey:key});now+=60001;
  assert.equal(p.call('classicSubmitAnswer',{code:secondCode,questionKey:key,answer:'late event'}).ok,false);
  assert.equal(rooms.get(secondCode).phase,'classic_review');host.call('classicCloseRoom',{code:secondCode});
  assert.equal(timers.size,0);
  const ten=host.call('classicCreateRoom',{hostKey:'test',pool:pool(10)}),tenRoom=rooms.get(ten.code);
  const tenTeam=socket('ten-team');tenTeam.call('classicJoinTeam',{code:ten.code,name:'Ten'});
  const tenCall=(event,extra={})=>host.call(event,{code:ten.code,questionKey:tenRoom.classic.questionKey,...extra});
  tenCall('classicStart');
  const shown=[];
  for(let i=1;i<=10;i++) {
    assert.equal(tenRoom.phase,'classic_ready');tenCall('classicOpenAnswers');tenCall('classicCloseAnswers');tenCall('classicReveal');
    assert.equal(mode.publicState(tenRoom).teams[0].score,undefined,'ordinary results hide cumulative scores');
    tenCall('classicNextQuestion');
    if(tenRoom.phase==='classic_standings') {
      shown.push(i);assert.equal(mode.publicState(tenRoom).question,null);
      assert.equal(mode.publicState(tenRoom).standings[0].score,0);tenCall('classicContinue');
    }
  }
  assert.deepEqual(shown,[4,7]);assert.equal(tenRoom.phase,'classic_final');
  tenCall('classicRevealNextPlace',{revealCount:0});assert.equal(tenRoom.phase,'classic_finished');tenCall('classicCloseRoom');
  console.log('PASS: arbitrary pool size, 60-second authoritative deadline, pause/resume, last-ms/late/stale packets, private answers, five teams, manual judgments, idempotent scoring, tied places and timer cleanup');
}

async function liveChecks() {
  const server=await startServer({HOST_KEY:'classic-live'}),sockets=[];
  const connect=async()=>{const s=client(server.url,{transports:['websocket'],reconnection:false,forceNew:true});sockets.push(s);s.on('state',state=>{s.state=state;});s.on('classicHostState',state=>{s.privateHost=state;});s.on('classicTeamState',state=>{s.privateTeam=state;});await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;};
  const emit=(s,event,payload={})=>s.timeout(5000).emitWithAck(event,payload);
  const ok=async(s,event,payload={})=>{const r=await emit(s,event,payload);assert.equal(r.ok,true,event+': '+JSON.stringify(r));return r;};
  const wait=async(check,label)=>{const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,label);await sleep(15);}};
  try {
    let host=await connect();const spy=await connect();
    assert.equal((await emit(spy,'classicCreateRoom',{pool:pool()})).ok,false);
    const data=pool();data.questions[0].points=2;data.questions[1].points=3;
    const created=await ok(host,'classicCreateRoom',{hostKey:'classic-live',pool:data});const code=created.code;
    assert.equal(created.hostState.pool.questions.length,2);
    const teams=[];
    for(let i=0;i<5;i++){const s=await connect();teams.push({s,...await ok(s,'classicJoinTeam',{code,name:'Team '+i})});}
    assert.equal((await emit(spy,'classicJoinTeam',{code,name:' team 0 '})).ok,false);
    await ok(spy,'classicJoinScreen',{code});
    assert.equal((await emit(spy,'classicRejoinHost',{code,hostToken:'wrong'})).ok,false);
    assert.equal((await(await fetch(server.url+'/screen/'+code,{redirect:'manual'})).headers.get('location')),'/classic/screen/'+code);
    assert.equal((await emit(spy,'getRoomTheme',{code})).gameType,'classic');
    for(const event of ['restartSameGame','adjustScore','chooseTile','startGame']) assert.equal((await emit(host,event,{code,playerId:teams[0].teamId,amount:1000,ci:0,qi:0})).ok,false,event+': legacy command cannot enter classic room');
    await ok(host,'classicStart',{code});await wait(()=>host.state?.phase==='classic_ready','ready');let questionKey=host.state.questionKey;
    assert.equal((await emit(teams[0].s,'classicOpenAnswers',{code,questionKey})).ok,false);
    await ok(host,'classicOpenAnswers',{code,questionKey});
    await ok(teams[0].s,'classicSubmitAnswer',{code,questionKey,answer:'ONLY_TEAM_ZERO'});
    await wait(()=>spy.state?.teams[0]?.submitted,'submission progress');
    assert.equal(JSON.stringify(spy.state).includes('ONLY_TEAM_ZERO'),false);
    assert.equal(JSON.stringify(spy.state).includes('FIXTURE_PRIVATE_ANSWER'),false);
    assert.equal(spy.privateHost,undefined);assert.equal(teams[1].s.privateHost,undefined);
    assert.equal(teams[1].s.privateTeam.answer,'');
    const previous=teams[0].s,replacement=await connect();
    const rejoined=await ok(replacement,'classicJoinTeam',{code,name:'Ignored rename',teamKey:teams[0].teamKey});
    assert.equal(rejoined.name,'Team 0');assert.equal(rejoined.teamState.answer,'ONLY_TEAM_ZERO');
    assert.equal((await emit(previous,'classicSubmitAnswer',{code,questionKey,answer:'old socket'})).ok,false);
    teams[0].s=replacement;
    const oldHost=host;host=await connect();await ok(host,'classicRejoinHost',{code,hostToken:created.hostToken});
    assert.equal((await emit(oldHost,'classicCloseAnswers',{code,questionKey})).ok,false);
    await ok(host,'classicCloseAnswers',{code,questionKey});
    assert.equal((await emit(host,'classicReveal',{code,questionKey})).ok,false);
    await ok(host,'classicJudgeAnswer',{code,questionKey,teamId:teams[0].teamId,correct:true});
    await ok(host,'classicReveal',{code,questionKey});
    assert.equal((await emit(host,'classicReveal',{code,questionKey})).ok,false);
    await wait(()=>host.state?.phase==='classic_result','result');assert.equal(host.privateHost.standings[0].score,2);
    assert.equal(host.state.teams[0].score,undefined,'public scores wait for a standalone table');
    assert.equal(host.state.question.answer,'FIXTURE_PRIVATE_ANSWER_0');
    await ok(host,'classicNextQuestion',{code,questionKey});await wait(()=>host.state?.phase==='classic_standings','standalone table');
    await wait(()=>spy.state?.phase==='classic_standings','public table');assert.equal(spy.state.standings.length,5);
    await ok(host,'classicContinue',{code,questionKey});await wait(()=>host.state?.phase==='classic_ready','second ready');
    const oldKey=questionKey;questionKey=host.state.questionKey;
    assert.equal((await emit(host,'classicOpenAnswers',{code,questionKey:oldKey})).ok,false);
    await ok(host,'classicOpenAnswers',{code,questionKey});
    assert.equal((await emit(spy,'classicSaveDraft',{code,questionKey,answer:'not a captain'})).ok,false);
    await ok(teams[1].s,'classicSaveDraft',{code,questionKey,answer:'DRAFT INITIAL'});
    await ok(teams[1].s,'classicSaveDraft',{code,questionKey,answer:'DRAFT LATEST'});
    const resumed=await ok(teams[1].s,'classicJoinTeam',{code,teamKey:teams[1].teamKey});
    assert.equal(resumed.teamState.draft,'DRAFT LATEST');
    await ok(teams[2].s,'classicSaveDraft',{code,questionKey,answer:'CLEARED DRAFT'});
    await ok(teams[2].s,'classicSaveDraft',{code,questionKey,answer:''});
    await ok(teams[3].s,'classicSaveDraft',{code,questionKey,answer:'SUPERSEDED DRAFT'});
    await ok(teams[3].s,'classicSubmitAnswer',{code,questionKey,answer:'MANUAL FINAL'});
    assert.equal((await emit(teams[3].s,'classicSaveDraft',{code,questionKey,answer:'replace final'})).ok,false);
    assert.equal(JSON.stringify(spy.state).includes('DRAFT LATEST'),false);
    assert.equal(JSON.stringify(host.privateHost).includes('DRAFT LATEST'),false,'unfinished draft is not shown to HOST');
    teams[1].s.disconnect();
    console.log('PASS: real HTTP/Socket.IO, five captains, private responses, secret-key reconnect, old socket revocation, cross-mode/role isolation, manual scoring and stale-question guards');
    if(!process.argv.includes('--fast')){
      console.log('Waiting for the real 60-second classic answer deadline...');
      await sleep(60100);
      await wait(()=>host.state?.phase==='classic_review','real deadline');
      assert.equal((await emit(teams[2].s,'classicSaveDraft',{code,questionKey,answer:'too late'})).ok,false);
    }else await ok(host,'classicCloseAnswers',{code,questionKey});
    await wait(()=>host.privateHost?.answers.some(answer=>answer.answer==='DRAFT LATEST'),'auto-submitted disconnected captain draft');
    const auto=host.privateHost.answers.find(answer=>answer.teamId===teams[1].teamId);
    assert.equal(auto.autoSubmitted,true);assert.equal(auto.correct,null);
    assert.equal(host.privateHost.answers.find(answer=>answer.teamId===teams[2].teamId).submitted,false);
    assert.equal(host.privateHost.answers.find(answer=>answer.teamId===teams[3].teamId).answer,'MANUAL FINAL');
    assert.equal((await emit(host,'classicReveal',{code,questionKey})).ok,false,'auto answers require a HOST judgment');
    await ok(host,'classicJudgeAnswer',{code,questionKey,teamId:teams[1].teamId,correct:false});
    await ok(host,'classicJudgeAnswer',{code,questionKey,teamId:teams[3].teamId,correct:false});
    await ok(host,'classicReveal',{code,questionKey});await ok(host,'classicNextQuestion',{code,questionKey});
    await wait(()=>host.state?.phase==='classic_final','final ceremony');
    assert.equal(spy.state.teams.every(team=>team.score===undefined),true);
    await ok(host,'classicRevealNextPlace',{code,questionKey,revealCount:0});
    await wait(()=>spy.state?.ceremony?.revealCount===1,'last place opened');
    assert.equal(spy.state.ceremony.latest.length,4,'tied places open together');
    assert.equal(spy.state.teams.find(team=>team.id===teams[0].teamId).score,undefined,'winner still hidden');
    assert.equal((await emit(host,'classicRevealNextPlace',{code,questionKey,revealCount:0})).ok,false);
    await ok(host,'classicRevealNextPlace',{code,questionKey,revealCount:1});
    await wait(()=>host.state?.phase==='classic_finished','finished');
    assert.equal(host.privateHost.history.length,2);
    assert.equal(JSON.stringify(host.privateHost.history).includes(created.hostToken),false);
    await ok(host,'classicCloseRoom',{code});assert.equal((await(await fetch(server.url+'/health')).json()).rooms,0);
    const board=await ok(host,'createRoom',{hostKey:'classic-live'});
    assert.equal((await emit(spy,'classicJoinScreen',{code:board.code})).ok,false);
    assert.equal((await emit(host,'classicStart',{code:board.code})).ok,false);
    assert.equal((await emit(spy,'classicJoinTeam',{code:board.code,name:'Wrong mode'})).ok,false);
    await ok(host,'closeRoom',{code:board.code});
    console.log('PASS: '+(process.argv.includes('--fast')?'manual close':'real deadline/late rejection')+', finish, private export history, two-way mode isolation and complete room cleanup');
  }finally{sockets.forEach(s=>s.disconnect());server.stop();}
}

clockChecks();liveChecks().catch(error=>{console.error(error);process.exitCode=1;});
