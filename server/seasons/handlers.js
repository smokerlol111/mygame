function registerSeasonHandlers(socket, {
  HOST_KEY_ERROR, getRoomGame, hostKeyOk, emitState, getRoom, isHost, storage
}) {
  socket.on("seasonAdminInit", async (payload, cb = () => {}) => {
    if(!hostKeyOk(payload?.hostKey))return cb({ok:false,error:HOST_KEY_ERROR});
    try {
      cb({ ok: true, adminToken: socket.data.seasonAdminToken, seasons: await storage.listSeasons() });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });
  function isSeasonAdmin(token) {
    return !!token && token === socket.data.seasonAdminToken;
  }

  socket.on("setSeasonWildCard", async ({ adminToken, code: c, seasonId, mode, name } = {}, cb = () => {}) => {
    if (!isSeasonAdmin(adminToken) && !isHost(socket, getRoom(c)))
      return cb({ ok: false, error: "Немає доступу." });
    try {
      const season = await storage.setSeasonWildCard(seasonId, { mode, name });
      cb({ ok: true, qualification: season.qualification });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("seasonAdminCreate", async ({ adminToken, name } = {}, cb = () => {}) => {
    if (!isSeasonAdmin(adminToken)) return cb({ ok: false, error: "Немає доступу." });
    try {
      const id = await storage.createSeason(name);
      cb({ ok: true, id, seasons: await storage.listSeasons() });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("seasonAdminSetStatus", async ({ adminToken, seasonId, status } = {}, cb = () => {}) => {
    if (!isSeasonAdmin(adminToken)) return cb({ ok: false, error: "Немає доступу." });
    try {
      await storage.setSeasonStatus(seasonId, status);
      cb({ ok: true, seasons: await storage.listSeasons() });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("seasonListHost", async ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    try {
      cb({ ok: true, seasons: await storage.listSeasons() });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("createSeason", async ({ code: c, name } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    try {
      const id = await storage.createSeason(name);
      cb({ ok: true, id, seasons: await storage.listSeasons() });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("setSeasonStatus", async ({ code: c, seasonId, status } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    try {
      await storage.setSeasonStatus(seasonId, status);
      cb({ ok: true, seasons: await storage.listSeasons() });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("saveSeasonResult", async ({ code: c, seasonId, isGrandFinal = false } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    if (room.isTestResult) return cb({ ok: false, error: "Тестові результати не зберігаються в сезон. Проведіть справжню гру." });
    if (room.phase !== "final_result" || !room.finalResults)
      return cb({ ok: false, error: "Спочатку завершіть фінал." });
    try {
      isGrandFinal = getRoomGame(room).isGrandFinal === true || isGrandFinal === true;
      const before = await storage.seasonDetails(seasonId);
      if (before?.seasonFormat === "qualifiers") {
        const qualifiersPlayed = before.qualification?.qualifierGamesPlayed || 0;
        if (!isGrandFinal && qualifiersPlayed >= 3)
          return cb({ ok: false, error: "Три відбіркові гри вже зіграно. Наступна гра має бути Grand Final." });
        if (isGrandFinal && qualifiersPlayed < 3)
          return cb({ ok: false, error: "Grand Final можна зберегти лише після трьох відбіркових ігор." });
      }
      const id = await storage.saveGame({
        seasonId,
        roomCode: room.code,
        gameId: room.gameId,
        title: getRoomGame(room).menuTitle || getRoomGame(room).title,
        results: room.finalResults,
        isGrandFinal,
      });
      room.savedSeasonGameId = id;
      room.savedSeasonId = seasonId;
      room.seasonCeremonyActive = false;
      room.seasonRevealCount = 0;
      if (isGrandFinal) {
        const season = await storage.seasonDetails(seasonId);
        room.seasonFinal = season
          ? {
              seasonId: season.id,
              name: season.name,
              leaderboard: season.championshipRule === "grand_final" ? season.grandFinalResults : season.leaderboard,
              championshipRule: season.championshipRule,
              isGrandFinal: true,
            }
          : null;
      } else room.seasonFinal = null;
      const season = await storage.seasonDetails(seasonId);
      cb({
        ok: true,
        id,
        isGrandFinal: !!isGrandFinal,
        seasonFinal: room.seasonFinal,
        seasonFormat: season?.seasonFormat,
        qualification: season?.qualification || null,
      });
      emitState(room);
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });
  async function refreshSeasonFinal(room) {
    if (!room.savedSeasonId || !room.savedSeasonGameId) return;
    const season = await storage.seasonDetails(room.savedSeasonId);
    const saved = season?.games.find(g => g.id === room.savedSeasonGameId && g.isGrandFinal);
    if (!saved) {
      room.seasonFinal = null;
      room.seasonCeremonyActive = false;
      return;
    }
    room.seasonFinal = {
      seasonId: season.id,
      name: season.name,
      championshipRule: season.championshipRule,
      leaderboard: season.championshipRule === "grand_final" ? season.grandFinalResults : season.leaderboard,
      isGrandFinal: true,
    };
  }

  socket.on("startSeasonCeremony", async ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    try {
      await refreshSeasonFinal(room);
    } catch (e) {
      return cb({ ok: false, error: e.message });
    }
    if (room.phase !== "final_result" || !room.seasonFinal?.leaderboard?.length)
      return cb({ ok: false, error: "Спочатку збережіть Grand Final у сезон." });
    room.seasonCeremonyActive = true;
    room.seasonRevealCount = 0;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("revealNextSeasonResult", async ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room) || !room.seasonCeremonyActive)
      return cb({ ok: false, error: "Сезонна церемонія не запущена." });
    try {
      await refreshSeasonFinal(room);
    } catch (e) {
      return cb({ ok: false, error: e.message });
    }
    if (!room.seasonCeremonyActive) {
      emitState(room);
      return cb({ ok: false, error: "Grand Final видалено із сезону." });
    }
    const total = room.seasonFinal?.leaderboard?.length || 0;
    if (room.seasonRevealCount < total) room.seasonRevealCount++;
    cb({ ok: true, revealCount: room.seasonRevealCount, total });
    emitState(room);
  });

  socket.on("closeSeasonCeremony", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    room.seasonCeremonyActive = false;
    cb({ ok: true });
    emitState(room);
  });

  socket.on("deleteSavedSeasonResult", async ({ code: c, gameId } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    if (!gameId) return cb({ ok: false, error: "Не вказано збережену гру." });
    try {
      await storage.deleteGame(gameId);
      if (room.savedSeasonGameId === gameId) {
        room.savedSeasonGameId = null;
        room.savedSeasonId = null;
        room.seasonFinal = null;
        room.seasonCeremonyActive = false;
        room.seasonRevealCount = 0;
      }
      cb({ ok: true });
      emitState(room);
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("correctSavedSeasonResult", async ({ code: c, gameId, results } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!isHost(socket, room)) return cb({ ok: false, error: "Немає доступу." });
    try {
      await storage.updateGameResults(gameId, results);
      await refreshSeasonFinal(room);
      emitState(room);
      cb({ ok: true });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerSeasonHandlers };
