const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const QRCode = require('qrcode');
const { JSDOM, VirtualConsole } = require('jsdom');
const { io } = require('socket.io-client');
const { startServer } = require('./lib/server');

async function main() {
  const server = await startServer({ HOST_KEY: '' });
  const sockets = [];
  let dom;
  const connect = async () => {
    const socket = io(server.url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  };
  const emit = async (socket, event, payload) => {
    const result = await new Promise((resolve, reject) => {
      socket.timeout(3000).emit(event, payload, (err, value) => err ? reject(err) : resolve(value));
    });
    assert.equal(result.ok, true, `${event}: ${JSON.stringify(result)}`);
    return result;
  };
  const config = async (headers = {}) => {
    const response = await fetch(server.url + '/public-config.js', { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const context = { window: {} };
    vm.runInNewContext(await response.text(), context);
    return context.window.PUBLIC_GAME_URL;
  };
  try {
    assert.equal(await config(), server.url, 'direct access falls back to request origin');
    assert.equal(await config({ 'x-forwarded-proto': 'https' }), server.url.replace('http:', 'https:'));
    const publicUrl = 'https://quiz-test.example';
    const funnelFile = path.join(server.dataDir, '.funnel-url');
    fs.writeFileSync(funnelFile, publicUrl);
    assert.equal(await config(), publicUrl, 'running server picks up Funnel address without restarting');

    const host = await connect();
    const token = 'public-url-test';
    const { code } = await emit(host, 'createRoom', { hostToken: token, gameId: 'season2-kinohardkor-2' });
    await emit(host, 'openAudienceRound', { code, roundIndex: 0 });
    const qrResponse = await fetch(`${server.url}/audience-qr/${code.toLowerCase()}`);
    assert.equal(qrResponse.status, 200);
    assert.equal(await qrResponse.text(), await QRCode.toString(`${publicUrl}/audience/${code}`, {
      type: 'svg', margin: 1, width: 360, errorCorrectionLevel: 'M',
    }), 'QR encodes the same public address as the link');

    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => {
      if (!/Not implemented/.test(error.message)) errors.push(error.message);
    });
    dom = await JSDOM.fromURL(server.url + '/host', {
      runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole,
      beforeParse(window) {
        window.localStorage.setItem('sgHostToken', token);
        window.localStorage.setItem('sgRoomCode', code);
        window.fetch = (url, options) => fetch(new URL(url, server.url), options);
      },
    });
    const deadline = Date.now() + 5000;
    while (!dom.window.document.getElementById('startAudienceQuestion')) {
      assert.ok(Date.now() < deadline, 'host audience lobby did not render: ' + errors.join('; '));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(dom.window.document.body.textContent.includes(`${publicUrl}/audience/${code}`));
    assert.equal(dom.window.document.getElementById('startAudienceQuestion').disabled, true);
    assert.equal(dom.window.document.querySelector('img[alt="QR"]').getAttribute('src'), `/audience-qr/${code}`);
    assert.deepEqual(errors, []);

    const audiencePage = await fetch(`${server.url}/audience/${code}`);
    assert.equal(audiencePage.status, 200);
    const viewer = await connect();
    await emit(viewer, 'joinAudience', { code, name: 'Viewer' });
    const joinedDeadline = Date.now() + 3000;
    while (dom.window.document.getElementById('startAudienceQuestion').disabled) {
      assert.ok(Date.now() < joinedDeadline, 'host must allow starting after a viewer joins');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await emit(host, 'startAudienceQuestion', { code });
    await emit(viewer, 'submitAudienceAnswer', { code, option: 0 });
    await emit(host, 'finishAudienceQuestion', { code });
    console.log('PASS: Funnel link and QR match; local host renders public URL; viewer joins and answers.');
  } finally {
    dom?.window.close();
    for (const socket of sockets) socket.disconnect();
    server.stop();
  }

  const explicit = await startServer({ PUBLIC_URL: 'https://custom.example/', HOST_KEY: '' });
  try {
    fs.writeFileSync(path.join(explicit.dataDir, '.funnel-url'), 'https://old-funnel.example');
    const context = { window: {} };
    vm.runInNewContext(await (await fetch(explicit.url + '/public-config.js')).text(), context);
    assert.equal(context.window.PUBLIC_GAME_URL, 'https://custom.example');
    console.log('PASS: explicit PUBLIC_URL takes precedence over Funnel configuration.');
  } finally {
    explicit.stop();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
