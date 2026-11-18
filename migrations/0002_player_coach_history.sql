-- Matchup Lab v0.2: source-traceable roster, player production and coach history.
-- Safe to apply after 0001_initial.sql. No synthetic production observations.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL REFERENCES sports(id),
  full_name TEXT NOT NULL,
  source TEXT NOT NULL,
  source_player_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  height_inches REAL,
  weight_lbs REAL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, source_player_id)
);
CREATE INDEX IF NOT EXISTS ix_players_name ON players(sport_id, full_name);

-- A player can appear at two schools within one season. Never overwrite past affiliation.
CREATE TABLE IF NOT EXISTS player_team_seasons (
  player_id TEXT NOT NULL REFERENCES players(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  season INTEGER NOT NULL,
  position TEXT,
  jersey TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL,
  PRIMARY KEY(player_id, team_id, season)
);
CREATE INDEX IF NOT EXISTS ix_roster_team_season ON player_team_seasons(team_id, season);

CREATE TABLE IF NOT EXISTS player_game_stats (
  game_id TEXT NOT NULL REFERENCES games(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  opponent_id TEXT NOT NULL REFERENCES teams(id),
  starter INTEGER,
  minutes REAL,
  points REAL,
  fgm REAL, fga REAL, tpm REAL, tpa REAL, ftm REAL, fta REAL,
  offensive_rebounds REAL, defensive_rebounds REAL,
  assists REAL, turnovers REAL, steals REAL, blocks REAL, fouls REAL,
  usage_rate REAL, offensive_rating REAL, defensive_rating REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(game_id, player_id, team_id)
);
CREATE INDEX IF NOT EXISTS ix_player_games_player ON player_game_stats(player_id, game_id);
CREATE INDEX IF NOT EXISTS ix_player_games_team ON player_game_stats(team_id, game_id);

-- Recorded provider season totals; do not mistake these for per-game averages.
CREATE TABLE IF NOT EXISTS player_season_stats (
  player_id TEXT NOT NULL REFERENCES players(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  season INTEGER NOT NULL,
  games REAL, starts REAL, minutes REAL,
  points REAL, fgm REAL, fga REAL, tpm REAL, tpa REAL, ftm REAL, fta REAL,
  offensive_rebounds REAL, defensive_rebounds REAL,
  assists REAL, turnovers REAL, steals REAL, blocks REAL,
  usage_rate REAL, offensive_rating REAL, defensive_rating REAL,
  effective_field_goal_pct REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(player_id,team_id,season)
);
CREATE INDEX IF NOT EXISTS ix_player_season_team ON player_season_stats(team_id, season);

-- No unverified coach effects: tenure facts precede any adjusted-coaching model.
CREATE TABLE IF NOT EXISTS coaches (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  source TEXT NOT NULL,
  provider_coach_id TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coach_team_seasons (
  coach_id TEXT NOT NULL REFERENCES coaches(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  season INTEGER NOT NULL,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(coach_id,team_id,season,role)
);
CREATE INDEX IF NOT EXISTS ix_coach_team_season ON coach_team_seasons(team_id,season);
