const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {io}=require('socket.io-client');
const {loadBank,SNAPSHOT}=require('../../server/question-bank/catalog');
const {generateBoard,options,keys}=require('../../server/modes/board/random-generator');
const {startServer,REPO_ROOT}=require('./lib/server');
const {play,key}=require('./all_games_smoke');

async function main() {
  const bank=loadBank(REPO_ROOT),byId=new Map(bank.entries.map(entry=>[entry.id,entry]));
  assert.ok(bank.entries.length>=540);assert.equal(byId.size,bank.entries.length);assert.equal(bank.themes.length,8);
  const markdown=fs.readFileSync(path.join(REPO_ROOT,'archive/QUESTION_BANK.md'),'utf8');
  assert.ok(markdown.startsWith(fs.readFileSync(path.join(REPO_ROOT,SNAPSHOT,'QUESTION_BANK.md'),'utf8')));
  const index=markdown.slice(markdown.indexOf('<!-- QUESTION_TOPIC_INDEX_START -->'));
  for(const entry of bank.entries)assert.ok(index.includes('`'+entry.id+'`'),entry.id+': covered by topic index');
  const themes=options(bank);assert.equal(themes.filter(theme=>theme.eligible).length,8);
  for(const invalid of [[],['cinema'],Array(5).fill('cinema'),['cinema','music','technology','science','missing']])
    assert.throws(()=>generateBoard(bank,invalid));
  const formats=new Set();
  for(let sample=0;sample<100;sample++) {
    const requested=sample===0?['cinema','music','technology','science','world']:undefined;
    const game=generateBoard(bank,requested),ids=[],signatures=[];
    assert.equal(game.rounds.length,2);assert.equal(game.audienceRounds.length,2);
    if(requested)assert.deepEqual(game.rounds[0].categories.map(category=>category.name),requested.map(id=>themes.find(theme=>theme.id===id).name));
    assert.equal(new Set(game.rounds[0].categories.map(category=>category.name)).size,5);
    for(const [ri,round]of game.rounds.entries()) {
      assert.equal(round.categories.length,5);
      for(const category of round.categories) {
        assert.deepEqual(category.questions.map(question=>question.value),[1,2,3,4,5].map(n=>n*(ri?200:100)));
        for(const question of category.questions) {
          ids.push(question.sourceId);signatures.push(...keys(question));formats.add(question.type||'text');
          const source=byId.get(question.sourceId).payload;
          assert.equal(question.q,source.q);assert.equal(question.a,source.a);
          assert.equal(question.media,source.media);assert.equal(question.pauseAt,source.pauseAt);
          assert.equal(question.stopAt,source.stopAt);assert.equal(question.emoji,source.emoji);
          if(source.revealValues)assert.deepEqual(question.revealValues,source.revealValues.map(value=>Math.round(value*question.value/source.value)));
          if(source.triplet)assert.deepEqual(question.triplet.map(part=>part.value),source.triplet.map(part=>Math.round(part.value*question.value/source.value)));
        }
      }
    }
    assert.equal(ids.length,50);assert.equal(new Set(ids).size,50);assert.equal(new Set(signatures).size,signatures.length,'no repeated atomic prompts/media');
    assert.equal(game.firstTurnQuiz.answer,byId.get(game.firstTurnQuiz.sourceId).payload.answer);
    assert.equal(game.final.a,byId.get(game.final.sourceId).payload.a);
    assert.ok(game.audienceRounds.every(round=>round.questions.length===3));
  }
  for(const type of ['text','emoji','triplet','numericClosest','imageReveal','audio','audioReveal','video'])assert.ok(formats.has(type),type+' preserved in generator');
  console.log('PASS: all 540 topic references, 8 themes, 100 unique 50-cell boards, source prompts/answers, difficulty rows, all supported formats and scaled reveal/triplet values');
  const server=await startServer({HOST_KEY:key,GAMES_INDEX_FILE:path.join(REPO_ROOT,'games/index.json')});
  const socket=io(server.url,{transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  const call=(event,payload={})=>socket.timeout(6000).emitWithAck(event,payload);
  const ok=async(event,payload={})=>{const response=await call(event,{hostKey:key,...payload});assert.equal(response.ok,true,event+': '+response.error);return response;};
  try {
    assert.equal((await call('boardRandomOptions',{hostKey:'wrong'})).ok,false);
    assert.equal((await call('boardRandomPreview',{hostKey:'wrong'})).ok,false);
    assert.equal((await ok('boardRandomOptions')).themes.length,8);
    const {game}=await ok('boardRandomPreview');
    assert.deepEqual(await(await fetch(server.url+'/games')).json(),[],'old games stay archived and previews are not listed');
    const privateGame=await(await fetch(server.url+'/games/'+game.id+'.json?key='+key)).json();
    assert.deepEqual(privateGame.rounds,game.rounds);
    const publicGame=await(await fetch(server.url+'/games/'+game.id+'.json')).json();
    assert.deepEqual(Object.keys(publicGame).sort(),['id','rounds']);
    assert.deepEqual(publicGame.rounds[0].categories[0].questions[0],{value:100});
    const active=await ok('createRoom',{gameId:game.id});
    const stale=(await ok('boardRandomPreview')).game;
    for(let i=0;i<24;i++)await ok('boardRandomPreview');
    assert.equal((await fetch(server.url+'/games/'+stale.id+'.json')).status,404,'unreferenced old preview evicted');
    assert.equal((await call('createRoom',{gameId:stale.id,hostKey:key})).ok,false,'evicted preview never falls back to another game');
    assert.equal((await fetch(server.url+'/games/'+game.id+'.json')).status,200,'active generated game survives eviction');
    const restored=await ok('rejoinHost',{code:active.code,hostToken:active.hostToken});assert.equal(restored.gameId,game.id);
    await ok('closeRoom',{code:active.code});
    if(!process.argv.includes('--fast')) {
      const result=await play(server,{id:game.id},game);
      assert.equal(result.passed,true,result.error);assert.equal(result.checked,50);
      assert.equal(result.audienceQuestions,6);assert.equal(result.firstTurn,true);
      if(process.env.QUIZ_TEST_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.QUIZ_TEST_ARTIFACT_DIR,'random-game-summary.json'),JSON.stringify(result,null,2));
    }
    assert.equal((await(await fetch(server.url+'/health')).json()).rooms,0);
    console.log('PASS: HOST authorization, generated-game HTTP privacy, empty archived menu, bounded previews, active-room retention and replay, room cleanup'+(process.argv.includes('--fast')?'':' and all 50 cells/start/6 audience questions/final'));
  } finally {socket.disconnect();server.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
