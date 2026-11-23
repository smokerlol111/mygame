function registerShutdown({ server, io, rooms, voice, stopPresenceMonitor }) {
  function shutdown(signal) {
    voice.stop();
    stopPresenceMonitor();
    console.log(`${signal}: завершуємо роботу сервера...`);
    for (const room of rooms.values()) {
      room.dispose?.();
      if (room.finalTimer) clearInterval(room.finalTimer);
      if (room.firstTurnTimer) clearTimeout(room.firstTurnTimer);
    }
    io.emit("serverRestarting", { message: "Сервер перезапускається. Спробуйте перепідключитися через кілька секунд." });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 25000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { registerShutdown };
