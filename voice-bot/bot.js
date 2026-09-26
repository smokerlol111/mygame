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
let connection=null, connecting=false, sweep=null;
const active=new Set(), lastStart=new Map();
const sendActivity=()=>{if(process.send)process.send({type:'voiceActivity',guildId,channelId,userIds:[...active]})};
const sendStatus=(status,error='')=>{if(process.send)process.send({type:'voiceStatus',status,error})};
function clearActivity(){active.clear();lastStart.clear();sendActivity()}
function stopSweep(){if(sweep){clearInterval(sweep);sweep=null}}

async function connectVoice(){
  if(connecting || connection?.state?.status===VoiceConnectionStatus.Ready)return;
  connecting=true;sendStatus('connecting');
  try{
    const guild=await client.guilds.fetch(guildId);
    const channel=await guild.channels.fetch(channelId);
    if(!channel||!channel.isVoiceBased()||channel.guildId!==guildId)throw new Error('Voice channel not found in configured guild');
    connection=joinVoiceChannel({channelId:channel.id,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,selfDeaf:false,selfMute:true});
    connection.on('error',error=>console.error('Voice connection:',error.stack||error.message));
    connection.receiver.speaking.on('start',userId=>{if(!/^\d{17,20}$/.test(userId))return;lastStart.set(userId,Date.now());active.add(userId);sendActivity()});
    connection.receiver.speaking.on('end',userId=>{lastStart.delete(userId);if(active.delete(userId))sendActivity()});
    connection.on('stateChange',(_,state)=>{if(state.status!==VoiceConnectionStatus.Ready&&active.size)clearActivity()});
    await entersState(connection,VoiceConnectionStatus.Ready,30_000);
    stopSweep();
    sweep=setInterval(()=>{const now=Date.now();let changed=false;for(const [id,at] of lastStart){if(now-at>15000){lastStart.delete(id);changed=active.delete(id)||changed}}if(changed)sendActivity()},1000);
    sweep.unref?.();
    sendActivity();sendStatus('connected');
    console.log('Discord Active Speaker connected to:',channel.name);
  }catch(error){
    console.error('Voice connect failed:',error.stack||error.message);
    connection?.destroy();connection=null;stopSweep();clearActivity();sendStatus('disconnected',error.message);
  }finally{connecting=false}
}
function disconnectVoice(){
  connecting=false;stopSweep();clearActivity();
  if(connection){try{connection.destroy()}catch{}connection=null}
  sendStatus('disconnected');
  console.log('Discord Active Speaker disconnected from voice.');
}
client.once(Events.ClientReady,()=>{console.log('Bot logged in as '+client.user.tag+'; waiting for host to enable Active Speaker.');sendStatus('disconnected')});
client.on('error',error=>console.error('Discord client:',error.message));
process.on('message',message=>{if(message?.type==='voiceConnect')connectVoice();else if(message?.type==='voiceDisconnect')disconnectVoice()});
client.login(token).catch(error=>{console.error('Discord login failed:',error.message);sendStatus('unavailable',error.message);process.exitCode=1});
process.on('SIGTERM',()=>{disconnectVoice();client.destroy();process.exit(0)});
