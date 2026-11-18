PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sports (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, gender TEXT NOT NULL,
  division TEXT NOT NULL
);
INSERT OR IGNORE INTO sports(id,display_name,gender,division)
VALUES('basketball-m','NCAA Division I Men''s Basketball','M','I');
CREATE TABLE IF NOT EXISTS seasons (
  sport_id TEXT NOT NULL REFERENCES sports(id), season INTEGER NOT NULL,
  label TEXT NOT NULL, PRIMARY KEY(sport_id,season)
);
INSERT OR IGNORE INTO seasons VALUES('basketball-m',2026,'2025–26');
INSERT OR IGNORE INTO seasons VALUES('basketball-m',2027,'2026–27');
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, sport_id TEXT NOT NULL REFERENCES sports(id),
  name TEXT NOT NULL, school TEXT, mascot TEXT, abbreviation TEXT,
  conference TEXT, di_status INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_teams_sport_name ON teams(sport_id,name);
CREATE TABLE IF NOT EXISTS provider_ids (
  provider TEXT NOT NULL, entity_type TEXT NOT NULL, provider_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL, seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider,entity_type,provider_id)
);
CREATE INDEX IF NOT EXISTS ix_provider_canonical ON provider_ids(canonical_id);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, sport_id TEXT NOT NULL, season INTEGER NOT NULL,
  provider TEXT NOT NULL, provider_game_id TEXT NOT NULL, start_date TEXT NOT NULL,
  status TEXT, neutral_site INTEGER NOT NULL DEFAULT 0,
  home_team_id TEXT NOT NULL REFERENCES teams(id),
  away_team_id TEXT NOT NULL REFERENCES teams(id),
  home_points INTEGER, away_points INTEGER, venue TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider,provider_game_id)
);
CREATE INDEX IF NOT EXISTS ix_games_season_date ON games(sport_id,season,start_date);
CREATE INDEX IF NOT EXISTS ix_games_home_season ON games(home_team_id,season);
CREATE INDEX IF NOT EXISTS ix_games_away_season ON games(away_team_id,season);
CREATE TABLE IF NOT EXISTS game_team_stats (
  game_id TEXT NOT NULL REFERENCES games(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  opponent_id TEXT NOT NULL REFERENCES teams(id),
  points REAL, possessions REAL, fgm REAL, fga REAL, tpm REAL, tpa REAL,
  ftm REAL, fta REAL, offensive_rebounds REAL, defensive_rebounds REAL,
  turnovers REAL, assists REAL, steals REAL, blocks REAL,
  source TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(game_id,team_id)
);
CREATE INDEX IF NOT EXISTS ix_gts_team ON game_team_stats(team_id,game_id);
CREATE TABLE IF NOT EXISTS team_ratings (
  sport_id TEXT NOT NULL, season INTEGER NOT NULL, team_id TEXT NOT NULL,
  off_rating REAL NOT NULL, def_rating REAL NOT NULL, pace REAL NOT NULL,
  efg REAL, orb_rate REAL, turnover_rate REAL,
  sos REAL NOT NULL, games_used INTEGER NOT NULL, prior_games INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(sport_id,season,team_id)
);
CREATE INDEX IF NOT EXISTS ix_ratings_season ON team_ratings(season,team_id);
CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT NOT NULL, season INTEGER NOT NULL, cursor TEXT NOT NULL,
  last_success_at TEXT, last_error TEXT,
  PRIMARY KEY(source,season)
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, season INTEGER NOT NULL,
  window_start TEXT NOT NULL, window_end TEXT NOT NULL,
  status TEXT NOT NULL, games_seen INTEGER NOT NULL DEFAULT 0,
  stats_seen INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS ix_sync_runs_started ON sync_runs(started_at);
