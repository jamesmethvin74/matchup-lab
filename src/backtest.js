// Date-ordered walk-forward backtest. Never train on the target game or future games.
import {buildRatings,simulate} from './model.js';
const clip=p=>Math.max(1e-8,Math.min(1-1e-8,p));
export function backtest(gameRows,scheduledGames,{season=2027,minGames=5,seed=1122}={}){
 const prior=buildRatings(gameRows,season-1);
 const outcomes=[];
 for(const game of [...scheduledGames].filter(g=>Number(g.season)===season&&Number.isFinite(g.homePoints)&&Number.isFinite(g.awayPoints)).sort((a,b)=>String(a.date).localeCompare(String(b.date)))){
   const ratings=buildRatings(gameRows,season,prior,game.date);
   const a=ratings.get(String(game.homeId)),b=ratings.get(String(game.awayId));
   if(!a||!b||a.gamesUsed<minGames||b.gamesUsed<minGames)continue;
   const p=simulate(a,b,{venue:game.neutral?'neutral':'home',seed:seed+outcomes.length}).a.winProbability;
   const actual=game.homePoints>game.awayPoints?1:0;
   outcomes.push({date:game.date,homeId:game.homeId,awayId:game.awayId,p,actual,
      marginPredicted:simulate(a,b,{venue:game.neutral?'neutral':'home',seed:seed+outcomes.length}).a.projectedScore-simulate(a,b,{venue:game.neutral?'neutral':'home',seed:seed+outcomes.length}).b.projectedScore,
      marginActual:game.homePoints-game.awayPoints});
 }
 if(!outcomes.length)return {games:0,accuracy:null,brier:null,logLoss:null,marginMAE:null,calibration:[]};
 const mean=fn=>outcomes.reduce((s,r)=>s+fn(r),0)/outcomes.length;
 const buckets=Array.from({length:10},(_,i)=>{const list=outcomes.filter(r=>Math.min(9,Math.floor(r.p*10))===i);return {bucket:i,number:list.length,predicted:list.length?list.reduce((s,r)=>s+r.p,0)/list.length:null,observed:list.length?list.reduce((s,r)=>s+r.actual,0)/list.length:null};});
 return {games:outcomes.length,accuracy:mean(r=>(r.p>=.5?1:0)===r.actual?1:0),brier:mean(r=>(r.p-r.actual)**2),
  logLoss:mean(r=>-r.actual*Math.log(clip(r.p))-(1-r.actual)*Math.log(1-clip(r.p))),
  marginMAE:mean(r=>Math.abs(r.marginPredicted-r.marginActual)),calibration:buckets};
}
