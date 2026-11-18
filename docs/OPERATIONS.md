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
