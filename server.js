const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = process.env.PORT || 3000;
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/host', (_, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (_, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/screen', (_, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/screen/:code', (_, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/health', (_, res) => res.json({ ok: true, version: '1.2.1', rooms: rooms.size }));

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
    title: questions.title,
    phase: room.phase,
    round: room.round,
    used: room.used,
    current: room.current,
    buzzer: room.buzzer,
    catChooser: room.catChooser,
    catReceiver: room.catReceiver,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, hasBet: p.bet !== null, hasFinalAnswer: !!p.finalAnswer })),
    finalSeconds: room.finalSeconds,
    revealAnswer: room.revealAnswer,
    finalResults: room.finalResults || null
  };
}

function emitState(room) {
  io.to(room.code).emit('state', publicState(room));
}

function getRoom(c) { return rooms.get(String(c || '').toUpperCase()); }
function isHost(socket, room) { return room && socket.data.hostToken && socket.data.hostToken === room.hostToken; }
function currentQuestion(room) {
  if (!room.current || room.current.type === 'final') return null;
  return questions.rounds[room.round].categories[room.current.ci].questions[room.current.qi];
}
function resetQuestionState(room) {
  room.buzzer = null;
  room.revealAnswer = false;
  room.answeringLocked = new Set();
  room.catChooser = null;
  room.catReceiver = null;
}
function finishTile(room) {
  if (room.current && room.current.type !== 'final') room.used[`${room.round}:${room.current.ci}:${room.current.qi}`] = true;
  room.current = null;
  resetQuestionState(room);
  room.phase = 'board';
}

