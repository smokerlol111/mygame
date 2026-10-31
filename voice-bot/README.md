# SMOKERLOL QUIZ — Discord Active Speaker

`server.js` launches `voice-bot/bot.js` as its child process when all three Discord settings are present. The bot logs in, then waits for HOST to enable Active Speaker. The child sends speaking user IDs and connection status to the server over local Node IPC. The server maps Discord IDs to players and updates HOST/OBS. No audio is subscribed to, recorded, stored, or forwarded.

## Configuration and use

Set these values privately in the root `.env` or server environment:

- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_VOICE_CHANNEL_ID`

The bot needs access to the configured voice channel and permission to connect. It requests Guilds and GuildVoiceStates intents and joins self-muted, with `selfDeaf: false` so the receiver can observe voice activity. In HOST, enable Active Speaker and map each player to their Discord User ID. Camera streams such as VDO.Ninja are independent of this mapping.

This implementation uses the IPC channel of the parent quiz process. Launching `voice-bot` independently does not establish a bridge to a separate quiz server. The previous stage-2 instructions describing an independent worker predated this implementation.

## Speaking updates and recovery — 31.10.2026

The previous code removed a user 15 seconds after their `start` event even if packets kept arriving. The installed `SpeakingMap` emits `start` once per uninterrupted packet sequence; its `users` map tracks ongoing activity and its `end` event clears it after silence. In a deterministic regression, the old bot lost the highlight at 16,000 ms of continuous packets.

The bot now reads `receiver.speaking.users` instead of imposing a maximum utterance duration. It publishes immediately on start/end and sends a fresh snapshot every second while Ready. The end handler excludes the ending user because the library emits `end` before deleting that user from the map. Fresh snapshots keep the server's existing 20-second IPC safety timeout from expiring during a long utterance. The server already suppresses unchanged browser events, so these snapshots do not rebuild HOST/OBS every second.

While a voice connection recovers, the bot clears highlighting and reports `connecting`. On Ready it restores the current receiver snapshot, resumes the heartbeat, and reports `connected`. The library first attempts recovery itself. After 30 seconds without Ready, the bot releases the unusable connection and retries while HOST still wants it enabled, using delays of 5, 10, 20, then at most 30 seconds. Gateway unavailability does not abandon these retries. Ready resets the delay.

HOST can cancel connecting/starting through the same toggle. Manual shutdown, Discord's Manual disconnect reason or WebSocket close 4014, and missing channel/guild/access errors (10003/10004/50001/50013) stop retries and require explicit HOST enable. This keeps transient network recovery separate from explicit removal. No retry records or forwards audio.

Disabling Active Speaker cancels pending fetch/join attempts, heartbeat, recovery and retry timers. A late completion cannot reconnect the bot after HOST disabled it. A rapid disable/enable keeps only the newest attempt. Enabling during login is remembered until the client is ready.

Connection transitions are logged as `Discord voice state: ... -> ...` for diagnosis. The per-second snapshot does not produce a per-second log or include audio.

## Verification and activation

```text
node --test tests/ai_repro/discord_voice_regression.js
node tests/ai_repro/halloween_theme.js
node --check voice-bot/bot.js
```

The regression runs actual bot code, the installed `SpeakingMap`, and the actual server IPC handler with a fake clock and simulated Discord transport. Sixteen checks cover 45 seconds of continuous packets, silent heartbeat, overlapping speakers, recovery beyond 30 seconds, repeated failed joins/backoff, late gateway recovery, transient fetch/access failures, explicit removal, manual shutdown, pending joins, rapid toggles, login readiness, server mapping/deduplication, and the unchanged stale-IPC guard. These are isolated checks, not a real Discord call, actual OBS test, or long live broadcast.

The 31.10 fix is local and has not been committed, pushed, or applied to the running bot. See the [change log](../CHANGELOG.md#31102026--discord-виправлення-зникнення-підсвітки-говоріння). An existing bot process keeps its loaded JavaScript; toggling voice off/on alone does not load the new code. Restart the quiz server between games to apply it. Rooms are stored in memory and do not survive a server restart.
