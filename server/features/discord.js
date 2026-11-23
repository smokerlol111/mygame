const path = require("path");

// One shared integration per server; each socket registers controls against its live state.
function createDiscordIntegration({ rootDir, rooms, io, getRoom, isHost, emitState, env = process.env }) {
  let voiceLastEvent = 0;
  function clearDiscordSpeaking() {
    for (const room of rooms.values()) {
      if (room.voiceSpeaking?.length) {
        room.voiceSpeaking = [];
        room.voiceUpdatedAt = Date.now();
        io.to(room.code).emit("voiceSpeaking", { code: room.code, playerIds: [] });
      }
    }
  }
  function handleDiscordVoiceMessage(message) {
    if (!message) return;
    if (message.type === "voiceStatus") {
      voiceBotStatus = String(message.status || "disconnected");
      voiceBotError = String(message.error || "");
      for (const room of rooms.values())
        if (room.hostSocket)
          io.to(room.hostSocket).emit("voiceBotStatus", {
            code: room.code,
            status: voiceBotStatus,
            error: voiceBotError,
          });
      if (voiceBotStatus !== "connected") {
        voiceLastEvent = 0;
        clearDiscordSpeaking();
      }
      return;
    }
    if (message.type !== "voiceActivity") return;
    if (message.guildId !== env.DISCORD_GUILD_ID || message.channelId !== env.DISCORD_VOICE_CHANNEL_ID)
      return;
    if (!Array.isArray(message.userIds) || message.userIds.length > 100) return;
    const active = new Set(message.userIds.filter(id => typeof id === "string" && /^\d{17,20}$/.test(id)));
    voiceLastEvent = Date.now();
    for (const room of rooms.values()) {
      const next = room.players.filter(p => active.has(room.voiceMappings?.[p.id])).map(p => p.id);
      const previous = room.voiceSpeaking || [];
      if (next.length !== previous.length || next.some(id => !previous.includes(id))) {
        room.voiceSpeaking = next;
        room.voiceUpdatedAt = Date.now();
        io.to(room.code).emit("voiceSpeaking", { code: room.code, playerIds: next });
      }
    }
  }
  const voiceStaleTimer = setInterval(() => {
    if (voiceLastEvent && Date.now() - voiceLastEvent > 20000) {
      voiceLastEvent = 0;
      clearDiscordSpeaking();
    }
  }, 2000);
  voiceStaleTimer.unref?.();

  // DEV-only: optional bot process shares this free Render Web Service.
  let voiceBotProcess = null;
  let voiceBotStatus = "unavailable";
  let voiceBotError = "";
  function startOptionalVoiceBot() {
    const names = ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_VOICE_CHANNEL_ID"];
    const present = names.filter(name => Boolean(env[name]));
    if (!present.length) {
      console.log("Discord voice bot disabled (no environment variables).");
      return;
    }
    if (present.length !== names.length) {
      console.warn("Discord voice bot disabled: incomplete environment variables.");
      return;
    }
    const { fork } = require("child_process");
    voiceBotStatus = "starting";
    voiceBotError = "";
    voiceBotProcess = fork(path.join(rootDir, "voice-bot", "bot.js"), [], {
      env: env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    voiceBotProcess.on("message", handleDiscordVoiceMessage);
    voiceBotProcess.on("error", err => console.error("Discord voice bot process:", err.message));
    voiceBotProcess.on("exit", (code, signal) => {
      console.warn("Discord voice bot exited:", code, signal);
      voiceBotProcess = null;
      voiceBotStatus = "unavailable";
      voiceBotError = "Discord-бот зупинено.";
      voiceLastEvent = 0;
      clearDiscordSpeaking();
    });
  }

  function registerHandlers(socket) {
    socket.on("voiceGetStatus", ({ code: c }, cb = () => {}) => {
      const room = getRoom(c);
      if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може переглядати статус Discord." });
      cb({ ok: true, status: voiceBotStatus, error: voiceBotError });
    });

    socket.on("voiceSetEnabled", ({ code: c, enabled }, cb = () => {}) => {
      const room = getRoom(c);
      if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може керувати Discord Active Speaker." });
      if (!voiceBotProcess?.connected) return cb({ ok: false, error: "Discord-бот зараз недоступний." });
      voiceBotError = "";
      voiceBotStatus = enabled ? "connecting" : "disconnected";
      voiceBotProcess.send({ type: enabled ? "voiceConnect" : "voiceDisconnect" });
      if (!enabled) {
        voiceLastEvent = 0;
        clearDiscordSpeaking();
      }
      io.to(room.hostSocket).emit("voiceBotStatus", { code: room.code, status: voiceBotStatus, error: "" });
      cb({ ok: true, status: voiceBotStatus });
    });

    socket.on("voiceSetMapping", ({ code: c, playerId, discordId }, cb = () => {}) => {
      const room = getRoom(c);
      if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може змінювати прив’язки." });
      if (!room.players.some(p => p.id === playerId)) return cb({ ok: false, error: "Гравця не знайдено." });
      const id = String(discordId || "").trim();
      if (id && !/^\d{17,20}$/.test(id))
        return cb({ ok: false, error: "Введіть Discord User ID (17–20 цифр) або залиште поле порожнім." });
      if (id && Object.entries(room.voiceMappings || {}).some(([p, v]) => p !== playerId && v === id))
        return cb({ ok: false, error: "Цей Discord ID вже прив’язано." });
      room.voiceMappings = room.voiceMappings || {};
      if (id) room.voiceMappings[playerId] = id;
      else delete room.voiceMappings[playerId];
      io.to(room.hostSocket).emit("voiceMappings", { code: room.code, mappings: room.voiceMappings });
      cb({ ok: true });
    });

    socket.on("voiceTestSpeaking", ({ code: c, playerIds }, cb = () => {}) => {
      const room = getRoom(c);
      if (!isHost(socket, room)) return cb({ ok: false, error: "Лише ведучий може запускати тест." });
      const valid = new Set(room.players.map(p => p.id));
      room.voiceSpeaking = [...new Set(Array.isArray(playerIds) ? playerIds : [])]
        .filter(id => valid.has(id))
        .slice(0, 4);
      room.voiceUpdatedAt = Date.now();
      emitState(room);
      cb({ ok: true });
    });
  }

  function stop() {
    clearInterval(voiceStaleTimer);
    if (voiceBotProcess) {
      voiceBotProcess.kill("SIGTERM");
      voiceBotProcess = null;
    }
  }

  return { registerHandlers, start: startOptionalVoiceBot, stop, handleMessage: handleDiscordVoiceMessage };
}

module.exports = { createDiscordIntegration };