io.on('connection', socket => {
  socket.on('createRoom', ({ hostToken } = {}, cb = () => {}) => {
    const roomCode = code();
    const token = hostToken || crypto.randomUUID();
    const room = {
      code: roomCode, hostToken: token, hostSocket: socket.id,
      players: [], phase: 'lobby', round: 0, used: {}, current: null,
      buzzer: null, revealAnswer: false, answeringLocked: new Set(),
      catChooser: null, catReceiver: null, finalSeconds: 30, finalTimer: null, finalResults: null
    };
    rooms.set(roomCode, room);
    socket.data.hostToken = token;
    socket.data.roomCode = roomCode;
    socket.join(roomCode);
    cb({ ok: true, code: roomCode, hostToken: token });
    emitState(room);
  });

  socket.on('rejoinHost', ({ code: c, hostToken }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.hostToken !== hostToken) return cb({ ok: false, error: 'Кімнату або ключ ведучого не знайдено.' });
    room.hostSocket = socket.id;
    socket.data.hostToken = hostToken;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code });
    emitState(room);
  });

  socket.on('joinPlayer', ({ code: c, name, playerId }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: 'Кімнату не знайдено.' });
    let p = room.players.find(x => x.id === playerId);
    if (!p) {
      if (room.players.length >= 4) return cb({ ok: false, error: 'У кімнаті вже 4 гравці.' });
      const clean = String(name || '').trim().slice(0, 20) || `Гравець ${room.players.length + 1}`;
      p = { id: crypto.randomUUID(), name: clean, score: 0, socketId: socket.id, connected: true, bet: null, finalAnswer: '' };
      room.players.push(p);
    } else {
      p.socketId = socket.id; p.connected = true;
      if (name) p.name = String(name).trim().slice(0,20) || p.name;
    }
    socket.data.playerId = p.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, playerId: p.id, code: room.code, name: p.name });
    emitState(room);
  });

  socket.on('joinScreen', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false, error: 'Кімнату не знайдено.' });
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code });
    emitState(room);
  });

  socket.on('startGame', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return;
    if (room.players.length < 1) return cb({ ok:false, error:'Потрібен хоча б один гравець.' });
    room.phase = 'board'; room.round = 0; room.used = {}; room.finalResults = null;
    room.players.forEach(p => { p.score = 0; p.bet = null; p.finalAnswer = ''; });
    cb({ok:true}); emitState(room);
  });

  socket.on('chooseTile', ({ code: c, ci, qi }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'board') return;
    ci = Number(ci); qi = Number(qi);
    const q = questions.rounds[room.round]?.categories[ci]?.questions[qi];
    if (!q) return cb({ok:false,error:'Невірна клітинка.'});
    const key = `${room.round}:${ci}:${qi}`;
    if (room.used[key]) return cb({ok:false,error:'Цю клітинку вже зіграно.'});
    resetQuestionState(room);
    room.current = { type: q.cat ? 'cat' : 'normal', ci, qi, value: q.value, q: q.cat ? q.cat.q : q.q, a: q.cat ? q.cat.a : q.a };
    if (q.cat && room.round === 1) {
      room.phase = 'cat_choose';
      room.catChooser = room.players.length ? room.players.reduce((a,b)=>a.score>=b.score?a:b).id : null;
    } else room.phase = 'question';
    cb({ok:true}); emitState(room);
  });

  socket.on('openBuzz', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current) return;
    room.phase = 'buzz'; room.buzzer = null; room.answeringLocked = new Set();
    cb({ok:true}); emitState(room);
  });

  socket.on('buzz', ({ code: c }) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== 'buzz' || room.buzzer || room.answeringLocked.has(p.id)) return;
    room.buzzer = p.id; room.phase = 'answering'; emitState(room);
  });

  socket.on('judge', ({ code: c, correct }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current || !room.buzzer) return;
    const p = room.players.find(x => x.id === room.buzzer);
    if (!p) return;
    const value = room.current.value;
    p.score += correct ? value : -value;
    if (correct) {
      room.revealAnswer = true; room.phase = 'result';
    } else {
      room.answeringLocked.add(p.id); room.buzzer = null; room.phase = 'buzz';
    }
    cb({ok:true}); emitState(room);
  });

  socket.on('revealAnswer', ({ code: c }) => {
    const room = getRoom(c); if (!isHost(socket, room) || !room.current) return;
    room.revealAnswer = true; room.phase = 'result'; emitState(room);
  });
  socket.on('nextFromResult', ({ code: c }) => { const room = getRoom(c); if (!isHost(socket, room)) return; finishTile(room); emitState(room); });

  socket.on('selectCatReceiver', ({ code: c, playerId }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || room.phase !== 'cat_choose' || !room.current) return;
    const p = room.players.find(x => x.id === playerId);
    if (!p) return cb({ok:false,error:'Гравця не знайдено.'});
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

  socket.on('nextRound', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room) || room.round !== 0) return;
    room.round = 1; room.phase = 'board'; room.current = null; resetQuestionState(room); cb({ok:true}); emitState(room);
  });

  socket.on('startFinalBets', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room)) return;
    room.phase = 'final_bets'; room.current = null; room.finalResults = null;
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
    room.current = { type:'final', q:questions.final.q, a:questions.final.a };
    room.phase = 'final_question'; room.finalSeconds = 30;
    clearInterval(room.finalTimer);
    room.finalTimer = setInterval(() => {
      room.finalSeconds--;
      if (room.finalSeconds <= 0) { clearInterval(room.finalTimer); room.finalTimer = null; room.phase = 'final_review'; }
      emitState(room);
    }, 1000);
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
    room.players.forEach(p => { const ok = map.get(p.id) || false; p.score += ok ? (p.bet || 0) : -(p.bet || 0); });
    room.finalResults = room.players.slice().sort((a,b)=>b.score-a.score).map(p=>({id:p.id,name:p.name,score:p.score}));
    room.revealAnswer = true; room.phase = 'final_result'; cb({ok:true}); emitState(room);
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode); if (!room) return;
    const p = room.players.find(x => x.id === socket.data.playerId);
    if (p) { p.connected = false; p.socketId = null; emitState(room); }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`СВОЯ ГРА v1.2.1: http://0.0.0.0:${PORT}`));

function shutdown(signal) {
  console.log(`${signal}: завершуємо роботу сервера...`);
  for (const room of rooms.values()) {
    if (room.finalTimer) clearInterval(room.finalTimer);
  }
  io.emit('serverRestarting', { message: 'Сервер перезапускається. Спробуйте перепідключитися через кілька секунд.' });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

