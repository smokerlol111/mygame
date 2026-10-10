// PARK-12: /audience-qr builds its URL from req.protocol (server.js:48). Without
// app.set('trust proxy', ...), Express ignores X-Forwarded-Proto, so behind an HTTPS proxy the QR says http://.
// Usage: node tests/ai_repro/express_protocol_check.js        Exit code 1 = still reproduces.
const fs = require('fs'), path = require('path');
const express = require('express');
const serverSrc = fs.readFileSync(path.resolve(__dirname, '..', '..', 'server.js'), 'utf8');
const trustsProxy = /trust proxy/.test(serverSrc);
const app = express();
if (trustsProxy) app.set('trust proxy', 1); // mirror the server's setting if it ever gets added
app.get('/p', (req, res) => res.send(req.protocol));
const srv = app.listen(0, '127.0.0.1', async () => {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/p`, { headers: { 'X-Forwarded-Proto': 'https' } });
  const protocol = await r.text();
  srv.close();
  const reproduced = !trustsProxy && protocol === 'http';
  console.log(`[PARK-12] server.js sets 'trust proxy': ${trustsProxy}; req.protocol with X-Forwarded-Proto: https -> ${protocol}`);
  console.log(reproduced ? '  => REPRODUCED (QR would encode http://)' : '  => NOT REPRODUCED');
  process.exitCode = reproduced ? 1 : 0;
});
