// Reproducible local acceptance + browser + historical diagnostics run.
// Each live test owns isolated ports/data; never run tailscale_media_preflight here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const TIMEZONE = process.env.QUIZ_TEST_TIMEZONE || 'Europe/Kiev';
const CLIENT_DATE = process.env.QUIZ_TEST_DATE || new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function staticChecks() {
  const files = ['server.js', 'start.js', 'storage.js', 'public/common.js', 'voice-bot/bot.js']
    .map(file => path.join(ROOT, file))
    .concat(filesIn(path.join(ROOT, 'server')), filesIn(path.join(ROOT, 'tests/ai_repro')),
      filesIn(path.join(ROOT, 'scripts')),
      filesIn(path.join(ROOT, 'public/themes')), filesIn(path.join(ROOT, 'public/classic')), [path.join(ROOT,'public/board-random.js')])
    .filter(file => file.endsWith('.js'));
  for (const file of files) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error(path.relative(ROOT, file) + '\n' + check.stderr);
  }
  let scripts = 0;
  for (const file of filesIn(path.join(ROOT, 'public')).filter(file => file.endsWith('.html'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || /\btype\s*=\s*["']application\//i.test(match[1])) continue;
      new vm.Script(match[2], { filename: path.relative(ROOT, file) });
      scripts++;
    }
  }
  let json = 0;
  for (const file of filesIn(path.join(ROOT, 'games')).filter(file => file.endsWith('.json'))) {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    json++;
  }
  const diff = spawnSync('git', ['diff', '--check'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (diff.status !== 0) throw new Error(diff.stdout + diff.stderr);
  console.log(`PASS: syntax of ${files.length} JavaScript files and ${scripts} inline scripts; ${json} game JSON files parse; git diff --check`);
}

function snapshot() {
  const protectedFiles = ['server.js', 'start.js', 'storage.js', 'package.json', 'package-lock.json', 'voice-bot/bot.js', 'data/seasons.json']
    .map(file => path.join(ROOT, file)).filter(file => fs.existsSync(file))
    .concat(filesIn(path.join(ROOT, 'server')), filesIn(path.join(ROOT, 'public')), filesIn(path.join(ROOT, 'games')));
  const manifest = {};
  for (const file of protectedFiles.sort()) {
    const stat = fs.statSync(file);
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    manifest[relative] = /\.(js|json|html|css|md)$/.test(file)
      ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      : `${stat.size}:${stat.mtimeMs}`;
  }
  return manifest;
}

const script = (id, file = id, args = [], lane = 'core', diagnostic = false) => ({
  id, lane, diagnostic, args: ['tests/ai_repro/' + file + '.js', ...args],
});
const jobs = [
  { id: 'static-preflight', lane: 'core', args: ['tests/ai_repro/full_local_suite.js', '--static'] },
  { id: 'question-topic-index', lane:'core', args:['scripts/build-question-topic-index.js','--verify'] },
  script('question_bank_approval_regression'),
  { id: 'server-registration', lane: 'core', args: ['--test', 'tests/ai_repro/server_registration_regression.js'] },
  script('classic_quiz_regression'),
  script('classic_random_pool_regression'),
  script('board_random_regression'),
  script('board_random_ui','board_random_ui',[],'browser'),
  script('classic_ui_regression', 'classic_ui_regression', [], 'browser'),
  { id: 'server-lifecycle', lane: 'core', args: ['--test', 'tests/ai_repro/server_lifecycle_regression.js'] },
  { id: 'discord-voice', lane: 'core', args: ['--test', 'tests/ai_repro/discord_voice_regression.js'] },
  script('server_modules_regression'), script('game_safety_regression'), script('numeric_turn_regression'),
  script('archived_games_regression'),
  script('grand_final_smoke'), script('buzz_reactions'), script('audience_public_url'),
  { ...script('all_games_smoke'), timeoutMs: 900000 },
  script('audience_rejoin_security'), script('season_grand_final'), script('season_wild_card'),
  script('player_join_regression'), script('host_reload_repro'), script('host_review_risks', 'host_review_risks', ['--fixed']),
  script('host_live_updates', 'host_live_updates', ['--browser', '--liveness'], 'browser'),
  script('halloween_theme', 'halloween_theme', ['--screenshots', '--traffic'], 'browser'),
  script('player_join_theme', 'player_join_theme', ['--browser'], 'browser'),
  script('grand_final_standard_browser', 'grand_final_standard_browser', ['--screenshots'], 'browser'),
  script('media_live_regression', 'media_live_regression', [], 'browser'),
  script('player_audio_host', 'player_audio_host', [], 'browser'),
  script('obs_content_fit', 'obs_content_fit', [], 'browser'),
  script('obs_camera_stability', 'obs_camera_stability', [], 'browser'),
  script('css_check'),
  script('validate_games', 'validate_games', [], 'core', true),
  script('server_repros', 'server_repros', [], 'core', true),
  script('storage_repros', 'storage_repros', [], 'core', true),
  script('express_protocol_check', 'express_protocol_check', [], 'core', true),
  script('check_doc_refs', 'check_doc_refs', [], 'core', true),
];

async function main() {
  if (process.argv.includes('--static')) return staticChecks();
  const onlyBrowser = process.argv.includes('--browser-only');
  const onlyCore = process.argv.includes('--core-only');
  const onlyIds = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
  if (onlyIds?.some(id => !jobs.some(job => job.id === id))) throw new Error('Unknown --only job');
  if (onlyBrowser && onlyCore) throw new Error('Choose one lane or omit both flags');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(CLIENT_DATE)) throw new Error('QUIZ_TEST_DATE must be YYYY-MM-DD');
  const reportDir = path.join(ROOT, 'archive/audits/full-local-' + CLIENT_DATE, 'run-' + Date.now());
  fs.mkdirSync(reportDir, { recursive: true });
  const before = snapshot();
  fs.writeFileSync(path.join(reportDir, 'protected-files-before.json'), JSON.stringify(before, null, 2) + '\n');
  const beforeStatus = execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  const report = {
    clientDate: CLIENT_DATE, timezone: TIMEZONE, startedAt: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    workingTree: beforeStatus, node: process.version,
    scope: 'Isolated local servers, throwaway JSON storage, jsdom and headless Edge; no live server/Funnel, production database, real Discord, phones or OBS compositor.',
    excluded: ['tailscale_media_preflight.js (uses the existing server/Funnel)', 'host_review_risks.js without --fixed (expects repaired defects)', 'PostgreSQL integration (no isolated PostgreSQL configured)'],
    results: [],
  };
  let baselineEntry;
  if (process.argv.includes('--baseline-server')) {
    const source = execFileSync('git', ['show', report.head + ':server.js'], { cwd: ROOT });
    fs.writeFileSync(path.join(reportDir, 'server-before-refactor.js'), source);
    baselineEntry = path.join(reportDir, 'baseline-loader.js');
    fs.writeFileSync(baselineEntry, [
      'const fs = require("node:fs");', 'const path = require("node:path");', 'const Module = require("node:module");',
      'const root = path.resolve(__dirname, "../../../..");', 'const filename = path.join(root, "server.js");',
      'const baseline = new Module(filename, module);', 'baseline.filename = filename;',
      'baseline.paths = Module._nodeModulePaths(root);',
      'const nativeRequire = baseline.require.bind(baseline);',
      'baseline.require = name => name !== "fs" || !process.env.GAMES_INDEX_FILE ? nativeRequire(name) : new Proxy(fs, { get(target, field) {',
      '  if (field !== "readFileSync") return target[field];',
      '  return (file, ...args) => { const base = path.join(root, "games"); const full = typeof file === "string" ? path.resolve(file) : "";',
      '    const input = full.startsWith(base + path.sep) ? path.join(path.dirname(process.env.GAMES_INDEX_FILE), path.relative(base, full)) : file;',
      '    return target.readFileSync(input, ...args); };',
      '} });',
      'baseline._compile(fs.readFileSync(path.join(__dirname, "server-before-refactor.js"), "utf8"), filename);',
    ].join('\n') + '\n');
    report.baselineServer = { sha: report.head, source: 'server-before-refactor.js', sha256: crypto.createHash('sha256').update(source).digest('hex') };
  }
  const save = () => fs.writeFileSync(path.join(reportDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('REPORT: ' + path.relative(ROOT, reportDir));
  save();

  async function run(job) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const log = fs.createWriteStream(path.join(reportDir, job.id + '.log'));
    const artifactDir = path.join(reportDir, job.id);
    fs.mkdirSync(artifactDir, { recursive: true });
    const env = { ...process.env, HOST_KEY: '', PUBLIC_URL: '', QUIZ_TEST_ARTIFACT_DIR: artifactDir };
    if (baselineEntry) env.QUIZ_TEST_SERVER_ENTRY = baselineEntry;
    const testModules = path.join(ROOT, 'node_modules/.full-local-tools/node_modules');
    if (fs.existsSync(testModules)) env.NODE_PATH = [testModules, env.NODE_PATH].filter(Boolean).join(path.delimiter);
    for (const key of ['DATABASE_URL', 'PGSSL', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_VOICE_CHANNEL_ID']) delete env[key];
    console.log('START: ' + job.id);
    const child = spawn(process.execPath, job.args, { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, launchError = null;
    const append = chunk => { output += chunk; log.write(chunk); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
    }, job.timeoutMs || 240000);
    const code = await new Promise(resolve => {
      child.once('error', error => { launchError = error.message; resolve(null); });
      child.once('close', resolve);
    });
    clearTimeout(timeout);
    await new Promise(resolve => log.end(resolve));
    const result = {
      id: job.id, command: ['node', ...job.args], lane: job.lane, diagnostic: !!job.diagnostic,
      startedAt, durationMs: Date.now() - started, exitCode: code, timedOut, launchError,
      status: code === 0 && !timedOut && !launchError ? 'PASS' : job.diagnostic ? 'DIAGNOSTIC_FINDINGS' : 'FAIL',
      log: job.id + '.log', artifacts: job.id, tail: output.trim().split(/\r?\n/).slice(-9),
    };
    report.results.push(result);
    save();
    console.log(`${result.status}: ${job.id} (${(result.durationMs / 1000).toFixed(1)} s)`);
    if (result.status !== 'PASS') console.log(result.tail.join('\n'));
  }

  const selected = jobs.filter(job => !onlyIds || onlyIds.includes(job.id));
  const core = selected.filter(job => job.lane === 'core' && !onlyBrowser);
  const browser = selected.filter(job => job.lane === 'browser' && !onlyCore);
  // Core tests use independent servers; browser tests run sequentially to avoid CDP contention.
  await Promise.all([
    ...Array.from({ length: 3 }, async () => { for (;;) { const job = core.shift(); if (!job) break; await run(job); } }),
    (async () => { for (const job of browser) await run(job); })(),
  ]);
  const after = snapshot();
  fs.writeFileSync(path.join(reportDir, 'protected-files-after.json'), JSON.stringify(after, null, 2) + '\n');
  report.protectedFilesChanged = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(file => before[file] !== after[file]);
  report.completedAt = new Date().toISOString();
  report.summary = {
    acceptancePassed: report.results.filter(result => !result.diagnostic && result.status === 'PASS').length,
    acceptanceFailed: report.results.filter(result => !result.diagnostic && result.status !== 'PASS').length,
    diagnosticsWithFindings: report.results.filter(result => result.diagnostic && result.status !== 'PASS').length,
    protectedFilesUnchanged: report.protectedFilesChanged.length === 0,
  };
  save();
  console.log('SUMMARY: ' + JSON.stringify(report.summary));
  console.log('RESULTS: ' + path.relative(ROOT, path.join(reportDir, 'results.json')));
  process.exitCode = report.summary.acceptanceFailed || !report.summary.protectedFilesUnchanged ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
