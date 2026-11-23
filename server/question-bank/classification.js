// Editorial grouping of the existing bank, not new question text or approval.
const themes = {
  C: { id:'cinema', name:'Кіно, серіали та анімація' },
  M: { id:'music', name:'Музика' },
  T: { id:'technology', name:'Ігри та технології' },
  I: { id:'internet', name:'Інтернет і меми' },
  S: { id:'science', name:'Наука та природа' },
  H: { id:'world', name:'Історія та географія' },
  K: { id:'culture', name:'Культура, спорт і суспільство' },
  L: { id:'logic', name:'Логіка та числа' },
};
// In source order: five categories in round one, then five in round two;
// each character classifies one of the five questions, including mixed categories.
const mainByGame = {
  'kinohardkor': Array(10).fill('CCCCC'),
  'general-knowledge': ['HHHHH','HHHHH','LLLLL','KKKKK','SSSSS','LLLLL','SSSSS','TKHTM','SSSSS','TKTTT'],
  'back-to-2000s-test': ['TTTCT','CCCCC','TTTTT','TTTTK','KKKKT','TTTIH','CCCCC','MMMMM','TTTTT','TTTTC'],
  'friends-super-final': ['CCCCC','MMMMM','SSSSS','TTTTT','SSSSS','CCCCC','CCCCC','LLLLL','MHHHS','SISSH'],
  'season2-kinohardkor-2': Array(10).fill('CCCCC'),
  'season2-general-knowledge-2': ['SSSSS','SSSSS','SSSSS','SSSSS','KKKKK','HHHHH','HHSTH','TSTTT','SSSKK','KKMKM'],
  'season2-memes-internet': ['IIIII','ITIII','CKKKM','KKKKK','IIIII','KKKKK','IIIII','IIIII','CCCCC','IIIII'],
  'season2-grand-final': ['CCCCC','LLLLL','IIIII','CCCCC','SSSSS','CCCCC','HHHHH','MIKTI','IIIII','LLLLL'],
  'halloween-special-2026': ['CCCCC','CKKCK','MTMMC','KKKSK','IIIII','KHCKS','TSKCT','SSSSS','SSSCS','KSCMT'],
};
const extrasByGame = {
  'kinohardkor': {firstTurn:'C',final:'C',audience:''},
  'general-knowledge': {firstTurn:'H',final:'H',audience:'SSLHLS'},
  'back-to-2000s-test': {firstTurn:'T',final:'C',audience:'TMCTMC'},
  'friends-super-final': {firstTurn:'C',final:'S',audience:'ICCCCK'},
  'season2-kinohardkor-2': {firstTurn:'C',final:'C',audience:'CCCCCC'},
  'season2-general-knowledge-2': {firstTurn:'L',final:'H',audience:'TSKHST'},
  'season2-memes-internet': {firstTurn:'T',final:'I',audience:'TIIIII'},
  'season2-grand-final': {firstTurn:'H',final:'S',audience:'HKKKTS'},
  'halloween-special-2026': {firstTurn:'K',final:'K',audience:'CCCSHC'},
};

function classification(record) {
  let code;
  if (record.kind === 'main') {
    const [,round,category,question] = record.id.match(/:R(\d+):C(\d+):Q(\d+)$/) || [];
    code = mainByGame[record.gameId]?.[(Number(round)-1)*5+Number(category)-1]?.[Number(question)-1];
  } else if (record.kind === 'audience') {
    const [,round,question] = record.id.match(/:AUD(\d+):Q(\d+)$/) || [];
    code = extrasByGame[record.gameId]?.audience[(Number(round)-1)*3+Number(question)-1];
  } else code = extrasByGame[record.gameId]?.[record.kind];
  if (!themes[code]) throw new Error('Немає тематичного розподілу для ' + record.id);
  return themes[code];
}

module.exports = { themes, classification };
