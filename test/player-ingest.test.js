import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {normalizePlayerBox,preparePlayerRows,savePlayerRows} from '../src/player-ingest.js';
import {bulkUpsert,syncPlayers} from '../src/ingest.js';
const box={gameId:11,season:2027,teamId:1,opponentId:2,players:[{athleteId:7,athleteSourceId:'abc',name:'Example Player',position:'G',starter:true,minutes:29,points:21,fieldGoals:{made:7,attempted:14},threePointFieldGoals:{made:3,attempted:7},freeThrows:{made:4,attempted:5},rebounds:{offensive:1,defensive:6},assists:4,turnovers:2,usage:26.4,offensiveRating:113.1}]};
const dbAdapter=(db)=>({prepare(sql){const stmt=db.prepare(sql);return {first(){return stmt.get()},all(){return {results:stmt.all()}},bind(...params){return {run(){return stmt.run(...params)},first(){return stmt.get(...params)},all(){return {results:stmt.all(...params)}}}}}},async batch(batch){return batch.map(b=>b.run())}});
test('normalizes documented CBBD player box nested fields',()=>{
 const v=normalizePlayerBox(box);assert.equal(v.players[0].id,'cbbd:7');assert.equal(v.memberships[0].season,2027);assert.equal(v.stats[0].tpm,3);assert.equal(v.stats[0].points,21);assert.equal(v.stats[0].starter,1);
});
test('rejects unknown games or missing athlete IDs before writing',()=>{
 assert.throws(()=>preparePlayerRows([box],new Set()),/unimported game/);
 assert.throws(()=>normalizePlayerBox({...box,players:[{name:'unknown'}]}),/athlete ID/);
});
test('JSON1 batch writer and player ingest upsert idempotently in real SQLite',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_player_coach_history.sql',import.meta.url),'utf8'));
 const db=dbAdapter(sql);
 await bulkUpsert(db,'teams',['id','sport_id','name','di_status'],[{id:'cbbd:1',sport_id:'basketball-m',name:'A',di_status:1},{id:'cbbd:2',sport_id:'basketball-m',name:'B',di_status:1}],['id']);
 await bulkUpsert(db,'games',['id','sport_id','season','provider','provider_game_id','start_date','home_team_id','away_team_id'],[{id:'cbbd:11',sport_id:'basketball-m',season:2027,provider:'cbbd',provider_game_id:'11',start_date:'2026-11-10',home_team_id:'cbbd:1',away_team_id:'cbbd:2'}],['provider','provider_game_id']);
 const rows=preparePlayerRows([box],new Set(['cbbd:11']));await savePlayerRows(db,rows);await savePlayerRows(db,rows);
 for(const [table,expect] of [['players',1],['player_team_seasons',1],['player_game_stats',1],['provider_ids',1]]) assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,expect);
 assert.equal(sql.prepare('SELECT points FROM player_game_stats').get().points,21);
});

test('one-day player sync advances independent cursor only after persisted source records',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_player_coach_history.sql',import.meta.url),'utf8'));
 const db=dbAdapter(sql);
 await bulkUpsert(db,'teams',['id','sport_id','name','di_status'],[{id:'cbbd:1',sport_id:'basketball-m',name:'A',di_status:1},{id:'cbbd:2',sport_id:'basketball-m',name:'B',di_status:1}],['id']);
 await bulkUpsert(db,'games',['id','sport_id','season','provider','provider_game_id','start_date','home_team_id','away_team_id'],[{id:'cbbd:11',sport_id:'basketball-m',season:2027,provider:'cbbd',provider_game_id:'11',start_date:'2026-10-01T10:00:00Z',home_team_id:'cbbd:1',away_team_id:'cbbd:2'}],['provider','provider_game_id']);
 let requests=0;const fetcher=async url=>{requests++;assert.match(url,/\/games\/players\?/);return Response.json([{...box,season:2027}])};
 const first=await syncPlayers({DB:db,CBBD_API_KEY:'fixture-only'},2027,fetcher);
 assert.equal(first.playerGames,1);assert.equal(requests,1);assert.match(sql.prepare("SELECT cursor FROM sync_state WHERE source='cbbd-players' AND season=2027").get().cursor,/2026-10-02/);
 assert.equal(sql.prepare('SELECT count(*) n FROM player_game_stats').get().n,1);
});