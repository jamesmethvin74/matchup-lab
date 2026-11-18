const $=x=>document.getElementById(x);
let teams=[],venue='neutral',status=null;
async function json(url){const r=await fetch(url,{headers:{accept:'application/json'}});const payload=await r.json();if(!r.ok)throw new Error(payload.error||`HTTP ${r.status}`);return payload;}
function clean(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function display(t){return `${t.name}${t.mascot&&!t.name.toLowerCase().includes(t.mascot.toLowerCase())?' '+t.mascot:''}`;}
function selected(input){const value=$(input).value.trim().toLowerCase();return teams.find(t=>display(t).toLowerCase()===value)||teams.find(t=>t.name.toLowerCase()===value)||null;}
function initialTeam(fragment,input){const t=teams.find(t=>t.name.toLowerCase()===fragment)||teams.find(t=>t.school?.toLowerCase()===fragment);if(t)$(input).value=display(t);}
async function loadTeams(){const season=$('season').value;try{
  const result=await json(`/api/teams?season=${season}`);teams=result.teams;
  $('team-options').replaceChildren(...teams.map(t=>{const option=document.createElement('option');option.value=display(t);return option;}));
  if(!selected('team-a'))initialTeam('arkansas','team-a');if(!selected('team-b'))initialTeam('duke','team-b');
  $('a-hint').textContent=`${teams.length} Division I schools · ${selected('team-a')?.gamesUsed||0} rated games`;
  $('b-hint').textContent=`${teams.length} Division I schools · ${selected('team-b')?.gamesUsed||0} rated games`;
  if(!teams.length)$('empty-copy').textContent='Team catalog is not yet ingested. The site will not generate synthetic scores; configure the Cloudflare data source to enable real predictions.';
}catch(err){$('empty-copy').textContent=`Team catalog unavailable: ${err.message}`;}}
function statLine(label,a,b,format=v=>Number(v).toFixed(1)){return `<tr><td>${clean(label)}</td><td>${format(a)}</td><td>${format(b)}</td></tr>`;}
function show(r){const a=r.a,b=r.b;const winner=a.winProbability>=b.winProbability?a:b;
 const advantages=r.advantages.filter(x=>Math.abs(x.edge)>0.3).sort((x,y)=>Math.abs(y.edge)-Math.abs(x.edge)).slice(0,3);
 const max=Math.max(...r.scoreDifferenceDistribution.map(x=>x.count),1);
 const chart=r.scoreDifferenceDistribution.map(d=>`<div class="${d.margin<0?'negative':''}" style="height:${Math.max(2,100*d.count/max)}%" title="Team A margin ${d.margin} to ${d.margin+4}: ${d.count} games"></div>`).join('');
 $('results').innerHTML=`<div class="result-heading"><div><span class="eyebrow">02 / PREDICTION RESULTS</span><h2>${clean(a.name)} <span style="color:#d2a455">vs.</span> ${clean(b.name)}</h2><p>${r.iterations.toLocaleString()} simulated games · ${clean(r.venue)} site · ${clean(String(r.season-1))}–${String(r.season).slice(-2)}</p></div><span class="pill">UNVALIDATED MODEL</span></div>
 <div class="probabilities"><div class="prob"><span>${clean(a.name)}</span><strong>${(a.winProbability*100).toFixed(1)}%</strong><small>Avg. ${a.projectedScore} pts · ${a.gamesUsed} games</small></div><div class="prob"><span>${clean(b.name)}</span><strong>${(b.winProbability*100).toFixed(1)}%</strong><small>Avg. ${b.projectedScore} pts · ${b.gamesUsed} games</small></div></div>
 <div class="bar-compare"><span style="width:${(100*a.winProbability).toFixed(2)}%"></span></div><p class="reason">In this <b>experimental, not yet calibrated</b> model, ${clean(winner.name)} wins more simulated games. Opponent-adjusted efficiency, expected pace, recent box scores and historical shrinkage drive the estimate. This is not a gambling recommendation.</p>
 <div class="section-sub">TEAM COMPARISON</div><table class="stats"><thead><tr><th>METRIC</th><th>${clean(a.name)}</th><th>${clean(b.name)}</th></tr></thead><tbody>${statLine('Offense / 100 possessions',a.ratings.offRating,b.ratings.offRating)}${statLine('Defense / 100 possessions',a.ratings.defRating,b.ratings.defRating)}${statLine('Est. possessions',a.ratings.pace,b.ratings.pace)}${statLine('Effective FG%',a.ratings.efg,b.ratings.efg,v=>(100*v).toFixed(1)+'%')}${statLine('Off. rebound%',a.ratings.orbRate,b.ratings.orbRate,v=>(100*v).toFixed(1)+'%')}${statLine('Turnover%',a.ratings.turnoverRate,b.ratings.turnoverRate,v=>(100*v).toFixed(1)+'%')}${statLine('Schedule strength',a.ratings.sos,b.ratings.sos)}</tbody></table>
 <div class="section-sub">SIMULATED POINT MARGIN DISTRIBUTION</div><p class="mini">Left: Team B wins by more · Right: Team A wins by more</p><div class="distribution" role="img" aria-label="Histogram of simulated scoring margins">${chart}</div>
 <div class="section-sub">KEY MATCHUP EDGES</div><p class="reason">${advantages.length?advantages.map(x=>`${clean(x.metric)} favors ${clean(x.favors===a.teamId?a.name:b.name)} (${Math.abs(x.edge).toFixed(1)} relative units)`).join(' · '):'Ratings are closely matched.'}</p><p class="mini">Data ratings updated: ${r.dataUpdatedAt?new Date(r.dataUpdatedAt+'Z').toLocaleString():'Unknown'} · ${clean(r.modelVersion)} · seed ${r.seed} · previous-season games A/B: ${a.priorGames}/${b.priorGames}</p>`;
}
async function run(){const a=selected('team-a'),b=selected('team-b');if(!a||!b||a.id===b.id){$('empty-copy')&&($('empty-copy').textContent='Choose two distinct schools from the suggestions before running.');return;}
 $('run').disabled=true;$('run').textContent='SIMULATING…';try{const q=new URLSearchParams({season:$('season').value,a:a.id,b:b.id,venue,seed:'20271118'});show(await json(`/api/matchup?${q}`));}
 catch(e){$('results').innerHTML=`<div class="empty"><h2>Prediction unavailable</h2><p>${clean(e.message)}</p></div>`;}finally{$('run').disabled=false;$('run').innerHTML='RUN SIMULATION <span>→</span>';}}
$('venues').addEventListener('click',e=>{const button=e.target.closest('[data-venue]');if(!button)return;venue=button.dataset.venue;for(const b of $('venues').querySelectorAll('button'))b.classList.toggle('selected',b===button);});
$('switch').addEventListener('click',()=>{const a=$('team-a').value;$('team-a').value=$('team-b').value;$('team-b').value=a;});
$('run').addEventListener('click',run);$('season').addEventListener('change',()=>{ $('team-a').value='';$('team-b').value='';loadTeams();});
for(const key of ['team-a','team-b'])$(key).addEventListener('change',()=>{const t=selected(key);$(key==='team-a'?'a-hint':'b-hint').textContent=t?`${t.gamesUsed} season games available`:'Choose a team from the suggestions';});
json('/api/status').then(s=>{$('model').textContent=s.modelVersion;$('freshness').textContent=s.lastSync?`SYNC ${new Date(s.lastSync).toLocaleDateString()}`:'DATA PENDING';}).catch(()=>{$('freshness').textContent='SETUP PENDING';});
loadTeams();
