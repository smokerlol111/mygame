// Optional real-browser checks. Uses a new headless Edge profile, never the user's browser.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startEdge() {
  const executable = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!fs.existsSync(executable)) throw new Error('Microsoft Edge is required for --screenshots');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smokerlol-ui-edge-'));
  const child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 15000;
  const stop = () => {
    child.kill();
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('smokerlol-ui-edge-')) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Edge may still hold its temporary profile. */ }
    }
  };
  while (!fs.existsSync(portFile)) {
    if (launchError || child.exitCode !== null || Date.now() > deadline) {
      stop();
      throw launchError || new Error(`Edge did not start (exit ${child.exitCode})`);
    }
    await sleep(50);
  }
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
  return {
    stop,
    async page(url, width, height, options = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
      const target = await response.json();
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      let nextId = 0;
      const pending = new Map(), errors = [], requests = [], sentFrames = [], receivedFrames = [];
      socket.on('message', raw => {
        const packet = JSON.parse(raw.toString());
        if (packet.method === 'Network.requestWillBeSent') requests.push({ url: packet.params.request.url, type: packet.params.type, method: packet.params.request.method, postData: packet.params.request.postData });
        if (packet.method === 'Network.webSocketFrameSent') sentFrames.push(packet.params.response.payloadData);
        if (packet.method === 'Network.webSocketFrameReceived') receivedFrames.push(packet.params.response.payloadData);
        if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text);
        const entry = pending.get(packet.id);
        if (!entry) return;
        clearTimeout(entry.timer); pending.delete(packet.id);
        packet.error ? entry.reject(new Error(packet.error.message)) : entry.resolve(packet.result);
      });
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
      const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      try {
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Network.enable');
        if (options.session) await send('Page.addScriptToEvaluateOnNewDocument', { source: `for (const [key,value] of Object.entries(${JSON.stringify(options.session)})) localStorage.setItem(key,value);` });
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
        if (options.touch !== undefined) await send('Emulation.setTouchEmulationEnabled', { enabled: options.touch });
        await send('Page.navigate', { url });
        const readyDeadline = Date.now() + 12000;
        while (!await evaluate('document.readyState === "complete" && !!document.body.dataset.uiTheme')) {
          if (Date.now() > readyDeadline) throw new Error(`Theme did not render: ${url}`);
          await sleep(50);
        }
        await evaluate('(async () => { await document.fonts.ready; await Promise.allSettled([...document.images].map(img => img.decode())); return true; })()');
      } catch (error) {
        socket.close();
        throw error;
      }
      return {
        evaluate, errors, requests, sentFrames, receivedFrames,
        async screenshot(file) {
          const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          fs.writeFileSync(file, Buffer.from(data, 'base64'));
        },
        async close() { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); socket.close(); },
      };
    },
  };
}
module.exports = { startEdge };
