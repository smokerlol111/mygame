# Proposed fixes — SMOKERLOL Quiz

> **Status:** proposals only. **Nothing here is applied to the repo.**
> **Snapshot:** commit `46e0620`. Line numbers refer to the original files.
> **Bug details:** [`found_bugs.md`](found_bugs.md). `FIX-0N` fixes `EASY-0N`.

---

## ⚡ TL;DR

- **8 fixes** for the 🎯 EASY bugs, plus **2 optional** cosmetic ones.
- **Tiny:** the 8 main fixes change **10 lines** in 3 files: 6 in `server.js`, 3 in `public/host.html`, 1 in `public/play.html`. Lines 476–477 of `host.html` are very long, and 3 of the fixes edit them.
- **Only safe changes:** guards, confirm dialogs, one missing variable, one corrected update. **No game rules change.**
- **Every fix was tested** on a throwaway copy of the code (results per fix below, and in "How these were verified").

### Not included, on purpose
- 🤔 **RULE-xx:** needs the owner's decision first.
- 🛠️ **WORK-xx:** needs a rule decision or more design, or touches what's saved in the production database.
- 💤 **PARK-xx:** security / attacker-only; not worth it now.

---

## 📝 Instructions for whoever applies this (human or AI)

1. Each fix is a **find → replace** of an exact snippet. **Change nothing else.**
2. Each "Find" text appears **exactly once** in its file (checked by script).
3. Fixes are **independent**: apply any subset, in any order.
   - FIX-06b and FIX-09 each add one line, so later line numbers shift by 1. Search by text, not by line number.
4. **Line endings:** git stores these files with LF. A Windows checkout may show CRLF. Match the snippet line by line; don't change line endings.
5. The Ukrainian confirm texts are suggestions. Rewording them is safe.
6. After applying, you can run the matching repro in [`tests/ai_repro/`](tests/ai_repro/README.md). It should print `NOT REPRODUCED`.

---

## ✅ Checklist

| Fix | Bug | File(s) | Size |
|---|---|---|---|
| [ ] FIX-01 | EASY-01 double points | `server.js` | 1 line |
| [ ] FIX-02 | EASY-02 skipped turn | `server.js` | 1 line |
| [ ] FIX-03 | EASY-03 leave without confirm | `public/play.html` | +1 line |
| [ ] FIX-04 | EASY-04 restart without confirm | `public/host.html` | 1 line |
| [ ] FIX-05 | EASY-05 Round 2 / Final without confirm | `public/host.html` | 1 line |
| [ ] FIX-06 | EASY-06 test button mid-game | `public/host.html` + `server.js` | 1 line + 1 line |
| [ ] FIX-07 | EASY-07 host crash on F5 | `public/host.html` | 1 line |
| [ ] FIX-08 | EASY-08 "undefined" on OBS | `server.js` | 3 lines |
| [ ] FIX-09 *(optional)* | MINOR-01 CSS selector | `public/host.html` | 1 line |
| [ ] FIX-10 *(optional)* | MINOR-04 Postgres qualifier order | `storage.js` | 1 line |

---

## FIX-01 → EASY-01: double-click "Правильно" gives double points

**File:** `server.js`, line 1027 (inside `socket.on('judge', …)`)

**Find:**
```js
    if (!isHost(socket, room) || !room.current || !room.buzzer) return;
```
**Replace with:**
```js
    if (!isHost(socket, room) || room.phase !== 'answering' || !room.current || !room.buzzer) return;
```

- **Why it's safe:** `judge` is only sent by the "Правильно" / "Неправильно" / sponsor buttons (`host.html:477`). Those are only shown in phase `answering` (`host.html:465`). A second click arrives when the phase is already `result` or `buzz`, and is now ignored.
- **Verified:** R01 → `NOT REPRODUCED` (score 0 → 100). Normal flow still works: wrong answer → another player → correct (−200 / +200), and a duel judged correctly.

---

## FIX-02 → EASY-02: double-click "До дошки" skips a player's turn

**File:** `server.js`, line 1117

**Find:**
```js
socket.on('nextFromResult', ({ code: c }) => { const room = getRoom(c); if (!isHost(socket, room)) return; finishTile(room); emitState(room); });
```
**Replace with:**
```js
socket.on('nextFromResult', ({ code: c }) => { const room = getRoom(c); if (!isHost(socket, room) || room.phase !== 'result') return; finishTile(room); emitState(room); });
```

