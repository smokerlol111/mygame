# tests/ai_repro: proof scripts for `found_bugs.md`

> **What this is:** small scripts, written by an AI assistant (Claude) during the code review, that **prove** the bugs in [`../../found_bugs.md`](../../found_bugs.md) exist.
> **What this is not:** a test framework (yet). There's no runner and no assertions library. Each script prints a result and sets an exit code.

## ⚡ TL;DR

- **`REPRODUCED` = the bug is still there.** After a fix, the matching line should say `NOT REPRODUCED`.
- **Exit code `1`** = at least one bug still reproduces. **`0`** = none do. (So they already work as regression checks.)
- **Isolation:** server repro scripts **start their own** server on a random port, with a throwaway data folder; `DATABASE_URL` and Discord variables are removed. The explicit exception is `tailscale_media_preflight.js`: it checks the already running server/Funnel using only its own temporary room, closes that room, and never saves season results or restarts/configures services.

## 🛠️ Setup (once)

```bash
npm install                                                   # project deps (express, socket.io, …)
npm install --no-save socket.io-client@4 jsdom@24 css-tree@2  # extra deps used only by these scripts
```

- The repo has no `package-lock.json`, so `npm install` will create one. Committing it is your call.
- `--no-save` keeps `package.json` unchanged. A later plain `npm install` may remove these 3 packages; if so, run the second line again.

## ▶️ Run

| Command | Proves | Time |
|---|---|---|
| `node tests/ai_repro/tailscale_media_preflight.js --browser` | **Uses the existing server on 3100 and existing Funnel.** Forces public ingress DNS with valid TLS; checks 29 Grand Final files/SHA-256, 33 Range responses, 5 concurrent video ranges, own temporary room with public PLAYER/OBS/WebSocket/polling, real Edge decode and remote play/pause/seek. Never saves seasons or changes/restarts Funnel/server. Local HOST key and Windows/Edge required; writes `archive/audits/tailscale-media-2026-10-28/`. | ~2–4 min |
| `node tests/ai_repro/tailscale_media_preflight.js --browser --control-only` | Public Funnel native-player checks for all 11 recordings: 6 PLAYER videos, 6 OBS videos, 5 OBS audio; skips the separate file/hash/range pass and writes `control-results.json`. | ~1 min |
| `node tests/ai_repro/grand_final_standard_browser.js --screenshots` | Isolated actual Edge HOST/PLAYER/OBS: standard theme and Halloween CSS isolation, all Grand Final question formats and final screens (198 renders), 29 media decodes, muted playback, 6 actual HOST STOP guards; report/9 screenshots in `archive/audits/grand-final-standard-2026-10-28/`. Rendering fixtures complement the live `grand_final_smoke.js` command traversal. Windows + Edge required; not real phones/OBS/audio routing. | ~20 s |
| `node tests/ai_repro/halloween_theme.js` | HOST-only room theme control and authorization, room isolation/reconnect, live HOST/PLAYER/OBS sync, focused answers/timers/media preserved; previews/BUZZ/camera slots and default Grand Final | ~4 s |
| `node tests/ai_repro/halloween_theme.js --screenshots` | The same checks plus 50 PLAYER comparisons against standard geometry (including login), HOST/OBS layout checks and 16 screenshots in `themes/halloween/previews/`; Windows + Edge required, not real phones/OBS or a media decode test | ~20 s |
| `node tests/ai_repro/halloween_theme.js --player-layout` | Every PLAYER element's dimensions, spacing, fonts and layout match standard across 10 states at 320/390/768/1280/1920 px, with touch and desktop input; `lib/player-theme-layout.js` | ~15 s |
| `node tests/ai_repro/player_join_theme.js` | Theme lookup before joining via a link/manual code; response exposes only theme, no seat/subscription, no partial/duplicate lookups, preserved inputs, stale replies cannot override a different code/joined state | ~2 s |
| `node tests/ai_repro/player_join_theme.js --browser` | The same checks plus actual Edge login, one lookup across polling/WebSocket transports, 3.5 s idle without repeats, `player-join-halloween.png` | ~6 s |
| `node tests/ai_repro/halloween_theme.js --traffic` | Real Edge HOST/PLAYER/OBS tabs: 3.5 s idle without theme polling, 500 unchanged OBS updates and 500 photo-layout updates without DOM mutations/theme HTTP loads, duplicate selection suppressed, one small event per real change without a full-state broadcast; existing clock sync/heartbeats excluded | ~8 s |
| `node tests/ai_repro/game_safety_regression.js` | Конкурентні записи фіналів/сезонів, пауза числового/глядацького таймерів, повторні кнопки, нульові пропущені ставки, повернення PLAYER, заборона збереження фіктивних результатів | ~2 s |
| `node tests/ai_repro/grand_final_smoke.js` | Усі 50 клітинок Grand Final, спецклітинки, 27 медіафайлів/HTTP, стартове, 6 глядацьких питань і справжній фінал; без перевірки декодування медіа | ~60 s |
| `node tests/ai_repro/season_grand_final.js` | Окрема гра визначає чемпіона: відбори, автоматична позначка фіналу, HOST/public/OBS у jsdom, нічия, виправлення/видалення, сумісність історії | ~3 s |
| `node tests/ai_repro/season_wild_card.js` | Ручний Wild Card за голосуванням глядачів, доступ HOST, збереження й публічна сторінка | ~3 s |
| `node tests/ai_repro/audience_public_url.js` | Funnel/public URL used by the local host and QR; viewer joins and answers; direct/proxy fallbacks | ~2 s |
| `node tests/ai_repro/numeric_turn_regression.js` | RULE-03: turn rotation with/without a winner, wraparound, finish guards; isolated server checks the real 30-second timer and winner points | ~33 s |
| `node tests/ai_repro/server_repros.js` | 19 live repros: EASY-01, 02, 03, 06, 08 · WORK-02…05 · RULE-03 · PARK-01…07 | ~45 s |
| `node tests/ai_repro/server_repros.js R01,R04` | only the listed repros (IDs from `found_bugs.md` appendix) | a few s |
| `node tests/ai_repro/storage_repros.js` | PARK-08, RULE-01, RULE-02, PARK-09 (calls `storage.js` directly, JSON mode) | ~2 s |
| `node tests/ai_repro/host_reload_repro.js` | EASY-07 (real `host.html` in jsdom) | ~5 s |
| `node tests/ai_repro/css_check.js` | MINOR-01 (broken CSS selector) | instant |
| `node tests/ai_repro/express_protocol_check.js` | PARK-12 (QR uses `http://` behind a proxy) | instant |
| `node tests/ai_repro/validate_games.js` | RULE-06 + checks every enabled game against the server's rules | instant |
| `node tests/ai_repro/check_doc_refs.js` | **the docs**, not the code: 98 `file:line` references still point at the described code | instant |

