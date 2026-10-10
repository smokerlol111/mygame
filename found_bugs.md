# Found bugs — SMOKERLOL Quiz

> **Snapshot:** commit `46e0620` (2026-10-09). `file:line` references point to that commit.
> **Production storage:** PostgreSQL (confirmed by the owner's side, 2026-10-10). JSON-file-only bugs are parked.
> **Architecture overview:** [`architecture.md`](architecture.md) · **Fixes:** [`proposed_fixes.md`](proposed_fixes.md)
> **No guessing:** each bug says **how it was verified**.

---

## ⚡ TL;DR

- Bugs are grouped by **"will this hurt a real game night?" × "how hard is the fix?"**, not by technical severity.
- **38 items:** 🎯 8 EASY · 🛠️ 5 WORK · 🤔 6 RULE · 💤 15 PARK · 🧹 4 MINOR.
- **Start here:** the 8 🎯 EASY bugs. Each has a small fix in [`proposed_fixes.md`](proposed_fixes.md), and each fix was tested on a copy of the code.
- Security issues are **parked**: they need someone deliberately cheating, and most fixes are big.

---

## 🧭 How to read this file

**Groups** (the ID prefix tells you the group):

| Group | Meaning |
|---|---|
| 🎯 **EASY** | Happens at a real game night through normal mistakes (double-click, misclick, F5). Small, safe fix with no rule question. **Fixes are in `proposed_fixes.md`.** |
| 🛠️ **WORK** | Happens at a real game night, but the fix needs a decision, more work, or touches saved production data. |
| 🤔 **RULE** | The code works, but the intended game rule is unclear. The owner must decide before anyone "fixes" it. |
| 💤 **PARK** | Not worth fixing now: needs a deliberate cheater/attacker, doesn't apply to production, or is extremely unlikely. |
| 🧹 **MINOR** | Cosmetic, or latent (current game data doesn't trigger it). |

**Evidence:**

| Tag | Meaning |
|---|---|
| ✅ **REPRODUCED** | Ran it and saw the wrong behavior (repro ID like R01; scripts are in [`tests/ai_repro/`](tests/ai_repro/README.md)). |
| 📖 **CODE-VERIFIED** | Traced the exact code path by reading. Not executed. |

**Old IDs:** the first version of this file used IDs like `GAME-01` or `SEC-03`. Each bug below shows its old ID as `(was …)`.

---

## 📋 All bugs at a glance

| ID | Was | One-liner | Real-world trigger | Evidence |
|---|---|---|---|---|
| **EASY-01** | GAME-01 | Double-click "Правильно" = double points | Host double-clicks (or double-taps) | ✅ R01 |
| **EASY-02** | GAME-03 | Double-click "До дошки" skips the next player's turn | Host double-clicks (or double-taps) | ✅ R02 |
| **EASY-03** | GAME-02 | "Вийти з кімнати" mid-game removes the player forever, no confirm | Player misclicks | ✅ R10 |
| **EASY-04** | UX-01 | "Нова гра з цими гравцями" has no confirm; unsaved result is lost | Host clicks before saving | 📖 |
| **EASY-05** | UX-02 | "Раунд 2" / "Фінал" have no confirm and no undo | Host misclicks | 📖 |
| **EASY-06** | SEC-05 | "🧪 ТЕСТ GRAND FINAL" works mid-game and replaces real scores | Host misclicks + OK | ✅ R06a |
| **EASY-07** | CLIENT-01 | Host page crashes on F5 during the audience results | Host refreshes | ✅ R19 |
| **EASY-08** | GAME-04 | A score fix during the final ceremony shows "undefined" on OBS | Host corrects a score | ✅ R08 |
| **WORK-01** | GAME-08 | A final answer typed but not sent is lost when time runs out | Player types until the last second | 📖 |
| **WORK-02** | GAME-05 | A player who can't reconnect blocks the final forever | Player's device/browser drops out for good | ✅ R13 |
| **WORK-03** | DATA-02 | 2nd game in the same room can never be saved to the season | "Нова гра з цими гравцями" | ✅ R07 |
| **WORK-04** | GAME-07 | Pause doesn't pause the numeric/audience timers | Host pauses then | ✅ R11 · 📖 |
| **WORK-05** | GAME-06 | One connected player page that stops syncing disables "Відкрити BUZZ" | e.g. a backgrounded mobile browser (per code comment) | ✅ R17 |
| **RULE-01** | DATA-03 | Tied players get different season points (alphabetical) | Tie | ✅ R14 |
| **RULE-02** | DATA-04 | Qualifiers: one person can take 2 Grand Final spots; format decided by season name | Same winner twice | ✅ R15 |
| **RULE-03** | GAME-09 | Numeric question nobody answered: same player chooses again | Nobody answers | ✅ R21 |
| **RULE-04** | GAME-11 | Buzzer re-opens after a wrong answer without the sound | Wrong answer | 📖 |
| **RULE-05** | DATA-07 | Season stats merge players by name, not identity | Rename / same name | 📖 |
| **RULE-06** | DATA-08 | Question with unknown type `"numeric"` is played as a normal question | That tile is chosen | ✅ validator |
| **PARK-01** | SEC-01 | Season admin has no authentication | Attacker | ✅ R05 |
| **PARK-02** | SEC-02 | Any room's host can rewrite/delete any saved game | Attacker | ✅ R06b, R06c |
| **PARK-03** | SEC-03 | Anyone with the room code can take over a player's seat | Attacker | ✅ R03, R03b |
| **PARK-04** | SEC-04 | Audience prize code can be stolen | Attacker | ✅ R04 |
| **PARK-05** | SEC-06 | All answers are public at `/games/<id>.json` | Cheater | ✅ R09 |
| **PARK-06** | SEC-07 | "Reveal" questions send the full image/audio/video | Cheater | ✅ R20 · 📖 |
| **PARK-07** | SEC-08 | Buzz winner is chosen by a timestamp the player's device reports | Cheater | ✅ R18 |
| **PARK-08** | DATA-01 | Corrupted `seasons.json` wipes history | JSON mode only, **not used in production** | ✅ R12 |
| **PARK-09** | DATA-05 | Two simultaneous "create season" → 2 active seasons | Two clicks in the same instant | ✅ R16 (JSON) |
| **PARK-10** | DATA-06 | New room code can collide with a saved game's code | ~N in 1,048,576 per game | 📖 |
| **PARK-11** | CLIENT-03 | Host can't create a room over plain-HTTP LAN | Only if run on a LAN IP | 📖 |
| **PARK-12** | CLIENT-04 | Audience QR uses `http://` behind an HTTPS proxy | Impact on Render unverified | ✅ Express check |
| **PARK-13** | OPS-01 | Rooms never expire; no rate limits; any website may connect | Abuse / long uptime | 📖 |
| **PARK-14** | OPS-02 | Postgres TLS without certificate check | Network attacker | 📖 |
| **PARK-15** | OPS-03 | Media files are never cached by browsers | Performance only | 📖 |
| **MINOR-01** | CLIENT-02 | Broken CSS selector: host sound-mixer box loses its styling | Always | ✅ CSS parser |
| **MINOR-02** | GAME-10 | Some host events lack phase checks / never answer the callback | Hidden by the UI | 📖 |
| **MINOR-03** | DATA-09 | Config values silently ignored (`seconds`, `audienceQuestionSeconds`) | Latent | 📖 |
| **MINOR-04** | *new* | Postgres: qualifier games are ordered by weekday name | Qualifiers season | ✅ `pg` parser |

---

# 🎯 EASY: real game-night bugs with small, safe fixes

> Each fix is in [`proposed_fixes.md`](proposed_fixes.md): `FIX-0N` fixes `EASY-0N`.

### EASY-01 Double-click "Правильно" = double points *(was GAME-01)*
- **What happens:** the host clicks (or taps) "Правильно +X" twice quickly → the player gets **+2X**. Same for the sponsor button.
- **Where:** `server.js:1025-1044`. `judge` has no phase check (it only needs `room.buzzer`), and the correct-answer path doesn't clear `room.buzzer`.
- **Evidence:** ✅ **R01:** score `0 → 200` for a 100-point question.
- **Fix:** FIX-01 (only accept `judge` in phase `answering`).

### EASY-02 Double-click "До дошки" skips the next player's turn *(was GAME-03)*
- **What happens:** the turn moves forward twice: P1 → P3, and P2 never gets to choose.
- **Where:** `server.js:1117` (`nextFromResult` has no phase check) → `finishTile` → `advanceTurn` (`server.js:230-241`).
- **Evidence:** ✅ **R02:** turn `P1 → P3`.
- **Fix:** FIX-02 (only accept it in phase `result`).

### EASY-03 "Вийти з кімнати" mid-game removes the player forever *(was GAME-02)*
- **What happens:** the button is at the top of every player screen. One click, with no confirmation, deletes the player and their score. They **can't rejoin**: new players are only allowed in the lobby.
- **Where:** button `play.html:400`, handler `play.html:243-248`; server `server.js:441-460`; rejoin refused at `server.js:420`.
- **Evidence:** ✅ **R10:** both rejoin attempts → "Гра вже почалася…".
- **Fix:** FIX-03 adds a confirmation dialog. Leaving is **still permanent** after you confirm. Letting a player come back is a bigger change and isn't proposed.

### EASY-04 "Нова гра з цими гравцями" has no confirmation *(was UX-01)*
- **What happens:** one click wipes the final results. If they weren't saved to the season yet, they're gone for good.
- **Where:** `host.html:477` (`restartSame`; compare `backMenu` right next to it, which does ask). The server clears `finalResults` at `server.js:1348`.
- **Evidence:** 📖 CODE-VERIFIED.
- **Fix:** FIX-04.

### EASY-05 "Раунд 2" / "Фінал" have no confirmation and no undo *(was UX-02)*
- **What happens:** a misclick skips the rest of the round. There's no way back.
- **Where:** `host.html:455` (buttons), `host.html:477` (emit immediately). Other destructive host buttons already ask (`backMenu`, `newRoom`, `stopGame`, `emergencyBoard`); these two were missed.
- **Evidence:** 📖 CODE-VERIFIED.
- **Fix:** FIX-05.

### EASY-06 "🧪 ТЕСТ GRAND FINAL" works in the middle of a real game *(was SEC-05)*
- **What happens:** the test panel is shown on **every** host screen. Misclick + OK on the confirm dialog → the real scores are replaced with fake ones and the game jumps to the final results.
- **Where:** button `host.html:476`; server handler `server.js:1286-1300` (no phase check).
- **Evidence:** ✅ **R06a** shows the test results replace the game state and can be saved.
- **Note:** saving test results to a season looks **intentional**: README v1.5.1 describes "save the test into the season, check `/seasons`, delete it". So only the mid-game availability is treated as a bug.
- **Fix:** FIX-06 (test only in the lobby; the button is hidden elsewhere).

### EASY-07 Host page crashes on F5 during the audience results *(was CLIENT-01)*
- **What happens:** reload on the audience podium → `ReferenceError: hostAudienceWinner is not defined` → the host page doesn't render.
- **Where:** never declared; assigned only in the `hostSecrets` handler (`host.html:179`), read in `render()` (`host.html:454`), called by the rejoin callback before any `hostSecrets` (`host.html:119-122`).
- **Evidence:** ✅ **R19** (jsdom, real `host.html`, real server).
- **Fix:** FIX-07 (declare the variable).

### EASY-08 A score fix during the final ceremony breaks the OBS screen *(was GAME-04)*
- **What happens:** using the host's ±score buttons on the final results rebuilds `finalResults` with only `id, name, score`. OBS then shows **"undefined − undefined ="** and "— ❌" for the places not yet revealed.
- **Where:** `server.js:534-538`; OBS reads `beforeScore`, `bet`, `correct`, `finalAnswer` at `screen.html:388`.
- **Evidence:** ✅ **R08:** keys `beforeScore,bet,correct,finalAnswer,id,name,score` → `id,name,score`.
- **Fix:** FIX-08 (update the score inside the existing entries).

---

# 🛠️ WORK: real game-night bugs, but the fix needs a decision or more care

### WORK-01 A final answer typed but not sent is lost *(was GAME-08)*
- **What happens:** the answer only goes to the server when the player clicks "Надіслати відповідь". When 30 s run out, the player's screen switches and the text is gone.
- **Where:** `play.html:457, 485-488`; the timer ends at `server.js:261-265`; late answers are refused at `server.js:1262`.
- **Evidence:** 📖 CODE-VERIFIED.
- **Why not easy:** auto-saving the draft must not flip the player's screen to the "sent" screen while the player is still typing (`play.html:214-217` logic). That needs a design choice.

### WORK-02 A player who can't reconnect blocks the final forever *(was GAME-05)*
- **Where:** `server.js:1243` waits for **every** player's bet, including disconnected ones. There's no "remove player" event.
- **When it happens:** a player can only come back as themselves from the **same browser**, because the player ID is kept in that browser's storage (`play.html:108`). A dead device, a different browser, or cleared site data means they can't return.
- **Evidence:** ✅ **R13:** `startFinalQuestion` → "Не всі гравці зробили ставки.".
- **Why not easy:** the fix needs a rule: does a missing bet count as 0? Can the host skip a player?

### WORK-03 2nd game in the same room can never be saved to the season *(was DATA-02)*
- **What happens:** after "🔄 Нова гра з цими гравцями", saving fails with "Результат цієї гри вже збережено.", because duplicate protection is "one save per room code".
- **Where:** `restartSameGame` keeps `room.code` (`server.js:1339-1354`); the Postgres table has `room_code … UNIQUE` (`storage.js:13`).
- **Evidence:** ✅ **R07** (JSON mode). Production (Postgres) has the same `UNIQUE` rule: 📖 by schema, not executed against a database.
- **Workaround today:** "🏠 Головне меню" → create a new room.
- **Why not easy:** the code change is small, but it changes **what gets written to the production database**.

### WORK-04 Pause doesn't pause the numeric or audience timers *(was GAME-07)*
- **Where:** `pauseRoom` only handles the first-turn and final timers (`server.js:270-288`). Numeric: `server.js:886, 893`. Audience: `server.js:1200, 1205`.
- **Evidence:** ✅ **R11 (numeric):** after resume → "Час вийшов.". 📖 Audience: same structure.
- **Why not easy:** needs the same pause/resume logic as the first-turn timer for two more timers. More code, more risk.

### WORK-05 One connected player page that stops syncing disables "Відкрити BUZZ" *(was GAME-06)*
- **What happens:** if any *connected* player page hasn't sent a clock-sync update for 12 s, the main buzz button is disabled. The code's own comment names a backgrounded mobile browser as a cause (`server.js:1380-1381`). Desktop situations (background tab, sleeping laptop) were **not tested**.
- **Where:** `server.js:955-956`; button disabled at `host.html:463`.
- **Evidence:** ✅ **R17:** "Очікуємо SYNC: SleepyPhone".
- **Workaround today:** "🔔 Повернути BUZZ" in the collapsed "⚙️ Керування ведучого" panel.
- **Why not easy:** deciding when a stale player device may be ignored is a fairness trade-off.

---

# 🤔 RULE: the owner decides first

| ID | What the code does today | Question for the owner | Evidence |
|---|---|---|---|
| **RULE-01** *(was DATA-03)* | Equal final scores → places by alphabet → 10 vs 7 season points (`storage.js:47`) | Shared place? Tie-break? | ✅ R14: Андрій 1000 → 10 pts, Богдан 1000 → 7 pts |
| **RULE-02** *(was DATA-04)* | A player who wins 2 qualifiers is listed twice among Grand Finalists (`storage.js:52-66`). "Qualifiers" mode depends on the season **name** matching `сезон N` with N ≥ 2 (`storage.js:48-49`). | Who gets the extra spot? Should the format be a setting instead of the name? | ✅ R15: `["Alice","Alice","Bob","B"]` |
| **RULE-03** *(was GAME-09)* | Numeric question with no answers → the first player in the list chooses next, usually the same chooser (`server.js:911`) | Advance the turn normally? | ✅ R21: turn B1 → B1 |
| **RULE-04** *(was GAME-11)* | After a wrong answer the buzzer re-opens (800 ms) with **no** "buzz open" sound (`server.js:1060-1061` vs `961, 1103`) | Intended? | 📖 |
| **RULE-05** *(was DATA-07)* | Season stats merge players by lower-cased name (`storage.js:84, 58`) | Fine as is? (Player IDs change every room) | 📖 |
| **RULE-06** *(was DATA-08)* | `games/back_to_2000s_test.json:477` (iPhone question, answer 270) has `"type": "numeric"`, which the server doesn't know, so it's played as a normal buzz question | Was `numericClosest` intended? | ✅ validator |

---

# 💤 PARK: not worth fixing now

| ID | Why parked | Evidence |
|---|---|---|
| **PARK-01** *(was SEC-01)* Season admin has no auth (`server.js:370, 1313-1327`) | Needs someone using browser dev tools on purpose. (The fix itself, an admin password, is probably small; revisit if the game grows.) | ✅ R05 |
| **PARK-02** *(was SEC-02)* Any room's host can rewrite/delete any saved game (`server.js:1336-1337`) | Same as PARK-01 | ✅ R06b, R06c |
| **PARK-03** *(was SEC-03)* Seat takeover with the room code; old device keeps working (`server.js:152, 425-428, 971`) | Needs an attacker; the fix is a reconnect-token redesign | ✅ R03, R03b |
| **PARK-04** *(was SEC-04)* Audience prize code theft (`server.js:174-176, 1180-1183`) | Needs an attacker | ✅ R04 |
| **PARK-05** *(was SEC-06)* All answers public at `/games/<id>.json` (`server.js:52-60`) | Needs a cheater; the fix changes how host/OBS load data | ✅ R09: 50 answers + final |
| **PARK-06** *(was SEC-07)* Reveal questions send the full media (`server.js:846, 129`; `play.html:385-389, 331-357`) | Needs a cheater; the fix needs pre-cut media files | ✅ R20 (image) · 📖 audio/video |
| **PARK-07** *(was SEC-08)* Buzz winner trusts the player device's timestamp (`server.js:976-996, 1015`) | Needs a modified client; fairness trade-off | ✅ R18 (timing-sensitive repro: 6/6 on the original code; 1 miss in 7 runs on a copy) |
| **PARK-08** *(was DATA-01)* Corrupted `seasons.json` → history wiped (`storage.js:8, 16-17`) | **JSON mode only. Production uses PostgreSQL.** | ✅ R12 |
| **PARK-09** *(was DATA-05)* Simultaneous "create season" → 2 active seasons (`storage.js:23-27`) | Needs two clicks in the same instant. Postgres not tested. | ✅ R16 (JSON) |
| **PARK-10** *(was DATA-06)* Room code collides with a saved game's code (`server.js:67-74`, `storage.js:13`) | About N/1,048,576 chance per game (N = saved games). Fixing WORK-03 removes it. | 📖 |
| **PARK-11** *(was CLIENT-03)* `crypto.randomUUID()` (`host.html:170`) only exists on HTTPS/localhost (per MDN) | Production is HTTPS | 📖 (spec, not reproduced) |
| **PARK-12** *(was CLIENT-04)* QR built from `req.protocol` without `trust proxy` (`server.js:48`) | Whether Render redirects http→https is unverified; if it does, the QR still works | ✅ Express 4.22 check |
| **PARK-13** *(was OPS-01)* Rooms never expire (`server.js:551, 1363`); no rate limits; Socket.IO `cors: origin:true` (`server.js:12`) | Abuse / very long uptime only | 📖 |
| **PARK-14** *(was OPS-02)* Postgres TLS with `rejectUnauthorized:false` (`storage.js:11`) | Applies to production, but needs a network attacker | 📖 |
| **PARK-15** *(was OPS-03)* `Cache-Control: no-store` on everything incl. ~97 MB media (`server.js:28-36`) | Performance only; no failure observed | 📖 |

---

# 🧹 MINOR: cosmetic or latent

### MINOR-01 Broken CSS selector: host sound-mixer box loses its styling *(was CLIENT-02)*
- `host.html:7` has the two characters `\` `n` (not a newline) before `.cueMixer{…}`. CSS reads it as an element named `n`, so the rule matches nothing.
- **Evidence:** ✅ `css-tree` parse + byte dump. Not looked at in a browser.
- **Fix:** FIX-09 (optional). Note that it **changes how the host page looks**.

### MINOR-02 Some host events lack phase checks / never answer the callback *(was GAME-10)*
- No phase check: `revealAnswer` (1107), `startFinalBets` (1226), `finishFinalNow` (1266), `startGame` (641), `nextRound` (1221, round only), `openAudienceRound` (1187). The UI hides those buttons in the wrong phases. The real-world cases were `judge` and `nextFromResult`, which are now EASY-01 and EASY-02.
- No callback on rejection: `startGame`, `openBuzz`, `judge`, `judgeVaBank`, `openDuelBuzz`, `selectCatReceiver`, `judgeCat`, `nextRound`, `startFinalBets`, `submitBet`, `startFinalQuestion`, `startFinalTimer`, `submitFinalAnswer`, `scoreFinal`.
- **Evidence:** 📖.

### MINOR-03 Config values silently ignored (latent) *(was DATA-09)*
- `q.seconds` for numericClosest is read (`server.js:870`) but the timer is hard-coded to 30 s (`server.js:885-886`).
- `audienceQuestionSeconds` other than 30 → **15 s** on the server (`server.js:1198`), while the UI shows the configured value.
- **Evidence:** 📖. The validator confirmed no current game triggers it.

### MINOR-04 Postgres: qualifier games are ordered by weekday name *(new)*
- **What happens:** in a "qualifiers" season, games are sorted with `String(playedAt)` (`storage.js:52`). In JSON mode `playedAt` is an ISO string, so it sorts correctly. In **Postgres**, the `pg` library returns `TIMESTAMPTZ` as a JavaScript `Date`. `String(Date)` starts with the weekday ("Tue Oct 06…"), so games sort alphabetically by weekday.
- **Effect:** "🏆 Гра 1 / Гра 2 / Гра 3" labels on `/seasons` and the host panel can be in the wrong order. Which players qualify is **not** affected: at most 3 qualifier games can be saved (`server.js:1332`), so all of them are always counted.
- **Evidence:** ✅ with `pg` 8.23.1's own TIMESTAMPTZ parser and the exact sort expression: Tue 6 → Fri 9 → Sat 10 came out as **Fri 9 → Sat 10 → Tue 6**. **Not run against a real database.**
- **Fix:** FIX-10 (optional).

---

# 🧹 Cleanup list (not bugs, but they confuse humans and AIs)

- **Dead files:** root `host.html`, `play.html`, `screen.html`, `index.html`, `seasons.html`, `style.css`, `common.js`, `kinohardkor.json`, `index.json`, `questions.json` (+ route `server.js:50`), `download` (identical to `.gitignore`), draft game JSONs, `games/media_test.json` (not in the index).
- **Dead code:**
  - `finishVideoResult`/`continueVideo` (`server.js:913-926`; phase `video_result` is never set)
  - `currentQuestion()` (`server.js:211-215`)
  - `audienceReturnPhase` (`server.js:390, 1190`)
  - `buzzScheduled` event (`server.js:497, 960, 1061, 1102`; no client listens)
  - `media-test` branches (`server.js:807-813`)
  - stubs in `play.html:364-369`; `ensureGameData` in play (`play.html:100-104`); `resumeVideoResult` (`host.html:366`, `screen.html:251`)
  - unused `cueAudioCtx` (`host.html:18`, `screen.html:75`) and `mediaPlaybackSnapshot` (`host.html:319`, `screen.html:161`)
  - `.catTile::after` CSS
  - duplicated assignments in `startGame` (`server.js:651-654`)
- **Content hard-coded in the engine:** murloc sound (`server.js:780`, `host.html:71-72`, `screen.html:109-110`); sponsor double only when `value === 600` (`server.js:815`); game id `'media-test'`.
- **Version strings disagree:** `package.json` 3.0.0 · `/health` 3.1.0-dev · startup log v3.0.0-rc · README v1.4.1…v1.6.12 · `RENDER_DEPLOY.md` v1.5.0 · `voice-bot/package.json` 3.1.0.
- **Stale docs:** README says questions live in `questions.json` (README:48). `voice-bot/README.md` says the bot can't detect speaking and must be a separate worker, but `bot.js:29-30` detects speaking and `server.js:1449` forks it.
- **Hard-coded UI assumptions** (current data complies): 5 questions per category, 2 rounds, 3 audience questions, 4 options ABCD.
- **Line endings:** git stores LF; a Windows checkout with `core.autocrlf=true` has CRLF. Harmless, but tools that patch by exact text must match the file's line endings.

---

# ✅ Checked and NOT a bug

| Suspicion | Result |
|---|---|
| OBS board shows 🐈 on cat tiles | ❌ Only the **stale root** `common.js` adds `catTile`; the served `public/common.js` doesn't. |
| XSS via player/audience names, final answers, season names | ❌ None found. All go through `GameUI.esc`/`esc` (grep over every template interpolation). |
| Players/OBS receive the special-cell map | ❌ `hostSecrets` goes to the host socket only (`server.js:198`); the public game JSON strips it (`server.js:58`). |
| Answer text in `state` before reveal | ❌ Hidden until reveal (`server.js:110-112, 142`). (But see PARK-05.) |
| Final bets visible to others | ❌ Only `hasBet` is sent (`server.js:152`). |
| Saving "TEST GRAND FINAL" results to a season | Looks intentional (README v1.5.1 workflow). Only mid-game availability is a bug (EASY-06). |
| Game JSON content errors | Only RULE-06 found (validator over types, media files, numeric answers, triplets, audience options, special pools). |

---

# ❓ Not verified

- **PostgreSQL:** no live database was used. WORK-03 applies by schema; MINOR-04 was checked with `pg`'s parser only; PARK-09 not tested on Postgres.
- **Discord voice bot:** not run.
- **Real browsers (desktop and mobile) and OBS:** only jsdom and code reading.
- **Render specifics:** proxy headers, http→https redirect.

---

# 🔬 Appendix: reproductions

- **Scripts:** [`tests/ai_repro/`](tests/ai_repro/README.md). Each starts its own isolated server, so they're safe to run. `REPRODUCED` / exit code 1 = the bug is still there.
- **Environment:** Node v24.11.1, Express 4.22.3, Socket.IO 4.8.4, socket.io-client 4.8.4, jsdom 24.1.3, css-tree 2.3.1, pg 8.23.1. Windows 11, 2026-10-10.
- **Core recipe** (most repros start this way): `createRoom{gameId:'kinohardkor'}` → players `joinPlayer` → `reportNetworkStats{samples:5}` → `skipFirstTurnQuiz` → `chooseTile{ci:0,qi:0}` (a normal 100-point question) → `openBuzz` → wait ~1.2 s → player `buzz` → phase `answering`.

| Repro | Bug | Steps (after the core recipe, or standalone) | Observed |
|---|---|---|---|
| R01 | EASY-01 | `judge{correct:true}` ×2 without waiting | score 0 → 200 |
| R02 | EASY-02 | 3 players; `judge{correct:true}`; `nextFromResult` ×2 | turn P1 → P3 |
| R03 / R03b | PARK-03 | extra socket `getAudienceState` → read `players[].id` → `joinPlayer{playerId: victimId}`; then the victim's old socket `buzz` | ok, renamed / `{ok:true,pending:true}` |
| R04 | PARK-04 | `general-knowledge`; audience round; new socket `joinAudience{audienceId: winnerId}` | same prize code |
| R05 | PARK-01 | fresh socket: `seasonAdminInit` → `seasonAdminSetStatus{completed}` → `seasonAdminCreate` | all ok |
| R06a | EASY-06 | 1 player; `testGrandFinal` → `saveSeasonResult` | ok |
| R06b/c | PARK-02 | unrelated room's host: `correctSavedSeasonResult` / `deleteSavedSeasonResult` | ok / ok |
| R07 | WORK-03 | final → save → `restartSameGame` → final → save | 2nd: "вже збережено" |
| R08 | EASY-08 | in `final_result`: `adjustScore{+100}` | keys reduced to id,name,score |
| R09 | PARK-05 | `GET /games/kinohardkor.json` | 50 answers + final + first-turn |
| R10 | EASY-03 | `leavePlayer` mid-game → `joinPlayer` (new / old id) | both refused |
| R11 | WORK-04 | numericClosest tile → `startNumericTimer` → pause → 31 s → resume → answer | "Час вийшов." |
| R12 | PARK-08 | `storage.init()` on a seasons.json cut in half (12 games) | 0 games remain |
| R13 | WORK-02 | 2 players, 1 disconnects; bets; `startFinalQuestion` | refused |
| R14 | RULE-01 | `saveGame` with two players at 1000 | places 1/2, 10/7 pts |
| R15 | RULE-02 | season "Сезон 2"; qualifiers won by Alice, Alice, Bob | Alice listed twice |
| R16 | PARK-09 | `Promise.all([createSeason, createSeason])` | 2 active seasons |
| R17 | WORK-05 | player never sends `reportNetworkStats`; `openBuzz` | "Очікуємо SYNC" |
| R18 | PARK-07 | honest `buzz` at open+20 ms; cheater at +60 ms claiming `opensAt` | Cheater wins (timing-sensitive) |
| R19 | EASY-07 | room at the audience podium; close host; load `host.html` in jsdom with the saved token | ReferenceError |
| R20 | PARK-06 | imageReveal tile (kinohardkor 0:2:4); GET the player's `activeQuestion.image` | 200 image/jpeg at stage 0 |
| R21 | RULE-03 | 3 players, numeric tile, nobody answers, 31 s, finish | turn B1 → B1 |
