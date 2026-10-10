# tests/ai_repro: proof scripts for `found_bugs.md`

> **What this is:** small scripts, written by an AI assistant (Claude) during the code review, that **prove** the bugs in [`../../found_bugs.md`](../../found_bugs.md) exist.
> **What this is not:** a test framework (yet). There's no runner and no assertions library. Each script prints a result and sets an exit code.

## ⚡ TL;DR

- **`REPRODUCED` = the bug is still there.** After a fix, the matching line should say `NOT REPRODUCED`.
- **Exit code `1`** = at least one bug still reproduces. **`0`** = none do. (So they already work as regression checks.)
- **They are safe:** every script that needs a server **starts its own** on a random port, with a throwaway data folder. `DATABASE_URL` and the Discord variables are removed, so real seasons and your database are never touched.

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
| `node tests/ai_repro/server_repros.js` | 19 live repros: EASY-01, 02, 03, 06, 08 · WORK-02…05 · RULE-03 · PARK-01…07 | ~45 s |
| `node tests/ai_repro/server_repros.js R01,R04` | only the listed repros (IDs from `found_bugs.md` appendix) | a few s |
| `node tests/ai_repro/storage_repros.js` | PARK-08, RULE-01, RULE-02, PARK-09 (calls `storage.js` directly, JSON mode) | ~2 s |
| `node tests/ai_repro/host_reload_repro.js` | EASY-07 (real `host.html` in jsdom) | ~5 s |
| `node tests/ai_repro/css_check.js` | MINOR-01 (broken CSS selector) | instant |
| `node tests/ai_repro/express_protocol_check.js` | PARK-12 (QR uses `http://` behind a proxy) | instant |
| `node tests/ai_repro/validate_games.js` | RULE-06 + checks every enabled game against the server's rules | instant |
| `node tests/ai_repro/check_doc_refs.js` | **the docs**, not the code: 98 `file:line` references still point at the described code | instant |

**Slow ones:** R11 and R21 wait 31 s, because the numeric-question timer is hard-coded to 30 s.

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
