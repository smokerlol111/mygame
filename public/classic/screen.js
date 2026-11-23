(() => {
  const ui = ClassicUI, $ = id => document.getElementById(id);
  let code = location.pathname.match(/\/classic\/screen\/([^/]+)/)?.[1] || new URLSearchParams(location.search).get('room') || '';
  code = code.toUpperCase(); $('code').value = code;
  async function join() { if (code) { ui.room = code; await ui.run('classicJoinScreen',{code}); } }
  $('screenForm').onsubmit = event => { event.preventDefault(); code = $('code').value.trim().toUpperCase(); join(); };
  ui.onChange(() => {
    const state = ui.state;
    $('screenForm').hidden = !!state; $('session').hidden = !state;
    if (!state) return;
    $('title').textContent = state.title; $('roomCode').textContent = state.code;
    $('phase').textContent = ui.phaseText(state); ui.renderQuestion(state); ui.renderPresentation(state);
    $('teams').hidden = true; $('teamsTitle').hidden = true;
  });
  ui.socket.on('connect',join);
  if (ui.socket.connected) join();
})();
