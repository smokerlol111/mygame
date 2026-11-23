(() => {
  const ui = ClassicUI, $ = id => document.getElementById(id);
  let pool = null, session = null, restoring = false, preparing = false;
  try { session = JSON.parse(localStorage.getItem('classicHostSession') || 'null'); } catch {}
  $('hostKey').value = ui.hostKey;
  $('reveal').textContent = 'Відкрити відповідь';
  $('keyField').hidden = !!ui.hostKey;
  function showPool(value) {
    pool = value;
    $('poolSummary').textContent = `${value.title} · ${value.questions.length} питань`;
    $('poolPreview').hidden = false;
    $('poolQuestions').innerHTML = value.questions.map(question=>`<li><strong>${ui.h(question.q)}</strong><p>${ui.h(question.a)}</p><small>ID: ${ui.h(question.id || 'буде призначено при створенні')}</small></li>`).join('');
  }
  $('randomPool').onclick = async () => {
    preparing = true; render();
    const response = await ui.run('classicRandomPool',{hostKey:$('hostKey').value,count:Number($('randomCount').value)});
    if (response) {
      showPool(response.pool);
      $('randomCount').max = response.available;
      $('randomInfo').textContent = `Доступно ${response.available} різних текстових питань. Це повторне використання питань проведених ігор; кожне — за 1 бал. Перегляньте набір перед створенням кімнати.`;
    }
    preparing = false; render();
  };
  $('poolFile').onchange = async () => {
    pool = null; preparing = true; $('poolPreview').hidden = true; render();
    try {
      const file = $('poolFile').files[0];
      if (!file) return;
      if (file.size > 750000) throw new Error('Набір завеликий. Скоротіть файл до 750 КБ.');
      const value = JSON.parse(await file.text());
      if (!value.title || !Array.isArray(value.questions) || !value.questions.length) throw new Error('У наборі потрібні назва й непорожній список questions.');
      showPool(value);
      ui.notice('');
    } catch (error) { $('poolSummary').textContent = 'Набір не завантажено.'; ui.notice(error.message); }
    finally { preparing = false; render(); }
  };
  $('create').onclick = async () => {
    $('create').disabled = true;
    const response = await ui.run('classicCreateRoom', { hostKey:$('hostKey').value, pool });
    if (response) {
      session = { code:response.code, hostToken:response.hostToken };
      localStorage.setItem('classicHostSession',JSON.stringify(session));
      if ($('hostKey').value) localStorage.setItem('sgHostKey',$('hostKey').value);
    }
    render();
  };
  for (const [id,event] of Object.entries({start:'classicStart',open:'classicOpenAnswers',pause:'classicTogglePause',
    closeAnswers:'classicCloseAnswers',reveal:'classicReveal',next:'classicNextQuestion'})) $(id).onclick = () => ui.run(event);
  const continueButton = document.createElement('button');
  continueButton.id = 'continue'; continueButton.textContent = 'Продовжити квіз'; continueButton.hidden = true;
  continueButton.onclick = () => ui.run('classicContinue');
  $('next').after(continueButton);
  const revealPlace = document.createElement('button');
  revealPlace.id = 'revealPlace'; revealPlace.hidden = true;
  revealPlace.onclick = () => ui.run('classicRevealNextPlace',{revealCount:ui.state.ceremony.revealCount});
  continueButton.after(revealPlace);
  $('closeRoom').onclick = () => {
    if (confirm('Закрити кімнату? Збережіть результати перед завершенням.')) ui.run('classicCloseRoom');
  };
  $('mediaPlay').onclick = () => ui.run('classicMediaControl',{action:'play',time:ui.mediaTime()});
  $('mediaPause').onclick = () => ui.run('classicMediaControl',{action:'pause',time:ui.mediaTime()});
  $('mediaSeek').onclick = () => ui.run('classicMediaControl',{action:'seek',time:Number($('mediaPosition').value)});
  $('export').onclick = () => {
    const output = { title:ui.state.title, code:ui.room, completedAt:new Date().toISOString(),
      teams:ui.host.standings, questions:ui.host?.history || [] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `classic-${ui.room}-results.json`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  async function restore() {
    if (!session || restoring || ui.closed) return;
    restoring = true; ui.room = session.code;
    const response = await ui.run('classicRejoinHost',session);
    if (!response) {
      session = null; ui.room = ''; ui.state = null; ui.host = null;
      localStorage.removeItem('classicHostSession'); render();
    }
    restoring = false;
  }
  function render() {
    const state = ui.state;
    $('create').disabled = !pool || !ui.socket.connected || preparing;
    $('randomPool').disabled = !ui.socket.connected || preparing;
    $('poolFile').disabled = preparing;
    $('setup').hidden = !!state;
    $('session').hidden = !state;
    if (!state) return;
    $('roomCode').textContent = state.code;
    $('joinLink').href = '/classic/play?room=' + encodeURIComponent(state.code);
    $('screenLink').href = '/screen/' + encodeURIComponent(state.code);
    $('phase').textContent = ui.phaseText(state);
    ui.renderQuestion(state);
    ui.renderPresentation(state);
    const privateState = ui.host?.questionKey === state.questionKey ? ui.host : null;
    $('hostAnswer').textContent = privateState?.questionAnswer || '';
    $('mediaControls').hidden = !['audio','video'].includes(state.question?.type);
    const phases = {start:['classic_lobby'],open:['classic_ready'],pause:['classic_question','classic_paused'],
      closeAnswers:['classic_question'],reveal:['classic_review'],next:['classic_result'],
      continue:['classic_standings'],revealPlace:['classic_final'],export:['classic_final','classic_finished']};
    for (const [id,visible] of Object.entries(phases)) {
      $(id).hidden = !visible.includes(state.phase);
      $(id).disabled = !ui.socket.connected || !!ui.closed;
    }
    for (const id of ['closeRoom','mediaPlay','mediaPause','mediaSeek']) $(id).disabled = !ui.socket.connected || !!ui.closed || state.phase === 'classic_paused';
    $('start').disabled ||= !state.teams.length;
    $('pause').textContent = state.phase === 'classic_paused' ? 'Продовжити' : 'Пауза';
    $('next').textContent = state.questionNumber === state.totalQuestions ? 'Почати фінальну церемонію'
      : state.standingsAfter.includes(state.questionNumber) ? 'Показати таблицю команд' : 'Наступне питання';
    revealPlace.textContent = `Відкрити ${ui.host?.nextRevealPlace || ''} місце`;
    $('teamsTitle').textContent = state.phase === 'classic_finished' ? 'Підсумкові результати' : `Команди · ${state.teams.filter(team=>team.submitted).length} / ${state.teams.length} відповідей`;
    if (state.phase === 'classic_review') {
      const answers = privateState?.answers || [];
      $('reveal').disabled ||= !privateState || answers.some(answer => answer.submitted && typeof answer.correct !== 'boolean');
      $('teams').innerHTML = answers.map(answer => `<div class="team-row"><strong>${ui.h(answer.name)}</strong><span>${answer.submitted ? answer.correct === true ? '✓ Зараховано' : answer.correct === false ? '✕ Не зараховано' : 'Очікує перевірки' : 'Без відповіді'}</span><div class="submitted-answer">${ui.h(answer.answer || 'Відповідь не надійшла')}${answer.autoSubmitted ? '<br><small>Здано автоматично з чернетки</small>' : ''}</div>${answer.submitted ? `<div class="row"><button class="positive" data-team="${ui.h(answer.teamId)}" data-correct="true">Зарахувати</button><button class="negative" data-team="${ui.h(answer.teamId)}" data-correct="false">Не зарахувати</button></div>` : ''}</div>`).join('');
      $('teams').querySelectorAll('[data-team]').forEach(button => {
        button.disabled = !ui.socket.connected || !!ui.closed;
        button.onclick = () => ui.run('classicJudgeAnswer',{teamId:button.dataset.team,correct:button.dataset.correct==='true'});
      });
    } else ui.renderTeams($('teams'),{...state,teams:(ui.host?.standings || []).map(team=>({...state.teams.find(item=>item.id===team.id),...team}))});
  }
  ui.onChange(render);
  ui.socket.on('connect',restore);
  if (ui.socket.connected) restore();
  render();
})();
