# Matchup Lab

NCAA Division I men's basketball: real CBBD game/team box scores in a **separate** Cloudflare D1 database, reproducible 10,000-game simulations, and responsive Worker-hosted interface.

## Status

Code and unit tests are implemented. **No fabricated production rows or win probabilities.** Until `matchup-lab` D1, `CBBD_API_KEY`, Worker secrets and Git deployment are configured, the live app cannot predict real games. Model is intentionally **uncalibrated** pending held-out walk-forward backtests.

## Run locally

```bash
npm install
npm run check
npm run db:migrate:local
npm run dev
```

The offline tests use only synthetic fixtures. Production D1 always starts empty and must ingest CBBD records.

## Production deployment

Use Cloudflare Workers Builds (Git integration, `main`, root `/`, no build command, deploy command `npm run deploy:cloudflare`), matching LocalBleachersAR. The D1 migration is a separate one-time operation; never grant D1 admin privileges to the build token. See `docs/OPERATIONS.md`.

## API

- `GET /api/health` — health and model version
- `GET /api/status` — ingestion counts and source freshness
- `GET /api/teams?season=2027` — D-I searchable catalog
- `GET /api/matchup?season=2027&a=cbbd:...&b=cbbd:...&venue=neutral&seed=20271118` — 10k seeded simulations, derived stats only; 422 on insufficient real data
- `POST /api/admin/ingest` — protected bearer token, performs next bounded incremental sync

Source: [CollegeBasketballData](https://collegebasketballdata.com), unofficial, subject to their [terms](https://collegebasketballdata.com/terms). Team names are factual identifiers; no third-party logos are included.

## Model

Three iterative opponent adjustments to possessions-normalized attack and defense, smoothed toward previous-season ratings (10 equivalent games) or observed league average (6 equivalent games). Mean scores use pace × the mean of attacking and opposing defensive efficiency, plus bounded shooting/rebounding/turnover factors and a ±2.7 point venue adjustment. Gaussian shared and individual scoring variance drives 10,000 seeded Monte Carlo finishes. This is a prototype, **not calibrated**.
