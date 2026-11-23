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

### Повний локальний прогін

`question_bank_approval_regression.js` перевіряє обов'язкові тему/підкатегорію/рівень, унікальні ID, дату/статус/походження, метадані схожості та погодження точного повтору, вкладені питання й відхилення чернеток/пошкоджених блоків. На тимчасовій копії банку перевіряється включення нових записів у покажчик, потрібний рівень теми поля та класичний пул. Службові приклади ніколи не додаються в робочий банк. Сценарій включено в runner.

`board_random_regression.js` перевіряє тематичний покажчик 540 записів, 100 випадкових полів по 50 клітинок, рівні/масштабування, доступ до generated ID, очищення невикористаних прев'ю, збереження активних кімнат та проходить усі 50 клітинок/старт/6 глядацьких/фінал через наявний сценарій `all_games_smoke.play`. `--fast` пропускає повний ігровий обхід. `board_random_ui.js` перевіряє в Edge вибір п'яти тем, прев'ю, фактичний JSON експорту, створення кімнати, повернення HOST, PLAYER/OBS і приватність еталона. Обидва сценарії включено в runner. `node scripts/build-question-topic-index.js --verify` перевіряє згенерований покажчик без зміни банку.

Класичний браузерний сценарій також моделює старий сервер із 404 на `/api/capabilities`: має показати українське повідомлення про перезапуск і не надсилати непідтримуваний `classicRandomPool`. Після повернення актуального API перевіряється вибір саме 30 питань. HTTP-сценарій перевіряє capability-відповідь без кешу.

`classic_random_pool_regression.js` перевіряє 271 придатне наявне питання, збереження початкових текстів/відповідей/ID, випадковий вибір 1/12/47/271 питань без точних повторів, відсіювання спецмеханік/позначок перегляду, граничні значення кількості, захист ключем HOST, створення класичної кімнати з пулом, приховані старі ігри й незмінність банку/знімка/каталогу. Браузерний класичний сценарій також натискає кнопку випадкового набору, перевіряє попередній перегляд і потім завантажує власний JSON.

