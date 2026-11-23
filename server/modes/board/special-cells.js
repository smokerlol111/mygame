function createSpecialCells({ getRoomGame }) {
  function randomSpecialCells(room) {
    const game = getRoomGame(room);
    if (game.specialSetup?.mode === "season2_balanced") {
      const out = {};
      const normal = q =>
        q
        && !q.cat
        && (!q.type || q.type === "normal" || q.type === "text")
        && !q.media
        && !q.image
        && !q.audio
        && !q.video
        && !q.numericAnswer
        && !q.answerImage
        && !q.answerVideo;
      // Only games that explicitly opt in may randomly assign special cells to emoji questions.
      const emojiEligible = q =>
        game.specialSetup.allowEmojiSpecials === true
        && q?.type === "emoji"
        && !q.cat
        && !!String(q.emoji || "").trim()
        && !q.media && !q.image && !q.audio && !q.video
        && !q.numericAnswer && !q.answerImage && !q.answerVideo;
      // Keep existing fixed emoji cats/VA-BANKs; a fixed emoji duel requires opt-in.
      for (const [key, kind] of Object.entries(game.specialSetup.fixed || {})) {
        const [ri, ci, qi] = key.split(":").map(Number);
        const q = game.rounds?.[ri]?.categories?.[ci]?.questions?.[qi];
        if (
          (normal(q) || (q?.type === "emoji" && (["cat", "va_bank"].includes(kind) || (kind === "duel" && emojiEligible(q)))))
          && ["cat", "duel", "va_bank"].includes(kind)
        )
          out[key] = kind;
      }
      for (const ri of [0, 1]) {
        const keys = [];
        (game.rounds?.[ri]?.categories || []).forEach((cat, ci) =>
          (cat.questions || []).forEach((q, qi) => {
            const key = `${ri}:${ci}:${qi}`;
            if (!out[key] && (normal(q) || emojiEligible(q))) keys.push(key);
          }),
        );
        for (let i = keys.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [keys[i], keys[j]] = [keys[j], keys[i]];
        }
        const existing = Object.entries(out)
          .filter(([key]) => key.startsWith(ri + ":"))
          .map(([, kind]) => kind);
        for (const kind of ["cat", "duel", "va_bank"]) {
          if (!existing.includes(kind) && keys.length) out[keys.pop()] = kind;
        }
      }
      return out;
    }
    const secondRound = game.rounds?.[1];
    if (!secondRound?.categories?.length) return {};
    // Special cells are reserved exclusively for ordinary text questions.
    // Never replace audio, video, photo/reveal or numerical question mechanics.
    const eligible = new Set();
    secondRound.categories.forEach((cat, ci) =>
      (cat.questions || []).forEach((q, qi) => {
        if (
          !q.cat
          && (!q.type || q.type === "normal" || q.type === "text")
          && !q.media
          && !q.image
          && !q.audio
          && !q.video
          && !q.numericAnswer
          && !q.answerImage
          && !q.answerVideo
        ) {
          eligible.add(`1:${ci}:${qi}`);
        }
      }),
    );
    const shuffle = a => {
      a = [...a];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const pools = game.specialPools || null;
    const available = pools ? new Set(eligible) : eligible;
    const pick = (pool, count) => shuffle(pool.filter(key => available.has(key))).slice(0, count);
    const vb = pick(pools ? pools.vaBank || [] : [...eligible], 2);
    vb.forEach(key => available.delete(key));
    const duel = pick(pools ? pools.duel || [] : [...eligible], 1);
    duel.forEach(key => available.delete(key));
    const out = {};
    vb.forEach(key => (out[key] = "va_bank"));
    duel.forEach(key => (out[key] = "duel"));
    return out;
  }
  return randomSpecialCells;
}

module.exports = { createSpecialCells };
