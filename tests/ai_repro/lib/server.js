// Starts an ISOLATED copy of ../../server.js for reproductions:
// random free port, throwaway DATA_DIR, no DATABASE_URL, no Discord bot.
// Some repros complete seasons and delete saved games, so they must never touch real data.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// Replay the frozen completed packs; the production catalog can intentionally be empty.
const REPLAY_CATALOG = path.join(REPO_ROOT, 'archive/completed-games/2026-11-22/games/index.json');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function startServer(overrides = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smokerlol-repro-'));
  const env = { ...process.env, PUBLIC_URL: '', FUNNEL_URL_FILE: path.join(dataDir, '.funnel-url'),
    GAMES_INDEX_FILE: fs.existsSync(REPLAY_CATALOG) ? REPLAY_CATALOG : path.join(REPO_ROOT, 'games/index.json'),
    ...overrides, PORT: String(port), DATA_DIR: dataDir, DOTENV_CONFIG_PATH: path.join(dataDir, '.env') };
  for (const key of ['DATABASE_URL', 'PGSSL', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_VOICE_CHANNEL_ID']) delete env[key];
  const entry = process.env.QUIZ_TEST_SERVER_ENTRY || 'server.js';
  const child = spawn(process.execPath, [entry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('server.js exited during startup:\n' + output);
    try { if ((await fetch(url + '/health')).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error('server.js did not answer /health within 15 s:\n' + output); }
    await new Promise(r => setTimeout(r, 200));
  }
  return {
    url, port, dataDir, repoRoot: REPO_ROOT, catalogPath: env.GAMES_INDEX_FILE,
    stop() {
      child.kill();
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

module.exports = { startServer, REPO_ROOT, REPLAY_CATALOG };
