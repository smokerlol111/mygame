// Actual bot code + installed SpeakingMap; fake Discord transport and clock, no login/audio.
// Usage: node --test tests/ai_repro/discord_voice_regression.js
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { SpeakingMap, VoiceConnectionDisconnectReason } = require('@discordjs/voice');

const source = fs.readFileSync(path.join(__dirname, '../../voice-bot/bot.js'), 'utf8');
const USER = '123456789012345678';
const OTHER = '223456789012345678';
const statuses = { Ready:'ready', Connecting:'connecting', Signalling:'signalling', Disconnected:'disconnected', Destroyed:'destroyed' };
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };

function harness(t) {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:100000});
  const messages = [], connections = [];
  const fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, {
    env:{DISCORD_BOT_TOKEN:'test-only',DISCORD_GUILD_ID:'guild',DISCORD_VOICE_CHANNEL_ID:'channel'},
    send:message=>messages.push(structuredClone(message)), exit:()=>{},
  });
  let fetchGate = Promise.resolve(), ready=true, client, observer, joinStatus=statuses.Ready;
  const fetchErrors=[];
  class Client extends EventEmitter {
    constructor() {
      super(); client=this;this.user={tag:'test'};
      this.guilds={fetch:async()=>{await fetchGate;if(fetchErrors.length)throw fetchErrors.shift();return {id:'guild',voiceAdapterCreator:()=>{},channels:{fetch:async()=>({id:'channel',name:'test',guildId:'guild',isVoiceBased:()=>true})}};}};
    }
    isReady(){return ready;}
    login(){return Promise.resolve();}
    destroy(){}
  }
  class Connection extends EventEmitter {
    constructor(){super();this.state={status:joinStatus};this.receiver={speaking:new SpeakingMap()};this.destroyed=false;}
    change(status,details={}){const prior=this.state;this.state={status,...details};this.emit('stateChange',prior,this.state);this.emit(status,prior,this.state);}
    destroy(){if(!this.destroyed){this.destroyed=true;this.change(statuses.Destroyed);}}
  }
  const entersState = (connection,status,ms) => {
    if(connection.state.status===status)return Promise.resolve(connection);
    return new Promise((resolve,reject)=>{
      const onState=()=>{if(connection.state.status===status){cleanup();resolve(connection);}};
      const timer=setTimeout(()=>{cleanup();reject(new Error('test voice timeout'));},ms);
      const cleanup=()=>{clearTimeout(timer);connection.off('stateChange',onState);};
      connection.on('stateChange',onState);
    });
  };
  const context=vm.createContext({
    require:name=>{
      if(name==='discord.js')return {Client,GatewayIntentBits:{Guilds:1,GuildVoiceStates:2},Events:{ClientReady:'ready'}};
      if(name==='@discordjs/voice')return {joinVoiceChannel:()=>{const c=new Connection();connections.push(c);return c;},entersState,VoiceConnectionStatus:statuses,VoiceConnectionDisconnectReason};
      throw new Error('Unexpected module: '+name);
    },
    process:fakeProcess, console:{log(){},error(){}}, Date, setInterval,clearInterval,setTimeout,clearTimeout,
  });
  vm.runInContext(source,context,{filename:'voice-bot/bot.js'});
  const send=fakeProcess.send;
  fakeProcess.send=message=>{send(message);observer?.(message);};
  t.after(()=>fakeProcess.emit('message',{type:'voiceDisconnect'}));
  return {
    messages, connections,
    latest:type=>messages.filter(m=>m.type===type).at(-1),
    async connect(){fakeProcess.emit('message',{type:'voiceConnect'});await flush();},
    disconnect(){fakeProcess.emit('message',{type:'voiceDisconnect'});},
    blockFetch(){let release;fetchGate=new Promise(resolve=>{release=resolve;});return release;},
    observe(fn){observer=fn;},
    setReady(value){ready=value;if(value)client.emit('ready');},
    setGatewayReady(value){ready=value;},
    setJoinStatus(value){joinStatus=value;},
    failNextFetch(error){fetchErrors.push(error);},
  };
}

test('continuous speech stays highlighted for 45 seconds without another start event',async t=>{
  const h=harness(t);await h.connect();const speaking=h.connections[0].receiver.speaking;
  let starts=0;speaking.on('start',()=>starts++);
  for(let elapsed=0;elapsed<45000;elapsed+=50){
    speaking.onPacket(USER);t.mock.timers.tick(50);
    assert.deepEqual(h.latest('voiceActivity').userIds,[USER],`speaking at ${elapsed+50}ms`);
  }
  assert.equal(starts,1,'installed SpeakingMap emits start only once during uninterrupted packets');
  t.mock.timers.tick(150);
  assert.deepEqual(h.latest('voiceActivity').userIds,[],'silence clears the speaker');
});

