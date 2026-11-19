import {simulate,MODEL_VERSION} from './model.js';
import {ingest,bootstrapIngest,syncCurrentRosterBatch,syncCurrentDirectory} from './ingest.js';
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const bad=(message,status=400)=>respond({error:message},status);
function validSeason(value){const s=Number(value??2027);return [2026,2027].includes(s)?s:null;}
function hydrate(row){return {teamId:row.team_id,offRating:row.off_rating,defRating:row.def_rating,pace:row.pace,efg:row.efg,orbRate:row.orb_rate,turnoverRate:row.turnover_rate,sos:row.sos,gamesUsed:row.games_used,priorGames:row.prior_games,uncertainty:1/Math.sqrt(row.games_used+(row.prior_games?10:6))};}
const BACKFILL_CRON='2-57/5 * * * *';
const BACKFILL_SOURCE='cbbd-accelerated-backfill';
const EIGHT_HOURS_MS=8*3600*1000;
const CURSOR_SOURCES=new Set(['cbbd-window','cbbd-players']);
async function accelerateBackfill(env){
  if(!env?.DB || !env?.CBBD_API_KEY){
    console.error('Accelerated backfill paused: production DB or CBBD_API_KEY is missing');
    return;
  }
  // Current-season only: no need to finish 2025-26 to use today's rosters.
  const {results}=await env.DB.prepare(
    "SELECT source,season,cursor FROM sync_state WHERE source IN ('cbbd-window','cbbd-players') AND season=2027"
  ).all();
  const cursors=new Map(results.filter(x=>CURSOR_SOURCES.has(x.source)).map(x=>[x.source,Date.parse(x.cursor)]));
  const currentDataCutoff=Date.now()-86400000;
  const allCaughtUp=[...CURSOR_SOURCES].every(source=>(cursors.get(source)??0)>=currentDataCutoff);
  if(allCaughtUp)return;
  // One run at most every eight hours, even on errors or Worker retries.
  const now=new Date().toISOString();
  const cutoff=new Date(Date.now()-EIGHT_HOURS_MS).toISOString();
  const claim=await env.DB.prepare(
    "INSERT INTO sync_state(source,season,cursor,last_success_at,last_error) VALUES(?,2027,?,NULL,NULL) ON CONFLICT(source,season) DO UPDATE SET cursor=excluded.cursor,last_error=NULL WHERE sync_state.cursor<?"
  ).bind(BACKFILL_SOURCE,now,cutoff).run();
  if(claim.meta?.changes!==1)return;
  try {
    const result=await ingest(env,{playerDays:4});
    const errors=result.playerSeasons.filter(entry=>entry.error);
    if(errors.length)throw new Error('Player sync errors: '+errors.map(e=>e.season+' '+e.error).join('; ').slice(0,350));
    await env.DB.prepare(
      "UPDATE sync_state SET last_success_at=?,last_error=NULL WHERE source=? AND season=2027"
    ).bind(new Date().toISOString(),BACKFILL_SOURCE).run();
    console.log('Matchup Lab accelerated backfill',JSON.stringify({
      teamsUpdated:result.teamsUpdated,seasons:result.seasons,playerSeasons:result.playerSeasons,
      ratings:result.ratings
    }));
  }catch(error){
    const message=String(error?.message||error).slice(0,450);
    console.error('Matchup Lab accelerated backfill failure',message);
    await env.DB.prepare(
      "UPDATE sync_state SET last_error=? WHERE source=? AND season=2027"
    ).bind(message,BACKFILL_SOURCE).run();
  }
}
async function router(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/health'&&request.method==='GET')return respond({ok:true,app:'Matchup Lab',modelVersion:MODEL_VERSION});
  if(!env.DB)return bad('Database is not configured',503);
  if(path==='/api/status'&&request.method==='GET'){
    const [teams,games,ratings,last,hasPlayers]=await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM teams WHERE di_status=1').first(),
      env.DB.prepare('SELECT season,COUNT(*) AS n FROM games GROUP BY season').all(),
      env.DB.prepare('SELECT season,COUNT(*) AS n FROM team_ratings GROUP BY season').all(),
      env.DB.prepare('SELECT MAX(last_success_at) AS last FROM sync_state').first(),
      env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_game_stats'").first()
    ]);
    const playerData=hasPlayers?await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM players').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM player_game_stats').first(),
      env.DB.prepare("SELECT season, cursor, last_success_at AS lastSync FROM sync_state WHERE source='cbbd-players' ORDER BY season").all()
    ]):null;
    return respond({teams:teams.n,games:games.results,ratings:ratings.results,lastSync:last.last,
      players:playerData?.[0].n??null,playerGameStats:playerData?.[1].n??null,
      playerSync:playerData?.[2].results??[],playerSchemaReady:!!hasPlayers,
      upstreamConfigured:!!env.CBBD_API_KEY,
      currentRoster: await env.DB.prepare("SELECT cursor,last_success_at AS lastSync,last_error AS error FROM sync_state WHERE source='cbbd-2027-roster' AND season=2027").first(),
      backfillProgress: (await env.DB.prepare("SELECT source,season,cursor,last_success_at AS lastSync FROM sync_state WHERE source IN ('cbbd-window','cbbd-players') ORDER BY source,season").all()).results,
      immediateCurrent: await env.DB.prepare("SELECT cursor AS state,last_success_at AS completedAt,last_error AS error FROM sync_state WHERE source='cbbd-2027-immediate-once-20261119' AND season=2027").first(),
      backfill: await env.DB.prepare("SELECT cursor AS lastAttemptAt,last_success_at AS lastSuccessAt,last_error AS lastError FROM sync_state WHERE source='cbbd-accelerated-backfill' AND season=2027").first(),
      bootstrap: await env.DB.prepare("SELECT cursor AS state,last_success_at AS completedAt,last_error AS error FROM sync_state WHERE source='cbbd-bootstrap-once-20261118' AND season=2027").first(),
      modelVersion:MODEL_VERSION,calibrated:false});
  }
  if(path==='/api/teams'&&request.method==='GET'){
    const season=validSeason(url.searchParams.get('season'));if(!season)return bad('Invalid season');
    const {results}=await env.DB.prepare(`SELECT t.id,t.name,t.school,t.mascot,t.abbreviation,t.conference,
      COALESCE(r.games_used,0) AS gamesUsed FROM teams t LEFT JOIN team_ratings r
      ON t.id=r.team_id AND r.season=? WHERE t.sport_id='basketball-m' AND t.di_status=1
      ORDER BY t.name LIMIT 500`).bind(season).all();
    return respond({season,teams:results});
  }
  if(path==='/api/matchup'&&request.method==='GET'){
    const season=validSeason(url.searchParams.get('season'));
    const a=url.searchParams.get('a'),b=url.searchParams.get('b');
    const venue=url.searchParams.get('venue')??'neutral';
    const seed=Number(url.searchParams.get('seed')??20271118);
    if(!season||!a||!b||a===b||!['neutral','home','away'].includes(venue)||!Number.isSafeInteger(seed)||seed<0)return bad('Select two different teams, a supported season, and valid venue/seed');
    const {results}=await env.DB.prepare(`SELECT r.*,t.name,t.conference FROM team_ratings r
      JOIN teams t ON t.id=r.team_id AND t.di_status=1
      WHERE r.sport_id='basketball-m' AND r.season=? AND r.team_id IN (?,?)`).bind(season,a,b).all();
    const first=results.find(r=>r.team_id===a),second=results.find(r=>r.team_id===b);
    if(!first||!second)return bad('Insufficient verified game statistics for one or both teams. No prediction is available yet.',422);
    const outcome=simulate(hydrate(first),hydrate(second),{iterations:10000,venue,seed});
    outcome.a.name=first.name;outcome.b.name=second.name;
    outcome.season=season;outcome.dataUpdatedAt=[first.updated_at,second.updated_at].filter(Boolean).sort().at(0)??null;
    return respond(outcome);
  }
  if(path==='/api/admin/ingest'&&request.method==='POST'){
    if(!env.INGEST_TOKEN)return bad('INGEST_TOKEN secret not configured',503);
    if(request.headers.get('authorization')!==`Bearer ${env.INGEST_TOKEN}`)return bad('Unauthorized',401);
    return respond(await ingest(env));
  }
  if(path.startsWith('/api/'))return bad('Route not found',404);
  return bad('Not found',404);
}
export default {
  async fetch(request,env){try{return await router(request,env);}catch(e){console.error('Matchup Lab error:',e);return bad('Request failed. See Worker logs for details.',500);}},
  async scheduled(event,env,ctx){
    if(event.cron==='* * 19 11 *'){
      ctx.waitUntil((async()=>{
        const source='cbbd-2027-immediate-once-20261119';
        if(!env?.DB||!env?.CBBD_API_KEY)return;
        const claim=await env.DB.prepare("INSERT OR IGNORE INTO sync_state(source,season,cursor) VALUES(?,2027,'running')").bind(source).run();
        if(claim.meta?.changes!==1)return;
        try{
          const result=await ingest(env,{playerDays:4});
          const failures=result.playerSeasons.filter(x=>x.error);
          if(failures.length)throw new Error('Player box sync: '+failures.map(x=>x.error).join('; ').slice(0,350));
          await env.DB.prepare("UPDATE sync_state SET cursor='complete',last_success_at=?,last_error=NULL WHERE source=? AND season=2027").bind(new Date().toISOString(),source).run();
          console.log('2026-27 immediate ingestion complete',JSON.stringify(result));
        }catch(error){
          console.error('2026-27 immediate ingestion failed',String(error));
          await env.DB.prepare("UPDATE sync_state SET cursor='failed',last_error=? WHERE source=? AND season=2027").bind(String(error).slice(0,450),source).run();
        }
      })());
      return;
    }
    if(event.cron===BACKFILL_CRON){
      ctx.waitUntil((async()=>{
        try{await syncCurrentDirectory(env);}
        catch(error){console.error('2027 D-I directory sync failed',String(error));}
        try{console.log('2027 roster collection',JSON.stringify(await syncCurrentRosterBatch(env)));}
        catch(error){console.error('2027 roster collection failed',String(error));}
        await accelerateBackfill(env);
      })());
      return;
    }
    if(event.cron==='* * 18 11 *'){
      ctx.waitUntil((async()=>{
        const source='cbbd-bootstrap-once-20261118';
        // Preserve the one-shot guard. A missing key may be corrected in Worker
        // settings without manual D1 edits; other failures remain blocked.
        if(!env.CBBD_API_KEY){
          console.error('Matchup Lab bootstrap paused: CBBD_API_KEY secret is not present on the deployed Worker');
          return;
        }
        const claim=await env.DB.prepare(`INSERT INTO sync_state(source,season,cursor,last_error)
          VALUES(?,2027,'running',NULL)
          ON CONFLICT(source,season) DO UPDATE SET cursor='running',last_error=NULL
          WHERE sync_state.cursor='failed' AND sync_state.last_error LIKE '%CBBD_API_KEY secret%'`).bind(source).run();
        if(claim.meta?.changes!==1)return;
        try{
          const result=await bootstrapIngest(env);
          await env.DB.prepare("UPDATE sync_state SET cursor='complete',last_success_at=?,last_error=NULL WHERE source=? AND season=2027").bind(new Date().toISOString(),source).run();
          console.log('Matchup Lab one-time bootstrap completed',JSON.stringify(result));
        }catch(e){
          console.error('Matchup Lab one-time bootstrap failed',String(e));
          await env.DB.prepare("UPDATE sync_state SET cursor='failed',last_error=? WHERE source=? AND season=2027").bind(String(e).slice(0,500),source).run();
        }
      })());
      return;
    }
    ctx.waitUntil(ingest(env).then(r=>console.log('Matchup Lab scheduled sync',JSON.stringify(r))).catch(e=>console.error('Matchup Lab sync error',String(e))));
  }
};