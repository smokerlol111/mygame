const fs = require('fs');
const path = require('path');
const POINTS=[10,7,5,3], usePostgres=!!process.env.DATABASE_URL;
let pool=null, fileData={seasons:[],games:[]};
const dataDir=process.env.DATA_DIR||path.join(__dirname,'data'), jsonPath=path.join(dataDir,'seasons.json');
const nowIso=()=>new Date().toISOString();
const slugId=(p='id')=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
function saveFile(){fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(jsonPath,JSON.stringify(fileData,null,2));}
async function init(){
 if(usePostgres){
  const {Pool}=require('pg'); pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='disable'?false:{rejectUnauthorized:false}});
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_seasons(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_games(id TEXT PRIMARY KEY,season_id TEXT NOT NULL REFERENCES quiz_seasons(id) ON DELETE CASCADE,room_code TEXT NOT NULL UNIQUE,game_id TEXT NOT NULL,title TEXT NOT NULL,played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),is_grand_final BOOLEAN NOT NULL DEFAULT FALSE,results JSONB NOT NULL)`);
  const {rows}=await pool.query(`SELECT COUNT(*)::int AS n FROM quiz_seasons`);if(!rows[0].n)await createSeason('Сезон 1');
 }else{
  fs.mkdirSync(dataDir,{recursive:true});if(fs.existsSync(jsonPath)){try{fileData=JSON.parse(fs.readFileSync(jsonPath,'utf8'));}catch(e){console.error(e)}}
  fileData.seasons||=[];fileData.games||=[];if(!fileData.seasons.length){fileData.seasons.push({id:slugId('season'),name:'Сезон 1',status:'active',createdAt:nowIso(),completedAt:null});saveFile();}
 }
 console.log(`Season storage: ${usePostgres?'PostgreSQL':`JSON (${jsonPath})`}`);
}
async function createSeason(name){const clean=String(name||'').trim().slice(0,80);if(!clean)throw Error('Вкажіть назву сезону.');const id=slugId('season');
 if(usePostgres)await pool.query(`INSERT INTO quiz_seasons(id,name,status) VALUES($1,$2,'active')`,[id,clean]);
 else{fileData.seasons.push({id,name:clean,status:'active',createdAt:nowIso(),completedAt:null});saveFile();}return id;}
async function listSeasons(){if(usePostgres){const {rows}=await pool.query(`SELECT id,name,status,created_at AS "createdAt",completed_at AS "completedAt" FROM quiz_seasons ORDER BY created_at DESC`);return rows;}return [...fileData.seasons].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
async function setSeasonStatus(id,status){if(!['active','completed'].includes(status))throw Error('Невірний статус.');
 if(usePostgres){const r=await pool.query(`UPDATE quiz_seasons SET status=$2,completed_at=CASE WHEN $2='completed' THEN NOW() ELSE NULL END WHERE id=$1`,[id,status]);if(!r.rowCount)throw Error('Сезон не знайдено.');}
 else{const s=fileData.seasons.find(x=>x.id===id);if(!s)throw Error('Сезон не знайдено.');s.status=status;s.completedAt=status==='completed'?nowIso():null;saveFile();}}
function normalizeResults(results){return(results||[]).slice().sort((a,b)=>b.score-a.score||String(a.name).localeCompare(String(b.name),'uk')).map((r,i)=>({playerId:r.id||r.playerId||'',name:String(r.name||'Гравець').slice(0,40),score:Number(r.score)||0,place:i+1,seasonPoints:POINTS[i]||0}));}
async function saveGame({seasonId,roomCode,gameId,title,results,isGrandFinal=false}){const normalized=normalizeResults(results);if(!seasonId)throw Error('Оберіть сезон.');if(!normalized.length)throw Error('Немає результатів.');
 const id=slugId('game');if(usePostgres){try{await pool.query(`INSERT INTO quiz_games(id,season_id,room_code,game_id,title,is_grand_final,results) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[id,seasonId,roomCode,gameId,title,!!isGrandFinal,JSON.stringify(normalized)]);}catch(e){if(e.code==='23505')throw Error('Результат цієї гри вже збережено.');throw e;}}
 else{if(fileData.games.some(g=>g.roomCode===roomCode))throw Error('Результат цієї гри вже збережено.');if(!fileData.seasons.some(s=>s.id===seasonId))throw Error('Сезон не знайдено.');fileData.games.push({id,seasonId,roomCode,gameId,title,playedAt:nowIso(),isGrandFinal:!!isGrandFinal,results:normalized});saveFile();}return id;}
async function updateGameResults(gameId,results){const normalized=normalizeResults(results);if(usePostgres){const r=await pool.query(`UPDATE quiz_games SET results=$2::jsonb WHERE id=$1`,[gameId,JSON.stringify(normalized)]);if(!r.rowCount)throw Error('Гру не знайдено.');}else{const g=fileData.games.find(x=>x.id===gameId);if(!g)throw Error('Гру не знайдено.');g.results=normalized;saveFile();}}
async function gamesForSeason(seasonId){if(usePostgres){const {rows}=await pool.query(`SELECT id,season_id AS "seasonId",room_code AS "roomCode",game_id AS "gameId",title,played_at AS "playedAt",is_grand_final AS "isGrandFinal",results FROM quiz_games WHERE season_id=$1 ORDER BY played_at DESC`,[seasonId]);return rows;}return fileData.games.filter(g=>g.seasonId===seasonId).sort((a,b)=>String(b.playedAt).localeCompare(String(a.playedAt)));}
function leaderboardFromGames(games){const m=new Map();for(const g of games)for(const r of(g.results||[])){const k=String(r.name).trim().toLocaleLowerCase('uk');let p=m.get(k);if(!p){p={name:r.name,games:0,wins:0,podiums:0,seasonPoints:0,totalGameScore:0};m.set(k,p)}p.games++;if(r.place===1)p.wins++;if(r.place<=3)p.podiums++;p.seasonPoints+=Number(r.seasonPoints)||0;p.totalGameScore+=Number(r.score)||0;}return[...m.values()].sort((a,b)=>b.seasonPoints-a.seasonPoints||b.wins-a.wins||b.podiums-a.podiums||b.totalGameScore-a.totalGameScore||a.name.localeCompare(b.name,'uk'));}
async function seasonDetails(id){const seasons=await listSeasons(),season=seasons.find(s=>s.id===id);if(!season)return null;const games=await gamesForSeason(id),leaderboard=leaderboardFromGames(games);return{...season,games,leaderboard,champion:season.status==='completed'&&games.length?leaderboard[0]||null:null};}
async function publicData(){const seasons=await listSeasons(),out=[];for(const s of seasons)out.push(await seasonDetails(s.id));return{seasons:out,points:POINTS,storage:usePostgres?'postgres':'json'};}
module.exports={init,createSeason,listSeasons,setSeasonStatus,saveGame,updateGameResults,seasonDetails,publicData,POINTS};
