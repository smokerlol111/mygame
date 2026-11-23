function createRoomStore() {
  const rooms = new Map();

  function code() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    do {
      out = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    } while (rooms.has(out));
    return out;
  }

  function getRoom(c) {
    return rooms.get(String(c || "").toUpperCase());
  }
  function isHost(socket, room) {
    return room && socket.data.hostToken && socket.data.hostToken === room.hostToken;
  }
  return { rooms, code, getRoom, isHost };
}

module.exports = { createRoomStore };
