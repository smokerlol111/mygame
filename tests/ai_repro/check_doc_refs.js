// Checks that a sample of file:line references in architecture.md / found_bugs.md still point at the code
// they describe. Written for commit 46e0620: after code edits, mismatches mean the DOCS need updating
// (that is the purpose of this script, not a code bug).
// Usage: node tests/ai_repro/check_doc_refs.js        Exit code 1 = at least one reference drifted.
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..', '..');
const f = n => fs.readFileSync(path.join(R, n), 'utf8').split('\n');
const S = f('server.js'), ST = f('storage.js'), H = f('public/host.html'), P = f('public/play.html'), O = f('public/screen.html'), G = f('games/back_to_2000s_test.json');
const BACKSLASH_N = '\\' + 'n'; // the two characters "\" and "n", not a newline
const checks = [
  [S, 'server.js', 370, 'seasonAdminToken'], [S, 'server.js', 1313, 'seasonAdminInit'], [S, 'server.js', 1336, 'deleteSavedSeasonResult'],
  [S, 'server.js', 1337, 'correctSavedSeasonResult'], [S, 'server.js', 152, 'players: room.players.map'], [S, 'server.js', 1166, 'getAudienceState'],
  [S, 'server.js', 971, 'socket.data.playerId'], [S, 'server.js', 1182, 'ownWin'], [S, 'server.js', 58, 'specialSetup, specialPools'],
  [S, 'server.js', 1025, "'judge'"], [S, 'server.js', 1117, 'nextFromResult'], [S, 'server.js', 534, "room.phase === 'final_result'"],
  [S, 'server.js', 1243, 'p.bet === null'], [S, 'server.js', 955, 'unready'], [S, 'server.js', 886, '30000'],
  [S, 'server.js', 1198, 'audienceQuestionSeconds===30'], [S, 'server.js', 1262, "'final_question'"], [S, 'server.js', 911, 'numericResults?.[0]?.id'],
  [S, 'server.js', 1015, 'pressTime'], [S, 'server.js', 1005, 'FAIR_WINDOW_MS=90'], [S, 'server.js', 846, 'room.current.image = q.image'],
  [S, 'server.js', 1060, 'Date.now()+800'], [S, 'server.js', 807, 'media-test'], [S, 'server.js', 815, 'q.value===600'],
  [S, 'server.js', 1348, 'room.finalResults = null'], [S, 'server.js', 1449, 'fork('], [S, 'server.js', 48, 'req.protocol'],
  [S, 'server.js', 12, 'origin: true'], [S, 'server.js', 63, '3.1.0-dev'], [S, 'server.js', 1455, 'v3.0.0-rc'],
  [S, 'server.js', 441, 'leavePlayer'], [S, 'server.js', 420, "room.phase !== 'lobby'"], [S, 'server.js', 1286, 'testGrandFinal'],
  [S, 'server.js', 1222, 'room.round !== 0'], [S, 'server.js', 1029, 'if (!p) return;'], [S, 'server.js', 1080, 'if(!p)return;'],
  [S, 'server.js', 1161, 'if (!p) return;'], [S, 'server.js', 1150, 'return;'], [S, 'server.js', 551, 'rooms.delete'],
  [S, 'server.js', 1363, 'rooms.delete'], [S, 'server.js', 211, 'function currentQuestion'], [S, 'server.js', 497, 'buzzScheduled'],
  [S, 'server.js', 960, 'buzzScheduled'], [S, 'server.js', 1061, 'buzzScheduled'], [S, 'server.js', 1102, 'buzzScheduled'],
  [S, 'server.js', 1454, 'server.listen'], [S, 'server.js', 824, 'room.current.media=source'], [S, 'server.js', 130, 'media: room.current.media'],
  [S, 'server.js', 129, 'image: room.current.image'], [S, 'server.js', 110, 'room.revealAnswer ? room.current.a'], [S, 'server.js', 198, 'hostSecrets'],
  [S, 'server.js', 1215, 'randomBytes(3)'], [S, 'server.js', 1214, 'eligible:!prev.has'], [S, 'server.js', 733, 'room.players.sort'],
  [S, 'server.js', 806, 'formatLocked'], [S, 'server.js', 1031, 'sponsorBonus===true'], [S, 'server.js', 1036, "room.current?.type === 'duel'"],
  [ST, 'storage.js', 8, 'writeFileSync'], [ST, 'storage.js', 16, 'JSON.parse'], [ST, 'storage.js', 17, 'saveFile()'],
  [ST, 'storage.js', 13, 'room_code TEXT NOT NULL UNIQUE'], [ST, 'storage.js', 70, 'g.roomCode===roomCode'], [ST, 'storage.js', 47, 'localeCompare'],
  [ST, 'storage.js', 48, 'сезон|season'], [ST, 'storage.js', 84, 'toLocaleLowerCase'], [ST, 'storage.js', 11, 'rejectUnauthorized:false'],
  [ST, 'storage.js', 3, 'POINTS=[10,7,5,3]'], [ST, 'storage.js', 68, 'isGrandFinal?2:1'],
  [H, 'public/host.html', 7, '}' + BACKSLASH_N + '.cueMixer'], [H, 'public/host.html', 170, 'crypto.randomUUID()'], [H, 'public/host.html', 179, 'hostAudienceWinner='],
  [H, 'public/host.html', 454, 'hostAudienceWinner?.id'], [H, 'public/host.html', 476, 'testGrandFinal'], [H, 'public/host.html', 74, 'let state=null'],
  [H, 'public/host.html', 463, 'openBuzz'], [H, 'public/host.html', 122, 'render()'], [H, 'public/host.html', 109, '/games/'],
  [H, 'public/host.html', 18, 'cueAudioCtx'], [H, 'public/host.html', 319, 'mediaPlaybackSnapshot'], [H, 'public/host.html', 366, 'function resumeVideoResult(){}'],
  [H, 'public/host.html', 202, 'qi<5'], [H, 'public/host.html', 475, 'ставка ${p.bet}'], [H, 'public/host.html', 455, 'id="finalBets"'],
  [P, 'public/play.html', 400, 'leaveRoom'], [P, 'public/play.html', 457, 'finalAnswer'], [P, 'public/play.html', 389, 'filter:blur'],
  [P, 'public/play.html', 467, 'pressedAtServerTime:serverNow()'], [P, 'public/play.html', 243, 'function leaveRoom'],
  [P, 'public/play.html', 364, "function mediaQuestionHTML(){return '';}"], [P, 'public/play.html', 100, 'async function ensureGameData'],
  [O, 'public/screen.html', 388, 'latest.p.beforeScore'], [O, 'public/screen.html', 327, 'roomCode'], [O, 'public/screen.html', 349, '/audience-qr/'],
  [O, 'public/screen.html', 129, '/games/'], [O, 'public/screen.html', 75, 'cueAudioCtx'], [O, 'public/screen.html', 161, 'mediaPlaybackSnapshot'],
  [O, 'public/screen.html', 251, 'function resumeVideoResult(){}'],
  [G, 'games/back_to_2000s_test.json', 477, '"type": "numeric"'],
];
let bad = 0;
for (const [lines, name, ln, needle] of checks) {
  if (!(lines[ln - 1] || '').includes(needle)) { bad++; console.log(`DRIFT ${name}:${ln} expected ${JSON.stringify(needle)} -> ${JSON.stringify((lines[ln - 1] || '').slice(0, 100))}`); }
}
console.log(`${checks.length} line references checked, ${bad} drifted`);
process.exitCode = bad ? 1 : 0;
