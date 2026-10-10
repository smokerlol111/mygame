// Reproductions of storage.js bugs (JSON mode) from found_bugs.md.
// Usage: node tests/ai_repro/storage_repros.js [R12,R14,...]   (no argument = run all)
// Each repro runs in its own child process with a fresh temp DATA_DIR, because storage.js
// reads env vars and keeps state at module load. DATABASE_URL is removed, so PostgreSQL is never touched.
// Exit code 1 = at least one bug still reproduces.
const { spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const STORAGE = path.resolve(__dirname, '..', '..', 'storage.js');
const CHILD_FLAG = '--child';

const repros = {
  async R12() { // PARK-08
    const dir = process.env.DATA_DIR, file = path.join(dir, 'seasons.json');
    // Simulate a crash in the middle of writeFileSync: the file holds half a JSON document.
    const good = { seasons: [{ id: 's_old', name: 'Сезон 1', status: 'active', createdAt: '2026-01-01T00:00:00Z', completedAt: null }],
      games: Array.from({ length: 12 }, (_, i) => ({ id: 'g' + i, seasonId: 's_old', roomCode: 'R' + i, gameId: 'x', title: 't', playedAt: '2026-01-0' + (i % 9 + 1) + 'T00:00:00Z', isGrandFinal: false, results: [] })) };
    const text = JSON.stringify(good, null, 2);
    fs.writeFileSync(file, text.slice(0, Math.floor(text.length / 2)));
    const storage = require(STORAGE);
    await storage.init(); // logs the SyntaxError, then continues
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { bug: 'PARK-08', title: 'Corrupted seasons.json is silently replaced; history is gone',
      expected: 'startup refuses or keeps the data', actual: `12 games before (file cut in half) -> ${after.games.length} games after init, seasons=${JSON.stringify(after.seasons.map(s => s.name))}`,
      reproduced: after.games.length === 0 };
  },
  async R14() { // RULE-01
    const storage = require(STORAGE);
    await storage.init();
    const [season] = await storage.listSeasons();
    await storage.saveGame({ seasonId: season.id, roomCode: 'TIE1', gameId: 'x', title: 'tie', results: [{ id: 'b', name: 'Богдан', score: 1000 }, { id: 'a', name: 'Андрій', score: 1000 }] });
    const r = (await storage.seasonDetails(season.id)).games[0].results;
    return { bug: 'RULE-01', title: 'Tied final scores get different places/season points (alphabetical)',
      expected: 'equal scores -> equal points (or an explicit tie-break)', actual: JSON.stringify(r.map(x => ({ name: x.name, score: x.score, place: x.place, seasonPoints: x.seasonPoints }))),
      reproduced: r[0].score === r[1].score && r[0].seasonPoints !== r[1].seasonPoints };
  },
  async R15() { // RULE-02
    const storage = require(STORAGE);
    await storage.init();
    const [s1] = await storage.listSeasons();
    await storage.saveGame({ seasonId: s1.id, roomCode: 'Q0', gameId: 'x', title: 't', results: [{ name: 'A', score: 1 }] });
    await storage.setSeasonStatus(s1.id, 'completed');
    const sid = await storage.createSeason('Сезон 2'); // the NAME makes it a qualifiers season
    const play = async (code, winner) => {
      await storage.saveGame({ seasonId: sid, roomCode: code, gameId: 'x', title: code, results: [{ name: winner, score: 900 }, { name: 'B', score: 500 }, { name: 'C', score: 300 }, { name: 'D', score: 100 }] });
      await new Promise(r => setTimeout(r, 5)); // distinct playedAt
    };
    await play('G1', 'Alice'); await play('G2', 'Alice'); await play('G3', 'Bob');
    const d = await storage.seasonDetails(sid);
    const names = d.qualification.grandFinalists.map(x => x.name);
    return { bug: 'RULE-02', title: 'Qualifiers: the same winner takes two Grand Final spots',
      expected: '4 distinct finalists (or a defined rule)', actual: `format=${d.seasonFormat}; grandFinalists=${JSON.stringify(names)}`,
      reproduced: new Set(names).size !== names.length };
  },
  async R16() { // PARK-09
    const storage = require(STORAGE);
    await storage.init();
    const [s1] = await storage.listSeasons();
    await storage.saveGame({ seasonId: s1.id, roomCode: 'X', gameId: 'x', title: 't', results: [{ name: 'A', score: 1 }] });
    await storage.setSeasonStatus(s1.id, 'completed');
    await Promise.allSettled([storage.createSeason('Race A'), storage.createSeason('Race B')]);
    const active = (await storage.listSeasons()).filter(s => s.status === 'active');
    return { bug: 'PARK-09', title: 'Two simultaneous createSeason calls -> two active seasons',
      expected: '1 active season', actual: `${active.length} active: ${JSON.stringify(active.map(s => s.name))}`,
      reproduced: active.length > 1 };
  },
};

if (process.argv[2] === CHILD_FLAG) {
  repros[process.argv[3]]().then(r => { process.stdout.write('\n@@RESULT@@' + JSON.stringify(r)); })
    .catch(e => { process.stdout.write('\n@@RESULT@@' + JSON.stringify({ error: e.stack })); });
} else {
  const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
  let anyReproduced = false;
  for (const id of Object.keys(repros)) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smokerlol-storage-repro-'));
    const env = { ...process.env, DATA_DIR: dataDir };
    delete env.DATABASE_URL; delete env.PGSSL;
    const out = spawnSync(process.execPath, [__filename, CHILD_FLAG, id], { env, encoding: 'utf8' });
    fs.rmSync(dataDir, { recursive: true, force: true });
    const raw = (out.stdout || '').split('@@RESULT@@')[1];
    const r = raw ? JSON.parse(raw) : { error: out.stderr || 'no output' };
    if (r.error) { console.log(`\n[${id}] ERROR ${r.error}`); anyReproduced = true; continue; }
    anyReproduced ||= r.reproduced;
    console.log(`\n[${id}] (${r.bug}) ${r.title}\n  expected: ${r.expected}\n  actual:   ${r.actual}\n  => ${r.reproduced ? 'REPRODUCED' : 'NOT REPRODUCED'}`);
  }
  process.exitCode = anyReproduced ? 1 : 0;
}
