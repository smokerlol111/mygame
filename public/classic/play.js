(() => {
  const ui = ClassicUI, $ = id => document.getElementById(id);
  let session = null, lastKey = null, ownDraftKey = null, savedDraft = '', draftError = false, draftRequest = 0, restoring = false;
  try { session = JSON.parse(localStorage.getItem('classicTeamSession') || 'null'); } catch {}
  const entered = new URLSearchParams(location.search).get('room')?.toUpperCase() || session?.code || '';
  $('code').value = entered;
  $('name').value = session?.name || sessionStorage.getItem('classicSuggestedName') || '';
  const draftKey = () => 'classicDraft:' + ui.room + ':' + ui.state?.questionKey;
  async function join(payload) {
    const response = await ui.run('classicJoinTeam',payload);
    if (response) {
      session = {code:response.code,teamId:response.teamId,teamKey:response.teamKey,name:response.name};
      localStorage.setItem('classicTeamSession',JSON.stringify(session));
      if (ui.state?.questionKey && ui.team?.questionKey === ui.state.questionKey && !ui.team.submitted) {
        $('answer').value = localStorage.getItem(draftKey()) ?? ui.team.draft;
        savedDraft = ui.team.draft;
        if (ui.state.phase === 'classic_question' && $('answer').value !== savedDraft) saveDraft();
      }
      render();
    }
    return response;
  }
  $('joinForm').onsubmit = async event => {
    event.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    ui.room = code; ui.state = null; ui.team = null;
    await join({code,name:$('name').value,teamKey:session?.code===code ? session.teamKey : undefined});
  };
  async function saveDraft() {
    const text = $('answer').value, key = ui.state?.questionKey, request = ++draftRequest;
    draftError = false;
    if (!ui.socket.connected || ui.state?.phase !== 'classic_question' || ui.team?.submitted) return;
    render();
    try {
      const response = await ui.request('classicSaveDraft',{answer:text});
      if (request === draftRequest && key === ui.state?.questionKey) { savedDraft = response.draft; draftError = false; render(); }
    } catch {
      if (request === draftRequest && key === ui.state?.questionKey) { draftError = true; render(); }
    }
  }
  $('answer').oninput = () => { try { localStorage.setItem(draftKey(),$('answer').value); } catch {} saveDraft(); };
  $('answerForm').onsubmit = async event => {
    event.preventDefault(); $('send').disabled = true;
    const response = await ui.run('classicSubmitAnswer',{answer:$('answer').value});
    if (response) localStorage.removeItem(draftKey());
    render();
  };
  async function restore() {
    if (!session || restoring || ui.closed || (entered && entered !== session.code)) return;
    restoring = true; ui.room = session.code;
    await join(session); restoring = false;
  }
  function render() {
    const state = ui.state;
    $('join').disabled = !ui.socket.connected;
    $('joinForm').hidden = !!state;
    $('session').hidden = !state;
    if (!state) return;
    $('teamName').textContent = session?.name || $('name').value;
    $('phase').textContent = ui.phaseText(state);
    ui.renderQuestion(state);
    ui.renderPresentation(state);
    const own = ui.team?.questionKey === state.questionKey ? ui.team : null;
    if (lastKey !== state.questionKey) {
      lastKey = state.questionKey; ownDraftKey = null; savedDraft = ''; draftError = false;
      $('answer').value = localStorage.getItem(draftKey()) || '';
    }
    if (own && ownDraftKey !== state.questionKey) {
      ownDraftKey = state.questionKey; savedDraft = own.draft;
      $('answer').value = localStorage.getItem(draftKey()) ?? own.draft;
    }
    if (own?.submitted) { $('answer').value = own.answer; localStorage.removeItem(draftKey()); }
    $('answerForm').hidden = !['classic_question','classic_paused','classic_review','classic_result'].includes(state.phase);
    const disabled = state.phase !== 'classic_question' || !own || !!own.submitted || !ui.socket.connected || !!ui.closed;
    $('answer').disabled = disabled; $('send').disabled = disabled;
    $('answerStatus').textContent = own?.submitted ? own.autoSubmitted ? '✓ Чернетку автоматично передано ведучому.' : '✓ Відповідь збережена на сервері.' : state.phase === 'classic_question'
      ? draftError ? 'Не вдалося зберегти чернетку. Перевірте з’єднання.' : savedDraft !== $('answer').value ? 'Зберігаємо чернетку…' : 'Чернетку збережено. Після завершення часу її буде здано автоматично.'
      : state.phase === 'classic_paused' ? 'Гра на паузі.' : 'Приймання відповідей завершено.';
    $('teams').parentElement.hidden = true;
  }
  ui.onChange(render);
  ui.socket.on('connect',restore);
  if (ui.socket.connected) restore();
  render();
})();