test('periodic snapshots stay fresh through silence without inventing speakers',async t=>{
  const h=harness(t);await h.connect();const count=h.messages.length;
  t.mock.timers.tick(35000);
  const updates=h.messages.slice(count).filter(m=>m.type==='voiceActivity');
  assert.equal(updates.length,35);
  assert.ok(updates.every(m=>m.userIds.length===0));
  assert.equal(h.latest('voiceStatus').status,'connected');
});

test('overlapping speakers stop independently and end excludes the user before map removal',async t=>{
  const h=harness(t);await h.connect();const s=h.connections[0].receiver.speaking;
  s.onPacket(USER);s.onPacket(OTHER);s.onPacket('invalid');
  assert.deepEqual(h.latest('voiceActivity').userIds,[USER,OTHER]);
  t.mock.timers.tick(50);s.onPacket(OTHER);t.mock.timers.tick(60);
  assert.deepEqual(h.latest('voiceActivity').userIds,[OTHER]);
  t.mock.timers.tick(100);
  assert.deepEqual(h.latest('voiceActivity').userIds,[]);
});

test('temporary connection loss clears highlighting and ready restores an ongoing speaker',async t=>{
  const h=harness(t);await h.connect();const c=h.connections[0],s=c.receiver.speaking;
  let starts=0;s.on('start',()=>starts++);s.onPacket(USER);
  c.change(statuses.Connecting);
  assert.equal(h.latest('voiceStatus').status,'connecting');
  assert.deepEqual(h.latest('voiceActivity').userIds,[]);
  for(let i=0;i<100;i++){s.onPacket(USER);t.mock.timers.tick(50);}
  c.change(statuses.Ready);
  assert.equal(starts,1,'no extra start on recovery');
  assert.equal(h.latest('voiceStatus').status,'connected');
  assert.deepEqual(h.latest('voiceActivity').userIds,[USER]);
  t.mock.timers.tick(31000);
  assert.equal(c.destroyed,false,'old recovery deadline is cancelled after ready');
  assert.deepEqual(h.latest('voiceActivity').userIds,[],'actual silence still clears activity');
});

test('outage beyond 30 seconds retries automatically and ignores old receiver events',async t=>{
  const h=harness(t);await h.connect();const c=h.connections[0];
  c.receiver.speaking.onPacket(USER);c.change(statuses.Disconnected);
  t.mock.timers.tick(30001);
  assert.equal(c.destroyed,true);
  assert.equal(h.latest('voiceStatus').status,'connecting');
  const count=h.messages.length;c.receiver.speaking.onPacket(OTHER);t.mock.timers.tick(4000);
  assert.equal(h.messages.length,count,'destroyed receiver and heartbeat cannot publish stale activity');
  t.mock.timers.tick(1000);await flush();assert.equal(h.connections.length,2);
  assert.equal(h.latest('voiceStatus').status,'connected','recovery requires no new HOST enable');
});

test('HOST disable cancels a scheduled network retry',async t=>{
  const h=harness(t);await h.connect();h.connections[0].change(statuses.Disconnected);
  t.mock.timers.tick(30001);h.disconnect();t.mock.timers.tick(60000);await flush();
  assert.equal(h.connections.length,1);assert.equal(h.latest('voiceStatus').status,'disconnected');
});

test('transient fetch failure retries but missing access stops retries',async t=>{
  const h=harness(t);h.failNextFetch(new Error('temporary network failure'));await h.connect();
  assert.equal(h.latest('voiceStatus').status,'connecting');
  t.mock.timers.tick(5000);await flush();assert.equal(h.connections.length,1);
  assert.equal(h.latest('voiceStatus').status,'connected');
  h.disconnect();h.failNextFetch(Object.assign(new Error('Missing Access'),{code:50001}));await h.connect();
  t.mock.timers.tick(60000);await flush();assert.equal(h.connections.length,1);
  assert.equal(h.latest('voiceStatus').status,'disconnected');
});

test('gateway recovery after the initial ready event still resumes voice retries',async t=>{
  const h=harness(t);await h.connect();h.setGatewayReady(false);
  h.connections[0].change(statuses.Disconnected);t.mock.timers.tick(30001);await flush();
  t.mock.timers.tick(5000);await flush();
  assert.equal(h.connections.length,1);assert.equal(h.latest('voiceStatus').status,'starting');
  h.setGatewayReady(true);t.mock.timers.tick(10000);await flush();
  assert.equal(h.connections.length,2);assert.equal(h.latest('voiceStatus').status,'connected');
});

test('failed joins back off and keep trying beyond multiple 30-second deadlines',async t=>{
  const h=harness(t);h.setJoinStatus(statuses.Connecting);await h.connect();
  for(const delay of [5000,10000,20000,30000]){
    const count=h.connections.length;t.mock.timers.tick(30000);await flush();
    assert.equal(h.connections.at(-1).destroyed,true);
    t.mock.timers.tick(delay-1);await flush();assert.equal(h.connections.length,count);
    t.mock.timers.tick(1);await flush();assert.equal(h.connections.length,count+1);
  }
  h.connections.at(-1).change(statuses.Ready);await flush();
  assert.equal(h.latest('voiceStatus').status,'connected');
});

