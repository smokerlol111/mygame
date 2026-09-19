const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storage');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true }, pingInterval: 3000, pingTimeout: 6000 });
const PORT = process.env.PORT || 3000;
const gamesIndex = JSON.parse(fs.readFileSync(path.join(__dirname, 'games', 'index.json'), 'utf8'));
const games = new Map();
for (const meta of gamesIndex.filter(g => g.enabled !== false)) {
  const game = JSON.parse(fs.readFileSync(path.join(__dirname, 'games', meta.file), 'utf8'));
  games.set(meta.id, { ...game, id: meta.id, menuTitle: meta.title || game.menuTitle || game.title, menuIcon: meta.icon || game.menuIcon || '🎮', description: meta.description || game.description || '' });
}
const DEFAULT_GAME_ID = gamesIndex.find(g => g.enabled !== false)?.id || 'kinohardkor';
const rooms = new Map();

function getGameById(id) { return games.get(String(id || DEFAULT_GAME_ID)) || games.get(DEFAULT_GAME_ID); }
function getRoomGame(room) { return room?.gameData || getGameById(room?.gameId); }

// Always serve the current deployed UI. This prevents Safari/iPhone from
// keeping an older play/host/screen page after a new Render deployment.
app.use((req, res, next) => {
  if (!req.path.startsWith('/socket.io/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  maxAge: 0
}));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/host', (_, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (_, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/audience', (_, res) => res.sendFile(path.join(__dirname, 'public', 'audience.html')));
app.get('/audience/:code', (_, res) => res.sendFile(path.join(__dirname, 'public', 'audience.html')));
app.get('/audience-qr/:code', async (req,res)=>{try{const c=String(req.params.code||'').toUpperCase();const base=`${req.protocol}://${req.get('host')}`;const svg=await QRCode.toString(`${base}/audience/${encodeURIComponent(c)}`,{type:'svg',margin:1,width:360,errorCorrectionLevel:'M'});res.type('image/svg+xml').send(svg)}catch(e){res.status(500).send('QR error')}});

app.get('/questions.json', (_, res) => res.sendFile(path.join(__dirname, 'questions.json')));
app.get('/games', (_, res) => res.json(gamesIndex.filter(g => g.enabled !== false).map(({file, ...g}) => g)));
app.get('/games/:id.json', (req, res) => {
  const meta = gamesIndex.find(g => g.id === req.params.id && g.enabled !== false);
  if (!meta) return res.status(404).json({ error: 'Гру не знайдено.' });
  res.sendFile(path.join(__dirname, 'games', meta.file));
});
app.get('/screen', (_, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/screen/:code', (_, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/health', (_, res) => res.json({ ok:true, version:'3.1.0-dev', rooms:rooms.size }));
app.get('/seasons', (_,res)=>res.sendFile(path.join(__dirname,'public','seasons.html')));
app.get('/api/seasons', async (_,res)=>{try{res.json(await storage.publicData())}catch(e){console.error(e);res.status(500).json({error:'Не вдалося завантажити сезони.'})}});

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  do {
    out = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(out));
  return out;
}

function publicState(room) {
  return {
    code: room.code,
    title: getRoomGame(room).title,
    gameId: room.gameId,
    gameMenuTitle: getRoomGame(room).menuTitle || getRoomGame(room).title,
    phase: room.phase,
    paused: !!room.paused,
    pausedPhase: room.pausedPhase || null,
    round: room.round,
    used: room.used,
    current: room.current,
    buzzer: room.buzzer,
    catChooser: room.catChooser,
    catReceiver: room.catReceiver,
    turnPlayerId: room.turnPlayerId,
    vaBankPlayer: room.vaBankPlayer,
    vaBankBet: room.vaBankBet,
    duelPlayers: room.duelPlayers || [],
    voice: { speakingPlayerIds: (room.voiceSpeaking||[]).filter(id=>room.players.some(p=>p.id===id)), updatedAt:room.voiceUpdatedAt||0 },
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, falseStartUntil: Number(p.falseStartUntil||0), falseStartRemainingMs: Math.max(0, Number(p.falseStartUntil||0) - Date.now()), networkRttMs: Number.isFinite(p.networkRttMs) ? Math.round(p.networkRttMs) : null, networkJitterMs: Number.isFinite(p.networkJitterMs) ? Math.round(p.networkJitterMs) : null, syncReady: !!p.connected && Number(p.syncSamples||0)>=3 && Date.now()-Number(p.lastSyncAt||0)<12000, hasBet: p.bet !== null, hasFinalAnswer: !!p.finalAnswer, finalAnswer: ['final_review','final_result'].includes(room.phase) ? p.finalAnswer : '' })),
    buzzOpensAt: room.buzzOpensAt || null,
    answeringLocked: Array.from(room.answeringLocked || []),
    finalSeconds: room.finalSeconds,
    revealAnswer: room.revealAnswer,
    finalResults: room.finalResults || null,
    finalRevealCount: room.finalRevealCount || 0,
    savedSeasonGameId: room.savedSeasonGameId || null,
    savedSeasonId: room.savedSeasonId || null,
    numericChallenge: room.numericChallenge ? {
      question: room.numericChallenge.question, unit: room.numericChallenge.unit || '', value: room.numericChallenge.value,
      submittedPlayerIds: Object.keys(room.numericAnswers || {}), endsAt: room.numericEndsAt || null,
      results: room.phase === 'numeric_result' ? room.numericResults : null, revealCount: room.numericRevealCount || 0,
      correctAnswer: room.phase === 'numeric_result' ? room.numericChallenge.answer : null
    } : null,
    audience: room.audienceRoundIndex !== null ? (()=>{
      const rounds=getRoomGame(room).audienceRounds||[]; const ar=rounds[room.audienceRoundIndex]||null; const aq=ar?.questions?.[room.audienceQuestionIndex]||null;
      const submitted=Object.keys(room.audienceAnswers||{});
      const counts=aq?aq.options.map((_,i)=>Object.values(room.audienceAnswers||{}).filter(x=>x.option===i).length):[];
      const ranking=(room.audienceRanking||[]).map(x=>({id:x.id,name:x.name,correct:x.correct,timeMs:x.timeMs,eligible:x.eligible}));
      return {roundIndex:room.audienceRoundIndex,title:ar?.title||'',questionIndex:room.audienceQuestionIndex,totalQuestions:ar?.questions?.length||0,question:aq?aq.q:'',options:aq?aq.options:[],correct:['audience_result','audience_podium'].includes(room.phase)?aq?.correct:null,fact:['audience_result','audience_podium'].includes(room.phase)?aq?.fact:'',endsAt:room.audienceEndsAt||null,remainingMs:room.audienceEndsAt?Math.max(0,room.audienceEndsAt-Date.now()):0,joined:room.audience.length,submitted:submitted.length,submittedPlayerIds:submitted,counts,ranking:room.phase==='audience_podium'?ranking:[],revealCount:room.audienceRevealCount||0,winner:room.phase==='audience_podium'&&room.audienceRevealCount>=Math.min(5,ranking.length)?ranking[0]||null:null};
    })() : null,
    firstTurnQuiz: room.firstTurnQuiz ? {
      title: room.firstTurnQuiz.title,
      question: room.firstTurnQuiz.question,
      unit: room.firstTurnQuiz.unit,
      submittedPlayerIds: Object.keys(room.firstTurnAnswers || {}),
      timerStatus: room.firstTurnTimerStatus || 'ready',
      duration: 30,
      endsAt: room.firstTurnTimerStatus === 'running' ? room.firstTurnEndsAt : null,
      results: room.phase === 'first_turn_result' ? room.firstTurnResults : null,
      revealCount: room.phase === 'first_turn_result' ? (room.firstTurnRevealCount || 0) : 0,
      correctAnswer: room.phase === 'first_turn_result' ? room.firstTurnQuiz.answer : null
    } : null
  };
}

function emitState(room) {
  io.to(room.code).emit('state', publicState(room));
  // Hidden service information is sent only to the authenticated HOST socket.
  // Players and the OBS screen never receive the special-cell map.
  if (room.hostSocket) io.to(room.hostSocket).emit('hostSecrets', { code: room.code, specialCells: room.specialCells || {}, voiceMappings:room.voiceMappings||{}, audienceWinner: room.audienceWinners?.[room.audienceWinners.length-1] || null });
}