- **Why it's safe:** `nextFromResult` is only sent by "До дошки" (`host.html:477`), which is only shown in phase `result` (`host.html:467`). After the first click the phase is `board`, so the second click is ignored.
- **Verified:** R02 → `NOT REPRODUCED`. One click still returns to the board, marks the tile used and moves the turn by exactly one. "Ніхто не відповів" → result → board still works.

---

## FIX-03 → EASY-03: "Вийти з кімнати" asks before removing the player

**File:** `public/play.html`, lines 243–244

**Find:**
```js
function leaveRoom(){
  const oldCode=code;
```
**Replace with:**
```js
function leaveRoom(){
  if(state&&state.phase!=='lobby'&&!confirm('Вийти з гри? Ваші бали буде втрачено, і повернутися в цю гру вже не вийде.'))return;
  const oldCode=code;
```

- **Why it's safe:** it only adds a question before the existing code. In the lobby, leaving is harmless (the player can rejoin), so no question is asked there.
- **What it does NOT fix:** after the player confirms, leaving is still permanent. Allowing a return is a bigger change (see EASY-03).
- **Verified:** 📖 syntax-checked only (inline script parses). Not clicked in a real browser.

---

## FIX-04 → EASY-04: "Нова гра з цими гравцями" asks first

**File:** `public/host.html`, line 477 (inside `bind()`, a very long line)

**Find:**
```js
if($('restartSame'))$('restartSame').onclick=()=>emit('restartSameGame');
```
**Replace with:**
```js
if($('restartSame'))$('restartSame').onclick=()=>{if(confirm('Почати нову гру з цими гравцями? Фінальні результати цієї гри зникнуть. Якщо ще не зберегли їх у сезон — спочатку збережіть.'))emit('restartSameGame')};
```

- **Why it's safe:** same pattern as the "🏠 Головне меню" button right next to it, which already asks.
- **Verified:** 📖 syntax-checked only.

---

## FIX-05 → EASY-05: "Раунд 2" and "Фінал" ask first

**File:** `public/host.html`, line 477 (inside `bind()`)

**Find:**
```js
if($('nextRound'))$('nextRound').onclick=()=>emit('nextRound'); if($('finalBets'))$('finalBets').onclick=()=>emit('startFinalBets');
```
**Replace with:**
```js
if($('nextRound'))$('nextRound').onclick=()=>{if(confirm('Перейти до Раунду 2? Повернутися до Раунду 1 вже не вийде.'))emit('nextRound')}; if($('finalBets'))$('finalBets').onclick=()=>{if(confirm('Почати фінал? Повернутися до дошки вже не вийде.'))emit('startFinalBets')};
```

- **Why it's safe:** only adds a question. These are the only two senders of `nextRound` / `startFinalBets`.
- **Verified:** 📖 syntax-checked only.

---

## FIX-06 → EASY-06: test button only in the lobby

Two parts: hide the button (**a**) and make the server refuse it outside the lobby (**b**).

**a) File:** `public/host.html`, line 476

**Find:**
```js
h+=`<details class="panel" style="margin-top:20px;border:1px dashed #8d70d8">
```
**Replace with:**
```js
if(state.phase==='lobby')h+=`<details class="panel" style="margin-top:20px;border:1px dashed #8d70d8">
```

**b) File:** `server.js`, lines 1288–1289 (inside `socket.on('testGrandFinal', …)`)

**Find:**
```js
    if (!isHost(socket, room)) return cb({ok:false,error:'Лише ведучий може запускати тест.'});
    if (!room.players.length)
```
**Replace with:**
```js
    if (!isHost(socket, room)) return cb({ok:false,error:'Лише ведучий може запускати тест.'});
    if (room.phase !== 'lobby') return cb({ok:false,error:'Тест доступний лише в лобі, до початку гри.'});
    if (!room.players.length)
```

- **Why it's safe:** the test still works exactly as before **from the lobby**, which is where test players join. Saving test results to a season is unchanged (it looks intentional; see EASY-06).
- **Verified:** server part: test in the lobby → `ok:true`; test mid-game → refused with the new message. Hiding the button: 📖 syntax-checked only.

---

## FIX-07 → EASY-07: host page no longer crashes on F5 during the audience results

**File:** `public/host.html`, line 74 (end of the `let state=null,…` line)

**Find:**
```js
storedCode=localStorage.getItem('sgRoomCode')||'';
```
**Replace with:**
```js
storedCode=localStorage.getItem('sgRoomCode')||'',hostAudienceWinner=null;
```

