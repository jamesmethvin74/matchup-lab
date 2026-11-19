// Bounded, idempotent CBBD -> D1 importer. Only scheduled or authenticated POSTs call this.
import {buildRatings} from './model.js';
import {preparePlayerRows,savePlayerRows} from './player-ingest.js';
const BASE='https://api.collegebasketballdata.com';
const ID=id=>`cbbd:${id}`;
const str=x=>x==null?null:String(x);
const num=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const date=x=>new Date(x).toISOString();
const sevenDays=7*86400*1000;
const CURRENT_SEASON_START='2026-11-01T00:00:00.000Z';
const sqlName=x=>{if(!/^[a-z_]+$/.test(x))throw new Error('Unsafe identifier');return x;};
// JSON1 keeps statements under D1's 100-bound-parameter limit; bounded batches
// keep free-tier subrequests and payload sizes predictable.
function insertSql(db,table,columns,records,conflict,updateColumns=columns){
  const updates=updateColumns.filter(c=>!conflict.includes(c)).map(c=>`${sqlName(c)}=excluded.${sqlName(c)}`).join(',');
  const sql=`INSERT INTO ${sqlName(table)} (${columns.map(sqlName).join(',')})
    SELECT ${columns.map(c=>`json_extract(value,'$.${sqlName(c)}')`).join(',')}
    FROM json_each(?) WHERE 1=1 ON CONFLICT(${conflict.map(sqlName).join(',')}) DO ${updates?'UPDATE SET '+updates:'NOTHING'}`;
  const payload=JSON.stringify(records.map(r=>Object.fromEntries(columns.map(c=>[c,r[c]??null]))));
  return db.prepare(sql).bind(payload);
}
export async function bulkUpsert(db,table,columns,records,conflict,updateColumns=columns){
  const batch=[];
  for(let i=0;i<records.length;i+=60)batch.push(insertSql(db,table,columns,records.slice(i,i+60),conflict,updateColumns));
  for(let i=0;i<batch.length;i+=20)await db.batch(batch.slice(i,i+20));
}
async function api(key,path,params={},fetcher=fetch){
  if(!key)throw new Error('CBBD_API_KEY secret is missing');
  const url=new URL(path,BASE);
  for(const [k,v] of Object.entries(params)) if(v!=null)url.searchParams.set(k,String(v));
  for(let attempt=0;attempt<2;attempt++){
    const result=await fetcher(url.toString(),{headers:{authorization:`Bearer ${key}`,accept:'application/json'}});
    if(result.status===429)throw new Error('CBBD free quota/rate limit reached (429); sync stopped');
    if(result.status>=500&&attempt===0)continue;
    if(!result.ok)throw new Error(`CBBD ${path} returned ${result.status}`);
    const data=await result.json();if(!Array.isArray(data))throw new Error(`Unexpected CBBD ${path} response shape`);
    if(data.length>=3000)throw new Error(`CBBD ${path} result reached page limit; reduce window`);
    return data;
  }
}
export function normalizeGame(g){
  if(!Number.isInteger(num(g.id))||!Number.isInteger(num(g.homeTeamId))||!Number.isInteger(num(g.awayTeamId))||!g.startDate||!Number.isInteger(num(g.season)))throw new Error('Invalid CBBD game shape');
  return {id:ID(g.id),sport_id:'basketball-m',season:g.season,provider:'cbbd',provider_game_id:str(g.id),start_date:g.startDate,status:g.status??null,
    neutral_site:g.neutralSite?1:0,home_team_id:ID(g.homeTeamId),away_team_id:ID(g.awayTeamId),home_points:num(g.homePoints),away_points:num(g.awayPoints),venue:g.venue??null};
}
export function normalizeBox(b){
  if(!Number.isInteger(num(b.gameId))||!Number.isInteger(num(b.teamId))||!Number.isInteger(num(b.opponentId)))throw new Error('Invalid CBBD team box score shape');
  const t=b.teamStats||{};
  const attempts=t.fieldGoals||{},threes=t.threePointFieldGoals||{},free=t.freeThrows||{},reb=t.rebounds||{};
  return {game_id:ID(b.gameId),team_id:ID(b.teamId),opponent_id:ID(b.opponentId),points:num(t.points?.total),possessions:num(t.possessions),
    fgm:num(attempts.made),fga:num(attempts.attempted),tpm:num(threes.made),tpa:num(threes.attempted),ftm:num(free.made),fta:num(free.attempted),
    offensive_rebounds:num(reb.offensive),defensive_rebounds:num(reb.defensive),turnovers:num(t.turnovers?.total),assists:num(t.assists),steals:num(t.steals),blocks:num(t.blocks),source:'cbbd'};
}
const teamCols=['id','sport_id','name','school','mascot','abbreviation','conference','di_status'];
const gameCols=['id','sport_id','season','provider','provider_game_id','start_date','status','neutral_site','home_team_id','away_team_id','home_points','away_points','venue'];
const boxCols=['game_id','team_id','opponent_id','points','possessions','fgm','fga','tpm','tpa','ftm','fta','offensive_rebounds','defensive_rebounds','turnovers','assists','steals','blocks','source'];
const syncCols=['source','season','cursor','last_success_at','last_error'];
function namesFromGames(games){const unique=new Map();for(const g of games){for(const side of ['home','away']){const tid=g[side+'TeamId'],name=g[side+'Team'];if(tid==null||!name)continue;unique.set(ID(tid),{id:ID(tid),sport_id:'basketball-m',name,school:name,mascot:null,abbreviation:null,conference:g[side+'Conference']??null,di_status:0});}}return [...unique.values()];}
async function catalog(env,fetcher){
  const state=await env.DB.prepare("SELECT last_success_at FROM sync_state WHERE source='cbbd-teams' AND season=2027").first();
  if(state?.last_success_at && Date.now()-Date.parse(state.last_success_at)<7*sevenDays/7)return 0;
  const teams=await api(env.CBBD_API_KEY,'/teams',{},fetcher);
  const rows=teams.filter(t=>t.id!=null&&t.school).map(t=>({id:ID(t.id),sport_id:'basketball-m',name:t.displayName||t.school,school:t.school,mascot:t.mascot??null,abbreviation:t.abbreviation??null,conference:t.conference??null,di_status:1}));
  if(rows.length<100)throw new Error('Team catalog unexpectedly small; refusing to mark team IDs');
  await bulkUpsert(env.DB,'teams',teamCols,rows,['id'],['name','school','mascot','abbreviation','conference','di_status']);
  await bulkUpsert(env.DB,'provider_ids',['provider','entity_type','provider_id','canonical_id'],rows.map(r=>({provider:'cbbd',entity_type:'team',provider_id:r.id.slice(5),canonical_id:r.id})),['provider','entity_type','provider_id']);
  await bulkUpsert(env.DB,'sync_state',syncCols,[{source:'cbbd-teams',season:2027,cursor:'complete',last_success_at:new Date().toISOString(),last_error:null}],['source','season']);
  return rows.length;
}
async function syncSeason(env,season,fetcher,override=null){
  const source=override?.source??'cbbd-window';
  const state=await env.DB.prepare('SELECT cursor FROM sync_state WHERE source=? AND season=?').bind(source,season).first();
  const start=override?.start??(season===2026?'2025-10-01T00:00:00.000Z':'2026-10-01T00:00:00.000Z');
  const bound=override?.end??(season===2026?'2026-07-01T00:00:00.000Z':new Date().toISOString());
  let cursor=state?.cursor??start;
  // Prioritize 2026-27 regular season: Nov 1 was the verified season opener.
  // Older 2027 preseason cursor positions are safely fast-forwarded.
  if(season===2027 && Date.parse(cursor)<Date.parse(CURRENT_SEASON_START))cursor=CURRENT_SEASON_START;
  if(Date.parse(cursor)>=Date.parse(bound)){
    if(season===2026||override)return {season,complete:true,games:0,boxes:0};
    cursor=new Date(Date.now()-sevenDays).toISOString(); // rescan last week for corrections
  }
  const next=new Date(Math.min(Date.parse(cursor)+sevenDays,Date.parse(bound))).toISOString();
  if(Date.parse(next)<=Date.parse(cursor))return {season,complete:true,games:0,boxes:0};
  const filter={season,startDateRange:cursor,endDateRange:next};
  // Source endpoints return at most 3,000 records: weekly slices avoid truncation.
  const games=await api(env.CBBD_API_KEY,'/games',filter,fetcher);
  const boxes=await api(env.CBBD_API_KEY,'/games/teams',filter,fetcher);
  const validatedGames=games.map(normalizeGame);
  const ids=new Set(validatedGames.map(g=>g.id));
  const stats=boxes.map(normalizeBox).filter(b=>ids.has(b.game_id));
  const teams=namesFromGames(games);
  await bulkUpsert(env.DB,'teams',teamCols,teams,['id'],['name','school','conference']);
  await bulkUpsert(env.DB,'provider_ids',['provider','entity_type','provider_id','canonical_id'],validatedGames.map(g=>({provider:'cbbd',entity_type:'game',provider_id:g.provider_game_id,canonical_id:g.id})),['provider','entity_type','provider_id']);
  await bulkUpsert(env.DB,'games',gameCols,validatedGames,['provider','provider_game_id']);
  await bulkUpsert(env.DB,'game_team_stats',boxCols,stats,['game_id','team_id']);
  await bulkUpsert(env.DB,'sync_state',syncCols,[{source,season,cursor:next,last_success_at:new Date().toISOString(),last_error:null}],['source','season']);
  return {season,complete:false,games:games.length,boxes:stats.length,from:cursor,to:next};
}
// Player history has a separate daily cursor; it never advances until every validated
// player in the bounded slice has been written. It skips cleanly until migration 0002.
export async function syncPlayers(env,season,fetcher=fetch,override=null){
  const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_game_stats'").first();
  if(!table)return {season,skipped:'Apply migration 0002_player_coach_history.sql'};
  const source=override?.source??'cbbd-players';
  const state=await env.DB.prepare('SELECT cursor FROM sync_state WHERE source=? AND season=?').bind(source,season).first();
  const start=override?.start??(season===2026?'2025-10-01T00:00:00.000Z':'2026-10-01T00:00:00.000Z');
  const bound=override?.end??(season===2026?'2026-07-01T00:00:00.000Z':new Date().toISOString());
  let cursor=state?.cursor??start;
  // Prioritize 2026-27 regular season: Nov 1 was the verified season opener.
  // Older 2027 preseason cursor positions are safely fast-forwarded.
  if(season===2027 && Date.parse(cursor)<Date.parse(CURRENT_SEASON_START))cursor=CURRENT_SEASON_START;
  if(Date.parse(cursor)>=Date.parse(bound)){
    if(season===2026||override)return {season,complete:true,playerGames:0};
    // Only corrections in the last week once historical catch-up is complete.
    cursor=new Date(Date.now()-sevenDays).toISOString();
  }
  // One-day player slices protect D1 free daily write budgets and CBBD's 1,000-game limit.
  const next=new Date(Math.min(Date.parse(cursor)+(override?.spanDays??1)*86400000,Date.parse(bound))).toISOString();
  if(Date.parse(next)<=Date.parse(cursor))return {season,complete:true,playerGames:0};
  const filter={season,startDateRange:cursor,endDateRange:next};
  const boxes=await api(env.CBBD_API_KEY,'/games/players',filter,fetcher);
  // Endpoint counts games, not player rows. Fail closed if it might have truncated.
  const gamesFromSource=new Set(boxes.map(x=>x.gameId));
  if(gamesFromSource.size>=1000)throw new Error('CBBD player game limit reached; reduce player window');
  const found=await env.DB.prepare('SELECT id FROM games WHERE season=? AND start_date>=? AND start_date<? LIMIT 2000').bind(season,cursor,next).all();
  const ids=new Set(found.results.map(g=>g.id));
  const rows=preparePlayerRows(boxes,ids);
  if(rows.stats.length>12000)throw new Error('Too many player records for a free-tier daily sync; shorten window');
  const counts=await savePlayerRows(env.DB,rows);
  await bulkUpsert(env.DB,'sync_state',syncCols,[{source,season,cursor:next,last_success_at:new Date().toISOString(),last_error:null}],['source','season']);
  return {season,from:cursor,to:next,teamBoxes:rows.teamBoxes,...counts};
}