function getRoom(c) { return rooms.get(String(c || '').toUpperCase()); }
function isHost(socket, room) { return room && socket.data.hostToken && socket.data.hostToken === room.hostToken; }
function currentQuestion(room) {
  if (!room.current || room.current.type === 'final') return null;
  const game = getRoomGame(room);
  return game.rounds[room.round].categories[room.current.ci].questions[room.current.qi];
}
function resetQuestionState(room) {
  room.buzzer = null;
  room.revealAnswer = false; room.resultReason = null;
  room.answeringLocked = new Set();
  room.catChooser = null;
  room.catReceiver = null;
  room.vaBankPlayer = null;
  room.vaBankBet = null;
  room.duelPlayers = [];
  room.buzzOpensAt = null;
  room.buzzCandidates = [];
  if (room.buzzResolveTimer) clearTimeout(room.buzzResolveTimer);
  room.buzzResolveTimer = null;
}
function advanceTurn(room) {
  if (!room.players.length) { room.turnPlayerId = null; return; }
  const i = room.players.findIndex(p => p.id === room.turnPlayerId);
  room.turnPlayerId = room.players[(i < 0 ? 0 : (i + 1) % room.players.length)].id;
}
function finishTile(room) {
  if (room.current && room.current.type !== 'final') room.used[`${room.round}:${room.current.ci}:${room.current.qi}`] = true;
  advanceTurn(room);
  room.current = null;
  resetQuestionState(room);
  room.phase = 'board';
}

function expireFirstTurn(room){
  room.firstTurnTimer = null;
  room.firstTurnTimerStatus = 'expired';
  room.firstTurnEndsAt = null;
  emitState(room);
}
function startFirstTurnCountdown(room, ms){
  const duration = Math.max(0, Number(ms)||0);
  clearTimeout(room.firstTurnTimer);
  room.firstTurnTimerStatus = 'running';
  room.firstTurnEndsAt = Date.now() + duration;
  room.firstTurnTimer = setTimeout(()=>expireFirstTurn(room), duration);
}
function startFinalCountdown(room){
  clearInterval(room.finalTimer);
  room.finalTimer = setInterval(() => {
    if(room.paused) return;
    room.finalSeconds--;
    if (room.finalSeconds <= 0) {
      room.finalSeconds = 0;
      clearInterval(room.finalTimer);
      room.finalTimer = null;
      room.phase = 'final_review';
    }
    emitState(room);
  }, 1000);
}
function pauseRoom(room){
  if(room.paused) return;
  room.paused = true;
  room.pausedPhase = room.phase;

  if(room.firstTurnTimerStatus === 'running'){
    room.pauseFirstTurnRemaining = Math.max(0, Number(room.firstTurnEndsAt||0) - Date.now());
    clearTimeout(room.firstTurnTimer); room.firstTurnTimer = null;
    room.firstTurnEndsAt = null;
    room.firstTurnTimerStatus = 'paused';
  } else room.pauseFirstTurnRemaining = null;

  if(room.phase === 'final_question' && room.finalTimer){
    room.pauseFinalRemaining = Math.max(0, Number(room.finalSeconds)||0);
    clearInterval(room.finalTimer); room.finalTimer = null;
  } else room.pauseFinalRemaining = null;

  room.phase = 'paused';
}
function resumeRoom(room){
  if(!room.paused) return;
  const previous = room.pausedPhase || 'board';
  room.paused = false;
  room.pausedPhase = null;
  room.phase = previous;

  if(room.firstTurnTimerStatus === 'paused'){
    const ms = Math.max(0, Number(room.pauseFirstTurnRemaining)||0);
    room.pauseFirstTurnRemaining = null;
    if(ms <= 0) expireFirstTurn(room);
    else startFirstTurnCountdown(room, ms);
  }

  if(previous === 'final_question' && room.pauseFinalRemaining !== null){
    room.finalSeconds = Math.max(0, Number(room.pauseFinalRemaining)||0);
    room.pauseFinalRemaining = null;
    if(room.finalSeconds <= 0) room.phase = 'final_review';
    else startFinalCountdown(room);
  }
}

function randomSpecialCells(room) {
  const game = getRoomGame(room);
  const pools = game.specialPools || null;
  if (pools) {
    const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
    const vb=shuffle(pools.vaBank||[]).slice(0,2);
    const duel=shuffle((pools.duel||[]).filter(k=>!vb.includes(k))).slice(0,1);
    const out={}; vb.forEach(k=>out[k]='va_bank'); duel.forEach(k=>out[k]='duel'); return out;
  }
  const candidates = [];
  game.rounds[1].categories.forEach((cat, ci) => cat.questions.forEach((q, qi) => { if (!q.cat) candidates.push(`1:${ci}:${qi}`); }));
  for (let i=candidates.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [candidates[i],candidates[j]]=[candidates[j],candidates[i]]; }
  return { [candidates[0]]:'va_bank', [candidates[1]]:'va_bank', [candidates[2]]:'duel' };
}

