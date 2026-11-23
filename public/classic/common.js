(() => {
  const socket = io();
  const listeners = [];
  const ui = { socket, state:null, host:null, team:null, room:'', offset:0 };
  const notify = reason => listeners.forEach(listener => listener(reason));
  ui.onChange = listener => listeners.push(listener);
  ui.h = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  ui.notice = text => { const node = document.getElementById('notice'); node.textContent = text; node.hidden = !text; };
  ui.setState = state => {
    if (state?.gameType !== 'classic' || (ui.room && ui.room !== state.code)) return;
    ui.room = state.code; ui.state = state; ui.offset = state.serverNow - Date.now(); notify('state');
  };
  function hostState(state) {
    if (state.code !== ui.room) return;
    ui.host = { ...(ui.host || {}), ...state }; notify('host');
  }
  function teamState(state) { if (state.code === ui.room) { ui.team = state; notify('team'); } }
  async function requireRandomPool() {
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),6000);
    const restartMessage = 'Запущений сервер ще не підтримує випадкові питання. Перезапустіть локальний сервер гри та оновіть сторінку.';
    try {
      const response = await fetch('/api/capabilities',{cache:'no-store',signal:controller.signal});
      if (response.status === 404) throw new Error(restartMessage);
      if (!response.ok) throw new Error('Не вдалося перевірити сервер гри. Спробуйте ще раз.');
      const capabilities = await response.json();
      if (!capabilities.classicRandomPool) throw new Error(restartMessage);
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError)
        throw new Error('Немає відповіді від сервера гри. Перевірте з’єднання та спробуйте ще раз.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  ui.request = async (event, payload = {}) => {
    if (event === 'classicRandomPool') await requireRandomPool();
    const response = await socket.timeout(6000).emitWithAck(event, { code:ui.room, questionKey:ui.state?.questionKey, ...payload });
    if (!response?.ok) throw new Error(response?.error || 'Не вдалося виконати дію.');
    if (response.state) ui.setState(response.state);
    if (response.hostState) hostState(response.hostState);
    if (response.teamState) teamState(response.teamState);
    return response;
  };
  ui.run = async (event, payload) => {
    try { const response = await ui.request(event, payload); ui.notice(''); return response; }
    catch (error) {
      ui.notice(/timed out|timeout/i.test(error.message || '')
        ? 'Сервер не підтвердив дію. Перевірте з’єднання й оновіть сторінку.'
        : error.message || 'Немає зв’язку із сервером.');
      return null;
    }
  };
  socket.on('state', ui.setState);
  socket.on('classicHostState', hostState);
  socket.on('classicTeamState', teamState);
  socket.on('roomClosed', event => {
    if (event.code !== ui.room) return;
    ui.closed = true; pauseMedia(); ui.notice(event.reason || 'Кімнату закрито.'); notify('closed');
  });
  socket.on('classicSessionReplaced', () => {
    ui.closed = true; pauseMedia(); socket.disconnect(); ui.notice('Капітан або ведучий підключився з іншого вікна. Ця сесія завершена.'); notify('closed');
  });
  for (const event of ['connect','disconnect']) socket.on(event, () => {
    document.getElementById('network').textContent = socket.connected ? '● Підключено' : '○ Відновлюємо зв’язок';
    if (!socket.connected) pauseMedia();
    notify('network');
  });
  const params = new URLSearchParams(location.search);
  if (params.has('key')) {
    localStorage.setItem('sgHostKey', params.get('key')); params.delete('key');
    history.replaceState(null,'',location.pathname + (params.size ? '?' + params.toString() : ''));
  }
  ui.hostKey = localStorage.getItem('sgHostKey') || '';
  ui.phaseText = state => ({classic_lobby:'Команди підключаються',classic_ready:'Питання готове',classic_question:'Приймаємо відповіді',
    classic_paused:'Пауза',classic_review:'Ведучий перевіряє відповіді',classic_result:'Результати питання',
    classic_standings:'Проміжні підсумки',classic_final:'Фінальна церемонія',classic_finished:'Квіз завершено'})[state.phase] || '';
  ui.renderTeams = (node, state, {answers = true, limit = state.teams.length} = {}) => {
    node.innerHTML = state.teams.slice(0,limit).map(team => `<div class="team-row"><div><strong>${ui.h(team.name)}</strong><br><small>${state.phase === 'classic_finished' ? 'Місце ' + team.place : team.submitted ? '✓ Відповідь надіслана' : team.connected ? 'У грі' : 'Відновлює з’єднання'}</small></div>${typeof team.score === 'number' ? `<div class="score">${team.score}</div>` : ''}${answers && state.phase === 'classic_result' ? `<div class="submitted-answer">${ui.h(team.answer || 'Без відповіді')}<br><small>${team.correct ? 'Зараховано · +' + team.awarded : 'Не зараховано · +0'}</small></div>` : ''}</div>`).join('');
  };
  const presentation = document.createElement('section');
  presentation.id = 'presentation'; presentation.className = 'panel presentation'; presentation.hidden = true;
  document.getElementById('question').insertAdjacentElement('afterend', presentation);
  let presentationKey = '';
  const table = teams => `<div class="standings-scroll"><table class="standings"><thead><tr><th scope="col">Місце</th><th scope="col">Команда</th><th scope="col">Бали</th></tr></thead><tbody>${teams.map(team=>`<tr><td>${team.place}</td><th scope="row">${ui.h(team.name)}</th><td>${team.score}</td></tr>`).join('')}</tbody></table></div>`;
  ui.renderPresentation = state => {
    const visible = ['classic_standings','classic_final','classic_finished'].includes(state.phase);
    presentation.hidden = !visible;
    document.querySelectorAll('[data-clock]').forEach(node => { node.hidden = visible; });
    if (!visible) { presentationKey = ''; return; }
    const key = `${state.phase}:${state.questionKey}:${state.ceremony?.revealCount || 0}`;
    if (key === presentationKey) return;
    presentationKey = key;
    if (state.phase === 'classic_standings') {
      presentation.innerHTML = `<h2>Таблиця команд</h2><p class="muted">Після ${state.questionNumber} із ${state.totalQuestions} питань</p>${table(state.standings)}`;
      return;
    }
    const ceremony = state.ceremony, latest = ceremony.latest, winner = latest[0]?.place === 1;
    const revealed = [...ceremony.revealed].sort((a,b)=>a.place-b.place);
    presentation.innerHTML = `<div class="ceremony-stage ${winner ? 'ceremony-winner' : ''}" aria-live="polite"><div class="ceremony-icon">${winner ? '👑' : '🏆'}</div>${latest.length ? `<p class="ceremony-place">${winner ? latest.length > 1 ? 'ПЕРЕМОЖЦІ КВІЗУ' : 'ПЕРЕМОЖЕЦЬ КВІЗУ' : latest[0].place + ' МІСЦЕ'}</p><h2 class="ceremony-name">${latest.map(team=>ui.h(team.name)).join(' · ')}</h2><div class="ceremony-score">${latest[0].score}<small> балів</small></div>` : '<h2>Фінальна церемонія</h2><p class="muted">Відкриваємо місця від останнього до переможця</p>'}</div>${revealed.length ? table(revealed) : ''}`;
  };
  let mediaElement = null, mediaKey = '', mediaRevision = null;
  function pauseMedia() { if (mediaElement && mediaElement.tagName !== 'IMG') mediaElement.pause(); }
  function syncMedia() {
    const state = ui.state;
    if (!mediaElement || mediaElement.tagName === 'IMG' || !state?.media) return;
    const target = state.media.time + (state.media.playing ? Math.max(0,Date.now()+ui.offset-state.media.updatedAt)/1000 : 0);
    if (mediaElement.readyState >= 1 && (mediaRevision !== state.media.revision || Math.abs(mediaElement.currentTime-target) > .6)) {
      try { mediaElement.currentTime = target; mediaRevision = state.media.revision; } catch {}
    }
    if (!state.media.playing || ui.closed || !socket.connected) mediaElement.pause();
    else if (mediaElement.paused) {
      const active = mediaElement;
      active.play().then(() => { document.getElementById('allowSound').hidden = true; }).catch(() => {
        if (active === mediaElement && ui.state?.media?.playing) document.getElementById('allowSound').hidden = false;
      });
    }
  }
  ui.renderQuestion = state => {
    const block = document.getElementById('question');
    block.hidden = !state.question;
    if (!state.question) { pauseMedia(); document.getElementById('allowSound').hidden = true; return; }
    if (!['audio','video'].includes(state.question.type)) document.getElementById('allowSound').hidden = true;
    document.getElementById('questionText').textContent = state.question.q;
    document.getElementById('questionNumber').textContent = `Питання ${state.questionNumber} / ${state.totalQuestions} · ${state.question.points} б.`;
    const answer = document.getElementById('revealedAnswer');
    answer.hidden = !state.question.answer; answer.textContent = state.question.answer;
    const nextKey = state.questionKey + ':' + state.question.media;
    if (nextKey !== mediaKey) {
      pauseMedia(); mediaKey = nextKey; mediaRevision = null;
      const box = document.getElementById('media'); box.replaceChildren(); mediaElement = null;
      if (state.question.media) {
        mediaElement = document.createElement({image:'img',audio:'audio',video:'video'}[state.question.type]);
        mediaElement.src = state.question.media;
        if (state.question.type !== 'image') {
          mediaElement.preload = 'metadata'; mediaElement.playsInline = true; mediaElement.controls = false;
          mediaElement.addEventListener('loadedmetadata',syncMedia);
          mediaElement.addEventListener('play', () => { if (!ui.state?.media?.playing) mediaElement.pause(); });
        }
        box.append(mediaElement);
      }
    }
    syncMedia();
  };
  ui.mediaTime = () => mediaElement?.currentTime || 0;
  document.getElementById('allowSound').onclick = () => {
    document.getElementById('allowSound').hidden = true;
    if (mediaElement && mediaElement.tagName !== 'IMG') mediaElement.muted = false;
    syncMedia();
  };
  setInterval(() => {
    const state = ui.state;
    if (!state) return;
    const milliseconds = state.phase === 'classic_question' ? Math.max(0,state.endsAt-(Date.now()+ui.offset)) : state.remainingMs;
    document.querySelectorAll('[data-clock]').forEach(node => { node.textContent = Math.ceil(milliseconds/1000); });
  },100);
  setInterval(() => {
    if (!socket.connected) return;
    const sent = Date.now(); socket.emit('timeSync',{clientSentAt:sent},result => { ui.offset = result.serverSentAt - (sent+Date.now())/2; });
  },5000);
  window.ClassicUI = ui;
})();
