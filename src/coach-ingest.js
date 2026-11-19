import {CURRENT_COACH_ROWS} from './coaches-2027-data.js';
import {bulkUpsert} from './ingest.js';
// Public factual head-coach directory; never derive uncalibrated coaching bonuses.
export const COACH_DIRECTORY_URL="https://en.wikipedia.org/wiki/List_of_current_NCAA_Division_I_men%27s_basketball_coaches";
export const normalizeTeamLabel=value=>String(value??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&amp;/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
function plain(html){
  return html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi,'').replace(/<[^>]*>/g,'')
    .replace(/&amp;/gi,'&').replace(/&nbsp;|&#160;/gi,' ').replace(/&apos;|&#39;|&#x27;/gi,"'")
    .replace(/&ndash;|&#8211;/gi,'–').replace(/&mdash;|&#8212;/gi,'—')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/\s+/g,' ').trim();
}
export function parsePublishedCoaches(html){
  if(typeof html!=='string'||html.length<1000)throw new Error('Coach HTML is unexpectedly short');
  const table=html.match(/<table\b[^>]*class="[^"]*wikitable[^"]*"[^>]*>[\s\S]*?<\/table>/i)?.[0];
  if(!table)throw new Error('Expected NCAA head-coach table missing');
  const rows=[],teams=new Set();
  for(const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>plain(x[1]));
    if(cells.length<4)continue;
    const [team,conference,coach,since]=cells;
    if(!team||!coach||!since||/vacant|to be determined|interim vacant/i.test(coach))continue;
    const normalized=normalizeTeamLabel(team);
    if(teams.has(normalized))throw new Error('Duplicate published head-coach team '+team);
    teams.add(normalized);
    rows.push({team,conference,coach,since});
  }
  if(rows.length<300||rows.length>450)throw new Error('Unexpected published head-coach coverage: '+rows.length);
  return rows;
}

export function matchCurrentCoaches(rows,teams){
  const assigned=new Set(),matched=[];
  for(const row of rows){
    const wiki=normalizeTeamLabel(row.team);
    let candidates=teams.filter(t=>normalizeTeamLabel(t.name)===wiki||
      (t.mascot&&normalizeTeamLabel(t.school+' '+t.mascot)===wiki));
    if(candidates.length!==1){
      const prefixes=teams.map(t=>({t,school:normalizeTeamLabel(t.school)}))
        .filter(x=>x.school&&(wiki===x.school||wiki.startsWith(x.school+' ')));
      const longest=Math.max(0,...prefixes.map(x=>x.school.length));
      candidates=prefixes.filter(x=>x.school.length===longest).map(x=>x.t);
    }
    if(candidates.length!==1||assigned.has(candidates[0].id))continue;
    assigned.add(candidates[0].id);
    matched.push({...row,teamId:candidates[0].id});
  }
  return matched;
}
export async function syncCurrentCoaches(env){
  const directory=await env.DB.prepare("SELECT cursor FROM sync_state WHERE source='cbbd-di-directory' AND season=2027").first();
  if(directory?.cursor!=='complete')return {skipped:'D-I team directory not yet ready'};
  const source='wikipedia-coaches-2027';
  const state=await env.DB.prepare('SELECT cursor FROM sync_state WHERE source=? AND season=2027').bind(source).first();
  if(state?.cursor==='complete')return {complete:true};
  const {results:teams}=await env.DB.prepare("SELECT id,name,school,mascot FROM teams WHERE sport_id='basketball-m' AND di_status=1").all();
  const matched=matchCurrentCoaches(CURRENT_COACH_ROWS,teams);
  if(matched.length<250)throw new Error('Too few unambiguous NCAA coaching assignments: '+matched.length+'/'+teams.length);
  const coaches=new Map(),tenures=[];
  for(const row of matched){
    const id='wiki:coach:'+normalizeTeamLabel(row.coach).replace(/\s+/g,'-');
    coaches.set(id,{id,full_name:row.coach,source:'wikipedia:2026-27',provider_coach_id:null});
    tenures.push({coach_id:id,team_id:row.teamId,season:2027,role:'Head Coach',source:'wikipedia:2026-27'});
  }
  await bulkUpsert(env.DB,'coaches',['id','full_name','source','provider_coach_id'],[...coaches.values()],['id'],['full_name','source']);
  await bulkUpsert(env.DB,'coach_team_seasons',['coach_id','team_id','season','role','source'],tenures,['coach_id','team_id','season','role'],['source']);
  await bulkUpsert(env.DB,'sync_state',['source','season','cursor','last_success_at','last_error'],
    [{source,season:2027,cursor:'complete',last_success_at:new Date().toISOString(),last_error:null}],['source','season']);
  return {coaches:coaches.size,assignments:tenures.length,unmatched:CURRENT_COACH_ROWS.length-matched.length};
}
