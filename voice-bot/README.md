# SMOKERLOL QUIZ Voice — v3.1 stage 2
This is a separate Node.js process that logs in and joins the configured server voice channel. It does **not** yet detect speaking users or send voice events to the quiz. No audio is stored.

## Render deployment
Create a **Background Worker** (not a second Web Service) from branch `v3-development`, root directory `voice-bot`, build command `npm install`, start command `npm start`. Workers generally require a paid Render plan; check the displayed price before confirming. Do not use a free Web Service with an artificial keep-alive for this long-lived bot.

Environment variables (set privately in Render, never commit):
- `DISCORD_BOT_TOKEN` — secret token from Developer Portal
- `DISCORD_GUILD_ID` — numeric ID of IRONPIXEL server
- `DISCORD_VOICE_CHANNEL_ID` — numeric ID of voice channel «гра»

Bot needs Connect permission for the voice channel. The code requests Guilds and GuildVoiceStates gateway intents; privileged intents are not needed. It joins self-muted and not self-deafened, but does not subscribe to, record, or forward audio.

Expected logs: `Bot logged in as ...`, `Connected to voice channel: ...`. If the connection fails, check channel ID, guild ID, permissions and worker logs.

## Not implemented yet
Reliable per-user speaking activity reception, a secured bridge to the DEV quiz server, and automatic score-card highlighting from real Discord voice. Existing HOST test controls remain manual.
