function registerNetworkHandlers(socket, { io, getRoom }) {
  socket.on("timeSync", ({ clientSentAt } = {}, cb = () => {}) => {
    const serverReceivedAt = Date.now();
    cb({ ok: true, clientSentAt: Number(clientSentAt) || 0, serverReceivedAt, serverSentAt: Date.now() });
  });

  socket.on("reportNetworkStats", ({ code: c, rttMs, jitterMs, samples } = {}, cb = () => {}) => {
    const room = getRoom(c || socket.data.roomCode);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || p.socketId !== socket.id || !p.connected) return cb({ ok: false });
    const rtt = Number(rttMs),
      jitter = Number(jitterMs);
    if (Number.isFinite(rtt) && rtt >= 0 && rtt < 10000) p.networkRttMs = rtt;
    if (Number.isFinite(jitter) && jitter >= 0 && jitter < 10000) p.networkJitterMs = jitter;
    p.syncSamples = Math.min(8, Math.max(0, Number(samples) || 0));
    p.lastSyncAt = Date.now();
    cb({ ok: true });
    if (room.hostSocket)
      io.to(room.hostSocket).emit("networkStats", {
        code: room.code,
        playerId: p.id,
        rttMs: p.networkRttMs,
        jitterMs: p.networkJitterMs,
        syncReady: p.syncSamples >= 3,
        connected: p.connected,
      });
  });
}

function startPresenceMonitor({ rooms, io, emitState }) {
  const playerLivenessTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      let changed = false;
      for (const player of room.players) {
        if (!player.connected) continue;
        // Missing clock-sync reports do not mean the Socket.IO connection is lost.
        // Keep the player in the room and let normal Socket.IO disconnect/reconnect handle transport loss.
        if (!player.socketId || !io.sockets.sockets.has(player.socketId)) {
          player.connected = false;
          player.socketId = null;
          player.syncSamples = 0;
          player.lastSyncAt = 0;
          changed = true;
        } else if (now - Number(player.lastSyncAt || 0) > 11000 && player.syncSamples !== 0) {
          player.syncSamples = 0;
          changed = true; // Show SYNC instead of LOST until clock synchronization resumes.
        }
      }
      if (changed) emitState(room);
    }
  }, 2000);
  playerLivenessTimer.unref?.();
  return () => clearInterval(playerLivenessTimer);
}

module.exports = { registerNetworkHandlers, startPresenceMonitor };
