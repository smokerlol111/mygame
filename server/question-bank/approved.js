const { themes } = require('./classification');
const START='<!-- APPROVED_QUESTION_START -->',END='<!-- APPROVED_QUESTION_END -->';
const block=/<!-- APPROVED_QUESTION_START -->\s*```json\s*([\s\S]*?)```\s*<!-- APPROVED_QUESTION_END -->/g;
const statuses=['затверджено, ще не використано','використано'];
const results=['точний повтор','схоже','суттєвих збігів не знайдено'];

function readApproved(markdown,existing=[]) {
  const section=markdown.indexOf('## Нові затверджені питання');
  if(section<0) {
    if(markdown.includes(START)||markdown.includes(END))throw new Error('Затверджені записи мають бути в розділі нових питань.');
    return {records:[],entries:[]};
  }
  const index=markdown.indexOf('<!-- QUESTION_TOPIC_INDEX_START -->',section);
  const region=markdown.slice(section,index<0?undefined:index);
  const outside=markdown.slice(0,section)+(index<0?'':markdown.slice(index));
  if(outside.includes(START)||outside.includes(END))throw new Error('Затверджені записи мають бути перед тематичним покажчиком.');
  const records=[];
  for(const match of region.matchAll(block)) {
    try { records.push(JSON.parse(match[1])); }
    catch { throw new Error('Нове затверджене питання містить невалідний JSON.'); }
  }
  const remainder=region.replace(block,'');
  if(remainder.includes(START)||remainder.includes(END)||/\*\*ID:\*\*/.test(remainder)||/```json/.test(remainder))
    throw new Error('Нові затверджені питання потрібно оформити повними блоками APPROVED_QUESTION_START/END.');
  const knownThemes=new Map(Object.values(themes).map(theme=>[theme.id,theme]));
  const ids=new Set(existing.map(entry=>entry.id)),entries=[];
  const text=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error('Заповніть '+label+'.');};
  function validate(record) {
    if(!record||typeof record!=='object')throw new Error('Невірний запис питання.');
    if(typeof record.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,99}$/.test(record.id)||ids.has(record.id))
      throw new Error('Невірний або повторний ID: '+record.id);
    ids.add(record.id);
    if(!knownThemes.has(record.themeId))throw new Error(record.id+': оберіть одну з восьми тематичних категорій.');
    text(record.category,record.id+': підкатегорію');text(record.source,record.id+': джерело або «ще не призначено»');
    if(!['main','classic','firstTurn','final','audience','tripletPart','catAlternative'].includes(record.kind))throw new Error(record.id+': невірна роль питання.');
    if(record.kind==='main'&&(!Number.isInteger(record.difficulty)||record.difficulty<1||record.difficulty>5))
      throw new Error(record.id+': основному питанню потрібен рівень 1–5.');
    if(record.difficulty!=null&&(!Number.isInteger(record.difficulty)||record.difficulty<1||record.difficulty>5))throw new Error(record.id+': невірний рівень.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(record.approvedAt||'')||!Number.isFinite(Date.parse(record.approvedAt+'T00:00:00Z'))
      ||new Date(record.approvedAt+'T00:00:00Z').toISOString().slice(0,10)!==record.approvedAt)throw new Error(record.id+': потрібна дата затвердження YYYY-MM-DD.');
    if(!statuses.includes(record.status))throw new Error(record.id+': запис має бути затвердженим; чернетки сюди не додаються.');
    const similarity=record.similarity;
    if(!similarity||!results.includes(similarity.result)||!Array.isArray(similarity.matches)||similarity.matches.some(id=>typeof id!=='string'))
      throw new Error(record.id+': потрібен результат перевірки схожості та масив ID збігів.');
    if(similarity.result==='суттєвих збігів не знайдено' ? similarity.matches.length!==0 : similarity.matches.length===0)
      throw new Error(record.id+': результат схожості не відповідає списку збігів.');
    if(similarity.matches.length)text(similarity.note,record.id+': пояснення збігів');
    if(similarity.result==='точний повтор')text(record.reuseApproval,record.id+': погодження повторного використання');
    const payload=record.payload;
    if(!payload||typeof payload!=='object')throw new Error(record.id+': потрібен payload питання.');
    for(const field of ['media','image','audio','video','answerImage','answerVideo','answerAudio','answerAudioFile']) {
      if(payload[field]!==undefined && (typeof payload[field]!=='string'||payload[field].includes('..')
        ||!(/^(\/media\/[a-zA-Z0-9_./-]+|https:\/\/[^\s"'<>]+)$/.test(payload[field]))))
        throw new Error(record.id+': невірне медіапосилання '+field);
    }
    if(['main','tripletPart'].includes(record.kind)&&(!Number.isInteger(payload.value)||payload.value<1||payload.value>10000))
      throw new Error(record.id+': потрібна базова ціна value від 1 до 10000.');
    if(record.kind==='firstTurn') {
      text(payload.question,record.id+': текст');
      if(!Number.isInteger(payload.answer)||payload.answer<0||payload.answer>1e9)throw new Error(record.id+': невірна стартова відповідь.');
    } else {
      text(payload.q,record.id+': текст');
      if(record.kind==='audience') {
        if(!Array.isArray(payload.options)||payload.options.length<2||payload.options.some(option=>typeof option!=='string'||!option.trim())
          ||!Number.isInteger(payload.correct)||payload.correct<0||payload.correct>=payload.options.length)throw new Error(record.id+': невірні варіанти глядацького питання.');
      } else if(!Array.isArray(payload.triplet)) text(payload.a,record.id+': правильну відповідь');
    }
    const entry={...record,themeName:knownThemes.get(record.themeId).name};entries.push(entry);
    if(payload.triplet) {
      if(!Array.isArray(payload.triplet)||payload.triplet.length!==3)throw new Error(record.id+': триплет містить три підпитання.');
      for(const part of payload.triplet)validate({...record,...part,kind:'tripletPart',parentId:record.id,similarity:part.similarity,payload:part});
    }
    if(payload.cat)validate({...record,...payload.cat,kind:'catAlternative',parentId:record.id,similarity:payload.cat.similarity,payload:payload.cat});
  }
  for(const record of records) {
    if(['tripletPart','catAlternative'].includes(record?.kind))throw new Error('Вкладене питання потрібно додавати у payload батьківського запису.');
    validate(record);
  }
  for(const entry of entries)for(const id of entry.similarity.matches)
    if(id===entry.id||!ids.has(id))throw new Error(entry.id+': невідомий ID збігу '+id);
  return {records,entries};
}
module.exports={readApproved};