io.on('connection', socket => {
  socket.data.seasonAdminToken = crypto.randomUUID();
  socket.on('createRoom', ({ hostToken, gameId } = {}, cb = () => {}) => {
    const selectedGame = getGameById(gameId);
    if (!selectedGame) return cb({ ok:false, error:'Гру не знайдено.' });
    const roomCode = code();
    const token = hostToken || crypto.randomUUID();
    const room = {
      code: roomCode, hostToken: token, hostSocket: socket.id,
      gameId: selectedGame.id || gameId || DEFAULT_GAME_ID, gameData: selectedGame,
      voiceMappings:{}, voiceSpeaking:[], voiceUpdatedAt:0,
      players: [], phase: 'lobby', round: 0, used: {}, current: null,
      buzzer: null, revealAnswer: false, answeringLocked: new Set(),
      catChooser: null, catReceiver: null, turnPlayerId: null,
      specialCells: {}, vaBankPlayer: null, vaBankBet: null, duelPlayers: [],
      finalSeconds: 30, finalTimer: null, finalResults: null, finalRevealCount: 0, savedSeasonGameId: null, savedSeasonId: null,
      firstTurnQuiz: selectedGame.firstTurnQuiz || null,
      firstTurnAnswers: {}, firstTurnResults: null,
      firstTurnTimerStatus: 'ready', firstTurnEndsAt: null, firstTurnTimer: null,
      firstTurnRevealCount: 0,
      numericChallenge: null, numericAnswers: {}, numericSubmittedAt: {}, numericResults: null, numericEndsAt: null, numericTimer: null, numericRevealCount: 0,
      audience: [], audienceRoundIndex: null, audienceQuestionIndex: 0, audienceAnswers: {}, audienceStartedAt: null, audienceEndsAt: null, audienceTimer: null, audienceReturnPhase: null, audienceRevealCount: 0, audienceWinners: [],
      paused: false, pausedPhase: null, pauseFirstTurnRemaining: null, pauseFinalRemaining: null,
      buzzCandidates: [], buzzResolveTimer: null
    };
    rooms.set(roomCode, room);
    socket.data.hostToken = token;
    socket.data.roomCode = roomCode;
    socket.join(roomCode);
    cb({ ok: true, code: roomCode, hostToken: token, gameId: room.gameId, state: publicState(room), specialCells: room.specialCells || {}, voiceMappings:room.voiceMappings||{} });
    emitState(room);
  });

  socket.on('rejoinHost', ({ code: c, hostToken }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.hostToken !== hostToken) return cb({ ok: false, error: 'Кімнату або ключ ведучого не знайдено.' });
    room.hostSocket = socket.id;
    socket.data.hostToken = hostToken;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code, gameId: room.gameId, state: publicState(room), specialCells: room.specialCells || {} });
    emitState(room);
  });

  socket.on('joinPlayer', ({ code: c, name, playerId }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: 'Кімнату не знайдено.' });
    let p = room.players.find(x => x.id === playerId);
    if (!p) {
      if (room.players.length >= 4) return cb({ ok: false, error: 'У кімнаті вже 4 гравці.' });
      const clean = String(name || '').trim().slice(0, 20) || `Гравець ${room.players.length + 1}`;
      p = { id: crypto.randomUUID(), name: clean, score: 0, socketId: socket.id, connected: true, bet: null, finalAnswer: '', falseStartUntil: 0, networkRttMs: null, networkJitterMs: null, syncSamples:0, lastSyncAt:0 };
      room.players.push(p);
    } else {
      p.socketId = socket.id; p.connected = true; p.syncSamples=0; p.lastSyncAt=0;
      if (name) p.name = String(name).trim().slice(0,20) || p.name;
    }
    socket.data.playerId = p.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, playerId: p.id, code: room.code, name: p.name });
    emitState(room);
  });

  socket.on('leavePlayer', ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c || socket.data.roomCode);
    if (!room) {
      socket.data.playerId = null;
      socket.data.roomCode = null;
      return cb({ ok: true });
    }
    const pid = socket.data.playerId;
    const idx = room.players.findIndex(x => x.id === pid);
    if (idx >= 0) {
      const wasTurn = room.turnPlayerId === pid;
      room.players.splice(idx, 1);
      if (wasTurn) room.turnPlayerId = room.players.length ? room.players[Math.min(idx, room.players.length-1)].id : null;
    }
    socket.leave(room.code);
    socket.data.playerId = null;
    socket.data.roomCode = null;
    cb({ ok: true });
    emitState(room);
  });

  // v3.0.1 — lightweight NTP-style clock sync. The client measures RTT and
  // estimates server clock offset from the midpoint of the request.
  socket.on('timeSync', ({clientSentAt} = {}, cb = () => {}) => {
    const serverReceivedAt = Date.now();
    cb({ok:true, clientSentAt:Number(clientSentAt)||0, serverReceivedAt, serverSentAt:Date.now()});
  });

  socket.on('reportNetworkStats', ({code:c,rttMs,jitterMs,samples} = {}, cb = () => {}) => {
    const room=getRoom(c || socket.data.roomCode);
    const p=room?.players.find(x=>x.id===socket.data.playerId);
    if(!room||!p||p.socketId!==socket.id||!p.connected)return cb({ok:false});
    const rtt=Number(rttMs), jitter=Number(jitterMs);
    if(Number.isFinite(rtt)&&rtt>=0&&rtt<10000)p.networkRttMs=rtt;
    if(Number.isFinite(jitter)&&jitter>=0&&jitter<10000)p.networkJitterMs=jitter;
    p.syncSamples=Math.min(8,Math.max(0,Number(samples)||0)); p.lastSyncAt=Date.now();
    cb({ok:true});
    if(room.hostSocket) io.to(room.hostSocket).emit('networkStats',{code:room.code,playerId:p.id,rttMs:p.networkRttMs,jitterMs:p.networkJitterMs,syncReady:p.syncSamples>=3,connected:p.connected});
  });

  socket.on('togglePause', ({code:c}={}, cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room))return cb({ok:false,error:'Немає доступу.'});
    if(room.phase==='lobby'||room.phase==='final_result')return cb({ok:false,error:'Пауза на цьому етапі не потрібна.'});
    if(room.paused) resumeRoom(room); else pauseRoom(room);
    cb({ok:true,paused:room.paused}); emitState(room);
  });

  socket.on('emergencyReopenBuzz', ({code:c}={},cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room)||!room.current)return cb({ok:false,error:'Немає активного питання.'});
    if(room.paused)return cb({ok:false,error:'Спочатку зніміть паузу.'});
    if(room.current.type==='final'||['cat_question','va_bank_question'].includes(room.phase))
      return cb({ok:false,error:'Для цього типу питання BUZZ не використовується.'});
    const leadMs=1200;
    room.buzzer=null; room.phase='buzz'; room.resultReason=null; room.buzzCandidates=[]; if(room.buzzResolveTimer){clearTimeout(room.buzzResolveTimer);room.buzzResolveTimer=null;} room.buzzOpensAt=Date.now()+leadMs;
    io.to(room.code).emit('buzzScheduled',{opensAt:room.buzzOpensAt});
    setTimeout(()=>{if(rooms.get(room.code)===room&&room.phase==='buzz'&&!room.buzzer)io.to(room.code).emit('cue',{type:'buzz_open',at:room.buzzOpensAt})},leadMs);
    cb({ok:true,opensAt:room.buzzOpensAt}); emitState(room);
  });

  socket.on('emergencyRevealQuestion', ({code:c}={},cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room)||!room.current||room.current.type==='final')return cb({ok:false,error:'Немає активного звичайного питання.'});
    if(room.paused)return cb({ok:false,error:'Спочатку зніміть паузу.'});
    room.buzzer=null; room.revealAnswer=true; room.resultReason='host_emergency'; room.phase='result';
    cb({ok:true}); emitState(room);
  });

  socket.on('emergencyFinishTile', ({code:c}={},cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room)||!room.current||room.current.type==='final')return cb({ok:false,error:'Немає активного питання.'});
    if(room.paused)return cb({ok:false,error:'Спочатку зніміть паузу.'});
    finishTile(room);
    cb({ok:true}); emitState(room);
  });

  socket.on('adjustScore', ({ code: c, playerId, amount } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok:false, error:'Немає доступу до цієї кімнати.' });
    const player = room.players.find(p => p.id === playerId);
    if (!player) return cb({ ok:false, error:'Гравця не знайдено.' });

    const delta = Number(amount);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000)
      return cb({ ok:false, error:'Вкажіть ціле число від -100000 до 100000, крім 0.' });

    player.score += delta;

    // Якщо коригування зроблено вже після фінального підрахунку —
    // одразу оновлюємо й фінальну таблицю.
    if (room.phase === 'final_result' && Array.isArray(room.finalResults)) {
      room.finalResults = room.players
        .map(p => ({ id:p.id, name:p.name, score:p.score }))
        .sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'uk'));
    }

    cb({ ok:true, playerId:player.id, score:player.score, delta });
    emitState(room);
  });

  socket.on('closeRoom', ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: 'Немає доступу до цієї кімнати.' });
    if (room.finalTimer) clearInterval(room.finalTimer);
    if (room.firstTurnTimer) clearTimeout(room.firstTurnTimer);
    io.to(room.code).emit('roomClosed', { code: room.code, message: 'Ведучий закрив кімнату.' });
    rooms.delete(room.code);
    socket.leave(room.code);
    socket.data.roomCode = null;
    cb({ ok: true });
  });

  socket.on('joinScreen', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: 'Кімнату не знайдено.' });
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code });
    emitState(room);
  });

  // v3.1: HOST-only voice mapping and manual test events. The Discord bridge is NOT connected yet.
  socket.on('voiceSetMapping',({code:c,playerId,discordId},cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room))return cb({ok:false,error:'Лише ведучий може змінювати прив’язки.'});
    if(!room.players.some(p=>p.id===playerId))return cb({ok:false,error:'Гравця не знайдено.'});
    const id=String(discordId||'').trim();
    if(id && !/^\d{17,20}$/.test(id))return cb({ok:false,error:'Введіть Discord User ID (17–20 цифр) або залиште поле порожнім.'});
    if(id && Object.entries(room.voiceMappings||{}).some(([p,v])=>p!==playerId&&v===id))return cb({ok:false,error:'Цей Discord ID вже прив’язано.'});
    room.voiceMappings=room.voiceMappings||{};
    if(id)room.voiceMappings[playerId]=id;else delete room.voiceMappings[playerId];
    io.to(room.hostSocket).emit('voiceMappings',{code:room.code,mappings:room.voiceMappings});
    cb({ok:true});
  });
  socket.on('voiceTestSpeaking',({code:c,playerIds},cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room))return cb({ok:false,error:'Лише ведучий може запускати тест.'});
    const valid=new Set(room.players.map(p=>p.id));
    room.voiceSpeaking=[...new Set(Array.isArray(playerIds)?playerIds:[])].filter(id=>valid.has(id)).slice(0,4);
    room.voiceUpdatedAt=Date.now();
    emitState(room);
    cb({ok:true});
  });

  socket.on('startGame', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return;
    if (room.players.length < 1) return cb({ ok:false, error:'Потрібен хоча б один гравець.' });
    clearTimeout(room.firstTurnTimer); room.firstTurnTimer = null;
    room.round = 0; room.used = {}; room.finalResults = null; room.finalRevealCount = 0;
    room.specialCells = randomSpecialCells(room);
    room.turnPlayerId = null;
    room.firstTurnQuiz = getRoomGame(room).firstTurnQuiz || null;
    room.firstTurnAnswers = {}; room.firstTurnResults = null;
    room.firstTurnTimerStatus = 'ready'; room.firstTurnEndsAt = null;
    room.firstTurnRevealCount = 0;
    room.firstTurnRevealCount = 0;
    room.firstTurnTimerStatus = 'ready'; room.firstTurnEndsAt = null;
    room.players.forEach(p => { p.score = 0; p.bet = null; p.finalAnswer = ''; });
    room.paused=false; room.pausedPhase=null; room.pauseFirstTurnRemaining=null; room.pauseFinalRemaining=null;
    room.phase = room.firstTurnQuiz ? 'first_turn_quiz' : 'board';
    if (!room.firstTurnQuiz) room.turnPlayerId = room.players[0]?.id || null;
    cb({ok:true}); emitState(room);
  });

  socket.on('startFirstTurnTimer', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'first_turn_quiz' || !room.firstTurnQuiz)
      return cb({ok:false,error:'Розіграш зараз недоступний.'});
    if (room.firstTurnTimerStatus === 'running')
      return cb({ok:false,error:'Таймер уже запущено.'});
    if (room.firstTurnTimerStatus === 'expired')
      return cb({ok:false,error:'Час уже вийшов.'});

    startFirstTurnCountdown(room, 30000);
    cb({ok:true}); emitState(room);
  });

  socket.on('submitFirstTurnAnswer', ({ code: c, answer }, cb = () => {}) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== 'first_turn_quiz' || !room.firstTurnQuiz)
      return cb({ok:false,error:'Розіграш зараз недоступний.'});
    if (room.firstTurnTimerStatus !== 'running')
      return cb({ok:false,error:room.firstTurnTimerStatus === 'expired' ? 'Час вийшов.' : room.firstTurnTimerStatus === 'paused' ? 'Гра на паузі.' : 'Дочекайтеся запуску таймера.'});
    if (Date.now() >= Number(room.firstTurnEndsAt || 0)) {
      clearTimeout(room.firstTurnTimer); room.firstTurnTimer = null;
      room.firstTurnTimerStatus = 'expired'; room.firstTurnEndsAt = null;
      emitState(room);
      return cb({ok:false,error:'Час вийшов.'});
    }
    if (Object.prototype.hasOwnProperty.call(room.firstTurnAnswers,p.id))
      return cb({ok:false,error:'Відповідь уже зафіксована.'});
    const n = Math.round(Number(answer));
    if (!Number.isFinite(n) || n < 0 || n > 1000000000)
      return cb({ok:false,error:'Введіть коректне невід’ємне число.'});

    room.firstTurnAnswers[p.id] = n;
    const submittedPlayerIds = Object.keys(room.firstTurnAnswers);
    cb({ok:true, submittedPlayerIds});
    // Не перебудовуємо UI телефонів інших гравців під час введення:
    // прогрес слухають тільки HOST/OBS.
    io.to(room.code).emit('firstTurnProgress', { code:room.code, submittedPlayerIds });
  });

  socket.on('revealFirstTurnResults', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'first_turn_quiz' || !room.firstTurnQuiz)
      return cb({ok:false,error:'Розіграш зараз недоступний.'});

    const allAnswered = room.players.every(p => Object.prototype.hasOwnProperty.call(room.firstTurnAnswers,p.id));
    if (!allAnswered && room.firstTurnTimerStatus !== 'expired')
      return cb({ok:false,error:'Ще не всі гравці відповіли, а час не завершився.'});

    clearTimeout(room.firstTurnTimer); room.firstTurnTimer = null;
    room.firstTurnTimerStatus = 'done'; room.firstTurnEndsAt = null;

    const correct = Number(room.firstTurnQuiz.answer);
    const collator = new Intl.Collator('uk',{sensitivity:'base'});
    const answered = room.players
      .filter(p => Object.prototype.hasOwnProperty.call(room.firstTurnAnswers,p.id))
      .map(p => {
        const answer = room.firstTurnAnswers[p.id];
        return {id:p.id,name:p.name,answer,diff:Math.abs(answer-correct),delta:answer-correct,noAnswer:false};
      })
      .sort((x,y)=>x.diff-y.diff || collator.compare(x.name,y.name));

    const unanswered = room.players
      .filter(p => !Object.prototype.hasOwnProperty.call(room.firstTurnAnswers,p.id))
      .map(p => ({id:p.id,name:p.name,answer:null,diff:null,delta:null,noAnswer:true}))
      .sort((x,y)=>collator.compare(x.name,y.name));

    room.firstTurnResults = [...answered, ...unanswered];

    // Порядок результатів стає реальним порядком ходів на всю гру.
    const order = new Map(room.firstTurnResults.map((r,i)=>[r.id,i]));
    room.players.sort((x,y)=>(order.get(x.id) ?? 999) - (order.get(y.id) ?? 999));
    room.turnPlayerId = room.players[0]?.id || null;

    room.firstTurnRevealCount = 0;
    room.phase = 'first_turn_result';
    cb({ok:true}); emitState(room);
  });

  socket.on('revealNextFirstTurnResult', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'first_turn_result' || !room.firstTurnResults)
      return cb({ok:false,error:'Результати розіграшу зараз недоступні.'});
    const total = room.firstTurnResults.length;
    if ((room.firstTurnRevealCount || 0) >= total)
      return cb({ok:false,error:'Усі результати вже відкриті.'});
    room.firstTurnRevealCount = (room.firstTurnRevealCount || 0) + 1;
    cb({ok:true,revealCount:room.firstTurnRevealCount,total}); emitState(room);
  });

  socket.on('beginRoundOne', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'first_turn_result')
      return cb({ok:false,error:'Спочатку відкрийте результати розіграшу.'});
    if ((room.firstTurnRevealCount || 0) < (room.firstTurnResults?.length || 0))
      return cb({ok:false,error:'Спочатку відкрийте всі місця від останнього до першого.'});
    room.phase = 'board'; room.round = 0;
    cb({ok:true}); emitState(room);
  });

  socket.on('skipFirstTurnQuiz', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !['lobby','first_turn_quiz'].includes(room.phase))
      return cb({ok:false,error:'Розіграш зараз не можна пропустити.'});
    clearTimeout(room.firstTurnTimer); room.firstTurnTimer = null;
    room.firstTurnTimerStatus = 'ready'; room.firstTurnEndsAt = null;
    room.firstTurnAnswers = {}; room.firstTurnResults = null;
    room.firstTurnRevealCount = 0;
    room.turnPlayerId = room.players[0]?.id || null;
    room.phase = 'board'; room.round = 0; room.used = {}; room.finalResults = null; room.finalRevealCount = 0;
    room.specialCells = randomSpecialCells(room);
    room.players.forEach(p => { p.score = 0; p.bet = null; p.finalAnswer = ''; });
    cb({ok:true}); emitState(room);
  });

  socket.on('playCue', ({code:c,type}={},cb=()=>{})=>{
    const room=getRoom(c);
    if(!isHost(socket,room)) return cb({ok:false,error:'Немає доступу.'});
    if(!['gong'].includes(type)) return cb({ok:false,error:'Невідомий звук.'});
    io.to(room.code).emit('cue',{type,at:Date.now()});
    cb({ok:true});
  });

  socket.on('chooseTile', ({ code: c, ci, qi }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.phase !== 'board') return cb({ok:false,error:'Зараз не можна обирати питання.'});
    const pid = socket.data.playerId;
    const host = isHost(socket, room);
    if (!host && pid !== room.turnPlayerId) return cb({ok:false,error:'Зараз питання обирає інший гравець.'});
    ci = Number(ci); qi = Number(qi);
    const game = getRoomGame(room);
    const q = game.rounds[room.round]?.categories[ci]?.questions[qi];
    if (!q) return cb({ok:false,error:'Невірна клітинка.'});
    const key = `${room.round}:${ci}:${qi}`;
    if (room.used[key]) return cb({ok:false,error:'Цю клітинку вже зіграно.'});
    resetQuestionState(room);
    room.players.forEach(p=>p.falseStartUntil=0);
    const special = q.cat && room.round===1 ? 'cat' : (room.specialCells[key] || 'normal');
    room.current = { type:special, ci, qi, value:q.value, q:q.cat ? q.cat.q : q.q, a:q.cat ? q.cat.a : q.a };
    if (q.type === 'imageReveal' && special === 'normal') {
      room.current.questionType = 'imageReveal';
      room.current.image = q.image;
      room.current.revealValues = Array.isArray(q.revealValues) && q.revealValues.length ? q.revealValues : [q.value];
      room.current.revealStage = 0;
      room.current.value = room.current.revealValues[0];
    }

    if (special === 'cat') {
      room.phase = 'cat_choose';
      room.catChooser = room.turnPlayerId;
    } else if (special === 'va_bank') {
      room.phase = 'va_bank_bet';
      room.vaBankPlayer = room.turnPlayerId;
    } else if (special === 'duel') {
      room.phase = 'duel_choose';
      room.duelPlayers = room.turnPlayerId ? [room.turnPlayerId] : [];
    } else if (q.type === 'numericClosest' && special === 'normal') {
      room.numericChallenge={question:q.q,answer:Number(q.numericAnswer),unit:q.unit||'',value:q.value,seconds:Number(q.seconds||30)};
      room.numericAnswers={}; room.numericSubmittedAt={}; room.numericResults=null; room.numericRevealCount=0;
      room.numericEndsAt=null; room.phase='numeric_ready'; clearTimeout(room.numericTimer); room.numericTimer=null;
    } else {
      room.phase = 'question';
    }
    cb({ok:true}); emitState(room);
  });

  socket.on('startNumericTimer', ({code:c},cb=()=>{})=>{
    const room=getRoom(c); if(!isHost(socket,room)||room.phase!=='numeric_ready'||!room.numericChallenge)return cb({ok:false,error:'Числове питання не готове.'});
    room.numericAnswers={}; room.numericSubmittedAt={}; room.numericEndsAt=Date.now()+30000; room.phase='numeric_question';
    clearTimeout(room.numericTimer); room.numericTimer=setTimeout(()=>{if(room.phase==='numeric_question'){room.numericEndsAt=null;emitState(room)}},30000);
    cb({ok:true}); emitState(room);
  });

  socket.on('submitNumericAnswer', ({code:c,answer},cb=()=>{})=>{
    const room=getRoom(c), p=room?.players.find(x=>x.id===socket.data.playerId);
    if(!room||!p||room.phase!=='numeric_question'||!room.numericChallenge) return cb({ok:false,error:'Числове питання зараз неактивне.'});
    if(!room.numericEndsAt||Date.now()>room.numericEndsAt) return cb({ok:false,error:'Час вийшов.'});
    if(Object.prototype.hasOwnProperty.call(room.numericAnswers,p.id)) return cb({ok:false,error:'Відповідь уже зафіксована.'});
    const n=Number(answer); if(!Number.isFinite(n)) return cb({ok:false,error:'Введіть число.'});
    room.numericAnswers[p.id]=n; room.numericSubmittedAt[p.id]=Date.now(); cb({ok:true}); emitState(room);
  });

  socket.on('finishNumericQuestion', ({code:c},cb=()=>{})=>{
    const room=getRoom(c); if(!isHost(socket,room)||room.phase!=='numeric_question'||!room.numericChallenge) return cb({ok:false});
    const all=room.players.every(p=>Object.prototype.hasOwnProperty.call(room.numericAnswers,p.id));
    if(!all && room.numericEndsAt && Date.now()<room.numericEndsAt) return cb({ok:false,error:'Ще є час і не всі відповіли.'});
    clearTimeout(room.numericTimer); room.numericTimer=null; room.numericEndsAt=null; const correct=room.numericChallenge.answer;
    const answered=room.players.filter(p=>Object.prototype.hasOwnProperty.call(room.numericAnswers,p.id)).map(p=>({id:p.id,name:p.name,answer:room.numericAnswers[p.id],diff:Math.abs(room.numericAnswers[p.id]-correct),at:room.numericSubmittedAt[p.id]})).sort((a,b)=>a.diff-b.diff||a.at-b.at);
    const missing=room.players.filter(p=>!Object.prototype.hasOwnProperty.call(room.numericAnswers,p.id)).map(p=>({id:p.id,name:p.name,noAnswer:true,diff:null}));
    room.numericResults=[...answered,...missing]; if(answered[0]){ const w=room.players.find(p=>p.id===answered[0].id); if(w) w.score+=room.numericChallenge.value; }
    room.revealAnswer=true; room.phase='numeric_result'; room.numericRevealCount=0; cb({ok:true}); emitState(room);
  });

  socket.on('revealNextNumeric', ({code:c},cb=()=>{})=>{ const room=getRoom(c); if(!isHost(socket,room)||room.phase!=='numeric_result')return cb({ok:false}); const total=room.numericResults?.length||0; if(room.numericRevealCount<total)room.numericRevealCount++; cb({ok:true});emitState(room); });
  socket.on('finishNumericResult', ({code:c},cb=()=>{})=>{ const room=getRoom(c); if(!isHost(socket,room)||room.phase!=='numeric_result')return cb({ok:false}); if((room.numericRevealCount||0)<(room.numericResults?.length||0))return cb({ok:false,error:'Спочатку відкрийте всі місця.'}); const key=`${room.round}:${room.current.ci}:${room.current.qi}`; room.used[key]=true; room.turnPlayerId=room.numericResults?.[0]?.id||room.turnPlayerId; room.phase='board'; room.current=null; room.numericChallenge=null; room.numericAnswers={}; room.numericResults=null; cb({ok:true});emitState(room); });

  socket.on('revealImageStep', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current || room.current.questionType !== 'imageReveal')
      return cb({ok:false,error:'Це не питання із зображенням.'});
    if (!['question'].includes(room.phase))
      return cb({ok:false,error:'Зображення можна відкривати тільки до відкриття BUZZ.'});
    const values = room.current.revealValues || [room.current.value];
    if (room.current.revealStage >= values.length-1)
      return cb({ok:false,error:'Зображення вже повністю відкрите.'});
    room.current.revealStage += 1;
    room.current.value = values[room.current.revealStage];
    cb({ok:true,value:room.current.value,stage:room.current.revealStage});
    emitState(room);
  });

  socket.on('openBuzz', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current) return;
    const unready=room.players.filter(p=>p.connected && (Number(p.syncSamples||0)<3 || Date.now()-Number(p.lastSyncAt||0)>=12000));
    if(unready.length)return cb({ok:false,error:'Очікуємо SYNC: '+unready.map(p=>p.name).join(', ')});
    const leadMs=1200;
    room.phase='buzz'; room.buzzer=null; room.answeringLocked=new Set(); room.resultReason=null; room.buzzCandidates=[]; if(room.buzzResolveTimer){clearTimeout(room.buzzResolveTimer);room.buzzResolveTimer=null;}
    room.buzzOpensAt=Date.now()+leadMs;
    io.to(room.code).emit('buzzScheduled',{opensAt:room.buzzOpensAt});
    setTimeout(()=>{ if(rooms.get(room.code)===room && room.phase==='buzz' && !room.buzzer && room.buzzOpensAt && Date.now()>=room.buzzOpensAt-20) io.to(room.code).emit('cue',{type:'buzz_open',at:room.buzzOpensAt}); },leadMs);
    cb({ok:true,opensAt:room.buzzOpensAt}); emitState(room);
  });

  // v3.0.3 Fair Press Engine: compare validated synchronized press timestamps,
  // not just packet arrival order. A short collection window lets near-simultaneous
  // presses arrive before the server chooses a winner.
  socket.on('buzz', ({ code: c, pressedAtServerTime }, cb=()=>{}) => {
    const receivedAt=Date.now();
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || !room.current) return cb({ok:false,error:'Питання зараз неактивне.'});
    const duel = room.current?.type === 'duel';
    if (duel && !room.duelPlayers.includes(p.id)) return cb({ok:false,error:'Ви не берете участі в цій дуелі.'});

    const claimed=Number(pressedAtServerTime);
    const beforeScheduledOpen = room.phase==='buzz' && Number(room.buzzOpensAt||0) > receivedAt;
    const claimedBeforeOpen = Number.isFinite(claimed) && Number(room.buzzOpensAt||0)>0 && claimed < Number(room.buzzOpensAt)-35;
    if (room.phase === 'question' || room.phase === 'duel_question' || beforeScheduledOpen || claimedBeforeOpen) {
      if (Number(p.falseStartUntil||0) <= receivedAt) p.falseStartUntil = receivedAt+3000;
      emitState(room);
      return cb({ok:false,falseStart:true,until:p.falseStartUntil});
    }
    if (room.phase !== 'buzz' || room.buzzer || room.answeringLocked.has(p.id)) return cb({ok:false});
    if (Number(p.falseStartUntil||0) > receivedAt) return cb({ok:false,falseStart:true,until:p.falseStartUntil});

    // Anti-spoof sanity check: a real press cannot be in the future, and it should
    // not predate packet receipt by much more than the player's observed RTT.
    const observedRtt=Number.isFinite(p.networkRttMs)?Math.max(0,p.networkRttMs):300;
    const maxAge=Math.min(1200,Math.max(180,observedRtt*1.5+80));
    let pressTime=claimed;
    if (!Number.isFinite(pressTime) || pressTime>receivedAt+40 || pressTime<receivedAt-maxAge) {
      // Safe fallback for an old/stale client: estimate one-way transit as RTT/2.
      pressTime=receivedAt-Math.min(300,observedRtt/2);
    }
    pressTime=Math.max(Number(room.buzzOpensAt||0),pressTime);

    room.buzzCandidates = room.buzzCandidates || [];
    if(!room.buzzCandidates.some(x=>x.playerId===p.id)){
      room.buzzCandidates.push({playerId:p.id,pressTime,receivedAt});
    }
    cb({ok:true,pending:true});

    if(!room.buzzResolveTimer){
      const FAIR_WINDOW_MS=90;
      room.buzzResolveTimer=setTimeout(()=>{
        room.buzzResolveTimer=null;
        if(rooms.get(room.code)!==room || room.phase!=='buzz' || room.buzzer)return;
        const candidates=(room.buzzCandidates||[]).filter(x=>{
          const player=room.players.find(p=>p.id===x.playerId);
          return player && !room.answeringLocked.has(player.id) && Number(player.falseStartUntil||0)<=Date.now();
        });
        room.buzzCandidates=[];
        if(!candidates.length)return;
        candidates.sort((a,b)=>a.pressTime-b.pressTime || a.receivedAt-b.receivedAt);
        const winner=candidates[0];
        room.buzzer=winner.playerId;
        room.buzzOpensAt=null;
        room.phase='answering';
        emitState(room);
      },FAIR_WINDOW_MS);
    }
  });

  socket.on('judge', ({ code: c, correct }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current || !room.buzzer) return;
    const p = room.players.find(x => x.id === room.buzzer);
    if (!p) return;
    const value = room.current.value;
    p.score += correct ? value : -value;
    if (correct) {
      room.revealAnswer = true;
      room.resultReason = 'correct';
      room.phase = 'result';
    } else {
      room.answeringLocked.add(p.id);
      room.buzzer = null;
      // Important: do not auto-finish just because another player is temporarily disconnected.
      // Auto-reveal only when EVERY player in the room has already answered incorrectly.
      const eligiblePlayers = room.current?.type === 'duel'
        ? room.players.filter(x => room.duelPlayers.includes(x.id))
        : room.players;
      const everyoneWrong = eligiblePlayers.length > 0 && eligiblePlayers.every(x => room.answeringLocked.has(x.id));
      if (everyoneWrong) {
        room.revealAnswer = true;
        room.resultReason = 'all_wrong';
        room.phase = 'result';
      } else {
        room.phase = 'buzz'; room.buzzCandidates=[]; if(room.buzzResolveTimer){clearTimeout(room.buzzResolveTimer);room.buzzResolveTimer=null;} room.buzzOpensAt=Date.now()+800;
        io.to(room.code).emit('buzzScheduled',{opensAt:room.buzzOpensAt});
      }
    }
    cb({ok:true}); emitState(room);
  });

  socket.on('submitVaBankBet', ({ code: c, bet }, cb = () => {}) => {
    const room=getRoom(c);
    const p=room?.players.find(x=>x.id===socket.data.playerId);
    if(!room || !p || room.phase!=='va_bank_bet' || p.id!==room.vaBankPlayer) return cb({ok:false,error:'Ставку зараз зробити не можна.'});
    const max=Math.max(0,p.score);
    const n=Math.floor(Number(bet));
    if(!Number.isFinite(n) || n<0 || n>max) return cb({ok:false,error:`Ставка має бути від 0 до ${max}.`});
    room.vaBankBet=n; room.phase='va_bank_question'; cb({ok:true}); emitState(room);
  });

  socket.on('judgeVaBank', ({ code:c, correct }, cb=()=>{}) => {
    const room=getRoom(c);
    if(!isHost(socket,room) || room.phase!=='va_bank_question' || !room.vaBankPlayer) return;
    const p=room.players.find(x=>x.id===room.vaBankPlayer); if(!p)return;
    p.score += correct ? room.vaBankBet : -room.vaBankBet;
    room.revealAnswer=true; room.resultReason=correct?'correct':'va_bank_wrong'; room.phase='result';
    cb({ok:true}); emitState(room);
  });

  socket.on('selectDuelOpponent', ({ code:c, playerId }, cb=()=>{}) => {
    const room=getRoom(c);
    const chooser=room?.players.find(x=>x.id===socket.data.playerId);
    const host=isHost(socket,room);
    if(!room || room.phase!=='duel_choose') return cb({ok:false,error:'Дуель зараз недоступна.'});
    if(!host && (!chooser || chooser.id!==room.turnPlayerId)) return cb({ok:false,error:'Суперника обирає гравець, чия черга.'});
    if(playerId===room.turnPlayerId) return cb({ok:false,error:'Не можна обрати себе.'});
    if(!room.players.some(p=>p.id===playerId)) return cb({ok:false,error:'Гравця не знайдено.'});
    room.duelPlayers=[room.turnPlayerId,playerId]; room.phase='duel_question'; cb({ok:true}); emitState(room);
  });

  socket.on('openDuelBuzz', ({ code:c }, cb=()=>{}) => {
    const room=getRoom(c);
    if(!isHost(socket,room) || room.phase!=='duel_question') return;
    const leadMs=1200;
    room.phase='buzz'; room.buzzer=null; room.answeringLocked=new Set(); room.resultReason=null; room.buzzCandidates=[]; if(room.buzzResolveTimer){clearTimeout(room.buzzResolveTimer);room.buzzResolveTimer=null;} room.buzzOpensAt=Date.now()+leadMs;
    io.to(room.code).emit('buzzScheduled',{opensAt:room.buzzOpensAt});
    setTimeout(()=>{if(rooms.get(room.code)===room&&room.phase==='buzz'&&!room.buzzer)io.to(room.code).emit('cue',{type:'buzz_open',at:room.buzzOpensAt})},leadMs);
    cb({ok:true,opensAt:room.buzzOpensAt}); emitState(room);
  });

  socket.on('revealAnswer', ({ code: c }) => {
    const room = getRoom(c); if (!isHost(socket, room) || !room.current) return;
    room.buzzer = null;
    room.revealAnswer = true;
    room.resultReason = 'no_answer';
    room.phase = 'result';
    emitState(room);
  });
  socket.on('nextFromResult', ({ code: c }) => { const room = getRoom(c); if (!isHost(socket, room)) return; finishTile(room); emitState(room); });

  socket.on('selectCatReceiver', ({ code: c, playerId }, cb = () => {}) => {
    const room = getRoom(c);
    const chooser = room?.players.find(x => x.id === socket.data.playerId);
    const host = isHost(socket, room);
    if (!room || room.phase !== 'cat_choose' || !room.current || (!host && chooser?.id !== room.catChooser)) return;
    const p = room.players.find(x => x.id === playerId);
    if (!p) return cb({ok:false,error:'Гравця не знайдено.'});
    if (p.id === room.catChooser && room.players.length > 1) return cb({ok:false,error:'Кота в мішку треба передати іншому гравцеві.'});
    room.catReceiver = p.id; room.phase = 'cat_question'; cb({ok:true}); emitState(room);
  });

  socket.on('judgeCat', ({ code: c, correct }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'cat_question' || !room.catReceiver) return;
    const p = room.players.find(x => x.id === room.catReceiver);
    if (!p) return;
    p.score += correct ? room.current.value : -room.current.value;
    room.revealAnswer = true; room.phase = 'result'; cb({ok:true}); emitState(room);
  });

  socket.on('getAudienceState', ({code:c}={},cb=()=>{})=>{
    const room=getRoom(c); if(!room)return cb({ok:false,error:'Кімнату не знайдено.'});
    socket.data.roomCode=room.code; socket.join(room.code);
    socket.emit('state', publicState(room));
    cb({ok:true,code:room.code});
  });

  socket.on('joinAudience', ({code:c,name,audienceId}={},cb=()=>{})=>{
    const room=getRoom(c); if(!room)return cb({ok:false,error:'Кімнату не знайдено.'});
    let a=room.audience.find(x=>x.id===audienceId);
    if(!a){
      if(room.phase!=='audience_lobby')return cb({ok:false,error:'Зараз реєстрація глядачів закрита.'});
      const clean=String(name||'').trim().slice(0,24); if(!clean)return cb({ok:false,error:'Введіть нік.'});
      a={id:crypto.randomUUID(),name:clean,socketId:socket.id,connected:true,roundStats:{}}; room.audience.push(a);
    } else {a.socketId=socket.id;a.connected=true;if(name)a.name=String(name).trim().slice(0,24)||a.name;}
    socket.data.audienceId=a.id;socket.data.roomCode=room.code;socket.join(room.code);cb({ok:true,audienceId:a.id,name:a.name,code:room.code});emitState(room);
  });

  socket.on('openAudienceRound', ({code:c,roundIndex}={},cb=()=>{})=>{
    const room=getRoom(c);if(!isHost(socket,room))return cb({ok:false});const rounds=getRoomGame(room).audienceRounds||[];const ri=Number(roundIndex);
    if(!rounds[ri])return cb({ok:false,error:'Глядацький раунд не налаштований.'});
    room.audienceRoundIndex=ri;room.audienceQuestionIndex=0;room.audienceAnswers={};room.audienceRanking=[];room.audienceRevealCount=0;room.audienceReturnPhase='board';room.audienceEndsAt=null;
    room.audience.forEach(a=>{a.roundStats[ri]={correct:0,timeMs:0,answered:0};});room.phase='audience_lobby';cb({ok:true});emitState(room);
  });
  socket.on('startAudienceQuestion', ({code:c}={},cb=()=>{})=>{
    const room=getRoom(c);if(!isHost(socket,room)||!['audience_lobby','audience_result'].includes(room.phase))return cb({ok:false,error:'Питання зараз не готове.'});
    if(room.phase==='audience_lobby' && room.audience.length<1)return cb({ok:false,error:'Спочатку має приєднатися хоча б один глядач.'});
    const ar=(getRoomGame(room).audienceRounds||[])[room.audienceRoundIndex];if(!ar)return cb({ok:false});
    if(room.phase==='audience_result' && room.audienceQuestionIndex<ar.questions.length-1)room.audienceQuestionIndex++;
    room.audienceAnswers={};room.audienceStartedAt=Date.now();room.audienceEndsAt=room.audienceStartedAt+15000;room.phase='audience_question';
    clearTimeout(room.audienceTimer);room.audienceTimer=setTimeout(()=>{if(room.phase==='audience_question'){room.audienceEndsAt=null;room.phase='audience_result';emitState(room)}},15000);
    cb({ok:true});emitState(room);
  });
  socket.on('submitAudienceAnswer', ({code:c,option}={},cb=()=>{})=>{
    const room=getRoom(c);const a=room?.audience.find(x=>x.id===socket.data.audienceId);if(!room||!a||room.phase!=='audience_question')return cb({ok:false,error:'Питання неактивне.'});
    if(!room.audienceEndsAt||Date.now()>room.audienceEndsAt)return cb({ok:false,error:'Час вийшов.'});if(room.audienceAnswers[a.id])return cb({ok:false,error:'Відповідь уже зафіксована.'});
    const ar=(getRoomGame(room).audienceRounds||[])[room.audienceRoundIndex],q=ar?.questions?.[room.audienceQuestionIndex];const o=Number(option);if(!q||!Number.isInteger(o)||o<0||o>=q.options.length)return cb({ok:false});
    const ms=Math.max(0,Date.now()-room.audienceStartedAt);room.audienceAnswers[a.id]={option:o,ms};const st=a.roundStats[room.audienceRoundIndex]||(a.roundStats[room.audienceRoundIndex]={correct:0,timeMs:0,answered:0});st.answered++;if(o===q.correct){st.correct++;st.timeMs+=ms;}
    cb({ok:true});emitState(room);
  });
  socket.on('finishAudienceQuestion', ({code:c}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room)||room.phase!=='audience_question')return cb({ok:false});clearTimeout(room.audienceTimer);room.audienceTimer=null;room.audienceEndsAt=null;room.phase='audience_result';cb({ok:true});emitState(room)});
  socket.on('finishAudienceRound', ({code:c}={},cb=()=>{})=>{
    const room=getRoom(c);if(!isHost(socket,room)||room.phase!=='audience_result')return cb({ok:false});const ar=(getRoomGame(room).audienceRounds||[])[room.audienceRoundIndex];if(room.audienceQuestionIndex!==ar.questions.length-1)return cb({ok:false,error:'Ще є питання.'});
    const prev=new Set(room.audienceWinners.map(x=>x.id));const ranked=room.audience.map(a=>{const st=a.roundStats[room.audienceRoundIndex]||{correct:0,timeMs:0};return{id:a.id,name:a.name,correct:st.correct,timeMs:st.timeMs,eligible:!prev.has(a.id)&&st.answered>0}}).filter(x=>x.eligible).sort((a,b)=>(b.correct-a.correct)||(a.timeMs-b.timeMs)||a.name.localeCompare(b.name,'uk'));
    const win=ranked[0]||null;if(win){win.code=crypto.randomBytes(3).toString('hex').toUpperCase();room.audienceWinners.push({id:win.id,name:win.name,code:win.code,roundIndex:room.audienceRoundIndex});}
    room.audienceRanking=ranked;room.audienceRevealCount=0;room.phase='audience_podium';if(win){const wa=room.audience.find(x=>x.id===win.id);if(wa?.socketId)io.to(wa.socketId).emit('audiencePrize',{code:win.code,roundIndex:room.audienceRoundIndex});}cb({ok:true});emitState(room);
  });
  socket.on('revealNextAudience', ({code:c}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room)||room.phase!=='audience_podium')return cb({ok:false});const n=Math.min(5,room.audienceRanking?.length||0);if(room.audienceRevealCount<n)room.audienceRevealCount++;cb({ok:true});emitState(room)});
  socket.on('closeAudienceRound', ({code:c}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room)||room.phase!=='audience_podium')return cb({ok:false});room.phase='board';room.audienceRoundIndex=null;room.audienceQuestionIndex=0;room.audienceAnswers={};room.audienceEndsAt=null;cb({ok:true});emitState(room)});

  socket.on('nextRound', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room) || room.round !== 0) return;
    room.round = 1; room.phase = 'board'; room.current = null; resetQuestionState(room); cb({ok:true}); emitState(room);
  });

  socket.on('startFinalBets', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room)) return;
    room.phase = 'final_bets'; room.current = null; room.finalResults = null; room.finalRevealCount = 0;
    room.players.forEach(p => { p.bet = null; p.finalAnswer = ''; });
    cb({ok:true}); emitState(room);
  });

  socket.on('submitBet', ({ code: c, bet }, cb = () => {}) => {
    const room = getRoom(c); const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== 'final_bets') return;
    const max = Math.max(0, p.score); let n = Math.floor(Number(bet));
    if (!Number.isFinite(n)) n = 0; n = Math.max(0, Math.min(max, n)); p.bet = n;
    cb({ok:true, bet:n}); emitState(room);
  });

  socket.on('startFinalQuestion', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room) || room.phase !== 'final_bets') return;
    if (room.players.some(p => p.bet === null)) return cb({ok:false,error:'Не всі гравці зробили ставки.'});
    const game = getRoomGame(room);
    room.current = { type:'final', q:game.final.q, a:game.final.a };
    room.phase = 'final_ready';
    room.finalSeconds = 30;
    clearInterval(room.finalTimer); room.finalTimer = null;
    cb({ok:true}); emitState(room);
  });

  socket.on('startFinalTimer', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room) || room.phase !== 'final_ready') return;
    room.phase = 'final_question';
    room.finalSeconds = 30;
    startFinalCountdown(room);
    cb({ok:true}); emitState(room);
  });

  socket.on('submitFinalAnswer', ({ code: c, answer }, cb = () => {}) => {
    const room = getRoom(c); const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== 'final_question') return;
    p.finalAnswer = String(answer || '').trim().slice(0, 240); cb({ok:true}); emitState(room);
  });

  socket.on('finishFinalNow', ({ code: c }) => {
    const room = getRoom(c); if (!isHost(socket, room)) return;
    clearInterval(room.finalTimer); room.finalTimer = null; room.phase = 'final_review'; emitState(room);
  });

  socket.on('scoreFinal', ({ code: c, results }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room) || room.phase !== 'final_review') return;
    const map = new Map((results || []).map(r => [r.playerId, !!r.correct]));
    const details = room.players.map(p => {
      const correct = map.get(p.id) || false;
      const beforeScore = p.score;
      const bet = p.bet || 0;
      p.score += correct ? bet : -bet;
      return {id:p.id,name:p.name,beforeScore,bet,correct,finalAnswer:p.finalAnswer||'',score:p.score};
    });
    room.finalResults = details.sort((a,b)=>b.score-a.score);
    room.finalRevealCount = 0;
    room.revealAnswer = true; room.phase = 'final_result'; cb({ok:true}); emitState(room);
  });

  socket.on('revealNextFinalResult', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'final_result' || !Array.isArray(room.finalResults))
      return cb({ok:false,error:'Фінальні результати ще не готові.'});
    const total = room.finalResults.length;
    if ((room.finalRevealCount || 0) < total) room.finalRevealCount = (room.finalRevealCount || 0) + 1;
    cb({ok:true,revealCount:room.finalRevealCount,total});
    emitState(room);
  });


  socket.on('seasonAdminInit', async (_, cb=()=>{})=>{
    try{cb({ok:true,adminToken:socket.data.seasonAdminToken,seasons:await storage.listSeasons()})}
    catch(e){cb({ok:false,error:e.message})}
  });
  function isSeasonAdmin(token){return !!token&&token===socket.data.seasonAdminToken}
  socket.on('seasonAdminCreate', async ({adminToken,name}={},cb=()=>{})=>{
    if(!isSeasonAdmin(adminToken))return cb({ok:false,error:'Немає доступу.'});
    try{const id=await storage.createSeason(name);cb({ok:true,id,seasons:await storage.listSeasons()})}
    catch(e){cb({ok:false,error:e.message})}
  });
  socket.on('seasonAdminSetStatus', async ({adminToken,seasonId,status}={},cb=()=>{})=>{
    if(!isSeasonAdmin(adminToken))return cb({ok:false,error:'Немає доступу.'});
    try{await storage.setSeasonStatus(seasonId,status);cb({ok:true,seasons:await storage.listSeasons()})}
    catch(e){cb({ok:false,error:e.message})}
  });

  socket.on('seasonListHost', async ({code:c}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room))return cb({ok:false,error:'Немає доступу.'});try{cb({ok:true,seasons:await storage.listSeasons()})}catch(e){cb({ok:false,error:e.message})}});
  socket.on('createSeason', async ({code:c,name}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room))return cb({ok:false,error:'Немає доступу.'});try{const id=await storage.createSeason(name);cb({ok:true,id,seasons:await storage.listSeasons()})}catch(e){cb({ok:false,error:e.message})}});
  socket.on('setSeasonStatus', async ({code:c,seasonId,status}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room))return cb({ok:false,error:'Немає доступу.'});try{await storage.setSeasonStatus(seasonId,status);cb({ok:true,seasons:await storage.listSeasons()})}catch(e){cb({ok:false,error:e.message})}});
  socket.on('saveSeasonResult', async ({code:c,seasonId,isGrandFinal=false}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room))return cb({ok:false,error:'Немає доступу.'});if(room.phase!=='final_result'||!room.finalResults)return cb({ok:false,error:'Спочатку завершіть фінал.'});try{const id=await storage.saveGame({seasonId,roomCode:room.code,gameId:room.gameId,title:getRoomGame(room).menuTitle||getRoomGame(room).title,results:room.finalResults,isGrandFinal});room.savedSeasonGameId=id;room.savedSeasonId=seasonId;cb({ok:true,id});emitState(room)}catch(e){cb({ok:false,error:e.message})}});
  socket.on('correctSavedSeasonResult', async ({code:c,gameId,results}={},cb=()=>{})=>{const room=getRoom(c);if(!isHost(socket,room))return cb({ok:false,error:'Немає доступу.'});try{await storage.updateGameResults(gameId,results);cb({ok:true})}catch(e){cb({ok:false,error:e.message})}});

  socket.on('restartSameGame', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ok:false,error:'Лише ведучий може перезапустити гру.'});
    clearInterval(room.finalTimer); room.finalTimer = null;
    clearTimeout(room.firstTurnTimer); room.firstTurnTimer = null;
    room.phase = 'lobby'; room.paused=false; room.pausedPhase=null; room.pauseFirstTurnRemaining=null; room.pauseFinalRemaining=null; room.round = 0; room.used = {}; room.current = null;
    room.buzzer = null; room.revealAnswer = false; room.answeringLocked = new Set();
    room.catChooser = null; room.catReceiver = null; room.turnPlayerId = null;
    room.specialCells = {}; room.vaBankPlayer = null; room.vaBankBet = null; room.duelPlayers = [];
    room.finalSeconds = 30; room.finalResults = null; room.finalRevealCount = 0; room.savedSeasonGameId = null; room.savedSeasonId = null;
    room.firstTurnQuiz = getRoomGame(room).firstTurnQuiz || null;
    room.firstTurnAnswers = {}; room.firstTurnResults = null;
    room.players.forEach(p => { p.score = 0; p.bet = null; p.finalAnswer = ''; });
    cb({ok:true}); emitState(room);
  });

  socket.on('returnToGameMenu', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ok:false,error:'Лише ведучий може закрити кімнату.'});
    clearInterval(room.finalTimer);
    clearTimeout(room.firstTurnTimer);
    io.to(room.code).emit('roomClosed', { code: room.code, reason: 'Ведучий повернувся в головне меню.' });
    rooms.delete(room.code);
    socket.data.roomCode = null;
    cb({ok:true});
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode); if (!room) return;
    const p = room.players.find(x => x.id === socket.data.playerId);
    if (p && p.socketId === socket.id) { p.connected = false; p.socketId = null; p.syncSamples=0; p.lastSyncAt=0; }
    const a = room.audience.find(x => x.id === socket.data.audienceId); if(a){a.connected=false;a.socketId=null;}
    if((p && !p.connected)||a) emitState(room);
  });
});

