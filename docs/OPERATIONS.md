# Matchup Lab operations

Read `AGENTS.md` before modifying any code or live resource. This is NOT part of LocalBleachersAR.

## Cloudflare setup (separate resources)

1. Create D1 `matchup-lab` in the same Cloudflare account. Copy the resulting **new** D1 UUID into `wrangler.jsonc` (replace `REPLACE_WITH_NEW_D1_DATABASE_ID`). Never copy the LocalBleachersAR UUID.
2. Apply migration `0001_initial.sql` to the new database via Cloudflare's D1 migration workflow, before starting the Worker. App deployment must not include migration write privileges.
3. Create Worker `matchup-lab-api` via Workers Builds connected to `jamesmethvin74/matchup-lab`, production branch `main`, root `/`, deploy command `npm run deploy:cloudflare`, no build command. No GitHub Actions for deployment.
4. Configure Worker secrets `CBBD_API_KEY` (free key from collegebasketballdata.com/key) and `INGEST_TOKEN` (independent strong random value). Keep out of Git and browser JS.
5. Deploy, request `GET /api/health`, `GET /api/status`, then do one protected manual sync with `POST /api/admin/ingest` and `Authorization: Bearer <INGEST_TOKEN>`; verify teams, games, ratings counts and actual Arkansas/Duke matchup. Never claim production success without those responses.

## Cadence and quotas

The Worker Cron is `0 12 * * *` (daily 12:00 UTC). Each tick fetches at most two seven-day game windows (2026 and 2027) at two requests per season, plus a team catalog request no more than weekly. Free CBBD is 1,000 calls per month **shared with football**. No automatic repeated catch-up loop. Old season stops after reaching July 1, 2026; current season re-scans the trailing seven days for corrections. If API reports 429 or 5xx, sync aborts without advancing the cursor and keeps last-good data. D1 upserts are idempotent and chunked. `GET` never calls external sources or writes D1.

**Known open checks:** Public team directory may include program status edge cases; verify D-I membership on first live sample. Verify 3,000-result caps and field completeness against real token-authenticated API payloads. Validate Cloudflare D1 binding/limits under real ingestion. Historical prior collection requires multiple daily ticks; first live predictions should be marked preliminary until the backlog is complete.

## Backtesting

`src/backtest.js` exposes a date-cutoff walk-forward evaluator measuring Brier score, log loss, accuracy, calibration deciles and average absolute margin error. It excludes games with insufficient prior-season observations. It is not a claim of completed historical validation; connect to a held-out in-database historical game cohort before reporting calibration.

## Player data pipeline (2026 and 2027)

- **Prerequisite:** Apply `migrations/0002_player_coach_history.sql` to the dedicated `matchup-lab` D1 database using its Console. The Worker safely reports `playerSchemaReady: false` and skips player sync while the migration is absent. Never run it against LocalBleachersAR.
- `GET /api/status` reports `players`, `playerGameStats`, `playerSync` cursors, and `playerSchemaReady`. Zero counts before the daily collection completes are expected.
- After migration, the existing scheduled ingestion adds one **one-day** `/games/players` slice per season per run (two additional provider calls at most). Player game stats, player-to-team-season membership, stable provider IDs, and source metadata are upserted without overwriting historic affiliations. Player cursors are independent of team-game cursors.
- Missing athlete IDs, unimported game references, unexpected shapes, overlarge windows, and API throttling fail closed without advancing the affected player cursor. Team ratings complete even if the optional player sync encounters an error; errors appear in cron logs. Correct a blocked cursor or smaller window through a reviewed code change, never by fabricating rows.
- Historical catch-up intentionally advances one day per daily run to stay on free quotas; faster backfill requires explicit budgeting. `player_season_stats` and coach tenure tables are reserved for later verified-source ingestion and remain empty for now. No player-transfer/coaching adjustments are claimed by the current team-only prediction model.
- API docs: CBBD `/games/players` and its nested `players` array with `athleteId`, `fieldGoals`, `rebounds`, `usage`, and ratings. Free API access quota is shared with CBBD football.
## Accelerated backfill (begun 2026-11-18)

- Temporary fast-check Cloudflare Cron `2-57/5 * * * *`: attempts an import at the first eligible tick; D1 `sync_state` atomically gates actual imports to **at most one every eight hours**. The original daily `0 12 * * *` cron is unchanged.
- Each eligible tick calls the same bounded, idempotent `ingest()`: at most one seven-day game/box window and one one-day player-box window per season. No manual bearer token, new key, or production D1 migration.
- Account for CollegeBasketballData's 1,000 calls/month free tier shared with other apps and Cloudflare D1 Free's 100,000 daily rows-written limit. Conservative 8h throttle caps accelerated calls to ~18 CBBD requests/day plus the ordinary daily job; no unbounded batch/retry loop.
- D1 `sync_state` with source `cbbd-accelerated-backfill` records last attempt timestamp, last success and last error; `/api/status` now exposes `backfill` and `backfillProgress` source cursors. No secrets exposed.
- Automatically pauses extra imports once both seasons' regular game and player cursors are caught up. The 5-minute gate/check trigger should be removed via a later GitHub commit after verified catch-up to avoid unnecessary invocations.
- Source cursor season 2026 ends 2026-07-01. Season 2027 catches up to within two days of the present; normal daily import continues with historical corrections. The initial one-time four-day bootstrap is independent and does not advance the regular cursors.

## Four-day bulk player backfill (2026-11-19)

- Accelerated six-hour game windows remain **seven days** each season; player windows expand to **four days** on accelerated runs (normal daily worker remains one-day, including corrections).
- The accelerated throttle remains 8h, at most 3 accelerated runs/day plus the normal daily job; never launch an unbounded one-shot ingestion or overwrite the historical cursor. Every batch is idempotent and resumable in source-specific D1 sync_state.
- Cloudflare D1 Free includes 100,000 rows written/day, with index writes counted; CBBD free uses 1,000 calls/month shared with football. Actual quotas must be verified during live rollout before further acceleration.
- From 2025-10-04, four days * 3 accelerated ticks plus the daily one-day tick is ~13 historical player-days per calendar day: ~20–22 days for the 2025–26 season to reach the July cutoff, assuming no provider/D1 interruptions. Actual calendar duration depends on source density, scheduled ticks, quotas and potential records over-limit.
- Code-only rollout with no user action; Cloudflare Workers Builds deploys Git main. The read-only GitHub production-status smoke workflow monitors completion and cursor progress.

## 2026-27 immediate focus (Nov 19, 2026)

- The regular season began November 1, 2026 (NCAA). Immediate collections now target **season 2027 only**; last season is no longer a blocking dependency.
- Existing season 2027 October cursors are automatically advanced to November 1 during the next bounded ingestion. Historical rows already stored are preserved.
- Scheduled daily collection remains active. Accelerated import remains at most one run per eight hours, capturing a seven-day current-season team-game window and a four-day current-season player-game window per accelerated tick. No new secrets, DB migrations or manual action.
- `2025-26` and coaching-history enrichments are deferred, not discarded. The current `coaches` schema remains empty until an independently verified 2026-27 roster-to-coach source is imported.
- Real box-score coverage is not equivalent to a complete team roster; the 2026-27 roster source must be ingested separately for transfer-scenario tooling. Keep probabilities labeled uncalibrated.
