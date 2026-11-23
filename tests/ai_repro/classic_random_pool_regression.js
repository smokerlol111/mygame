const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');
const { createRandomPool, candidatesFrom, normalize } = require('../../server/modes/classic/random-pool');
const { loadBank } = require('../../server/question-bank/catalog');
const { startServer, REPO_ROOT } = require('./lib/server');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,file))).digest('hex');

async function main() {
  const protectedFiles=['games/index.json','archive/QUESTION_BANK.md','archive/completed-games/2026-11-22/question-records.json'];
  const before=protectedFiles.map(hash);
  const fixture=(id,q,a,extra={})=>({id,kind:'main',payload:{q,a,...extra}});
  const sample=candidatesFrom([
    fixture('a','FIXTURE prompt!','A'),fixture('b','  fixture PROMPT ','different answer'),
    fixture('c','FIXTURE different prompt','A'),fixture('d','REVIEW','A',{reviewRequired:true}),
    fixture('e','MEDIA','A',{type:'video'}),fixture('f','SPECIAL','A',{cat:{q:'nested'}}),
    fixture('g','IMAGE ANSWER','A',{answerImage:'/fixture.jpg'}),
    {...fixture('h','AUDIENCE','A'),kind:'audience'},fixture('i','EMPTY',''),
  ]);
  assert.deepEqual(sample.questions.map(q=>q.id),['a','c']);
  assert.equal(sample.duplicates,1);assert.equal(sample.excluded,6);
  assert.equal(normalize('ПИТАННЯ — тест?'),normalize('питання тест'));
  const records=JSON.parse(fs.readFileSync(path.join(REPO_ROOT,protectedFiles[2]),'utf8'));
  assert.equal(candidatesFrom(records).questions.length,271,'frozen bank compatible questions');
  const merged=loadBank(REPO_ROOT).records,expected=candidatesFrom(merged).questions.length;
  const original=new Map(merged.map(record=>[record.id,record]));
  const all=createRandomPool(REPO_ROOT,expected,n=>n-1);
  assert.equal(all.available,expected,'all compatible archive and new questions');
  assert.equal(new Set(all.pool.questions.map(q=>normalize(q.q))).size,expected);
  for(const question of all.pool.questions) {
    const source=original.get(question.id);assert.ok(source);
    assert.equal(question.q,source.payload.q.trim());assert.equal(question.a,source.payload.a.trim());
    assert.equal(question.points,1);assert.equal(question.type,'text');
  }
  for(const count of [1,12,30,47,expected]) assert.equal(createRandomPool(REPO_ROOT,count).pool.questions.length,count);
  for(const count of [0,-1,1.5,expected+1,NaN,'wrong']) assert.throws(()=>createRandomPool(REPO_ROOT,count));
  assert.notDeepEqual(createRandomPool(REPO_ROOT,expected,()=>0).pool.questions.map(q=>q.id),all.pool.questions.map(q=>q.id),'selection order is shuffled');

  const server=await startServer({HOST_KEY:'random-test',GAMES_INDEX_FILE:path.join(REPO_ROOT,'games/index.json')});
  const sockets=[];
  const connect=async()=>{const socket=io(server.url,{transports:['websocket'],reconnection:false});sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;};
  const call=(socket,event,payload)=>socket.timeout(4000).emitWithAck(event,payload);
  try {
    const host=await connect(),spy=await connect();
    for(const hostKey of [undefined,'wrong']) {
      const response=await call(spy,'classicRandomPool',{count:12,hostKey});
      assert.equal(response.ok,false);assert.equal(response.pool,undefined);
    }
    assert.equal((await call(host,'classicRandomPool',{hostKey:'random-test',count:expected+1})).ok,false);
    const generated=await call(host,'classicRandomPool',{hostKey:'random-test',count:47});
    assert.equal(generated.ok,true);assert.equal(generated.pool.questions.length,47);
    assert.equal(new Set(generated.pool.questions.map(q=>q.id)).size,47);
    assert.equal((await(await fetch(server.url+'/health')).json()).rooms,0,'preparation creates no room');
    assert.deepEqual(await(await fetch(server.url+'/games')).json(),[],'completed games remain hidden');
    const room=await call(host,'classicCreateRoom',{hostKey:'random-test',pool:generated.pool});
    assert.equal(room.ok,true);assert.deepEqual(room.hostState.pool,generated.pool);
    const publicRoom=await call(spy,'classicJoinScreen',{code:room.code});
    assert.equal(publicRoom.state.question,null);assert.equal(publicRoom.hostState,undefined);
    assert.equal(JSON.stringify(publicRoom).includes(generated.pool.questions[0].a),false);
    const captain=await connect();assert.equal((await call(captain,'classicJoinTeam',{code:room.code,name:'Random team'})).ok,true);
    assert.equal((await call(host,'classicStart',{code:room.code})).ok,true);
    const resumed=await call(host,'classicRejoinHost',{code:room.code,hostToken:room.hostToken});
    assert.equal(resumed.state.question.q,generated.pool.questions[0].q);
    assert.equal(resumed.state.question.answer,'');assert.equal(resumed.hostState.questionAnswer,generated.pool.questions[0].a);
    assert.equal((await call(host,'classicCloseRoom',{code:room.code})).ok,true);
  } finally { sockets.forEach(socket=>socket.disconnect());server.stop(); }
  assert.deepEqual(protectedFiles.map(hash),before,'bank, snapshot and live catalog unchanged');
  console.log('PASS: 271 compatible original questions, exact duplicate filtering, unapproved/special/media exclusions, random unique counts/order, HOST-only access, archived games hidden, random room and private answers, unchanged source data');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
