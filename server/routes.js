const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const { createPublicBaseUrl } = require("./public-url");

function registerHttpRoutes(app, { rootDir, gamesIndex, games, hostKeyOk, rooms, storage }) {
  const publicBaseUrl = createPublicBaseUrl(rootDir);

  // Always serve the current deployed UI. This prevents Safari/iPhone from
  // keeping an older play/host/screen page after a new Render deployment.
  app.use((req, res, next) => {
    if (!req.path.startsWith("/socket.io/")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      res.set("Surrogate-Control", "no-store");
    }
    next();
  });

  app.use(
    express.static(path.join(rootDir, "public"), {
      etag: false,
      lastModified: false,
      maxAge: 0,
    }),
  );
  app.get("/", (_, res) => res.sendFile(path.join(rootDir, "public", "index.html")));
  app.get("/host", (_, res) => res.sendFile(path.join(rootDir, "public", "host.html")));
  app.get("/play", (_, res) => res.sendFile(path.join(rootDir, "public", "play.html")));
  app.get('/classic/:role(host|play|screen)', (req, res) => res.sendFile(path.join(rootDir, 'public/classic', req.params.role + '.html')));
  app.get('/classic/screen/:code', (_, res) => res.sendFile(path.join(rootDir, 'public/classic/screen.html')));
  app.get("/audience", (_, res) => res.sendFile(path.join(rootDir, "public", "audience.html")));
  app.get("/audience/:code", (_, res) => res.sendFile(path.join(rootDir, "public", "audience.html")));
  app.get("/public-config.js", (req, res) => {
    const base = JSON.stringify(publicBaseUrl(req)).replace(/</g, "\\u003c");
    res.type("application/javascript").send(`window.PUBLIC_GAME_URL = ${base};`);
  });
  app.get("/audience-qr/:code", async (req, res) => {
    try {
      const c = String(req.params.code || "").toUpperCase();
      const base = publicBaseUrl(req);
      const svg = await QRCode.toString(`${base}/audience/${encodeURIComponent(c)}`, {
        type: "svg",
        margin: 1,
        width: 360,
        errorCorrectionLevel: "M",
      });
      res.type("image/svg+xml").send(svg);
    } catch (e) {
      res.status(500).send("QR error");
    }
  });

  app.get("/games", (_, res) => res.json(gamesIndex.filter(g => g.enabled !== false).map(({ file, ...g }) => g)));
  app.get("/games/:id.json", (req, res) => {
    const meta = gamesIndex.find(g => g.id === req.params.id && g.enabled !== false);
    if (!meta && !games.get(req.params.id)?.generatedBoard) return res.status(404).json({ error: "Гру не знайдено." });
    // Special-cell positions are HOST-only secrets; never publish them in game JSON.
    const game = games.get(req.params.id);
    if (!game) return res.status(404).json({ error: "Гру не знайдено." });
    const { specialSetup, specialPools, ...publicGame } = game;
    if (hostKeyOk(req.query.key)) return res.json(publicGame);
    // Without the key: only what the OBS board needs (category names, values). No questions or answers.
    res.json({ id: game.id, rounds: (game.rounds || []).map(r => ({ categories: (r.categories || []).map(c => ({ name: c.name, questions: (c.questions || []).map(q => ({ value: q.value })) })) })) });
  });
  app.get("/screen", (_, res) => res.sendFile(path.join(rootDir, "public", "screen.html")));
  app.get("/screen/:code", (req, res) => rooms.get(req.params.code.toUpperCase())?.gameType === 'classic'
    ? res.redirect('/classic/screen/' + encodeURIComponent(req.params.code.toUpperCase()))
    : res.sendFile(path.join(rootDir, "public", "screen.html")));
  app.get("/health", (_, res) => res.json({ ok: true, version: "3.1.0-dev", rooms: rooms.size }));
  app.get('/api/capabilities', (_, res) => res.json({ ok:true, classicRandomPool:true, randomBoard:true }));
  app.get("/seasons", (_, res) => res.sendFile(path.join(rootDir, "public", "seasons.html")));
  app.get("/api/seasons", async (_, res) => {
    try {
      res.json(await storage.publicData());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Не вдалося завантажити сезони." });
    }
  });
}

module.exports = { registerHttpRoutes };
