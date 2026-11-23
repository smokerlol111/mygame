const fs = require('node:fs');
const path = require('node:path');
const { classification, themes } = require('./classification');
const { readApproved } = require('./approved');
const SNAPSHOT = 'archive/completed-games/2026-11-22';

function loadBank(rootDir) {
  const directory = path.join(rootDir,SNAPSHOT);
  const records = JSON.parse(fs.readFileSync(path.join(directory,'question-records.json'),'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(directory,'games/index.json'),'utf8'));
  const games = new Map(metadata.map(meta=>[meta.id,{...JSON.parse(fs.readFileSync(path.join(directory,'games',meta.file),'utf8')),id:meta.id,file:meta.file}]));
  const entries = [];
  for (const record of records) {
    const game = games.get(record.gameId), theme = classification(record);
    const match = record.id.match(/:R(\d+):C(\d+):Q(\d+)$/);
    const category = match ? game.rounds[Number(match[1])-1].categories[Number(match[2])-1].name
      : ({firstTurn:'Стартове питання',final:'Фінальне питання',audience:'Глядацьке питання'})[record.kind];
    const entry = { ...record, themeId:theme.id, themeName:theme.name, category,
      difficulty:match ? Number(match[3]) : null,
      source:`${SNAPSHOT}/games/${game.file}#${record.pointer}` };
    entries.push(entry);
    if (record.payload.cat) entries.push({...entry,id:record.id+':cat',parentId:record.id,kind:'catAlternative',payload:record.payload.cat,source:entry.source+'/cat'});
    for (const [index,part] of (record.payload.triplet || []).entries())
      entries.push({...entry,id:record.id+':triplet'+(index+1),parentId:record.id,kind:'tripletPart',payload:part,source:entry.source+'/triplet/'+index});
  }
  const file=path.join(rootDir,'archive/QUESTION_BANK.md');
  const approved=readApproved(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',entries);
  return { entries:[...entries,...approved.entries], records:[...records,...approved.records], games, themes:Object.values(themes) };
}

module.exports = { loadBank, SNAPSHOT };
