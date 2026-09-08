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
app.get('/questions.json', (_, res) => res.sendFile(path.join(__dirname, 'questions.json')));
app.get('/screen', (_, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/screen/:code', (_, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/health', (_, res) => res.json({ ok: true, version: '1.3.1', rooms: rooms.size }));

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
    turnPlayerId: room.turnPlayerId,
    vaBankPlayer: room.vaBankPlayer,
    vaBankBet: room.vaBankBet,
    duelPlayers: room.duelPlayers || [],
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, hasBet: p.bet !== null, hasFinalAnswer: !!p.finalAnswer, finalAnswer: ['final_review','final_result'].includes(room.phase) ? p.finalAnswer : '' })),
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
  room.revealAnswer = false; room.resultReason = null;
  room.answeringLocked = new Set();
  room.catChooser = null;
  room.catReceiver = null;
  room.vaBankPlayer = null;
  room.vaBankBet = null;
  room.duelPlayers = [];
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
function randomSpecialCells(room) {
  const candidates = [];
  questions.rounds[1].categories.forEach((cat, ci) => cat.questions.forEach((q, qi) => {
    if (!q.cat) candidates.push(`1:${ci}:${qi}`);
  }));
  for (let i=candidates.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1)); [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
  }
  return { [candidates[0]]:'va_bank', [candidates[1]]:'va_bank', [candidates[2]]:'duel' };
}

io.on('connection', socket => {
  socket.on('createRoom', ({ hostToken } = {}, cb = () => {}) => {
    const roomCode = code();
    const token = hostToken || crypto.randomUUID();
    const room = {
      code: roomCode, hostToken: token, hostSocket: socket.id,
      players: [], phase: 'lobby', round: 0, used: {}, current: null,
      buzzer: null, revealAnswer: false, answeringLocked: new Set(),
      catChooser: null, catReceiver: null, turnPlayerId: null,
      specialCells: {}, vaBankPlayer: null, vaBankBet: null, duelPlayers: [],
      finalSeconds: 30, finalTimer: null, finalResults: null
    };
    rooms.set(roomCode, room);
    socket.data.hostToken = token;
    socket.data.roomCode = roomCode;
    socket.join(roomCode);
    cb({ ok: true, code: roomCode, hostToken: token, state: publicState(room) });
    emitState(room);
  });

  socket.on('rejoinHost', ({ code: c, hostToken }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.hostToken !== hostToken) return cb({ ok: false, error: 'Кімнату або ключ ведучого не знайдено.' });
    room.hostSocket = socket.id;
    socket.data.hostToken = hostToken;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cb({ ok: true, code: room.code, state: publicState(room) });
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

  socket.on('closeRoom', ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: 'Немає доступу до цієї кімнати.' });
    if (room.finalTimer) clearInterval(room.finalTimer);
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

  socket.on('startGame', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return;
    if (room.players.length < 1) return cb({ ok:false, error:'Потрібен хоча б один гравець.' });
    room.phase = 'board'; room.round = 0; room.used = {}; room.finalResults = null;
    room.specialCells = randomSpecialCells(room);
    room.turnPlayerId = room.players[0]?.id || null;
    room.players.forEach(p => { p.score = 0; p.bet = null; p.finalAnswer = ''; });
    cb({ok:true}); emitState(room);
  });

  socket.on('chooseTile', ({ code: c, ci, qi }, cb = () => {}) => {
    const room = getRoom(c);
    if (!room || room.phase !== 'board') return cb({ok:false,error:'Зараз не можна обирати питання.'});
    const pid = socket.data.playerId;
    const host = isHost(socket, room);
    if (!host && pid !== room.turnPlayerId) return cb({ok:false,error:'Зараз питання обирає інший гравець.'});
    ci = Number(ci); qi = Number(qi);
    const q = questions.rounds[room.round]?.categories[ci]?.questions[qi];
    if (!q) return cb({ok:false,error:'Невірна клітинка.'});
    const key = `${room.round}:${ci}:${qi}`;
    if (room.used[key]) return cb({ok:false,error:'Цю клітинку вже зіграно.'});
    resetQuestionState(room);
    const special = q.cat && room.round===1 ? 'cat' : (room.specialCells[key] || 'normal');
    room.current = { type:special, ci, qi, value:q.value, q:q.cat ? q.cat.q : q.q, a:q.cat ? q.cat.a : q.a };

    if (special === 'cat') {
      room.phase = 'cat_choose';
      room.catChooser = room.turnPlayerId;
    } else if (special === 'va_bank') {
      room.phase = 'va_bank_bet';
      room.vaBankPlayer = room.turnPlayerId;
    } else if (special === 'duel') {
      room.phase = 'duel_choose';
      room.duelPlayers = room.turnPlayerId ? [room.turnPlayerId] : [];
    } else {
      room.phase = 'question';
    }
    cb({ok:true}); emitState(room);
  });

  socket.on('openBuzz', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.current) return;
    room.phase = 'buzz'; room.buzzer = null; room.answeringLocked = new Set(); room.resultReason = null;
    cb({ok:true}); emitState(room);
  });

  socket.on('buzz', ({ code: c }) => {
    const room = getRoom(c);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.phase !== 'buzz' || room.buzzer || room.answeringLocked.has(p.id)) return;
    if (room.current?.type === 'duel' && !room.duelPlayers.includes(p.id)) return;
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
        room.phase = 'buzz';
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
    room.phase='buzz'; room.buzzer=null; room.answeringLocked=new Set(); room.resultReason=null;
    cb({ok:true}); emitState(room);
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
    room.phase = 'final_ready';
    room.finalSeconds = 30;
    clearInterval(room.finalTimer); room.finalTimer = null;
    cb({ok:true}); emitState(room);
  });

  socket.on('startFinalTimer', ({ code: c }, cb = () => {}) => {
    const room = getRoom(c); if (!isHost(socket, room) || room.phase !== 'final_ready') return;
    room.phase = 'final_question';
    room.finalSeconds = 30;
    clearInterval(room.finalTimer);
    room.finalTimer = setInterval(() => {
      room.finalSeconds--;
      if (room.finalSeconds <= 0) {
        room.finalSeconds = 0;
        clearInterval(room.finalTimer);
        room.finalTimer = null;
        room.phase = 'final_review';
      }
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

server.listen(PORT, '0.0.0.0', () => console.log(`СВОЯ ГРА v1.3.1: http://0.0.0.0:${PORT}`));

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

