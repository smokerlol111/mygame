'use strict';
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const channelId = process.env.DISCORD_VOICE_CHANNEL_ID;
if (![token,guildId,channelId].every(Boolean)) {
  console.error('Missing DISCORD_BOT_TOKEN, DISCORD_GUILD_ID or DISCORD_VOICE_CHANNEL_ID');
  process.exit(1);
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let connection;
client.once(Events.ClientReady, async () => {
  try {
    console.log('Bot logged in as ' + client.user.tag);
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isVoiceBased() || channel.guildId !== guildId) throw new Error('Voice channel not found in configured guild');
    connection = joinVoiceChannel({
      channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false, selfMute: true
    });
    console.log('Voice channel resolved:', channel.name, 'type:', channel.type);
    connection.on('stateChange', (oldState, newState) => {
      console.log('Voice state:', oldState.status, '->', newState.status);
      const network = newState.networking;
      if (network && network !== oldState.networking) {
        network.on('stateChange', (oldNetwork, newNetwork) => {
          console.log('Voice network:', oldNetwork.code, '->', newNetwork.code);
        });
      }
    });
    connection.on('error', error => console.error('Voice connection:', error.stack || error.message));
    console.log('Waiting for Discord voice Ready (30 seconds)...');
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('Connected to voice channel: ' + channel.name);
    // Discord speaking events contain user IDs and activity transitions only.
    // No audio streams are subscribed to, decoded, recorded or stored.
    const active = new Set();
    const lastStart = new Map();
    const send = () => { if (process.send) process.send({type:'voiceActivity', guildId, channelId, userIds:[...active]}); };
    connection.receiver.speaking.on('start', userId => {
      if (!/^\d{17,20}$/.test(userId)) return;
      lastStart.set(userId, Date.now());
      active.add(userId);
      send();
    });
    connection.receiver.speaking.on('end', userId => {
      lastStart.delete(userId);
      if (active.delete(userId)) send();
    });
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, at] of lastStart) {
        if (now - at > 15000) { lastStart.delete(id); changed = active.delete(id) || changed; }
      }
      if (changed) send();
    }, 1000);
    sweep.unref?.();
    connection.on('stateChange', (_, state) => {
      if (state.status !== VoiceConnectionStatus.Ready && active.size) {
        active.clear(); lastStart.clear(); send();
      }
    });
    send();
    console.log('Discord speaking events connected (user IDs only; no audio recorded).');
  } catch (error) {
    console.error('Bot startup failed:', error.stack || error.message);
    console.error('Voice status at failure:', connection?.state?.status || 'not created');
    connection?.destroy();
    client.destroy();
    process.exitCode = 1;
  }
});
client.on('error', error => console.error('Discord client:', error.message));
client.login(token).catch(error => { console.error('Discord login failed:', error.message); process.exitCode=1; });
process.on('SIGTERM', () => { connection?.destroy(); client.destroy(); process.exit(0); });
