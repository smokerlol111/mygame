/* Inert fixture transport. Never joins a room or sends a game command. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("preview") !== "halloween" || !["/screen", "/screen.html"].includes(location.pathname) || params.has("code")) return;
  const handlers = new Map();
  const board = ["КІНОЖАХИ", "МІСЬКІ ЛЕГЕНДИ", "МОТОРОШНА НАУКА", "МОНСТРИ", "ТЕМНИЙ ІНТЕРНЕТ"].map(name => ({
    name, questions: [100, 200, 300, 400, 500].map(value => ({ value })),
  }));
  const players = ["АНДРІЙ", "ОЛЕНА", "МАКС", "ІРА"].map((name, cameraSlot) => ({
    id: `preview-${cameraSlot}`, name, cameraSlot, score: [1200, 900, 1500, 700][cameraSlot], connected: true,
  }));
  const view = params.get("view") || "board";
  const current = {
    type: "normal", ci: 3, qi: 2, value: 300,
    q: "Яка тварина ховається за цим незворушним поглядом?",
    questionType: "imageReveal", image: "/media/surprise_tibetan_fox.jpg",
    revealStage: 0, revealValues: [300], a: "",
  };
  const state = {
    code: "DEMO", title: "HALLOWEEN — ПЕРЕГЛЯД", gameId: "halloween-preview", uiTheme: "halloween",
    phase: view === "board" ? "board" : view === "paused" ? "paused" : view === "result" ? "result" : "answering",
    round: 0, board, players: params.get("order") === "reverse" ? [...players].reverse() : players,
    used: { "0:0:1": true, "0:4:3": true }, selectedTile: view === "board" ? { round: 0, ci: 2, qi: 2 } : null,
    current: view === "board" || view === "paused" ? null : current,
    turnPlayerId: players[0].id, buzzer: players[2].id,
    answeringLocked: [], revealAnswer: view === "result", voice: { speakingPlayerIds: [] },
  };
  if (state.revealAnswer) current.a = "Тибетська лисиця";
  if (view === "text") {
    current.questionType = "text";
    current.image = "";
    current.q = "У яку ніч за традицією святкують Хеловін?";
  }
  const socket = {
    on(event, callback) { handlers.set(event, callback); return socket; },
    emit() { return socket; },
  };
  window.QuizPreview = { socket, state, data: { rounds: [{ categories: board }] } };
  document.addEventListener("DOMContentLoaded", () => {
    document.title = "Halloween — демонстрація оформлення";
    handlers.get("state")?.(state);
  });
})();
