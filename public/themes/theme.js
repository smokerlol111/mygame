/* Presentation only: theme selection and OBS camera frames never change game state. */
window.QuizTheme = (() => {
  const cameraContent = new WeakMap();
  const questionFits = new WeakMap();
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  function apply(state) {
    const theme = state?.uiTheme === "halloween" ? "halloween" : "";
    if (theme) {
      if (document.body.dataset.uiTheme !== theme) document.body.dataset.uiTheme = theme;
      if (document.body.dataset.uiPhase !== (state.phase || "")) document.body.dataset.uiPhase = state.phase || "";
    } else {
      delete document.body.dataset.uiTheme;
      delete document.body.dataset.uiPhase;
      document.getElementById("halloweenIdentity")?.remove();
    }
    const view = document.body.dataset.uiView;
    const toggle = view === "host" ? document.getElementById("toggleTheme") : null;
    if (toggle) {
      setText(toggle, theme ? "🌙 Стандартна тема" : "🎃 Halloween");
      setAttribute(toggle, "aria-pressed", String(!!theme));
      setAttribute(toggle, "aria-label", theme ? "Увімкнути стандартну тему для кімнати" : "Увімкнути Halloween для кімнати");
    }
    if (theme && view === "host") {
      let identity = document.getElementById("halloweenIdentity");
      if (!identity) {
        identity = document.createElement("div");
        identity.id = "halloweenIdentity";
        identity.className = "halloween-identity";
        identity.innerHTML = `<img src="/themes/halloween/assets/pumpkin-candles.png" alt="" /><div class="halloween-identity-title"><span>SMOKERLOL QUIZ · ПУЛЬТ ВЕДУЧОГО</span><strong>HALLOWEEN</strong></div><span class="halloween-stage"></span>`;
        const target = document.querySelector(".wrap > .top > div");
        target?.prepend(identity);
      }
      const stage = state.phase === "paused" ? "ПАУЗА"
        : state.phase === "lobby" ? "ЛОБІ"
        : state.phase?.startsWith("final_") ? "ФІНАЛ"
        : `РАУНД ${Number(state.round || 0) + 1}`;
      // Update just the label: even round changes keep the same decorative image.
      if (identity.dataset.stage !== stage) {
        setText(identity.querySelector('.halloween-stage'), stage);
        identity.dataset.stage = stage;
      }
    }
    return theme;
  }

  function renderOBS(state, app) {
    const theme = apply(state);
    if (!theme) {
      const layout = app?.querySelector(".obsGameLayout");
      if (layout) questionFits.delete(layout);
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
      header.innerHTML = `<div class="halloween-brand"><img class="halloween-emblem" src="/themes/halloween/assets/pumpkin-candles.png" alt="" /><div><div class="halloween-wordmark"><b>SMOKERLOL QUIZ</b><strong>HALLOWEEN</strong></div><small></small></div></div><div class="halloween-room"> <span></span></div>`;
      document.body.append(header);
    }
    const cur = state.current;
    const category = cur ? state.board?.[cur.ci]?.name || "" : "";
    const subtitle = category
      ? `${category}${cur.value ? ` · ${cur.value} БАЛІВ` : ""}`
      : "HALLOWEEN";
    setText(header.querySelector('small'), subtitle === "HALLOWEEN" ? "НІЧ СТРАШНО ЦІКАВИХ ПИТАНЬ" : subtitle);
    const roomLabel = header.querySelector('.halloween-room');
    const roundLabel = state.paused || state.phase === "paused" ? "ПАУЗА" : `РАУНД ${Number(state.round || 0) + 1}`;
    if (roomLabel.firstChild.nodeValue !== roundLabel) roomLabel.firstChild.nodeValue = roundLabel;
    setText(roomLabel.querySelector('span'), String(state.code || ""));

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
    const cameraHTML = Array.from({ length: 4 }, (_, slot) => {
      const p = players.find(player => player.cameraSlot === slot);
      const active = !!p && p.id === answerer;
      const wrong = p ? GameUI.wrongAnswerClass(p, state) : "";
      return `<article class="halloween-camera ${active ? "is-answering" : ""} ${p && speaking.has(p.id) ? "is-speaking" : ""} ${wrong} ${p ? "" : "is-empty"}" data-camera-slot="${slot}"${p ? ` data-player-id="${esc(p.id)}"` : ""}>
        <div class="camera-window"><span class="camera-placeholder">${p ? `КАМЕРА ${slot + 1}` : "ВІЛЬНЕ МІСЦЕ"}</span><span class="camera-status">${active ? "ВІДПОВІДАЄ" : p && !p.connected ? "НЕ В МЕРЕЖІ" : ""}</span></div>
        <div class="camera-caption"><b>${p ? esc(p.name) : `Гравець ${slot + 1}`}</b><span>${p ? esc(p.score) : "—"}</span></div>
      </article>`;
    }).join("");
    if (cameraContent.get(cameras) !== cameraHTML) {
      cameras.innerHTML = cameraHTML;
      cameraContent.set(cameras, cameraHTML);
    }

    const layout = app.querySelector(".obsGameLayout");
    if (layout) {
      const media = layout.querySelector(".obsSegmentMedia");
      const hasMedia = !!media?.querySelector("img, video, audio, .emojiQuestion");
      if (layout.classList.contains("halloween-has-media") !== hasMedia) layout.classList.toggle("halloween-has-media", hasMedia);
      const hasVisual = !!media?.querySelector("img, video");
      if (layout.classList.contains("halloween-has-visual") !== hasVisual) layout.classList.toggle("halloween-has-visual", hasVisual);
      const panel = layout.querySelector(".obsSegmentQuestion");
      const question = panel?.querySelector(".question");
      if (question) {
        const fitKey = JSON.stringify([question.textContent, panel.clientWidth, panel.clientHeight, hasMedia, hasVisual]);
        if (questionFits.get(layout) === fitKey) return;
        if (question.style.fontSize) question.style.removeProperty('font-size');
        let size = parseFloat(getComputedStyle(question).fontSize);
        while (panel.scrollHeight > panel.clientHeight + 1 && size > 18) {
          size = Math.max(18, size - 1);
          question.style.fontSize = `${size}px`;
        }
        questionFits.set(layout, fitKey);
      }
    }
  }
  function bind(socket, getState, afterChange = () => {}) {
    socket.on("uiThemeChanged", update => {
      const state = getState();
      if (!state || update?.code !== state.code || update.uiTheme !== null && update.uiTheme !== "halloween") return;
      if ((state.uiTheme === 'halloween' ? 'halloween' : null) === update.uiTheme) return;
      state.uiTheme = update.uiTheme;
      apply(state);
      if (document.body.dataset.uiView === "obs") renderOBS(state, document.getElementById("app"));
      afterChange();
    });
  }
  return { apply, renderOBS, bind };
})();
