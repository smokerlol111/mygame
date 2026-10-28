/* Presentation only: theme selection and OBS camera frames never change game state. */
window.QuizTheme = (() => {
  function apply(state) {
    const theme = state?.uiTheme === "halloween" ? "halloween" : "";
    if (theme) document.body.dataset.uiTheme = theme;
    else delete document.body.dataset.uiTheme;
    return theme;
  }

  function renderOBS(state, app) {
    const theme = apply(state);
    if (!theme) {
      document.getElementById("halloweenHeader")?.remove();
      document.getElementById("halloweenCameras")?.remove();
      document.getElementById("halloweenBroadcast")?.remove();
      return;
    }
    const esc = GameUI.esc;
    let header = document.getElementById("halloweenHeader");
    if (!header) {
      header = document.createElement("header");
      header.id = "halloweenHeader";
      document.body.append(header);
    }
    const cur = state.current;
    const category = cur ? state.board?.[cur.ci]?.name || "" : "";
    const subtitle = category
      ? `${category}${cur.value ? ` · ${cur.value} БАЛІВ` : ""}`
      : "HALLOWEEN";
    header.innerHTML = `<div class="halloween-brand"><img class="halloween-emblem" src="/themes/halloween/assets/pumpkin-candles.png" alt="" /><div><div class="halloween-wordmark"><b>SMOKERLOL QUIZ</b><strong>HALLOWEEN</strong></div><small>${esc(subtitle === "HALLOWEEN" ? "НІЧ СТРАШНО ЦІКАВИХ ПИТАНЬ" : subtitle)}</small></div></div><div class="halloween-room">${state.paused || state.phase === "paused" ? "ПАУЗА" : `РАУНД ${Number(state.round || 0) + 1}`}<span>${esc(state.code)}</span></div>`;

    // OBS sources sit over these fixed windows. Mount once so state updates cannot
    // replace their contents or move the host camera, chat or donation widget.
    if (!document.getElementById("halloweenBroadcast")) {
      const broadcast = document.createElement("aside");
      broadcast.id = "halloweenBroadcast";
      broadcast.setAttribute("aria-label", "Камера ведучого, чат і донати");
      broadcast.innerHTML = `
        <section class="halloween-broadcast-slot halloween-host-camera" data-obs-slot="host-camera">
          <h2>КАМЕРА ВЕДУЧОГО</h2>
          <div class="broadcast-window"><span>ТВОЯ КАМЕРА</span></div>
        </section>
        <section class="halloween-broadcast-slot" data-obs-slot="chat">
          <h2>ЧАТ</h2>
          <div class="broadcast-window"><span>ЧАТ ТРАНСЛЯЦІЇ</span></div>
        </section>
        <section class="halloween-broadcast-slot" data-obs-slot="donations">
          <h2>ДОНАТИ</h2>
          <div class="broadcast-window"><span>ДОНАТИ ТА ПІДТРИМКА</span></div>
        </section>`;
      document.body.append(broadcast);
    }

    let cameras = document.getElementById("halloweenCameras");
    if (!cameras) {
      cameras = document.createElement("section");
      cameras.id = "halloweenCameras";
      cameras.setAttribute("aria-label", "Камери гравців");
      document.body.append(cameras);
    }
    // Slots are assigned by the server on join, independently of turn/score order.
    const players = state.players || [];
    const answerer = state.paused || state.phase === "paused" ? null : GameUI.answererId(state);
    const speaking = new Set(state.voice?.speakingPlayerIds || []);
    cameras.innerHTML = Array.from({ length: 4 }, (_, slot) => {
      const p = players.find(player => player.cameraSlot === slot);
      const active = !!p && p.id === answerer;
      const wrong = p ? GameUI.wrongAnswerClass(p, state) : "";
      return `<article class="halloween-camera ${active ? "is-answering" : ""} ${p && speaking.has(p.id) ? "is-speaking" : ""} ${wrong} ${p ? "" : "is-empty"}" data-camera-slot="${slot}"${p ? ` data-player-id="${esc(p.id)}"` : ""}>
        <div class="camera-window"><span class="camera-placeholder">${p ? `КАМЕРА ${slot + 1}` : "ВІЛЬНЕ МІСЦЕ"}</span><span class="camera-status">${active ? "ВІДПОВІДАЄ" : p && !p.connected ? "НЕ В МЕРЕЖІ" : ""}</span></div>
        <div class="camera-caption"><b>${p ? esc(p.name) : `Гравець ${slot + 1}`}</b><span>${p ? esc(p.score) : "—"}</span></div>
      </article>`;
    }).join("");

    const layout = app.querySelector(".obsGameLayout");
    if (layout) {
      const media = layout.querySelector(".obsSegmentMedia");
      const hasMedia = !!media?.querySelector("img, video, audio, .emojiQuestion");
      layout.classList.toggle("halloween-has-media", hasMedia);
      layout.classList.toggle("halloween-has-visual", !!media?.querySelector("img, video"));
      const panel = layout.querySelector(".obsSegmentQuestion");
      const question = panel?.querySelector(".question");
      if (question) {
        question.style.fontSize = "";
        let size = parseFloat(getComputedStyle(question).fontSize);
        while (panel.scrollHeight > panel.clientHeight + 1 && size > 18) {
          size = Math.max(18, size - 1);
          question.style.fontSize = `${size}px`;
        }
      }
    }
  }
  return { apply, renderOBS };
})();
