// Transport only: the selected game supplies its public-state builder.
function createStatePublisher({ io, publicState, getRoomGame }) {
  function emitState(room) {
    io.to(room.code).emit("state", publicState(room));
    // Hidden service information is sent only to the authenticated HOST socket.
    // Players and the OBS screen never receive the special-cell map.
    if (room.hostSocket)
      io.to(room.hostSocket).emit("hostSecrets", {
        code: room.code,
        specialCells: room.specialCells || {},
        voiceMappings: room.voiceMappings || {},
        audienceWinner: room.audienceWinners?.[room.audienceWinners.length - 1] || null,
      });
  }
  function emitPlayerPresence(room, player) {
    if (!room || !player) return;
    // The themed camera row needs presence updates without rebuilding active media.
    const theme = room.uiTheme === undefined ? getRoomGame(room).uiTheme : room.uiTheme;
    const target = theme === "halloween" ? room.code : room.hostSocket;
    if (!target) return;
    io.to(target).emit("playerPresence", {
      code: room.code,
      playerId: player.id,
      connected: !!player.connected,
      syncReady:
        !!player.connected && Number(player.syncSamples || 0) >= 3 && Date.now() - Number(player.lastSyncAt || 0) < 12000,
    });
  }
  return { emitState, emitPlayerPresence };
}

module.exports = { createStatePublisher };
