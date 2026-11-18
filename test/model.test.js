import test from 'node:test';import assert from 'node:assert/strict';
import {buildRatings,simulate} from '../src/model.js';
const samples=[
 {teamId:'ark',opponentId:'duke',season:2027,date:'2026-11-10',points:81,opponentPoints:72,possessions:70,fgm:29,fga:61,tpm:10,offRebounds:12,oppDefRebounds:25,turnovers:11},
 {teamId:'duke',opponentId:'ark',season:2027,date:'2026-11-10',points:72,opponentPoints:81,possessions:70,fgm:25,fga:59,tpm:8,offRebounds:9,oppDefRebounds:26,turnovers:13},
 {teamId:'ark',opponentId:'duke',season:2027,date:'2026-11-13',points:79,opponentPoints:76,possessions:69,fgm:27,fga:59,tpm:8,offRebounds:10,oppDefRebounds:26,turnovers:12},
 {teamId:'duke',opponentId:'ark',season:2027,date:'2026-11-13',points:76,opponentPoints:79,possessions:69,fgm:26,fga:62,tpm:9,offRebounds:11,oppDefRebounds:24,turnovers:10}
];
test('ratings exclude future games and reflect observed points',()=>{const a=buildRatings(samples,2027,new Map(),'2026-11-12');assert.equal(a.get('ark').gamesUsed,1);assert.equal(a.get('duke').gamesUsed,1);assert.ok(a.get('ark').offRating>a.get('duke').offRating);});
test('10k simulated games sum exactly, no hardcoded percentages, deterministic',()=>{const r=buildRatings(samples,2027);const x=simulate(r.get('ark'),r.get('duke'),{seed:42});const y=simulate(r.get('ark'),r.get('duke'),{seed:42});assert.deepEqual(x,y);assert.equal(x.iterations,10000);assert.equal(x.a.winProbability+x.b.winProbability,1);assert.equal(x.scoreDifferenceDistribution.reduce((v,z)=>v+z.count,0),10000);assert.ok(x.a.projectedScore>40&&x.a.projectedScore<110);});
test('venue changes probabilities in expected direction',()=>{const r=buildRatings(samples,2027);const a=r.get('ark'),b=r.get('duke');const home=simulate(a,b,{venue:'home'}),away=simulate(a,b,{venue:'away'});assert.ok(home.a.winProbability>away.a.winProbability);});
test('no unsupported predictions for teams with no data',()=>assert.throws(()=>simulate({gamesUsed:0},{gamesUsed:0})));