export async function rebuildRatings(db){
  const query=`SELECT g.season,g.start_date AS date,s.team_id AS teamId,s.opponent_id AS opponentId,
    s.points,s.possessions,op.points AS opponentPoints,s.fgm,s.fga,s.tpm,s.offensive_rebounds AS offRebounds,
    op.defensive_rebounds AS oppDefRebounds,s.turnovers
    FROM game_team_stats s JOIN games g ON g.id=s.game_id
    JOIN game_team_stats op ON op.game_id=s.game_id AND op.team_id=s.opponent_id
    WHERE g.season IN (2026,2027) AND g.home_points IS NOT NULL AND g.away_points IS NOT NULL`;
  const {results}=await db.prepare(query).all();
  const prev=buildRatings(results,2026);const curr=buildRatings(results,2027,prev);
  const rows=[...prev.values(),...curr.values()].map(r=>({sport_id:'basketball-m',season:r.season,team_id:r.teamId,off_rating:r.offRating,def_rating:r.defRating,pace:r.pace,efg:r.efg,orb_rate:r.orbRate,turnover_rate:r.turnoverRate,sos:r.sos,games_used:r.gamesUsed,prior_games:r.priorGames}));
  await bulkUpsert(db,'team_ratings',['sport_id','season','team_id','off_rating','def_rating','pace','efg','orb_rate','turnover_rate','sos','games_used','prior_games'],rows,['sport_id','season','team_id']);
  return {ratings:rows.length,completedGameRows:results.length};
}
// Authorized only by a one-time, server-side Cron Trigger; no public write endpoint.
// Seeds the actual current-season window without fast-forwarding historical cursors.
export async function bootstrapIngest(env,{fetcher=fetch}={}){
  if(!env?.DB||!env?.CBBD_API_KEY)throw new Error('Missing D1 database binding or CBBD_API_KEY secret');
  const end=new Date().toISOString();
  const start=new Date(Date.parse(end)-4*86400000).toISOString();
  const teamsUpdated=await catalog(env,fetcher);
  const games=await syncSeason(env,2027,fetcher,{start,end,source:'cbbd-bootstrap-games'});
  const ratings=await rebuildRatings(env.DB);
  const players=await syncPlayers(env,2027,fetcher,{start,end,spanDays:4,source:'cbbd-bootstrap-players'});
  return {teamsUpdated,games,players,ratings,windowStart:start,windowEnd:end};
}

export async function ingest(env,{fetcher=fetch,playerDays=1}={}){
  if(!Number.isInteger(playerDays)||playerDays<1||playerDays>4)throw new Error('Player ingest window must be 1–4 days');
  if(!env?.DB)throw new Error('D1 DB binding required');
  if(!env?.CBBD_API_KEY)throw new Error('Set CBBD_API_KEY as a Cloudflare Worker secret');
  const teams=await catalog(env,fetcher);
  const seasons=[];
  for(const s of [2027])seasons.push(await syncSeason(env,s,fetcher));
  const ratings=await rebuildRatings(env.DB);
  const playerSeasons=[];
  for(const s of [2027]){
    try{playerSeasons.push(await syncPlayers(env,s,fetcher,playerDays===1?null:{spanDays:playerDays}));}
    catch(error){console.error('Matchup Lab player ingestion error',s,error);playerSeasons.push({season:s,error:String(error)});}
  }
  return {teamsUpdated:teams,seasons,playerSeasons,...ratings,ingestedAt:new Date().toISOString()};
}