// Real Funnel checks against the already running server. Creates/closes only its
// own temporary room; never restarts the server, changes Funnel or saves a season.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');
const dns=require('node:dns').promises;
const crypto=require('node:crypto');
const {io}=require('socket.io-client');
const {REPO_ROOT}=require('./lib/server');
const game=JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'games/season2_grand_final.json'),'utf8'));
const publicUrl=new URL(fs.readFileSync(path.join(REPO_ROOT,'.funnel-url'),'utf8').trim()).origin;
const reportDirectory=path.join(REPO_ROOT,'archive/audits/tailscale-media-2026-10-28');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function request(url,options={}) {
  return new Promise((resolve,reject)=>{
    const started=performance.now();
    const req=https.request(url,{agent:options.agent,method:options.method||'GET',headers:options.headers||{},timeout:30000},res=>{
      const remoteAddress=res.socket.remoteAddress;
      const tls={authorized:res.socket.authorized,protocol:res.socket.getProtocol()};
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),remoteAddress,tls,ms:Math.round(performance.now()-started)}));
    });
    req.on('timeout',()=>req.destroy(new Error('HTTPS timeout')));req.on('error',reject);req.end();
  });
}
function readHostKey() {
  if(process.env.HOST_KEY)return process.env.HOST_KEY.trim();
  const filename=path.join(REPO_ROOT,'.env');if(!fs.existsSync(filename))return '';
  const match=fs.readFileSync(filename,'utf8').match(/^\s*HOST_KEY\s*=\s*(.*?)\s*$/m);
  return match?match[1].replace(/^['"]|['"]$/g,''):'';
}
async function main() {
  const controlOnly=process.argv.includes('--control-only');
  const report={mode:controlOnly?'browser-controls':'complete',sourceCommit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:REPO_ROOT,encoding:'utf8'}).trim(),publicUrl,files:[],ranges:[]};
  const sockets=[];let host,room,browser;const pages=[];
  const doh=JSON.parse((await request('https://dns.google/resolve?name='+new URL(publicUrl).hostname+'&type=A')).body);
  const ingress=(doh.Answer||[]).filter(a=>a.type===1).map(a=>a.data);
  assert.ok(ingress.length,'public DNS contains Funnel ingress addresses');
  assert.ok(ingress.every(ip=>!ip.startsWith('100.')&&!ip.startsWith('127.')),'public ingress must not be a tailnet/loopback address');
  const targetIp=ingress[0];
  const lookup=(hostname,options,cb)=>{
    if(hostname===new URL(publicUrl).hostname)return options?.all?cb(null,[{address:targetIp,family:4}]):cb(null,targetIp,4);
    require('node:dns').lookup(hostname,options,cb);
  };
  const agent=new https.Agent({keepAlive:true,lookup});
  const get=(route,options={})=>request(publicUrl+route,{...options,agent});
  const connect=async(url,transport='websocket')=>{
    const connectionAgent=url.startsWith('https:')?agent:undefined;
    const s=io(url,{transports:[transport],reconnection:false,timeout:10000,agent:connectionAgent,transportOptions:{websocket:{agent:connectionAgent},polling:{agent:connectionAgent}}});
    sockets.push(s);s.on('state',state=>{s.state=state;});
    await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;
  };
  const ok=async(s,event,payload)=>{
    const r=await s.timeout(8000).emitWithAck(event,payload);assert.equal(r.ok,true,`${event}: ${r.error||'failed'}`);return r;
  };
  try {
    const health=await get('/health');assert.equal(health.status,200);assert.ok(ingress.includes(health.remoteAddress));assert.equal(health.tls.authorized,true);
    report.route={systemDns:(await dns.lookup(new URL(publicUrl).hostname,{all:true})).map(a=>a.address),publicDns:ingress,connectedTo:health.remoteAddress,tls:health.tls};
    report.healthBefore=JSON.parse(health.body);console.log('PASS: verified HTTPS through public Funnel ingress '+health.remoteAddress+' (local MagicDNS bypassed)');
    const paths=new Set();const collect=obj=>Object.values(obj).forEach(v=>{if(typeof v==='string'&&v.startsWith('/')&&/\.(mp4|mp3|jpe?g|png)$/i.test(v))paths.add(v);else if(v&&typeof v==='object')collect(v);});collect(game);
    if(!controlOnly)for(const route of paths) {
      const expected=fs.readFileSync(path.join(REPO_ROOT,'public',route.slice(1)));
      const received=await get(route);assert.equal(received.status,200,route);assert.equal(received.body.length,expected.length,route);
      assert.equal(sha(received.body),sha(expected),route+': exact bytes');
      assert.match(received.headers['content-type'],/^(image|audio|video)\//,route+': MIME');
      assert.ok(ingress.includes(received.remoteAddress));
      report.files.push({path:route,bytes:expected.length,sha256:sha(expected),mime:received.headers['content-type'],ms:received.ms});
      if(/\.(mp4|mp3)$/i.test(route)) {
        for(const [start,end] of [[0,Math.min(65535,expected.length-1)],[Math.floor(expected.length/2),Math.min(expected.length-1,Math.floor(expected.length/2)+65535)],[Math.max(0,expected.length-65536),expected.length-1]]) {
          const receivedRange=await get(route,{headers:{Range:`bytes=${start}-${end}`}});
          assert.equal(receivedRange.status,206,route+': Range status');assert.equal(receivedRange.headers['content-range'],`bytes ${start}-${end}/${expected.length}`);
          assert.deepEqual(receivedRange.body,expected.subarray(start,end+1),route+': Range data');
          report.ranges.push({path:route,start,end,status:206,bytes:receivedRange.body.length,ms:receivedRange.ms});
        }
      }
      console.log(`FILE PASS: ${route} (${expected.length} bytes, ${received.ms} ms)`);
    }
    if(!controlOnly){
    const biggest=report.files.filter(f=>f.path.endsWith('.mp4')).sort((a,b)=>b.bytes-a.bytes)[0];
    const parallelStart=performance.now();
    const downloads=await Promise.all(Array.from({length:5},()=>get(biggest.path,{headers:{Range:'bytes=0-1048575'}})));
    downloads.forEach(r=>{assert.equal(r.status,206);assert.equal(r.body.length,Math.min(biggest.bytes,1048576));});
    report.concurrent={clients:5,path:biggest.path,bytes:downloads.reduce((s,r)=>s+r.body.length,0),totalMs:Math.round(performance.now()-parallelStart),clientMs:downloads.map(r=>r.ms)};
    console.log('PASS: all 29 Grand Final files match local SHA-256; 33 audio/video ranges and 5 concurrent video range downloads');
    }

    // Only this new room is changed. Existing rooms and season storage are untouched.
    host=await connect('http://127.0.0.1:3100');
    const token=crypto.randomUUID();
    room=await ok(host,'createRoom',{hostKey:readHostKey(),hostToken:token,gameId:game.id});
    const players=[];
    for(let i=0;i<4;i++){const s=await connect(publicUrl);const joined=await ok(s,'joinPlayer',{code:room.code,name:'Funnel audit '+(i+1)});players.push({socket:s,...joined});}
    const obs=await connect(publicUrl);await ok(obs,'joinScreen',{code:room.code});
    const polling=await connect(publicUrl,'polling');await ok(polling,'joinScreen',{code:room.code});
    const baseConfig=await get('/public-config.js');assert.ok(baseConfig.body.toString().includes(publicUrl));
    await ok(host,'skipFirstTurnQuiz',{code:room.code});
    report.signaling={players:4,obs:true,pollingFallback:true,questions:[]};
    if(process.argv.includes('--browser')) {
      const {startEdge}=require('./lib/edge');
      browser=await startEdge({hostResolverRules:`MAP ${new URL(publicUrl).hostname} ${targetIp}`,muteAudio:true});
      for(const spec of [{role:'player',route:'/play?room='+room.code,width:390,height:844,session:{sgCode:room.code,sgPlayerId:players[0].playerId,sgPlayerKey:players[0].playerKey,sgPlayerName:'Funnel audit 1'}},{role:'obs',route:'/screen/'+room.code,width:1920,height:1080}]) {
        const page=await browser.page(publicUrl+spec.route,spec.width,spec.height,{session:spec.session,ready:'document.readyState === "complete" && typeof state !== "undefined" && state?.phase === "board"'});
        pages.push({page,...spec});
        await page.activate();await page.evaluate('document.body.click();true',{userGesture:true});
      }
    }
    let activeRound=0;
    for(let ri=0;ri<game.rounds.length;ri++)for(let ci=0;ci<5;ci++)for(let qi=0;qi<5;qi++) {
      const q=game.rounds[ri].categories[ci].questions[qi];if(!['imageReveal','audio','video'].includes(q.type))continue;
      if(controlOnly&&q.type==='imageReveal')continue;
      if(ri!==activeRound){await ok(host,'nextRound',{code:room.code});activeRound=ri;}
      await ok(host,'chooseTile',{code:room.code,ci,qi});
      const targets=[...players.slice(1).map(p=>p.socket),obs,polling];
      const deadline=Date.now()+8000;
      while(!targets.every(s=>s.state?.current?.ci===ci&&s.state.current.qi===qi&&s.state.round===ri)){assert.ok(Date.now()<deadline,'public recipients receive question');await sleep(25);}
      const entry={round:ri,ci,qi,type:q.type,path:q.image||q.media};
      if(['video','audio'].includes(q.type)) {
        const event=q.type==='video'?'hostVideoControl':'hostAudioControl',received=q.type==='video'?'videoControl':'audioControl';
        for(const [action,time]of [['play',0],['seek',0.5],['pause',0.5]]) {
          const waits=targets.map(s=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(received+' timeout')),8000);s.once(received,p=>{clearTimeout(t);resolve(p);});}));
          await ok(host,event,{code:room.code,action,time});
          for(const payload of await Promise.all(waits)){assert.equal(payload.action,action);assert.equal(payload.media,q.media);assert.equal(payload.time,time);}
        }
        entry.controls=['play','seek','pause'];
      }
      for(const {page,role}of pages) {
        await page.activate();
        const deadline=Date.now()+10000;
        while(!await page.evaluate(`state?.current?.ci===${ci}&&state?.current?.qi===${qi}&&state?.round===${ri}`)){assert.ok(Date.now()<deadline,role+' browser receives question');await sleep(30);}
        const decoded=await page.evaluate(`(async()=>{
          const el=${q.type==='imageReveal'?'document.querySelector("#app img")':q.type==='video'?'document.querySelector("video.quizVideo,#playerVideo")':'document.querySelector("audio.quizAudio,#playerAudio")'};
          if(!el)throw new Error('Missing ${q.type} element');
          if(el.tagName==='IMG'){await el.decode();return {width:el.naturalWidth,height:el.naturalHeight};}
          await new Promise((resolve,reject)=>{if(el.readyState>=1)return resolve();const t=setTimeout(()=>reject(new Error('Media metadata timeout')),9000);el.addEventListener('loadedmetadata',()=>{clearTimeout(t);resolve();},{once:true});el.addEventListener('error',()=>{clearTimeout(t);reject(new Error('Media decode error '+el.error?.code));},{once:true});});
          el.muted=true;await el.play();await new Promise(r=>setTimeout(r,200));el.pause();return {duration:el.duration,currentTime:el.currentTime};
        })()`,{userGesture:true});
        assert.ok(decoded.width>0||decoded.duration>0,role+': media decodes');
        assert.deepEqual(page.errors,[],role+': no browser exceptions');
        entry[role]=decoded;
        // Verify the actual remote-control receiver, after unlocking this same
        // element with a user gesture. PLAYER audio intentionally remains local.
        if(q.type==='video'||q.type==='audio'&&role==='obs') {
          const selector=q.type==='video'?'video.quizVideo,#playerVideo':'audio.quizAudio,#playerAudio';
          const controlEvent=q.type==='video'?'hostVideoControl':'hostAudioControl';
          const inspectMedia=()=>page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return {paused:el.paused,time:el.currentTime};})()`);
          const until=async check=>{
            const limit=Date.now()+8000;let value;
            while(!check(value=await inspectMedia())){assert.ok(Date.now()<limit,role+': remote '+q.type+' command did not apply: '+JSON.stringify(value));await sleep(40);}
            return value;
          };
          await page.evaluate(`(async()=>{const el=document.querySelector(${JSON.stringify(selector)});el.muted=false;el.volume=0;await el.play();el.pause();return true;})()`,{userGesture:true});
          await ok(host,controlEvent,{code:room.code,action:'seek',time:0});await until(v=>v.time<0.15);
          await ok(host,controlEvent,{code:room.code,action:'play',time:0});
          const played=await until(v=>!v.paused&&v.time>0.03);
          await ok(host,controlEvent,{code:room.code,action:'pause',time:played.time});
          const paused=await until(v=>v.paused);
          await ok(host,controlEvent,{code:room.code,action:'seek',time:0.5});
          const sought=await until(v=>v.paused&&Math.abs(v.time-0.5)<0.1);
          entry[role].remoteControls={played,paused,sought};
        }
      }
      report.signaling.questions.push(entry);
      host.emit('revealAnswer',{code:room.code});
      for(let i=0;i<160&&host.state?.phase!=='result';i++)await sleep(25);
      assert.equal(host.state.phase,'result');host.emit('nextFromResult',{code:room.code});
      for(let i=0;i<160&&host.state?.phase!=='board';i++)await sleep(25);
      assert.equal(host.state.phase,'board');
      console.log(`ROOM PASS: ${ri}:${ci}:${qi} ${q.type}, 4 public players + OBS + polling${browser?' + real Edge PLAYER/OBS':''}`);
    }
    report.browser=pages.map(({page,role})=>({role,errors:page.errors,responses:page.responses.filter(r=>r.url.startsWith(publicUrl)).map(r=>({path:new URL(r.url).pathname,status:r.status,remoteIPAddress:r.remoteIPAddress,mime:r.mimeType,protocol:r.protocol}))}));
    for(const item of report.browser)assert.ok(item.responses.some(r=>ingress.includes(r.remoteIPAddress)),item.role+': browser uses public ingress');
    report.passed=true;
  } finally {
    for(const {page}of pages)await page.close().catch(()=>{});if(browser)browser.stop();
    if(room&&host?.connected)await ok(host,'closeRoom',{code:room.code});
    sockets.forEach(s=>s.disconnect());
    try{report.healthAfter=JSON.parse((await get('/health')).body);}catch{}
    agent.destroy();fs.mkdirSync(reportDirectory,{recursive:true});
    fs.writeFileSync(path.join(reportDirectory,controlOnly?'control-results.json':'results.json'),JSON.stringify(report,null,2)+'\n');
  }
}
// Socket.IO's polling implementation may retain handles after disconnect. All
// room cleanup and report writes above finish before this CLI process exits.
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
