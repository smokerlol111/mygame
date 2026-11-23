const crypto = require('node:crypto');
const { loadBank } = require('../../question-bank/catalog');
const { generateBoard, options } = require('./random-generator');

function registerRandomBoardHandlers(socket,{rootDir,hostKeyOk,games,rooms}) {
  const on=(event,action)=>socket.on(event,(payload={},callback=()=>{})=>{
    const reply=typeof callback==='function'?callback:()=>{};
    try {
      if(!hostKeyOk(payload?.hostKey))throw new Error('Потрібен ключ ведучого.');
      reply({ok:true,...action(payload)});
    } catch(error) {reply({ok:false,error:error.message});}
  });
  on('boardRandomOptions',()=>({themes:options(loadBank(rootDir))}));
  on('boardRandomPreview',payload=>{
    const active=new Set([...rooms.values()].map(room=>room.gameId));
    const pending=[...games.values()].filter(game=>game.generatedBoard&&!active.has(game.id)).sort((a,b)=>a.createdAt-b.createdAt);
    pending.forEach((game,index)=>{if(Date.now()-game.createdAt>30*60*1000||index<pending.length-19)games.delete(game.id);});
    const game={...generateBoard(loadBank(rootDir),payload.themeIds),id:'random-board-'+crypto.randomUUID()};
    games.set(game.id,game);
    return {game};
  });
}
module.exports={registerRandomBoardHandlers};
