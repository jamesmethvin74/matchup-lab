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