Класичний командний режим перевіряють `node tests/ai_repro/classic_quiz_regression.js` (керований час, п'ять капітанів і справжні 60 секунд) та `node tests/ai_repro/classic_ui_regression.js` (headless Edge: завантаження JSON, вісім команд, HOST/PLAYER/OBS, чернетка, перепідключення, оцінювання, результати, чотири типи питання та мобільні розміри). Додано перевірки автоздавання останньої чернетки, очищення/ручного пріоритету, офлайн-капітана, відхилення пізніх змін, окремих таблиць після третин, приховування поточних балів і фінального відкриття місць з однаковими результатами та HOST reload. `--fast` у серверному сценарії замінює реальне очікування ручним закриттям; перевірки межі часу з керованим годинником залишаються. Обидва сценарії включено в runner. Використовуються синтетичні позначки, які не є новими затвердженими питаннями.

Після архівування 22.11.2026 `lib/server.js` за замовчуванням відтворює дев’ять зафіксованих наборів з `archive/completed-games/2026-11-22/games/index.json` через GAMES_INDEX_FILE. Це тестові набори; вони не повертаються в робоче меню. `archived_games_regression.js` явно використовує робочий індекс: перевіряє нуль активних ігор, відмову для архівних ID, недоступність банку/ZIP через HTTP, керування сезонами та додавання нового набору. Він також перевіряє SHA-256 архіву й повноту 516 записів із усіма вкладеними питаннями. Старий сервер у baseline-прогоні отримує той самий архівний каталог через I/O-адаптер, без зміни його вихідного коду.

`node tests/ai_repro/full_local_suite.js` запускає актуальні перевірки, послідовні браузерні сценарії та старі діагностики. Серверні сценарії працюють у трьох незалежних чергах; кожен має власні тимчасові дані й порти. Browser-перевірки використовують окремі headless Edge-профілі. Чинний сервер/Funnel, виробнича БД, живий Discord і фізичні пристрої не залучаються.

Логи, скриншоти та `results.json` зберігаються в новому `archive/audits/full-local-YYYY-MM-DD/run-*`, дата — за Europe/Kiev. `protected-files-before.json` / `protected-files-after.json` фіксують хеші коду/JSON і метадані медіа; підсумок перевіряє, що тести не змінили ці файли або локальну історію сезонів. Старі аудити й прев'ю не перезаписуються.

- `--only=css_check,player_join_theme` — повторити конкретні сценарії, зберігши попередні результати.
- `--core-only` / `--browser-only` — виконати одну групу.
- `--only=server_repros --baseline-server` — повторити діагностику з точним `server.js` із HEAD через ізольований loader, без зміни робочого дерева.

Код завершення 0 означає, що актуальні сценарії пройшли й захищені файли не змінені. Старі діагностики мають окремий статус `DIAGNOSTIC_FINDINGS`; їхні ненульові результати залишаються у звіті та потребують аналізу. Це не твердження, що старих проблем у застосунку немає.

Якщо бракує `css-tree`, можна встановити його окремо від залежностей застосунку: `npm install --prefix node_modules/.full-local-tools --no-save --package-lock=false --ignore-scripts css-tree@2`. Runner підключає цей каталог через NODE_PATH, не змінюючи `package.json`, lock-файл і наявні пакети застосунку.

`all_games_smoke.js` проходить кожну ввімкнену гру з чотирма гравцями: усі клітинки, стартове/фінальне питання, глядацькі раунди, спецмеханіки, поетапне відкриття й бали. Невідомі старі типи фіксуються як fallback у звіті; успішне проходження не підтверджує правильність їхньої задуманої механіки. `server_lifecycle_regression.js` перевіряє SIGTERM/SIGINT, зупинку інтеграцій, скасування таймерів, повідомлення клієнтів і завершення із запасним тайм-аутом.

**HOST review and repairs:** use `node tests/ai_repro/host_review_risks.js --fixed --report` for the repaired behavior. It checks HTTP retry/rejoin, concurrent/stale loads, BUZZ and ping through PLAYER reconnect, preserved controls, voice checkboxes and cancellation; it writes `recovery-fixes.json`. Without `--fixed`, the historical mode expects the original three defects and should fail once they are fixed; its original output is preserved in `host-review-reproductions.json`. Both modes use an isolated server/jsdom with simulated media. See the [repair report](../../archive/audits/transport-review-2026-10-31/recovery-fixes.md).

| Command | Proves | Time |
|---|---|---|
| `node --test tests/ai_repro/server_registration_regression.js` | Complete one-time registration of the 87 existing Socket.IO commands; construction opens no listening port, starts no bot and installs no signal hooks; two application instances have separate rooms, HOST keys and live Discord state. | <1 s |
| `node tests/ai_repro/server_modules_regression.js` | Isolated HTTP/Socket.IO compatibility before/after module extraction: all page routes, static resources/no-cache, enabled catalog, anonymous/wrong-key answer secrecy, HOST-only full questions, hidden special-cell config, default/fallback/explicit game choice, health room count and seasons API. | ~2 s |
| `node tests/ai_repro/obs_content_fit.js` | Isolated desktop Edge: 39 layouts at 1920×1080, 1280×720, 1024×576 with every text line inside its window and no scrolling; first turn, long question/answer, numeric/audience, all five numeric result reveal counts/photo/winner/tie/no-answer states, resize and repeated render. Also traverses a real isolated numeric question with four submissions, HOST reveal steps, tied distance and the actual server winner/400-point award. Camera/widget coordinates unchanged. Optional `--screenshot` writes temporary first-turn/numeric previews. No production room or real OBS. | ~6 s |
| `node tests/ai_repro/player_audio_host.js` | Isolated desktop Edge + real server: HOST-only audio, hidden PLAYER element without native controls, local play rejected before HOST starts, permission click cannot start/replay while HOST paused, PLAYER cannot send HOST commands; play/pause/seek, volume preserved, 50 unchanged states, disconnect/rejoin, autoplay recovery and stale metadata guards. Silent playback; no live rooms/physical audio/OBS. | ~4 s |
| `node tests/ai_repro/media_live_regression.js` | Isolated actual Edge HOST/desktop PLAYER/SCREEN: all 23 Halloween/Grand Final audio/video questions, native silent decoding/playback, HOST controls to both PLAYER and SCREEN, 50 service states per question, reconnect, real BUZZ pause, result/board, answer cue, five audioReveal stages/reset/STOP/full last stage, 8 video STOP/resume. Without `--report`, historical artifacts remain unchanged. Windows + Edge required. | ~1 min |
| `node tests/ai_repro/host_live_updates.js --browser --liveness` | Isolated actual HOST/server, jsdom + Edge: 3 audience answers, 50 repeated states, network metadata, HOST reconnect, Discord status, real 14 s sync expiry; preserves timer/control nodes, draft/focus/scroll, real phase changes. One browser navigation. Omit flags for fast jsdom checks; Windows + Edge required for `--browser`. | ~17 s |
| `node --test tests/ai_repro/discord_voice_regression.js` | Actual bot and installed SpeakingMap with fake clock/Discord transport; 16 checks: 45 s speech, heartbeat, automatic recovery after >30 s, repeated failed joins/backoff, gateway return, transient/access errors, explicit removal, cancelled joins/toggles/login, real server IPC mapping/deduplication and stale guard. No real Discord/audio/OBS. | <1 s |
| `node tests/ai_repro/obs_camera_stability.js --report` | Isolated actual Edge: 8 live transitions including player/screen reconnect and room close; 44 layouts each at 1920×1080/1280×720 with fixed camera/host/chat/donation geometry and ownership. Standard host area and frame removal on theme reset. Writes `archive/audits/obs-cameras-2026-10-30/`; no actual OBS/webcams/VDO.Ninja streams. Windows + Edge required. | ~7 s |
| `node tests/ai_repro/tailscale_media_preflight.js --browser` | **Uses the existing server on 3100 and existing Funnel.** Forces public ingress DNS with valid TLS; checks 29 Grand Final files/SHA-256, 33 Range responses, 5 concurrent video ranges, own temporary room with public PLAYER/OBS/WebSocket/polling, real Edge decode and remote play/pause/seek. Never saves seasons or changes/restarts Funnel/server. Local HOST key and Windows/Edge required; writes `archive/audits/tailscale-media-2026-10-28/`. | ~2–4 min |
| `node tests/ai_repro/tailscale_media_preflight.js --browser --control-only` | Public Funnel native-player checks for all 11 recordings: 6 PLAYER videos, 6 OBS videos, 5 OBS audio; skips the separate file/hash/range pass and writes `control-results.json`. | ~1 min |
| `node tests/ai_repro/grand_final_standard_browser.js --screenshots` | Isolated actual Edge HOST/PLAYER/OBS: standard theme and Halloween CSS isolation, all Grand Final question formats and final screens (198 renders), 29 media decodes, muted playback, 6 actual HOST STOP guards; report/9 screenshots in `archive/audits/grand-final-standard-2026-10-28/`. Rendering fixtures complement the live `grand_final_smoke.js` command traversal. Windows + Edge required; not real phones/OBS/audio routing. | ~20 s |
| `node tests/ai_repro/halloween_theme.js` | HOST-only room theme control and authorization, room isolation/reconnect, live HOST/PLAYER/OBS sync, focused answers/timers/media preserved; previews/BUZZ/camera slots and default Grand Final | ~4 s |
| `node tests/ai_repro/halloween_theme.js --screenshots` | The same checks plus 50 PLAYER comparisons against standard geometry (including login), HOST/OBS layout checks and 16 screenshots in `themes/halloween/previews/`; Windows + Edge required, not real phones/OBS or a media decode test | ~20 s |
| `node tests/ai_repro/halloween_theme.js --player-layout` | Every PLAYER element's dimensions, spacing, fonts and layout match standard across 10 states at 320/390/768/1280/1920 px, with touch and desktop input; `lib/player-theme-layout.js` | ~15 s |
| `node tests/ai_repro/player_join_theme.js` | Theme lookup before joining via a link/manual code; response exposes only theme, no seat/subscription, no partial/duplicate lookups, preserved inputs, stale replies cannot override a different code/joined state | ~2 s |
| `node tests/ai_repro/player_join_theme.js --browser` | The same checks plus actual Edge login, one lookup across polling/WebSocket transports, 3.5 s idle without repeats, `player-join-halloween.png` | ~6 s |
| `node tests/ai_repro/halloween_theme.js --traffic` | Real Edge HOST/PLAYER/OBS tabs: 3.5 s idle without theme polling, 500 unchanged OBS updates and 500 photo-layout updates without DOM mutations/theme HTTP loads, duplicate selection suppressed, one small event per real change without a full-state broadcast; existing clock sync/heartbeats excluded | ~8 s |
| `node tests/ai_repro/game_safety_regression.js` | Конкурентні записи фіналів/сезонів, пауза числового/глядацького/стартового/фінального таймерів через імпорт модуля з керованим годинником, фінальне двосекундне вікно після нуля, повторні кнопки, нульові пропущені ставки, повернення PLAYER, заборона збереження фіктивних результатів | ~2 s |
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
