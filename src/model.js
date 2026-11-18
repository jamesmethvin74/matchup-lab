// Matchup Lab model v0.1: opponent adjusted per-possession ratings + historical shrinkage.
// All inputs must originate in persisted, completed box scores. No demo predictions.
export const MODEL_VERSION = '0.1.0-uncalibrated';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const numeric=x=>x===null||x===undefined?null:Number.isFinite(Number(x))?Number(x):null;
export function mulberry32(seed){let t=seed>>>0;return()=>{t+=0x6D2B79F5;let x=t;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return((x^(x>>>14))>>>0)/4294967296;};}
function normal(rand){const u=Math.max(1e-12,rand());return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rand());}
const average=(xs,fallback)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:fallback;
export function buildRatings(rows,season,previous=new Map(),asOf=Infinity){
  const usable=rows.filter(r=>Number(r.season)===Number(season)&&String(r.date||'')<String(asOf) && numeric(r.points)!==null && numeric(r.possessions)>35 && numeric(r.opponentPoints)!==null);
  const leagueOff=average(usable.map(r=>100*Number(r.points)/Number(r.possessions)),102);
  const leaguePace=average(usable.map(r=>Number(r.possessions)),69);
  const byTeam=new Map();for(const r of usable){const k=String(r.teamId);if(!byTeam.has(k))byTeam.set(k,[]);byTeam.get(k).push(r);}
  const initial=new Map();
  for(const [id,games] of byTeam){
    const previousRating=previous.get(id);
    // A full previous year contributes approximately 10 equivalent games early this season.
    const priorWeight=previousRating?.gamesUsed>0?10:6;
    const priorOff=previousRating?.offRating??leagueOff,priorDef=previousRating?.defRating??leagueOff;
    const observedOff=average(games.map(g=>100*g.points/g.possessions),leagueOff);
    const observedDef=average(games.map(g=>100*g.opponentPoints/g.possessions),leagueOff);
    const priorPace=previousRating?.pace??leaguePace;
    const mean=(key,fallback)=>average(games.map(key).filter(Number.isFinite),fallback);
    const observedEfg=mean(g=>g.fga>0?(g.fgm+0.5*(g.tpm??0))/g.fga:null,0.49);
    const observedOrb=mean(g=>g.offRebounds!=null&&g.oppDefRebounds!=null&&g.offRebounds+g.oppDefRebounds>0?g.offRebounds/(g.offRebounds+g.oppDefRebounds):null,0.29);
    const observedTov=mean(g=>g.turnovers!=null?g.turnovers/g.possessions:null,0.18);
    initial.set(id,{teamId:id,season:Number(season),gamesUsed:games.length,priorGames:previousRating?.gamesUsed??0,
      offRating:(observedOff*games.length+priorOff*priorWeight)/(games.length+priorWeight),
      defRating:(observedDef*games.length+priorDef*priorWeight)/(games.length+priorWeight),
      pace:(mean(g=>g.possessions,leaguePace)*games.length+priorPace*priorWeight)/(games.length+priorWeight),
      efg:observedEfg,orbRate:observedOrb,turnoverRate:observedTov,sos:0,uncertainty:clamp(1/Math.sqrt(games.length+priorWeight),0.09,0.5)});
  }
  // Three bounded fixed-point adjustments to account for opponents' scoring difficulty.
  let ratings=initial;
  for(let pass=0;pass<3;pass++){
    const next=new Map();
    for(const [id,games] of byTeam){const base=initial.get(id);const old=ratings.get(id);
      const adjustedOff=average(games.map(g=>100*g.points/g.possessions+leagueOff-(ratings.get(String(g.opponentId))?.defRating??leagueOff)),base.offRating);
      const adjustedDef=average(games.map(g=>100*g.opponentPoints/g.possessions+leagueOff-(ratings.get(String(g.opponentId))?.offRating??leagueOff)),base.defRating);
      const priorWeight=base.priorGames>0?10:6;
      const previousRating=previous.get(id);
      const off=(adjustedOff*games.length+(previousRating?.offRating??leagueOff)*priorWeight)/(games.length+priorWeight);
      const def=(adjustedDef*games.length+(previousRating?.defRating??leagueOff)*priorWeight)/(games.length+priorWeight);
      const sos=average(games.map(g=>{const o=ratings.get(String(g.opponentId));return o?o.offRating-o.defRating:0;}),0);
      next.set(id,{...old,offRating:clamp(off,75,140),defRating:clamp(def,75,140),sos});
    }
    ratings=next;
  }
  return ratings;
}
export function simulate(a,b,{iterations=10000,venue='neutral',seed=20271118}={}){
  if(!a||!b||!a.gamesUsed||!b.gamesUsed)throw new Error('Both teams require completed games and calculated ratings.');
  if(!['neutral','home','away'].includes(venue))throw new Error('Invalid venue');
  if(!Number.isInteger(iterations)||iterations<100||iterations>10000)throw new Error('Simulation count must be 100–10,000.');
  const random=mulberry32(Number(seed)>>>0);
  const pace=clamp((a.pace+b.pace)/2,56,83);
  const homeAdj=venue==='home'?2.7:venue==='away'?-2.7:0;
  const trendA=0.8*((a.efg??.49)-.49)*100+3*((a.orbRate??.29)-.29)-6*((a.turnoverRate??.18)-.18);
  const trendB=0.8*((b.efg??.49)-.49)*100+3*((b.orbRate??.29)-.29)-6*((b.turnoverRate??.18)-.18);
  // Two-way efficiencies, pace, small bounded four-factor adjustments; points/100 poss.
  const expectedA=clamp(pace*(a.offRating+b.defRating)/200+trendA+homeAdj,44,112);
  const expectedB=clamp(pace*(b.offRating+a.defRating)/200+trendB-homeAdj,44,112);
  let aWins=0,bWins=0,totalA=0,totalB=0,squaredA=0,squaredB=0;
  const dist=new Map();
  const varianceA=clamp(10.5+11*(a.uncertainty??0.2),10,17);
  const varianceB=clamp(10.5+11*(b.uncertainty??0.2),10,17);
  for(let i=0;i<iterations;i++){
    const shared=normal(random)*3.4;
    let sa=Math.max(0,Math.round(expectedA+shared+normal(random)*varianceA));
    let sb=Math.max(0,Math.round(expectedB+shared+normal(random)*varianceB));
    if(sa===sb){ // No ties in basketball: approximate a close overtime by a second stochastic finish.
      sa+=Math.max(2,Math.round(5+normal(random)*2));sb+=Math.max(2,Math.round(5+normal(random)*2));
      if(sa===sb)sa+=random()<.5?1:-1;
    }
    if(sa>sb)aWins++;else bWins++;
    totalA+=sa;totalB+=sb;squaredA+=sa*sa;squaredB+=sb*sb;
    const bucket=Math.floor((sa-sb)/5)*5;dist.set(bucket,(dist.get(bucket)||0)+1);
  }
  const scoreA=totalA/iterations,scoreB=totalB/iterations;
  const advantages=[['Offensive efficiency',a.offRating-b.offRating],['Defensive efficiency',b.defRating-a.defRating],['Strength of schedule',a.sos-b.sos],['Shooting efficiency',(a.efg-b.efg)*100],['Offensive rebounding',(a.orbRate-b.orbRate)*35],['Ball security',(b.turnoverRate-a.turnoverRate)*40]];
  return {modelVersion:MODEL_VERSION,calibrated:false,iterations,seed:Number(seed)>>>0,venue,
    a:{teamId:a.teamId,winProbability:aWins/iterations,projectedScore:Math.round(scoreA*10)/10,gamesUsed:a.gamesUsed,priorGames:a.priorGames,ratings:a},
    b:{teamId:b.teamId,winProbability:bWins/iterations,projectedScore:Math.round(scoreB*10)/10,gamesUsed:b.gamesUsed,priorGames:b.priorGames,ratings:b},
    uncertainty:'Early-season and schedule-adjustment estimates are experimental; probabilities are not historically calibrated.',
    advantages:advantages.map(([metric,difference])=>({metric,edge:Math.round(difference*10)/10,favors:difference>=0?a.teamId:b.teamId})),
    scoreDifferenceDistribution:[...dist].sort((x,y)=>x[0]-y[0]).map(([margin,count])=>({margin,count}))};
}