**Slow ones:** R11 and R21 wait 31 s, because the numeric-question timer is hard-coded to 30 s.

**24.10.2026:** `server_repros.js` and `storage_repros.js` are historical diagnostics, not an all-green acceptance suite. Some recipes predate secret player keys, the final answer grace window, mandatory Grand Final and the ban on saving test results. Their output needs interpretation against current code; use the season/safety/Grand Final regression scripts above for the current rules. `validate_games.js` still flags the known `type: "numeric"` in `back_to_2000s_test.json` at `1:4:1`; Grand Final has no validator findings.

## 📖 Reading the output

```
[R01] (EASY-01) Double "judge correct" (host double-click) awards points twice
  expected: score 0 -> 100 (question value 100)
  actual:   score 0 -> 200
  => REPRODUCED
```

- **`[R01]`** is the reproduction ID. **`(EASY-01)`** is the bug ID in `found_bugs.md`.
- **`expected`** is the correct behavior. **`actual`** is what the code did.

## ⚠️ Things to know

- **R18 is timing-sensitive.** It needs the cheater's press to arrive within the server's 90 ms window, and Windows timer jitter sometimes pushes it out. Seen: 6/6 reproduced on the original code; 1 miss in 7 runs on a copy. A single `NOT REPRODUCED` for R18 does **not** mean the bug is fixed.
- **`check_doc_refs.js` will "fail" after code edits.** That's on purpose: the line numbers were written for commit `46e0620`. Drift means `architecture.md` / `found_bugs.md` need updating, not that the code is broken.
- **Hard-coded test data:** the scripts rely on the current game files, e.g. `kinohardkor` tile `0:0:0` is a normal 100-point question, `0:2:4` is imageReveal, `general-knowledge` tile `0:1:3` is numericClosest, and audience answers are `1,0,1`. Changing those game JSONs can break a repro without the bug being fixed.
- **Some repros "attack" the isolated server on purpose** (complete seasons, delete saved games). That's why they must never point at a real deployment, and why `lib/server.js` refuses to inherit `DATABASE_URL`.
- **Last verified run:** 2026-10-10, commit `46e0620`, Windows 11, Node v24.11.1, express 4.22.3, socket.io 4.8.4, socket.io-client 4.8.4, jsdom 24.1.3, css-tree 2.3.1. All 27 runs (covering 25 bugs) found their bug, and `check_doc_refs.js` reported 0 drifted.

## 📁 Files

| File | Role |
|---|---|
| `lib/server.js` | starts an isolated `server.js` (free port, temp `DATA_DIR`, no DB/Discord env) and stops it |
| `server_repros.js` | Socket.IO + HTTP repros against that server |
| `storage_repros.js` | runs each storage repro in its own child process with a fresh temp `DATA_DIR` |
| `host_reload_repro.js` | jsdom + real server |
| `css_check.js`, `express_protocol_check.js`, `validate_games.js`, `check_doc_refs.js` | static checks |