- **Why it's safe:** declares a variable the code already uses (`host.html:179`, `host.html:454`) but never declared.
- **What it does NOT fix:** after an F5 on the podium, the host's own view won't show the winner's prize code again until the next update. The winner's own device still shows it.
- **Verified:** R19 → `NOT REPRODUCED` (no errors after reload in jsdom).

---

## FIX-08 → EASY-08: a score fix during the final ceremony keeps the OBS data

**File:** `server.js`, lines 535–537 (inside `socket.on('adjustScore', …)`)

**Find:**
```js
      room.finalResults = room.players
        .map(p => ({ id:p.id, name:p.name, score:p.score }))
        .sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'uk'));
```
**Replace with:**
```js
      const entry = room.finalResults.find(r => r.id === player.id);
      if (entry) entry.score = player.score;
      room.finalResults.sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'uk'));
```

- **Why it's safe:** it keeps the original intent from the code comment ("update the final table immediately") and the same sort order. It only stops throwing away `beforeScore`, `bet`, `correct` and `finalAnswer`.
- **Known side effect:** OBS shows "before ± bet = score". After a manual correction that sum won't add up, because the score includes the correction. Before this fix, OBS showed "undefined" instead.
- **Verified:** R08 → `NOT REPRODUCED` (all 7 fields kept).

---

## FIX-09 *(optional)* → MINOR-01: broken CSS selector

**File:** `public/host.html`, line 7. The line contains the **two characters** `\` and `n` (not a line break) right before `.cueMixer{`.

**Find** (the literal characters backslash + n):
```
!important}\n.cueMixer{
```
**Replace with** (a real line break):
```
!important}
.cueMixer{
```

- ⚠️ **This changes how the host page looks:** the sound-mixer box gets the border, background and row layout the CSS intended. Skip it if the current look is preferred.
- **Verified:** `css_check.js` → `NOT REPRODUCED`. Not looked at in a real browser.

---

## FIX-10 *(optional)* → MINOR-04: Postgres qualifier order

**File:** `storage.js`, line 52

**Find:**
```js
.sort((a,b)=>String(a.playedAt).localeCompare(String(b.playedAt)))
```
**Replace with:**
```js
.sort((a,b)=>new Date(a.playedAt)-new Date(b.playedAt))
```

- **Why it's safe:** it works for both a `Date` (Postgres) and an ISO string (JSON mode). It only affects the display order of "Гра 1/2/3"; who qualifies doesn't change.
- **Verified:** with `pg` 8.23.1's TIMESTAMPTZ parser the new comparison gives Tue 6 → Fri 9 → Sat 10. ISO strings sort the same way. The JSON-mode storage repros behave the same as before. **Not run against a real Postgres database.**

---

## 🔬 How these were verified

1. A copy of the repo was made outside the project (no `/media`). **The real repo was not modified.**
2. A script applied all 10 fixes to the copy. Each "Find" text had to match exactly once, or the script refused.
3. **Syntax:** `node --check` on `server.js` and `storage.js`; the inline `<script>` in `host.html` and `play.html` parsed with Node's `vm.Script`. All OK.
4. **Bug repros on the patched copy:**
   - Fixed bugs → `NOT REPRODUCED`: R01, R02, R08, R19, `css_check.js`.
   - All other repros unchanged, as expected for bugs these fixes don't touch: R03–R07, R09–R17, R20, R21 and the storage repros.
   - R18 (buzz timestamp) is timing-sensitive: it missed once in 7 runs on the copy, and the fixes don't touch buzz code.
5. **Normal-flow check, run on the original and on the patched copy:**
   - Checked: buzz → wrong → another player buzzes → correct → scores −200/+200 → result → one "До дошки" → turn +1 → tile used; "Ніхто не відповів" → result → board; duel scoring; test button in the lobby.
   - **Original: 11/12. Patched: 12/12.** The only difference is the intended FIX-06 change (test refused mid-game).
6. **Not verified:**
   - The client-side confirm dialogs (FIX-03, 04, 05) and the hidden test button (FIX-06a) were not clicked in a real browser.
   - FIX-10 was not run against a real database.

Tools: Node v24.11.1, Express 4.22.3, Socket.IO 4.8.4, socket.io-client 4.8.4, jsdom 24.1.3, css-tree 2.3.1, pg 8.23.1. Windows 11, 2026-10-10.
