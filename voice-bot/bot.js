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
    connection.on('error', error => console.error('Voice connection:', error.message));
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('Connected to voice channel: ' + channel.name);
    console.log('Voice activity forwarding is NOT implemented yet. No audio is recorded.');
  } catch (error) {
    console.error('Bot startup failed:', error.message);
    process.exitCode = 1;
    client.destroy();
  }
});
client.on('error', error => console.error('Discord client:', error.message));
client.login(token).catch(error => { console.error('Discord login failed:', error.message); process.exitCode=1; });
process.on('SIGTERM', () => { connection?.destroy(); client.destroy(); process.exit(0); });