test('administrative disconnect stops retries even when only the reason changes',async t=>{
  const h=harness(t);await h.connect();const c=h.connections[0];
  c.change(statuses.Disconnected,{reason:VoiceConnectionDisconnectReason.AdapterUnavailable});
  c.change(statuses.Disconnected,{reason:VoiceConnectionDisconnectReason.WebSocketClose,closeCode:4014});
  t.mock.timers.tick(90000);await flush();assert.equal(h.connections.length,1);
  assert.equal(h.latest('voiceStatus').status,'disconnected');assert.equal(c.destroyed,true);
});

test('manual disconnect stops heartbeat and recovery and cannot rejoin by itself',async t=>{
  const h=harness(t);await h.connect();const c=h.connections[0];
  c.change(statuses.Connecting);h.disconnect();const count=h.messages.length;
  t.mock.timers.tick(60000);await flush();
  assert.equal(h.connections.length,1);assert.equal(c.destroyed,true);
  assert.equal(h.messages.length,count);assert.deepEqual(h.latest('voiceActivity').userIds,[]);
});

test('disabling during a pending guild fetch cancels the join',async t=>{
  const h=harness(t),release=h.blockFetch();await h.connect();
  h.disconnect();release();await flush();
  assert.equal(h.connections.length,0);
  assert.equal(h.latest('voiceStatus').status,'disconnected');
});

test('quick disable/enable while fetching creates just the newest connection',async t=>{
  const h=harness(t),release=h.blockFetch();await h.connect();h.disconnect();await h.connect();
  release();await flush();
  assert.equal(h.connections.length,1);
  assert.equal(h.latest('voiceStatus').status,'connected');
  await h.connect();assert.equal(h.connections.length,1,'duplicate enable cannot attach extra listeners');
  const before=h.messages.length;t.mock.timers.tick(1000);
  assert.equal(h.messages.slice(before).filter(m=>m.type==='voiceActivity').length,1,'one heartbeat only');
});

test('enable before login is honored on ready, unless HOST disabled in the meantime',async t=>{
  const h=harness(t);h.setReady(false);await h.connect();
  assert.equal(h.connections.length,0);assert.equal(h.latest('voiceStatus').status,'starting');
  h.setReady(true);await flush();assert.equal(h.connections.length,1);
  assert.equal(h.latest('voiceStatus').status,'connected');
});

test('disable before login prevents a late ready event from joining',async t=>{
  const h=harness(t);h.setReady(false);await h.connect();h.disconnect();h.setReady(true);await flush();
  assert.equal(h.connections.length,0);assert.equal(h.latest('voiceStatus').status,'disconnected');
});

test('server accepts fresh heartbeat snapshots, deduplicates browser updates, and still clears stale IPC',async t=>{
  const h=harness(t);
  const source=fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8');
  const events=[],room={code:'TEST',hostSocket:'host',players:[{id:'player'}],voiceMappings:{player:USER},voiceSpeaking:[]};
  const context=vm.createContext({
    rooms:new Map([['TEST',room]]),Date,setInterval,clearInterval,
    voiceBotStatus:'starting',voiceBotError:'',
    process:{env:{DISCORD_GUILD_ID:'guild',DISCORD_VOICE_CHANNEL_ID:'channel'}},
    io:{to:target=>({emit:(event,payload)=>events.push({target,event,payload})})},
  });
  vm.runInContext(source.slice(source.indexOf('let voiceLastEvent ='),source.indexOf('// DEV-only: optional bot process')),context);
  t.after(()=>vm.runInContext('clearInterval(voiceStaleTimer)',context));
  h.observe(message=>context.handleDiscordVoiceMessage(message));await h.connect();
  const s=h.connections[0].receiver.speaking;
  for(let elapsed=0;elapsed<45000;elapsed+=50){
    s.onPacket(USER);t.mock.timers.tick(50);
    assert.deepEqual([...room.voiceSpeaking],['player'],`server highlight at ${elapsed+50}ms`);
  }
  assert.equal(events.filter(e=>e.event==='voiceSpeaking').length,1,'unchanged IPC does not rebuild HOST/OBS');
  context.handleDiscordVoiceMessage({type:'voiceActivity',guildId:'other',channelId:'channel',userIds:[]});
  assert.deepEqual([...room.voiceSpeaking],['player'],'wrong guild ignored');
  h.observe(()=>{}); // Simulate a stuck IPC bridge, not an intentional bot disconnect.
  t.mock.timers.tick(23000);
  assert.deepEqual([...room.voiceSpeaking],[],'20-second safety guard remains effective');
});
