// Synthetic records exist only in memory or a disposable copy, never the working bank.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {readApproved}=require('../../server/question-bank/approved');
const {loadBank,SNAPSHOT}=require('../../server/question-bank/catalog');
const {renderIndex}=require('../../scripts/build-question-topic-index');
const {createRandomPool}=require('../../server/modes/classic/random-pool');
const {candidates,options}=require('../../server/modes/board/random-generator');
const {REPO_ROOT}=require('./lib/server');
const heading='## Нові затверджені питання\n';
const block=record=>'<!-- APPROVED_QUESTION_START -->\n```json\n'+JSON.stringify(record,null,2)+'\n```\n<!-- APPROVED_QUESTION_END -->\n';
const sample=(id='new-fixture')=>({id,themeId:'science',category:'FIXTURE SUBCATEGORY',difficulty:3,kind:'main',
  approvedAt:'2026-11-22',status:'затверджено, ще не використано',source:'ще не призначено',
  similarity:{result:'суттєвих збігів не знайдено',matches:[]},payload:{q:'FIXTURE PROMPT '+id,a:'FIXTURE ANSWER '+id,value:300,type:'text'}});
function main() {
  const actual=loadBank(REPO_ROOT),valid=sample();
  assert.equal(readApproved(heading+block(valid),actual.entries).entries[0].themeName,'Наука та природа');
  for(const change of [{themeId:undefined},{themeId:'surprise'},{category:''},{difficulty:undefined},{difficulty:6},
    {id:actual.entries[0].id},{status:'чернетка'},{approvedAt:'2026-02-30'},{source:''},
    {similarity:{result:'схоже',matches:[]}},{similarity:{result:'точний повтор',matches:[actual.entries[0].id],note:'fixture'}},
    {payload:{q:'FIXTURE',a:'FIXTURE'}},{similarity:{result:'схоже',matches:['unknown-id'],note:'fixture'}}])
    assert.throws(()=>readApproved(heading+block({...valid,...change}),actual.entries));
  assert.throws(()=>readApproved(heading+block(valid)+block(valid),actual.entries));
  assert.throws(()=>readApproved(heading+'<!-- APPROVED_QUESTION_START -->\n```json\n{}',actual.entries));
  assert.throws(()=>readApproved(heading+'```json\n'+JSON.stringify(valid)+'\n```',actual.entries));
  assert.throws(()=>readApproved(heading+'<!-- QUESTION_TOPIC_INDEX_START -->\n'+block(valid),actual.entries));
  const repeated={...valid,similarity:{result:'точний повтор',matches:[actual.entries[0].id],note:'FIXTURE EXPLANATION'},reuseApproval:'FIXTURE OWNER APPROVAL'};
  assert.equal(readApproved(heading+block(repeated),actual.entries).entries.length,1);
  const triplet=sample('fixture-triplet');triplet.payload={type:'triplet',q:'FIXTURE TRIPLET',a:'',value:300,
    triplet:[1,2,3].map(n=>({id:'fixture-part-'+n,themeId:n===2?'logic':'science',q:'FIXTURE PART '+n,a:'FIXTURE ANSWER',value:100*n,similarity:valid.similarity}))};
  const nested=readApproved(heading+block(triplet),actual.entries).entries;
  assert.equal(nested.length,4);assert.equal(nested[2].themeId,'logic');
  assert.throws(()=>readApproved(heading+block({...triplet,payload:{...triplet.payload,triplet:[triplet.payload.triplet[0]]}}),actual.entries));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'smokerlol-approved-bank-'));
  try {
    const snapshot=path.join(temp,SNAPSHOT);fs.mkdirSync(snapshot,{recursive:true});
    for(const file of ['question-records.json','QUESTION_BANK.md'])fs.copyFileSync(path.join(REPO_ROOT,SNAPSHOT,file),path.join(snapshot,file));
    fs.cpSync(path.join(REPO_ROOT,SNAPSHOT,'games'),path.join(snapshot,'games'),{recursive:true});
    const snapshotBank=loadBank(temp);
    const classic={...sample('fixture-classic'),kind:'classic',difficulty:null};
    const markdown=fs.readFileSync(path.join(snapshot,'QUESTION_BANK.md'),'utf8')+'\n'+heading+'### Наука та природа\n'+block(valid)+block(classic);
    fs.writeFileSync(path.join(temp,'archive/QUESTION_BANK.md'),markdown);
    const merged=loadBank(temp);
    assert.equal(merged.entries.length,542);assert.equal(merged.records.length,518);
    assert.ok(candidates(merged).some(entry=>entry.id===valid.id));
    assert.equal(options(merged).find(theme=>theme.id==='science').levels[2],options(snapshotBank).find(theme=>theme.id==='science').levels[2]+1);
    assert.equal(candidates(merged).some(entry=>entry.id===classic.id),false,'classic-only entries do not enter the board');
    const text=renderIndex(temp);assert.ok(text.includes('`'+valid.id+'`'));assert.ok(text.includes('`'+classic.id+'`'));
    const random=createRandomPool(temp,273,n=>n-1);assert.equal(random.available,273);
    assert.ok(random.pool.questions.some(question=>question.id===valid.id));assert.ok(random.pool.questions.some(question=>question.id===classic.id));
    assert.equal(fs.readFileSync(path.join(temp,'archive/QUESTION_BANK.md'),'utf8'),markdown,'reading changes no bank data');
  } finally {
    const resolved=path.resolve(temp);
    if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('smokerlol-approved-bank-'))fs.rmSync(resolved,{recursive:true,force:true});
  }
  console.log('PASS: required themes/subcategories/levels, unique IDs, approval metadata, similarity references and reuse approval; nested themes; new entries in topic index and compatible random pools; immutable sources');
}
try{main();}catch(error){console.error(error);process.exitCode=1;}
