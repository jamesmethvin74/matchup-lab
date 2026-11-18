// CBBD /games/players ingest. No UI-generated player values; original provider IDs persist.
import {bulkUpsert} from './ingest.js';
const canon = value => `cbbd:${value}`;
const numeric = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const validId = value => Number.isSafeInteger(numeric(value)) && numeric(value) > 0;
const source = 'cbbd';
const playerCols = ['id','sport_id','full_name','source','source_player_id'];
const rosterCols = ['player_id','team_id','season','position','source'];
const gameCols = ['game_id','player_id','team_id','opponent_id','starter','minutes','points','fgm','fga','tpm','tpa','ftm','fta','offensive_rebounds','defensive_rebounds','assists','turnovers','steals','blocks','fouls','usage_rate','offensive_rating','defensive_rating','source'];

export function normalizePlayerBox(box) {
  if (!validId(box?.gameId) || !validId(box?.teamId) || !validId(box?.opponentId) || !Number.isSafeInteger(numeric(box?.season))) {
    throw new Error('Invalid CBBD game player box identifiers');
  }
  if (!Array.isArray(box.players)) throw new Error('CBBD player box is missing players array');
  const gameId=canon(box.gameId),teamId=canon(box.teamId),opponentId=canon(box.opponentId);
  const players=[], memberships=[], stats=[];
  for (const p of box.players) {
    if (!validId(p?.athleteId) || !p.name?.trim()) throw new Error('Missing CBBD athlete ID or name; refusing incomplete player window');
    const playerId=canon(p.athleteId);
    players.push({id:playerId,sport_id:'basketball-m',full_name:p.name.trim(),source,source_player_id:String(p.athleteId)});
    memberships.push({player_id:playerId,team_id:teamId,season:numeric(box.season),position:p.position||null,source});
    stats.push({game_id:gameId,player_id:playerId,team_id:teamId,opponent_id:opponentId,
      starter:p.starter == null ? null : p.starter ? 1 : 0,
      minutes:numeric(p.minutes),points:numeric(p.points),
      fgm:numeric(p.fieldGoals?.made),fga:numeric(p.fieldGoals?.attempted),
      tpm:numeric(p.threePointFieldGoals?.made),tpa:numeric(p.threePointFieldGoals?.attempted),
      ftm:numeric(p.freeThrows?.made),fta:numeric(p.freeThrows?.attempted),
      offensive_rebounds:numeric(p.rebounds?.offensive),defensive_rebounds:numeric(p.rebounds?.defensive),
      assists:numeric(p.assists),turnovers:numeric(p.turnovers),steals:numeric(p.steals),
      blocks:numeric(p.blocks),fouls:numeric(p.fouls),usage_rate:numeric(p.usage),
      offensive_rating:numeric(p.offensiveRating),defensive_rating:numeric(p.defensiveRating),source});
  }
  return {gameId,players,memberships,stats};
}

export function preparePlayerRows(boxes, knownGameIds) {
  const players=new Map(),memberships=new Map(),stats=new Map();
  let teamBoxes=0;
  for(const box of boxes){
    const normalized=normalizePlayerBox(box);
    if(!knownGameIds.has(normalized.gameId))throw new Error(`Player box references unimported game ${normalized.gameId}`);
    teamBoxes++;
    for(const p of normalized.players) players.set(p.id,p);
    for(const r of normalized.memberships) memberships.set(`${r.player_id}|${r.team_id}|${r.season}`,r);
    for(const s of normalized.stats) stats.set(`${s.game_id}|${s.player_id}|${s.team_id}`,s);
  }
  return {players:[...players.values()],memberships:[...memberships.values()],stats:[...stats.values()],teamBoxes};
}

export async function savePlayerRows(db,rows) {
  // Dependents follow parents; all keys are canonical and writes are idempotent.
  await bulkUpsert(db,'players',playerCols,rows.players,['id'],['full_name']);
  await bulkUpsert(db,'provider_ids',['provider','entity_type','provider_id','canonical_id'],rows.players.map(p=>({provider:source,entity_type:'player',provider_id:p.source_player_id,canonical_id:p.id})),['provider','entity_type','provider_id']);
  await bulkUpsert(db,'player_team_seasons',rosterCols,rows.memberships,['player_id','team_id','season'],['position','source']);
  await bulkUpsert(db,'player_game_stats',gameCols,rows.stats,['game_id','player_id','team_id']);
  return {players:rows.players.length,affiliations:rows.memberships.length,playerGames:rows.stats.length};
}