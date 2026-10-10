// Validates every game listed in games/index.json against the rules server.js actually implements.
// Found RULE-06 (unknown type "numeric"). Also guards the latent assumptions listed in found_bugs.md.
// Usage: node tests/ai_repro/validate_games.js        Exit code 1 = issues found.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'games', 'index.json'), 'utf8'));
const KNOWN = new Set([undefined, 'normal', 'text', 'emoji', 'triplet', 'numericClosest', 'audio', 'audioReveal', 'video', 'imageReveal']);
const exists = u => { if (typeof u !== 'string' || !u.startsWith('/')) return null; return fs.existsSync(path.join(root, 'public', u.replace(/^\//, ''))); };
let total = 0;
for (const meta of index) {
  const g = JSON.parse(fs.readFileSync(path.join(root, 'games', meta.file), 'utf8'));
  const issues = [];
  (g.rounds || []).forEach((r, ri) => (r.categories || []).forEach((c, ci) => {
    if ((c.questions || []).length !== 5) issues.push(`round ${ri} cat ${ci}: ${c.questions?.length} questions (UI assumes 5)`);
    (c.questions || []).forEach((q, qi) => {
      const k = `${ri}:${ci}:${qi}`;
      if (!KNOWN.has(q.type)) issues.push(`${k} unknown type "${q.type}" -> server plays it as a normal buzz question`);
      for (const f of ['media', 'audio', 'video', 'image', 'answerImage', 'answerVideo', 'answerAudio']) { const v = q[f]; if (v !== undefined && exists(v) === false) issues.push(`${k} ${f} missing file: ${v}`); }
      if (q.type === 'numericClosest' && !Number.isFinite(Number(q.numericAnswer))) issues.push(`${k} numericClosest without numeric numericAnswer`);
      if (q.type === 'numericClosest' && q.seconds !== undefined && Number(q.seconds) !== 30) issues.push(`${k} seconds=${q.seconds} but server hard-codes 30 s`);
      if (q.type === 'emoji' && !String(q.emoji || '').trim()) issues.push(`${k} emoji question without emoji`);
      if (q.type === 'triplet' && !(Array.isArray(q.triplet) && q.triplet.length >= 3)) issues.push(`${k} triplet with <3 items`);
      if (q.type === 'imageReveal' && !q.image) issues.push(`${k} imageReveal without image`);
      if (q.cat && ri !== 1) issues.push(`${k} has q.cat in round index ${ri}; server only treats q.cat as Cat in round index 1 (server.js:807)`);
    });
  }));
  (g.audienceRounds || []).forEach((ar, ai) => {
    if ((ar.questions || []).length !== 3) issues.push(`audience round ${ai} has ${ar.questions?.length} questions (UI hard-codes "/3")`);
    (ar.questions || []).forEach((q, qi) => {
      if (!Array.isArray(q.options) || q.options.length !== 4) issues.push(`audience ${ai}:${qi} has ${q.options?.length} options (UI labels assume ABCD)`);
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= (q.options || []).length) issues.push(`audience ${ai}:${qi} invalid correct index ${q.correct}`);
    });
  });
  if (g.audienceQuestionSeconds !== undefined && ![15, 30].includes(g.audienceQuestionSeconds)) issues.push(`audienceQuestionSeconds=${g.audienceQuestionSeconds} -> server uses 15 s (server.js:1198)`);
  if (!g.final) issues.push('no final');
  if (g.firstTurnQuiz && !Number.isFinite(Number(g.firstTurnQuiz.answer))) issues.push('firstTurnQuiz.answer not numeric');
  if ((g.rounds || []).length !== 2) issues.push(`${(g.rounds || []).length} rounds (server nextRound only supports 0 -> 1)`);
  for (const [kind, keys] of Object.entries(g.specialPools || {})) for (const key of keys) {
    const [ri, ci, qi] = key.split(':').map(Number);
    const q = g.rounds?.[ri]?.categories?.[ci]?.questions?.[qi];
    if (!q) issues.push(`specialPools.${kind} ${key} points to nothing`);
    else if (ri !== 1) issues.push(`specialPools.${kind} ${key} not in round index 1 (legacy mode only uses round 1)`);
  }
  total += issues.length;
  console.log(`\n### ${meta.id} (${meta.file}) enabled=${meta.enabled !== false}`);
  console.log(issues.length ? issues.map(x => ' - ' + x).join('\n') : ' (no issues found)');
}
console.log(`\n${total} issue(s) total`);
process.exitCode = total ? 1 : 0;
