// Freeze completed game packs + referenced media, export one readable question bank,
// verify every ZIP entry, then hide the originals from the active menu.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const DATE = '2026-11-22';
const RELATIVE = 'archive/completed-games/' + DATE;
const DIRECTORY = path.join(ROOT, RELATIVE);
const BANK = 'archive/QUESTION_BANK.md';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const read = file => fs.readFileSync(path.join(ROOT, file));
const write = (file, value) => fs.writeFileSync(path.join(ROOT, file), value, { flag: 'wx' });
const mediaFields = /^(media|image|audio|video|answerImage|answerVideo|answerAudio|answerAudioFile)$/;
const season = id => id === 'halloween-special-2026' ? 'Спецгра Halloween' : id.startsWith('season2-') ? 'Сезон 2' : 'Сезон 1';

function zip(mode) {
  process.stdout.write(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'game-archive-zip.ps1'), '-Mode', mode,
    '-PlanPath', path.join(DIRECTORY, 'zip-plan.json'), '-ArchivePath', path.join(DIRECTORY, 'games-and-media.zip')],
  { cwd: ROOT, encoding: 'utf8', windowsHide: true }));
}

function packageArchive() {
  zip('Create');
  zip('Verify');
  fs.writeFileSync(path.join(DIRECTORY, 'ARCHIVE.sha256'), hash(read(RELATIVE + '/games-and-media.zip')) + '  games-and-media.zip\n');
}

function verify() {
  const manifest = JSON.parse(read(RELATIVE + '/manifest.json'));
  for (const file of manifest.gameFiles) {
    if (hash(read(file.archivedPath)) !== file.sha256) throw new Error('Game copy differs: ' + file.archivedPath);
  }
  if (hash(read(manifest.questionBank.archivedPath)) !== manifest.questionBank.sha256) throw new Error('Archived question bank differs');
  zip('Verify');
  const digest = hash(read(RELATIVE + '/games-and-media.zip'));
  if (read(RELATIVE + '/ARCHIVE.sha256').toString().split(' ')[0] !== digest) throw new Error('ZIP checksum differs');
  console.log('PASS: immutable game copies, question bank, every ZIP entry and ZIP SHA-256');
}