// A backgrounded mobile browser can stop answering while Socket.IO still reports
// connected. Expire stale player sync and notify HOST without removing their score.
const playerLivenessTimer=setInterval(()=>{
 const now=Date.now();
 for(const room of rooms.values()){
   let changed=false;
   for(const player of room.players){
     if(!player.connected)continue;
     if(!player.socketId || now-Number(player.lastSyncAt||0)>11000){
       const oldSocketId=player.socketId;
       player.connected=false;player.socketId=null;player.syncSamples=0;player.lastSyncAt=0;
       changed=true;
       if(oldSocketId){
         const staleSocket=io.sockets.sockets.get(oldSocketId);
         if(staleSocket && staleSocket.data.playerId===player.id && staleSocket.data.roomCode===room.code) staleSocket.disconnect(true);
       }
     }
   }
   if(changed)emitState(room);
 }
},2000);
playerLivenessTimer.unref?.();

// Voice events arrive only over IPC from the locally forked Discord bot.
// Public socket clients cannot publish Discord speaking IDs.
let voiceLastEvent=0;
function clearDiscordSpeaking(){
  for(const room of rooms.values()){
    if(room.voiceSpeaking?.length){room.voiceSpeaking=[];room.voiceUpdatedAt=Date.now();io.to(room.code).emit('voiceSpeaking',{code:room.code,playerIds:[]});}
  }
}
function handleDiscordVoiceMessage(message){
  if(!message || message.type!=='voiceActivity')return;
  if(message.guildId!==process.env.DISCORD_GUILD_ID || message.channelId!==process.env.DISCORD_VOICE_CHANNEL_ID)return;
  if(!Array.isArray(message.userIds) || message.userIds.length>100)return;
  const active=new Set(message.userIds.filter(id=>typeof id==='string' && /^\d{17,20}$/.test(id)));
  voiceLastEvent=Date.now();
  for(const room of rooms.values()){
    const next=room.players.filter(p=>active.has(room.voiceMappings?.[p.id])).map(p=>p.id);
    const previous=room.voiceSpeaking||[];
    if(next.length!==previous.length || next.some(id=>!previous.includes(id))){
      room.voiceSpeaking=next;room.voiceUpdatedAt=Date.now();io.to(room.code).emit('voiceSpeaking',{code:room.code,playerIds:next});
    }
  }
}
const voiceStaleTimer=setInterval(()=>{
  if(voiceLastEvent && Date.now()-voiceLastEvent>20000){voiceLastEvent=0;clearDiscordSpeaking();}
},2000);
voiceStaleTimer.unref?.();

