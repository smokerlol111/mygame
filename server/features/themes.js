function registerThemeHandlers(socket, { io, getRoomGame, getRoom, isHost }) {
  socket.on("getRoomTheme", ({ code: c } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (!room) return cb({ ok: false });
    if (room.gameType === 'classic') return cb({ ok: true, code: room.code, uiTheme: null, gameType: 'classic' });
    const selected = room.uiTheme === undefined ? getRoomGame(room).uiTheme : room.uiTheme;
    // Public presentation metadata only; looking up a theme does not join the room.
    cb({ ok: true, code: room.code, uiTheme: selected === "halloween" ? "halloween" : null });
  });

  socket.on("setUiTheme", ({ code: c, uiTheme } = {}, cb = () => {}) => {
    const room = getRoom(c);
    if (room?.gameType === 'classic') return cb({ ok: false, error: 'Оформлення класичного квізу керується окремо.' });
    if (!isHost(socket, room)) return cb({ ok: false, error: "Тему змінює тільки ведучий кімнати." });
    if (uiTheme !== null && uiTheme !== "halloween") return cb({ ok: false, error: "Невідома тема оформлення." });
    const previous = (room.uiTheme === undefined ? getRoomGame(room).uiTheme : room.uiTheme) === "halloween" ? "halloween" : null;
    room.uiTheme = uiTheme;
    if (previous === uiTheme) return cb({ ok: true, uiTheme, changed: false });
    // A presentation-only update preserves focused inputs and active media.
    io.to(room.code).emit("uiThemeChanged", { code: room.code, uiTheme });
    cb({ ok: true, uiTheme });
  });
}

module.exports = { registerThemeHandlers };