function create() {
  if (fs.existsSync(DIRECTORY) || fs.existsSync(path.join(ROOT, BANK))) throw new Error('Archive/bank already exists; use --verify. Nothing overwritten.');
  const indexBytes = read('games/index.json');
  const index = JSON.parse(indexBytes);
  const completed = new Set(['kinohardkor','general-knowledge','back-to-2000s-test','friends-super-final',
    'season2-kinohardkor-2','season2-general-knowledge-2','season2-memes-internet','season2-grand-final','halloween-special-2026']);
  if (index.length !== completed.size || index.some(meta => !completed.has(meta.id))) throw new Error('Catalog differs from the nine owner-confirmed games; review scope first.');
  fs.mkdirSync(path.join(DIRECTORY, 'games'), { recursive: true });
  fs.mkdirSync(path.join(DIRECTORY, 'legacy'));
  write(RELATIVE + '/games/index.json', indexBytes);
  const gameFiles = [], assets = new Set(), records = [];
  const counts = { main: 0, firstTurn: 0, final: 0, audience: 0, tripletParts: 0, catAlternatives: 0 };
  const lines = ['# Спільний банк питань проведених ігор', '',
    'Знімок: ' + DATE + '. Усі дев’ять ігор підтверджені власником як завершені. Дата знімка не є датою проведення.', '',
    'Це один довідковий файл для підготовки наступних ігор: шукайте текст, відповідь, категорію або ID. Повтори між іграми збережено з окремим походженням.', '',
    'Оригінали та медіа збережено в `' + RELATIVE + '/games-and-media.zip`. Сервер цей банк не завантажує. Результати гравців і таблиці сезонів сюди не входять.', ''];
  function media(object) {
    for (const [field, value] of Object.entries(object || {})) {
      if (typeof value === 'string' && value.startsWith('/') && mediaFields.test(field)) {
        const absolute = path.resolve(ROOT, 'public', value.slice(1));
        if (!absolute.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.statSync(absolute).isFile()) throw new Error('Invalid/missing media: ' + value);
        assets.add('public/' + value.slice(1));
      } else if (value && typeof value === 'object') media(value);
    }
  }
  const quote = value => String(value ?? '').split(/\r?\n/).map(line => '> ' + line).join('\n');
  function content(item, depth) {
    lines.push('**Питання:**', quote(item.q ?? item.question ?? ''), '');
    const answer = Object.hasOwn(item, 'correct') && item.options ? item.options[item.correct] : item.a ?? item.answer;
    lines.push('**Відповідь:**', quote(answer === '' || answer === undefined ? 'Див. підпитання / технічні дані нижче.' : answer), '');
    if (item.options) lines.push('**Варіанти:**', ...item.options.map((option, i) => `${i + 1}. ${option}`), '');
    if (item.triplet) for (const [i, part] of item.triplet.entries()) {
      lines.push('#'.repeat(depth) + ` Підпитання триплета ${i + 1}`, '');
      content(part, depth + 1);
    }
    if (item.cat) { lines.push('#'.repeat(depth) + ' Альтернативне питання Кота в мішку', ''); content(item.cat, depth + 1); }
    const metadata = Object.fromEntries(Object.entries(item).filter(([field]) => !['q','question','a','answer','options','triplet','cat'].includes(field)));
    if (Object.keys(metadata).length) lines.push('<details><summary>Механіка, медіа й редакторські позначки</summary>', '', '```json', JSON.stringify(metadata, null, 2), '```', '', '</details>', '');
  }
  for (const meta of index) {
    const sourcePath = 'games/' + meta.file, archivedPath = RELATIVE + '/games/' + meta.file;
    const bytes = read(sourcePath), game = JSON.parse(bytes);
    write(archivedPath, bytes);
    gameFiles.push({ gameId: meta.id, group: season(meta.id), sourcePath, archivedPath, sha256: hash(bytes), bytes: bytes.length });
    media(game);
    lines.push('## ' + season(meta.id) + ' · ' + meta.title, '', '**ID гри:** `' + meta.id + '` · **Оригінал:** `' + archivedPath + '`', '');
    const settings = Object.fromEntries(Object.entries(game).filter(([field]) => !['rounds','firstTurnQuiz','final','audienceRounds'].includes(field)));
    lines.push('<details><summary>Налаштування гри й спецмеханік</summary>', '', '```json', JSON.stringify(settings, null, 2), '```', '', '</details>', '');
    function add(kind, id, pointer, label, item) {
      counts[kind]++;
      counts.tripletParts += item.triplet?.length || 0;
      counts.catAlternatives += item.cat ? 1 : 0;
      records.push({ id, gameId: meta.id, kind, pointer, payload: item });
      lines.push('### ' + label, '', '**ID:** `' + id + '` · **Джерело:** `' + archivedPath + '#' + pointer + '`', '');
      content(item, 4);
    }
    if (game.firstTurnQuiz) add('firstTurn', meta.id + ':first-turn', '/firstTurnQuiz', 'Стартовий розіграш', game.firstTurnQuiz);
    for (const [ri, round] of (game.rounds || []).entries()) for (const [ci, category] of (round.categories || []).entries()) {
      lines.push('### Раунд ' + (ri + 1) + ' · ' + category.name, '');
      for (const [qi, q] of category.questions.entries()) add('main', `${meta.id}:R${ri + 1}:C${ci + 1}:Q${qi + 1}`,
        `/rounds/${ri}/categories/${ci}/questions/${qi}`, `Питання ${qi + 1} · ${q.value} балів · ${q.type || 'text'}`, q);
    }
    for (const [ri, round] of (game.audienceRounds || []).entries()) for (const [qi, q] of round.questions.entries()) add('audience', `${meta.id}:AUD${ri + 1}:Q${qi + 1}`,
      `/audienceRounds/${ri}/questions/${qi}`, `Глядачі · ${round.title || 'раунд ' + (ri + 1)} · питання ${qi + 1}`, q);
    if (game.final) add('final', meta.id + ':final', '/final', 'Фінальне питання', game.final);
  }
  lines.splice(8, 0, `**Обсяг:** ${counts.main} основних клітинок, ${counts.firstTurn} стартових, ${counts.final} фінальних, ${counts.audience} глядацьких; додатково ${counts.tripletParts} підпитань триплетів і ${counts.catAlternatives} альтернатив Кота.`, '');
  const bank = lines.join('\n') + '\n';
  write(BANK, bank);
  write(RELATIVE + '/QUESTION_BANK.md', bank);
  const legacy = read('questions.json');
  if (hash(legacy) !== gameFiles.find(game => game.gameId === 'kinohardkor').sha256) throw new Error('Legacy questions.json is not a duplicate; review it before export.');
  write(RELATIVE + '/legacy/questions.json', legacy);
  const manifest = { schemaVersion: 1, snapshotDate: DATE, completionSource: 'Owner confirmation: both seasons and Halloween completed; hide all nine games.',
    sourceCommit: execFileSync('git', ['rev-parse','HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    sourceCatalogSha256: hash(indexBytes), games: index.length, counts, records: records.length, gameFiles,
    media: [...assets].sort().map(sourcePath => { const bytes = read(sourcePath); return { sourcePath, sha256: hash(bytes), bytes: bytes.length }; }),
    questionBank: { workingCopy: BANK, archivedPath: RELATIVE + '/QUESTION_BANK.md', sha256: hash(Buffer.from(bank)) },
    legacyAlias: { source: 'questions.json', archivedPath: RELATIVE + '/legacy/questions.json', duplicateOf: 'kinohardkor', sha256: hash(legacy) } };
  write(RELATIVE + '/manifest.json', json(manifest));
  // Machine-readable record map is verification data; the single planning reference is QUESTION_BANK.md.
  write(RELATIVE + '/question-records.json', json(records));
  write(RELATIVE + '/README.md', '# Архів завершених ігор — ' + DATE + '\n\nСезон 1: перші чотири набори; Сезон 2: чотири season2-набори; Halloween — окрема спецгра. Завершення підтверджено власником, фактичні дати проведення тут не призначаються.\n\nОригінальні JSON у games/ збережені побайтово. QUESTION_BANK.md містить єдиний читабельний довідник усіх питань; його робоча копія — archive/QUESTION_BANK.md у корені проєкту. question-records.json — технічний перелік для перевірки повноти.\n\nZIP містить JSON, довідник, маніфест і всі 136 медіафайлів за їхніми public-шляхами. Це архів контенту, не резервна копія сервера, статистики, БД або приватних шпаргалок. Налаштування питань, STOP, поетапне відкриття, ставки/спецмеханіки та редакторські позначки збережені в оригінальних JSON.\n\nПеревірка: node scripts/archive-completed-games.js --verify. Для відновлення розпакуйте ZIP в окрему папку; копії JSON беріть із ' + RELATIVE + '/games/, медіа — із public/. Повернення в меню виконується вибірково через enabled у чинному games/index.json; весь старий індекс поверх нових ігор не копіюйте.\n\nЧинні файли games/*.json залишені на місці для сумісності та повторного відтворення; усі дев’ять записів у робочому індексі позначені archived/disabled. Поточний сервер читає каталог при старті: зміни меню застосуються після наступного запуску. Сервер не перезапускався.\n');
  const archivedFiles = ['games/index.json', ...index.map(meta => 'games/' + meta.file), 'legacy/questions.json', 'QUESTION_BANK.md', 'question-records.json', 'manifest.json', 'README.md'].map(file => RELATIVE + '/' + file);
  const files = [...archivedFiles, BANK, ...assets].sort().map(entry => {
    const source = entry === BANK ? RELATIVE + '/QUESTION_BANK.md' : entry;
    const bytes = read(source); return { source, entry, sha256: hash(bytes), bytes: bytes.length };
  });
  write(RELATIVE + '/zip-plan.json', json({ files }));
  packageArchive();
  // Only hide menu entries after the full archive has passed verification.
  fs.writeFileSync(path.join(ROOT, 'games/index.json'), json(index.map(meta => ({ ...meta, enabled: false, archived: true, archivedAt: DATE, archive: RELATIVE }))));
  console.log(JSON.stringify({ archived: index.length, counts, records: records.length, media: assets.size, zipEntries: files.length, bank: BANK, archive: RELATIVE }, null, 2));
}

if (process.argv.includes('--verify')) verify();
else if (process.argv.includes('--package')) packageArchive();
else create();
