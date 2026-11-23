const crypto = require('node:crypto');
const { normalize } = require('../classic/random-pool');
const supported = new Set([undefined,'text','normal','emoji','triplet','numericClosest','audio','audioReveal','video','imageReveal']);
const shuffle = (items,randomInt=crypto.randomInt) => {
  const result=[...items];
  for(let i=result.length-1;i>0;i--) { const j=randomInt(i+1); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
};
function keys(question) {
  if(question.triplet) return question.triplet.flatMap(keys);
  return [normalize(String(question.q || question.question || ''))+'|'+String(question.media || question.image || question.audio || question.video || '')+'|'+String(question.emoji || '')];
}
function candidates(bank) {
  return bank.entries.filter(entry=>entry.kind==='main' && supported.has(entry.payload.type)
    && !entry.payload.cat && !entry.payload.reviewRequired && !entry.payload.sponsorDouble);
}
function options(bank) {
  const entries=candidates(bank);
  return bank.themes.map(theme=>{
    const pool=entries.filter(entry=>entry.themeId===theme.id);
    const levels=[1,2,3,4,5].map(level=>new Set(pool.filter(entry=>entry.difficulty===level).map(entry=>keys(entry.payload).join('||'))).size);
    return {...theme,count:pool.length,levels,eligible:levels.every(count=>count>=2)};
  });
}
function resize(entry,value) {
  const question=structuredClone(entry.payload),ratio=value/question.value;
  question.value=value;question.sourceId=entry.id;
  if(question.revealValues) question.revealValues=question.revealValues.map(old=>Math.round(old*ratio));
  if(question.triplet) question.triplet=question.triplet.map(part=>({...part,value:Math.round(part.value*ratio)}));
  return question;
}
function generateBoard(bank,requestedThemes,randomInt=crypto.randomInt) {
  const eligible=options(bank).filter(theme=>theme.eligible);
  if(requestedThemes!==undefined && (!Array.isArray(requestedThemes)||requestedThemes.length!==5||new Set(requestedThemes).size!==5))
    throw new Error('Оберіть рівно 5 різних тем або залиште автоматичний вибір.');
  if(requestedThemes?.some(id=>!eligible.some(theme=>theme.id===id))) throw new Error('Для обраної теми бракує питань потрібних рівнів.');
  if(eligible.length<5) throw new Error('Для двох раундів бракує п’яти повних тематичних пулів.');
  const entries=candidates(bank);
  for(let attempt=0;attempt<100;attempt++) {
    const themes=requestedThemes ? requestedThemes.map(id=>eligible.find(theme=>theme.id===id)) : shuffle(eligible,randomInt).slice(0,5);
    const used=new Set(),rounds=[{categories:[]},{categories:[]}];let failed=false;
    const add=question=>{const signature=keys(question);if(signature.some(key=>used.has(key)))return false;signature.forEach(key=>used.add(key));return true;};
    for(const theme of themes) {
      const pair=[{name:theme.name,questions:[]},{name:theme.name,questions:[]}];
      for(let level=1;level<=5;level++) {
        const available=shuffle(entries.filter(entry=>entry.themeId===theme.id&&entry.difficulty===level),randomInt);
        for(let ri=0;ri<2;ri++) {
          const chosen=available.find(entry=>add(entry.payload));
          if(!chosen) {failed=true;break;}
          pair[ri].questions.push(resize(chosen,level*(ri===0?100:200)));
        }
        if(failed)break;
      }
      if(failed)break;
      rounds.forEach((round,ri)=>round.categories.push(pair[ri]));
    }
    if(failed || rounds.some(round=>round.categories.flatMap(category=>category.questions).filter(question=>
      (!question.type||['text','normal'].includes(question.type))&&!question.media&&!question.answerImage&&!question.answerVideo).length<3)) continue;
    const pick=kind=>{
      const matching=bank.entries.filter(entry=>entry.kind===kind&&themes.some(theme=>theme.id===entry.themeId));
      return shuffle(matching.length?matching:bank.entries.filter(entry=>entry.kind===kind),randomInt).find(entry=>add(entry.payload));
    };
    const first=pick('firstTurn'),final=pick('final');
    if(!first||!final)continue;
    const audience=[];
    const audienceSources=[...bank.games.values()].flatMap(game=>(game.audienceRounds||[]).map((round,index)=>({...structuredClone(round),sourceId:game.id+':AUD'+(index+1)})));
    for(const round of shuffle(audienceSources,randomInt)) {
      const roundKeys=round.questions.flatMap(keys);
      if(roundKeys.some(key=>used.has(key)))continue;
      roundKeys.forEach(key=>used.add(key));audience.push(round);
      if(audience.length===2)break;
    }
    if(audience.length<2)continue;
    return {title:'Випадкова гра за категоріями',menuTitle:'Випадкова гра',generatedBoard:true,
      createdAt:Date.now(),selectedThemes:themes.map(theme=>theme.id),rounds,
      firstTurnQuiz:{...structuredClone(first.payload),sourceId:first.id},final:{...structuredClone(final.payload),sourceId:final.id},
      audienceRounds:audience,specialSetup:{mode:'season2_balanced'},uiTheme:null};
  }
  throw new Error('Не вдалося скласти поле без повторів із цими темами. Спробуйте інші теми.');
}
module.exports={generateBoard,options,keys,candidates};
