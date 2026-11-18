import {simulate,MODEL_VERSION} from './model.js';
import {ingest} from './ingest.js';
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const bad=(message,status=400)=>respond({error:message},status);
function validSeason(value){const s=Number(value??2027);return [2026,2027].includes(s)?s:null;}
function hydrate(row){return {teamId:row.team_id,offRating:row.off_rating,defRating:row.def_rating,pace:row.pace,efg:row.efg,orbRate:row.orb_rate,turnoverRate:row.turnover_rate,sos:row.sos,gamesUsed:row.games_used,priorGames:row.prior_games,uncertainty:1/Math.sqrt(row.games_used+(row.prior_games?10:6))};}
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
  async scheduled(_event,env,ctx){ctx.waitUntil(ingest(env).then(r=>console.log('Matchup Lab scheduled sync',JSON.stringify(r))).catch(e=>console.error('Matchup Lab sync error',String(e))));}
};