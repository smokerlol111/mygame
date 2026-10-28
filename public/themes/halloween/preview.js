/* Inert fixture transport. Never joins a room or sends a game command. */
(() => {
  const params = new URLSearchParams(location.search);
  const pages = { "/screen": "obs", "/screen.html": "obs", "/host": "host", "/host.html": "host", "/play": "player", "/play.html": "player" };
  const page = pages[location.pathname];
  if (params.get("preview") !== "halloween" || !page || ["code", "room", "key"].some(key => params.has(key))) return;
  const handlers = new Map();
  const board = ["Крик, камера, мотор!", "Ікла, лапи, два прокляття", "Мертвий хіт-парад", "Гарбузова афера", "Меми з того світу"].map(name => ({
    name, questions: [100, 200, 300, 400, 500].map(value => ({ value })),
  }));
  const players = ["АНДРІЙ", "ОЛЕНА", "МАКС", "ІРА"].map((name, cameraSlot) => ({
    id: `preview-${cameraSlot}`, name, cameraSlot, score: [1200, 900, 1500, 700][cameraSlot], connected: true,
    syncReady: true, networkRttMs: [24, 31, 18, 27][cameraSlot], networkJitterMs: 3,
  }));
  const view = params.get("view") || "board";
  const current = {
    type: "normal", ci: 3, qi: 2, value: 300,
    q: "Яка тварина ховається за цим незворушним поглядом?",
    questionType: "imageReveal", image: "/media/surprise_tibetan_fox.jpg",
    revealStage: 0, revealValues: [300], a: "",
  };
  const state = {
    code: "DEMO", title: "HALLOWEEN — ПЕРЕГЛЯД", gameId: "halloween-preview", uiTheme: params.get("theme") === "standard" ? null : "halloween",
    phase: view === "lobby" ? "lobby" : view === "board" ? "board" : view === "paused" ? "paused" : view === "result" ? "result" : view === "buzz" || page === "player" && view === "photo" ? "buzz" : page === "obs" && view === "photo" ? "answering" : "question",
    round: 0, board, players: params.get("order") === "reverse" ? [...players].reverse() : players,
    used: { "0:0:1": true, "0:4:3": true }, selectedTile: view === "board" && page === "obs" ? { round: 0, ci: 2, qi: 2 } : null,
    current: ["lobby", "board", "paused"].includes(view) ? null : current,
    turnPlayerId: players[0].id, buzzer: players[2].id,
    answeringLocked: [], revealAnswer: view === "result", voice: { speakingPlayerIds: [] },
  };
  if (state.revealAnswer) current.a = "Тибетська лисиця";
  if (["text", "buzz", "long"].includes(view)) {
    current.questionType = "text";
    current.image = "";
    current.q = "У яку ніч за традицією святкують Хеловін?";
    if (view === "long") current.q = "Уявіть старий замок, у якому щовечора запалюють гарбузові ліхтарі. На дверях є напис: «Не все моторошне є небезпечним, і не все знайоме є безпечним». Мандрівник бачить три коридори: один веде до бібліотеки з кажанами, інший — до кімнати зі старими дзеркалами, а третій — до саду під місячним сяйвом. Він обирає сад і бере із собою ліхтар. Навіщо потрібен ліхтар, якщо місяць уже освітлює дорогу? Поясніть свою відповідь.";
  }
  if (view === "video") {
    current.questionType = "video";
    current.image = "";
    current.media = "/media/SMOKERLOL_GrandFinal_Ukrnet_Shtany_40_500_STOP.mp4";
    current.pauseAt = 5;
    current.q = "Демонстрація відеопитання. Що станеться далі?";
  }
  const socket = {
    on(event, callback) { handlers.set(event, callback); return socket; },
    emit() { return socket; },
  };
  window.QuizPreview = {
    socket, state, login: page === "player" && view === "login", playerId: players[0].id, data: { rounds: [{ name: "Раунд 1", categories: board }] },
    setTheme(uiTheme) {
      if (page !== "host" || uiTheme !== null && uiTheme !== "halloween") return;
      handlers.get("uiThemeChanged")?.({ code: state.code, uiTheme });
      const url = new URL(location.href);
      url.searchParams.set("theme", uiTheme || "standard");
      history.replaceState(null, "", url);
      if (parent !== window) parent.postMessage({ type: "quiz-theme-preview", theme: uiTheme || "standard" }, location.origin);
    },
  };
  // These are the actual game pages. Capture controls before their handlers so
  // a preview cannot alter a saved session, send a command or change cue volumes.
  for (const event of ["click", "pointerdown", "input", "change", "submit"])
    document.addEventListener(event, e => {
      if (page === "host" && e.target.closest("#toggleTheme")) return;
      if (e.target.closest("button, input, textarea, select, a, form")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  document.addEventListener("DOMContentLoaded", () => {
    document.title = "Halloween — демонстрація оформлення";
    document.body.dataset.themePreview = "true";
    const badge = document.getElementById("netBadge");
    if (badge) badge.textContent = "🎃 Демонстрація";
    handlers.get("state")?.(state);
  });
})();
