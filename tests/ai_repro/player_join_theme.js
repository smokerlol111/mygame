// Public pre-join theme lookup + actual PLAYER login. Uses isolated rooms/data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { io } = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const { startServer, REPO_ROOT } = require('./lib/server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const server = await startServer({ HOST_KEY: 'join-theme-test' });
  const sockets = [], pages = [], errors = [];
  const waitFor = async (check, label) => {
    const deadline = Date.now() + 6000;
    while (!check()) { assert.deepEqual(errors, []); assert.ok(Date.now() < deadline, label); await sleep(20); }
  };
  const connect = async () => {
    const socket = io(server.url, { transports:['websocket'], reconnection:false });
    sockets.push(socket);
    socket.on('state', state => { socket.state = state; });
    await new Promise((resolve,reject) => {socket.once('connect',resolve);socket.once('connect_error',reject);});
    return socket;
  };
  const ok = async (socket,event,payload) => {
    const result = await socket.timeout(3000).emitWithAck(event,payload);
    assert.equal(result.ok,true,JSON.stringify(result)); return result;
  };
  const load = async route => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.detail?.message || error.message));
    const page = await JSDOM.fromURL(server.url+route, {
      runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole,
      beforeParse(win) {
        win.localStorage.setItem('sgPlayerName','Saved name');
        win.HTMLMediaElement.prototype.play = () => Promise.resolve();
        win.HTMLMediaElement.prototype.pause = () => {};
        win.HTMLMediaElement.prototype.load = () => {};
      },
    });
    pages.push(page);return page;
  };
  try {
    const host = await connect();
    const room = await ok(host,'createRoom',{hostKey:'join-theme-test',hostToken:'join-theme-host',gameId:'general-knowledge'});
    await ok(host,'setUiTheme',{code:room.code,uiTheme:'halloween'});
    const otherHost = await connect();
    const standard = await ok(otherHost,'createRoom',{hostKey:'join-theme-test',hostToken:'standard-host',gameId:'general-knowledge'});
    const visitor = await connect();
    const events = [];
    visitor.onAny(event => events.push(event));
    const metadata = await ok(visitor,'getRoomTheme',{code:room.code.toLowerCase()});
    assert.deepEqual(metadata,{ok:true,code:room.code,uiTheme:'halloween'},'anonymous response contains only theme metadata');
    const missingCode = ['ZZZZ','XXXX','YYYY'].find(code=>![room.code,standard.code].includes(code));
    assert.deepEqual(await visitor.timeout(3000).emitWithAck('getRoomTheme',{code:missingCode}),{ok:false});
    await ok(host,'setUiTheme',{code:room.code,uiTheme:null});
    await sleep(50);
    assert.deepEqual(events,[],'theme lookup does not subscribe the visitor to gameplay broadcasts');
    await ok(host,'setUiTheme',{code:room.code,uiTheme:'halloween'});
    assert.equal(host.state.players.length,0,'lookup does not occupy a player seat');

    const page = await load('/play?room='+room.code);
    const win = page.window,doc = win.document;
    await waitFor(()=>doc.getElementById('join')&&doc.body.dataset.uiTheme==='halloween','link with room code themes the login form');
    assert.equal(win.eval('joined'),false);
    assert.equal(win.eval('state'),null);
    assert.equal(doc.getElementById('toggleTheme'),null);
    assert.equal(doc.getElementById('code').value,room.code);
    const name = doc.getElementById('name');
    name.value='Typed name';name.focus();
    win.eval('window.themeLookups=0;socket.onAnyOutgoing(event=>{if(event==="getRoomTheme")window.themeLookups++;})');
    const enterCode = value => {doc.getElementById('code').value=value;doc.getElementById('code').dispatchEvent(new win.Event('input',{bubbles:true}));};
    for(const value of [room.code,room.code.toLowerCase(),room.code]) enterCode(value);
    assert.equal(win.themeLookups,0,'identical normalized code is not queried again');
    for(const value of ['A','AB','ABC']) enterCode(value);
    assert.equal(win.themeLookups,0,'incomplete codes create no theme queries');
    assert.equal(doc.body.dataset.uiTheme,undefined);
    enterCode(room.code);
    await waitFor(()=>doc.body.dataset.uiTheme==='halloween','manual full code gets the theme');
    assert.equal(win.themeLookups,1);
    await sleep(150);
    assert.equal(win.themeLookups,1,'no repeat query while the form is idle');
    assert.equal(doc.getElementById('name'),name);
    assert.equal(name.value,'Typed name');
    assert.equal(doc.activeElement,name);
    enterCode(standard.code);
    await sleep(70);
    assert.equal(doc.body.dataset.uiTheme,undefined,'another standard room clears the old theme');
    enterCode(missingCode);
    await sleep(70);
    assert.equal(doc.body.dataset.uiTheme,undefined,'missing room keeps the normal join form');
    assert.ok(doc.getElementById('err').classList.contains('hidden'),'lookup does not interrupt typing with join errors');

    // Deliver stale asynchronous responses out of order, then deliver one after joining.
    win.eval(`window.lookupReplies=[];window.originalTimeout=socket.timeout;socket.timeout=function(){return {emit(event,payload,reply){if(event!=='getRoomTheme')throw new Error(event);lookupReplies.push({payload,reply});}};}`);
    enterCode(room.code);enterCode(standard.code);
    assert.equal(win.lookupReplies.length,2);
    win.lookupReplies[1].reply(null,{ok:true,code:standard.code,uiTheme:null});
    win.lookupReplies[0].reply(null,{ok:true,code:room.code,uiTheme:'halloween'});
    assert.equal(doc.body.dataset.uiTheme,undefined,'late response for an earlier code is ignored');
    enterCode(room.code);
    const lateReply=win.lookupReplies[2].reply;
    win.eval('socket.timeout=originalTimeout');
    doc.getElementById('join').click();
    await waitFor(()=>doc.getElementById('leaveRoom'),'actual join still works');
    assert.equal(doc.body.dataset.uiTheme,'halloween');
    lateReply(null,{ok:true,code:room.code,uiTheme:null});
    assert.equal(doc.body.dataset.uiTheme,'halloween','pending login response cannot override joined state');
    await waitFor(()=>host.state.players.length===1,'one actual player joined');
    assert.equal(host.state.players[0].name,'Typed name');
    assert.deepEqual(errors,[]);
    console.log('PASS: themed link/manual-code login, no partial/duplicate/idle lookups, theme-only public response, no seat/subscription, inputs preserved, stale responses ignored, real join');

    if(process.argv.includes('--browser')) {
      const {startEdge}=require('./lib/edge');
      const browser=await startEdge();
      let tab;
      try {
        tab=await browser.page(server.url+'/play?room='+room.code,1280,900);
        assert.equal(await tab.evaluate('!!document.getElementById("join") && !joined'),true);
        // Socket.IO may send the first command over HTTP polling before its
        // WebSocket upgrade, so count both transports.
        const lookupCount=()=>tab.sentFrames.filter(frame=>frame.includes('"getRoomTheme"')).length+tab.requests.filter(request=>request.postData?.includes('"getRoomTheme"')).length;
        assert.equal(lookupCount(),1,'prefilled link makes one theme lookup');
        const count=tab.requests.length;
        await sleep(3500);
        assert.equal(lookupCount(),1,'real Edge has no idle theme polling on login');
        assert.equal(tab.requests.slice(count).filter(request=>request.url.includes('/themes/')).length,0);
        assert.equal(host.state.players.length,1,'browser login form did not join automatically');
        await tab.screenshot(path.join(REPO_ROOT,'themes/halloween/previews/player-join-halloween.png'));
        console.log('PASS: actual Edge pre-join form, one lookup, 3.5 s idle without repeated theme commands/assets; screenshot saved');
      } finally {if(tab)await tab.close();browser.stop();}
    }
  } finally {pages.forEach(page=>page.window.close());sockets.forEach(socket=>socket.disconnect());server.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