// DEV-only: optional bot process shares this free Render Web Service.
let voiceBotProcess=null;
function startOptionalVoiceBot(){
  const names=['DISCORD_BOT_TOKEN','DISCORD_GUILD_ID','DISCORD_VOICE_CHANNEL_ID'];
  const present=names.filter(name=>Boolean(process.env[name]));
  if(!present.length){console.log('Discord voice bot disabled (no environment variables).');return;}
  if(present.length!==names.length){console.warn('Discord voice bot disabled: incomplete environment variables.');return;}
  const {fork}=require('child_process');
  voiceBotProcess=fork(path.join(__dirname,'voice-bot','bot.js'),[],{env:process.env,stdio:'inherit'});
  voiceBotProcess.on('message',handleDiscordVoiceMessage);
  voiceBotProcess.on('error',err=>console.error('Discord voice bot process:',err.message));
  voiceBotProcess.on('exit',(code,signal)=>{console.warn('Discord voice bot exited:',code,signal);voiceBotProcess=null;voiceLastEvent=0;clearDiscordSpeaking();});
}
storage.init().then(()=>server.listen(PORT,'0.0.0.0',()=>{
  console.log(`SMOKERLOL v3.1.0-dev: http://0.0.0.0:${PORT}`);
  startOptionalVoiceBot();
})).catch(err=>{console.error('Storage init failed:',err);process.exit(1)});

function shutdown(signal) {
  if(voiceBotProcess){voiceBotProcess.kill('SIGTERM');voiceBotProcess=null;}
  console.log(`${signal}: завершуємо роботу сервера...`);
  for (const room of rooms.values()) {
    if (room.finalTimer) clearInterval(room.finalTimer);
    if (room.firstTurnTimer) clearTimeout(room.firstTurnTimer);
  }
  io.emit('serverRestarting', { message: 'Сервер перезапускається. Спробуйте перепідключитися через кілька секунд.' });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

