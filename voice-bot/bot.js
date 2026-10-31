'use strict';
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, VoiceConnectionDisconnectReason } = require('@discordjs/voice');

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const channelId = process.env.DISCORD_VOICE_CHANNEL_ID;
if (![token,guildId,channelId].every(Boolean)) {
  console.error('Missing DISCORD_BOT_TOKEN, DISCORD_GUILD_ID or DISCORD_VOICE_CHANNEL_ID');
  process.exit(1);
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let connection=null, connecting=false, heartbeat=null, recoveryTimer=null, retryTimer=null;
let wanted=false, generation=0, retryAttempt=0;
let loginError='';
const sendActivity=(userIds=[])=>{if(process.send)process.send({type:'voiceActivity',guildId,channelId,userIds})};
const sendStatus=(status,error='')=>{if(process.send)process.send({type:'voiceStatus',status,error})};
function stopHeartbeat(){if(heartbeat){clearInterval(heartbeat);heartbeat=null}}
function stopRecovery(){if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null}}
function stopRetry(){if(retryTimer){clearTimeout(retryTimer);retryTimer=null}}
function releaseConnection(){
  generation++;connecting=false;stopHeartbeat();stopRecovery();
  const previous=connection;connection=null;
  if(previous&&previous.state.status!==VoiceConnectionStatus.Destroyed){try{previous.destroy()}catch{}}
  sendActivity();
}
function retryVoice(error){
  if(!wanted)return;
  releaseConnection();
  sendStatus('connecting',error);
  if(retryTimer)return;
  const delay=Math.min(30000,5000*2**Math.min(retryAttempt++,3));
  retryTimer=setTimeout(()=>{retryTimer=null;if(wanted)connectVoice()},delay);
  retryTimer.unref?.();
}
function publishActivity(endedUserId){
  // SpeakingMap.users is maintained by received packets, not by utterance length.
  // Its 'end' event fires just BEFORE removal from users, hence the exclusion.
  const users=wanted&&connection?.state.status===VoiceConnectionStatus.Ready
    ? [...connection.receiver.speaking.users.keys()].filter(id=>/^\d{17,20}$/.test(id)&&id!==endedUserId)
    : [];
  sendActivity(users);
}
function connectionStateChanged(current,previous,state){
  if(connection!==current||!wanted)return;
  if(state.status===VoiceConnectionStatus.Disconnected
    &&(state.reason===VoiceConnectionDisconnectReason.Manual
      ||state.reason===VoiceConnectionDisconnectReason.WebSocketClose&&state.closeCode===4014)){
    disconnectVoice('Discord removed the voice connection. Enable Active Speaker to join again.');
    return;
  }
  if(previous.status===state.status)return;
  console.log('Discord voice state:',previous.status||'initial','->',state.status);
  if(state.status===VoiceConnectionStatus.Ready){
    stopRecovery();stopRetry();retryAttempt=0;
    sendStatus('connected');publishActivity();
    // Keep the server's 20 s stale-IPC guard alive even during one long utterance
    // or complete silence. Unchanged activity is not rebroadcast to browsers.
    if(!heartbeat){heartbeat=setInterval(()=>publishActivity(),1000);heartbeat.unref?.()}
    return;
  }
  stopHeartbeat();sendActivity();
  if(state.status===VoiceConnectionStatus.Destroyed){
    retryVoice('Discord voice connection was lost. Reconnecting automatically.');
    return;
  }
  sendStatus('connecting');
  // The library resumes/rejoins recoverable network failures itself. If it
  // cannot recover within 30 s, retry a fresh connection while HOST still wants it.
  if(!recoveryTimer){
    recoveryTimer=setTimeout(()=>{
      if(connection===current&&wanted)retryVoice('Discord voice connection is unavailable. Reconnecting automatically.');
    },30000);
    recoveryTimer.unref?.();
  }
}

async function connectVoice(){
  wanted=true;
  stopRetry();
  if(!client.isReady()){
    if(!loginError)retryVoice('Discord gateway is unavailable. Reconnecting automatically.');
    sendStatus(loginError?'unavailable':'starting',loginError||'Discord bot is still logging in.');
    return;
  }
  if(connecting)return;
  if(connection?.state?.status===VoiceConnectionStatus.Ready){sendStatus('connected');publishActivity();return}
  if(connection)return; // Existing connection is already attempting recovery.
  const attempt=++generation;
  connecting=true;sendStatus('connecting');
  try{
    const guild=await client.guilds.fetch(guildId);
    const channel=await guild.channels.fetch(channelId);
    if(!wanted||attempt!==generation)return; // HOST disabled/re-enabled while fetching.
    if(!channel||!channel.isVoiceBased()||channel.guildId!==guildId)throw Object.assign(new Error('Voice channel not found in configured guild'),{code:10003});
    connection=joinVoiceChannel({channelId:channel.id,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,selfDeaf:false,selfMute:true});
    const current=connection;
    current.on('error',error=>console.error('Voice connection:',error.stack||error.message));
    current.receiver.speaking.on('start',()=>{if(connection===current)publishActivity()});
    current.receiver.speaking.on('end',userId=>{if(connection===current)publishActivity(userId)});
    current.on('stateChange',(previous,state)=>connectionStateChanged(current,previous,state));
    await entersState(current,VoiceConnectionStatus.Ready,30_000);
    if(!wanted||attempt!==generation||connection!==current)return;
    if(!heartbeat)connectionStateChanged(current,{status:null},current.state);
    console.log('Discord Active Speaker connected to:',channel.name);
  }catch(error){
    if(!wanted||attempt!==generation)return;
    console.error('Voice connect failed:',error.stack||error.message);
    if([10003,10004,50001,50013].includes(Number(error.code)))disconnectVoice(error.message);
    else retryVoice(error.message);
  }finally{if(attempt===generation)connecting=false}
}
function disconnectVoice(error=''){
  wanted=false;stopRetry();retryAttempt=0;releaseConnection();
  sendStatus('disconnected',error);
  console.log('Discord Active Speaker disconnected from voice.');
}
client.once(Events.ClientReady,()=>{
  console.log('Bot logged in as '+client.user.tag+'; waiting for host to enable Active Speaker.');
  if(wanted)connectVoice();else sendStatus('disconnected');
});
client.on('error',error=>console.error('Discord client:',error.message));
process.on('message',message=>{if(message?.type==='voiceConnect')connectVoice();else if(message?.type==='voiceDisconnect')disconnectVoice()});
client.login(token).catch(error=>{
  const details=error.errors?.map(item=>[item.code,item.message].filter(Boolean).join(': ')).filter(Boolean).join('; ');
  loginError=[error.name,error.code,error.message,details].filter(Boolean).join(': ')||'Discord login failed';
  console.error('Discord login failed:',loginError);
  wanted=false;stopRetry();releaseConnection();
  sendStatus('unavailable',loginError);
  client.destroy();
  process.exitCode=1;
});
process.on('SIGTERM',()=>{disconnectVoice();client.destroy();process.exit(0)});
