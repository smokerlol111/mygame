const fs = require("fs");
const path = require("path");

// Read the catalog once at startup, as before. Rooms retain their selected game data.
function loadGameCatalog(rootDir, indexFile = path.join(rootDir, "games", "index.json")) {
  const catalogDirectory = path.dirname(path.resolve(rootDir, indexFile));
  const gamesIndex = JSON.parse(fs.readFileSync(path.resolve(rootDir, indexFile), "utf8"));
  const games = new Map();
  for (const meta of gamesIndex.filter(g => g.enabled !== false)) {
    const game = JSON.parse(fs.readFileSync(path.join(catalogDirectory, meta.file), "utf8"));
    games.set(meta.id, {
      ...game,
      id: meta.id,
      menuTitle: meta.title || game.menuTitle || game.title,
      menuIcon: meta.icon || game.menuIcon || "🎮",
      description: meta.description || game.description || "",
    });
  }
  const DEFAULT_GAME_ID = gamesIndex.find(g => g.enabled !== false)?.id || "kinohardkor";

  function getGameById(id) {
    if (String(id || '').startsWith('random-board-')) return games.get(id);
    if (gamesIndex.some(meta => meta.id === String(id || DEFAULT_GAME_ID) && meta.enabled === false)) return undefined;
    return games.get(String(id || DEFAULT_GAME_ID)) || games.get(DEFAULT_GAME_ID);
  }
  function getRoomGame(room) {
    return room?.gameData || getGameById(room?.gameId);
  }
  return { gamesIndex, games, DEFAULT_GAME_ID, getGameById, getRoomGame };
}

module.exports = { loadGameCatalog };
