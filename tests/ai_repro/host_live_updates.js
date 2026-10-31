// Actual HOST + isolated server. Checks DOM preservation, not a real broadcast/network.
const assert=require('node:assert/strict');
const {io}=require('socket.io-client');
const {JSDOM,VirtualConsole}=require('jsdom');
const {startServer}=require('./lib/server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const server=await startServer();const sockets=[];let dom,browser,browserPage;
 const connect=async()=>{const s=io(server.url,{transports:['websocket'],reconnection:false});sockets.push(s);await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j);});return s;};
 const ok=async(s,event,args)=>{const r=await s.timeout(3000).emitWithAck(event,args);assert.equal(r.ok,true,event+JSON.stringify(r));return r;};
 const wait=async(fn)=>{const end=Date.now()+6000;while(!fn()){assert.ok(Date.now()<end,'HOST update timed out');await sleep(20);}};
 try{
  const host=await connect();const room=await ok(host,'createRoom',{hostToken:'host-live-test',gameId:'general-knowledge'});
  const player=await connect();await ok(player,'joinPlayer',{code:room.code,name:'Player'});
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message);});
  dom=await JSDOM.fromURL(server.url+'/host',{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.localStorage.setItem('sgHostToken',room.hostToken);w.localStorage.setItem('sgRoomCode',room.code);w.fetch=(u,o)=>fetch(new URL(u,server.url),o);w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};}});
  const w=dom.window,d=w.document;await wait(()=>d.querySelector('.scoreCustomInput')&&w.eval('voiceBotStatus !== "unknown"'));
  await sleep(100);
  const field=d.querySelector('.scoreCustomInput');field.value='250';field.focus();
  await w.eval('socket.listeners("state")[0](JSON.parse(JSON.stringify(state)))');
  assert.equal(d.querySelector('.scoreCustomInput'),field,'identical full state must preserve controls');
  assert.equal(field.value,'250');assert.equal(d.activeElement,field);
  await w.eval('socket.listeners("state")[0]({...state,players:state.players.map(p=>({...p,syncReady:false,connected:false,networkRttMs:160}))})');
  assert.equal(d.querySelector('.scoreCustomInput'),field,'network/presence-only state preserves controls');
  await w.eval('restoreHostConnection()');await sleep(120);
  assert.equal(d.querySelector('.scoreCustomInput'),field,'same-state HOST reconnect preserves controls');
  await w.eval('socket.listeners("voiceBotStatus")[0]({code,status:"connecting"})');
  assert.equal(d.querySelector('.scoreCustomInput'),field,'voice status preserves game controls');
  if(process.argv.includes('--liveness')){
   await ok(player,'reportNetworkStats',{code:room.code,rttMs:50,jitterMs:2,samples:3});
   await wait(()=>w.eval('state.players[0].syncReady'));
   await sleep(14000);
   await wait(()=>!w.eval('state.players[0].syncReady'));
   assert.equal(d.querySelector('.scoreCustomInput'),field,'actual server liveness timer preserves controls');
   assert.equal(field.value,'250');assert.equal(d.activeElement,field);
   console.log('PASS: real 14-second clock-sync expiry and resulting state/hostSecrets preserve controls, draft and focus.');
  }
  await ok(w.eval('socket'),'openAudienceRound',{code:room.code,roundIndex:0});
  await wait(()=>d.getElementById('startAudienceQuestion'));
  const viewers=[];for(let i=0;i<3;i++){const s=await connect();await ok(s,'joinAudience',{code:room.code,name:'Viewer '+i});viewers.push(s);}
  await ok(w.eval('socket'),'startAudienceQuestion',{code:room.code});await wait(()=>d.getElementById('audienceTimer'));
  const timer=d.getElementById('audienceTimer'),button=d.getElementById('finishAudienceQuestion');
  const input=d.querySelector('.scoreCustomInput');input.value='350';input.focus();
  for(let i=0;i<3;i++)await ok(viewers[i],'submitAudienceAnswer',{code:room.code,option:i});
  await wait(()=>d.getElementById('audienceSubmitted').textContent==='3/3');
  assert.equal(d.getElementById('audienceTimer'),timer);assert.equal(d.getElementById('finishAudienceQuestion'),button);
  for(let i=0;i<50;i++)await w.eval('socket.listeners("state")[0](JSON.parse(JSON.stringify(state)))');
  assert.equal(d.getElementById('audienceTimer'),timer,'50 redundant audience states preserve timer');
  assert.equal(d.querySelector('.scoreCustomInput'),input);assert.equal(input.value,'350');assert.equal(d.activeElement,input);
  button.click();await wait(()=>w.eval('state.phase === "audience_result"'));
  assert.equal(d.getElementById('audienceTimer'),null,'real phase change still renders');
  assert.deepEqual(errors,[]);console.log('PASS: identical/network states, HOST reconnect, voice status, three real audience answers, 50 repeated states preserve nodes/drafts/focus; real phase changes render.');
  if(process.argv.includes('--browser')){
   await ok(w.eval('socket'),'openAudienceRound',{code:room.code,roundIndex:0});
   browser=await require('./lib/edge').startEdge({muteAudio:true});
   browserPage=await browser.page(server.url+'/host',1280,900,{session:{sgHostToken:room.hostToken,sgRoomCode:room.code},ready:'document.readyState === "complete" && typeof state !== "undefined" && state?.phase === "audience_lobby" && !!document.getElementById("startAudienceQuestion")'});
   const command=async(event)=>{const r=await browserPage.evaluate(`socket.timeout(3000).emitWithAck(${JSON.stringify(event)},{code})`);assert.equal(r.ok,true,event);};
   await command('startAudienceQuestion');
   await browserPage.activate();
   await browserPage.evaluate(`window.savedTimer=document.getElementById('audienceTimer');window.savedInput=document.querySelector('.scoreCustomInput');for(let p=savedInput.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;savedInput.value='450';savedInput.focus();scrollTo(0,200);window.savedScroll=scrollY;true`);
   for(let i=0;i<3;i++)await ok(viewers[i],'submitAudienceAnswer',{code:room.code,option:i});
   await browserPage.evaluate(`(async()=>{for(let i=0;i<60&&document.getElementById('audienceSubmitted').textContent!=='3/3';i++)await new Promise(r=>setTimeout(r,20));for(let i=0;i<50;i++)await socket.listeners('state')[0](JSON.parse(JSON.stringify(state)));socket.listeners('voiceBotStatus')[0]({code,status:'connecting'});return true;})()`);
   const check=await browserPage.evaluate(`({sameTimer:savedTimer===document.getElementById('audienceTimer'),sameInput:savedInput===document.querySelector('.scoreCustomInput'),value:savedInput.value,focus:document.activeElement===savedInput,scroll:scrollY===savedScroll,submitted:document.getElementById('audienceSubmitted').textContent,navigations:performance.getEntriesByType('navigation').length})`);
   assert.deepEqual(check,{sameTimer:true,sameInput:true,value:'450',focus:true,scroll:true,submitted:'3/3',navigations:1});
   assert.deepEqual(browserPage.errors,[]);console.log('PASS: actual Edge keeps timer/input nodes, draft, focus and scroll through three real audience answers, 50 states and Discord status; one document navigation.');
  }
 }finally{if(browserPage)await browserPage.close().catch(()=>{});browser?.stop();dom?.window.close();sockets.forEach(s=>s.disconnect());server.stop();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
