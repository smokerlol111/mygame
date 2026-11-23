(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function mount({container,socket,hostKey,createRoom}) {
    let prepared = null, busy = false;
    container.innerHTML = `<h3>Випадкова гра за категоріями</h3><p class="muted">Два раунди по 5 тем і 5 питань. Теми повторюються між раундами, питання — ні. Медіа, BUZZ, спецклітинки, стартове, глядацькі питання й фінал збережені.</p><button class="btn secondary" id="randomBoardOptions">Обрати теми</button><div id="randomBoardThemes" hidden></div><p id="randomBoardNotice" role="status"></p><div class="row"><button class="btn gold" id="randomBoardGenerate" hidden>Скласти випадкове поле</button><button class="btn" id="randomBoardCreate" hidden>Створити кімнату з цим полем</button><button class="btn secondary" id="randomBoardDownload" hidden>Зберегти набір JSON</button></div><details id="randomBoardPreview" hidden><summary>Переглянути питання й відповіді</summary><div id="randomBoardQuestions"></div></details>`;
    const get=id=>container.querySelector('#'+id);
    const notice=text=>{if(container.isConnected)get('randomBoardNotice').textContent=text;};
    const request=async(event,extra={})=>{
      const response=await socket.timeout(6000).emitWithAck(event,{hostKey,...extra});
      if(!response.ok)throw new Error(response.error || 'Не вдалося підготувати гру.');
      return response;
    };
    function controls() {
      if(!container.isConnected)return;
      const count=container.querySelectorAll('input:checked').length;
      get('randomBoardOptions').disabled=busy;
      get('randomBoardGenerate').disabled=busy || (count!==0&&count!==5);
      get('randomBoardCreate').disabled=busy;
      get('randomBoardDownload').disabled=busy || !prepared;
      container.querySelectorAll('input').forEach(input=>{input.disabled=busy || input.dataset.unavailable==='true';});
    }
    get('randomBoardOptions').onclick=async()=>{
      prepared=null;get('randomBoardCreate').hidden=true;get('randomBoardDownload').hidden=true;get('randomBoardPreview').hidden=true;
      busy=true;controls();notice('Завантажуємо теми…');
      try {
        const response=await fetch('/api/capabilities',{cache:'no-store',signal:AbortSignal.timeout(6000)});
        if(!response.ok || !(await response.json()).randomBoard)throw new Error('Для випадкового поля потрібно перезапустити локальний сервер і оновити сторінку.');
        const {themes}=await request('boardRandomOptions');
        if(!container.isConnected)return;
        get('randomBoardThemes').hidden=false;
        get('randomBoardThemes').innerHTML=`<p class="muted">Оберіть рівно 5 тем або залиште всі без позначок для випадкового вибору. Рівень — початковий рядок питання в старій категорії.</p>${themes.map(theme=>`<label style="display:block;margin:10px 0"><input type="checkbox" style="width:auto;margin-right:8px" value="${escape(theme.id)}" data-unavailable="${!theme.eligible}" ${theme.eligible?'':'disabled'}> ${escape(theme.name)} <small>(${theme.count} питань${theme.eligible?'':'; бракує потрібних рівнів'})</small></label>`).join('')}`;
        get('randomBoardThemes').querySelectorAll('input').forEach(input=>input.onchange=()=>{prepared=null;get('randomBoardCreate').hidden=true;get('randomBoardDownload').hidden=true;get('randomBoardPreview').hidden=true;controls();});
        get('randomBoardGenerate').hidden=false;notice('Ті самі тексти вже використовувалися в проведених іграх. Перед стартом перегляньте добірку.');
      } catch(error) {notice(error.name==='TimeoutError'?'Сервер не відповів. Оновіть сторінку та перевірте запуск сервера.':error.message);}
      finally {busy=false;controls();}
    };
    get('randomBoardGenerate').onclick=async()=>{
      busy=true;controls();notice('Готуємо поле…');
      try {
        const selected=[...container.querySelectorAll('input:checked')].map(input=>input.value);
        const {game}=await request('boardRandomPreview',selected.length?{themeIds:selected}:{});
        if(!container.isConnected)return;
        prepared=game;
        const questionHTML=question=>`<li><b>${question.value} · ${escape(question.type || 'text')}</b><p>${escape(question.q)}</p>${question.emoji?`<p>${escape(question.emoji)}</p>`:''}${question.media?`<p><a href="${escape(question.media)}" target="_blank" rel="noopener">Медіафайл питання</a></p>`:''}${question.triplet?`<ol>${question.triplet.map(questionHTML).join('')}</ol>`:`<p>${escape(question.a || '')}</p>`}<small>${escape(question.sourceId || '')}</small></li>`;
        get('randomBoardQuestions').innerHTML=game.rounds.map((round,ri)=>`<h3>Раунд ${ri+1}</h3>${round.categories.map(category=>`<h4>${escape(category.name)}</h4><ol>${category.questions.map(questionHTML).join('')}</ol>`).join('')}`).join('')+`<h3>Стартове</h3><p>${escape(game.firstTurnQuiz.question)} — ${escape(game.firstTurnQuiz.answer)}</p><h3>Фінал</h3><p>${escape(game.final.q)} — ${escape(game.final.a)}</p>`;
        get('randomBoardQuestions').innerHTML+=game.audienceRounds.map((round,index)=>`<h3>Глядацький раунд ${index+1}</h3><ol>${round.questions.map(question=>`<li>${escape(question.q)}<p>Відповідь: ${escape(question.options[question.correct])}</p></li>`).join('')}</ol>`).join('');
        get('randomBoardPreview').hidden=false;get('randomBoardCreate').hidden=false;get('randomBoardDownload').hidden=false;
        notice('Поле готове: 50 питань, по одному Коту, Дуелі та ВА-БАНКу на раунд. Підготовлений набір не змінюється під час гри.');
      } catch(error) {notice(/timed out/i.test(error.message)?'Сервер не підтвердив підготовку поля. Перевірте з’єднання.':error.message);}
      finally {busy=false;controls();}
    };
    get('randomBoardCreate').onclick=async()=>{
      if(!prepared)return;
      busy=true;controls();
      try {await createRoom(prepared.id);} finally {busy=false;controls();}
    };
    get('randomBoardDownload').onclick=()=>{
      if(!prepared)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(prepared,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=prepared.id+'.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }
  window.BoardRandom={mount};
})();
