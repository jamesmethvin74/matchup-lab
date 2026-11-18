# Matchup Lab operating instructions

- This is a separate project from LocalBleachersAR. Never target the game-nearby repository, localbleachersar-sports D1 database or localbleachersar-sports-api Worker.
- Production deployments use Cloudflare Workers Builds Git integration. GitHub Actions are not a production deployment substitute.
- Keep the D1 database ID and secrets out of JavaScript delivered to browsers. DB ID goes in wrangler config after creation; keys live as Worker secrets.
- Public GET routes are read-only, respond from precomputed team ratings, and never trigger upstream fetches or D1 writes.
- Incremental ingestion is via a single Cloudflare Cron Trigger or a protected manual request; bounded weekly slices, idempotent inserts and a server-side bearer token.
- Respect Workers Free query/CPU/D1 limits and the CBBD shared 1,000/month free request pool.
- Do not claim predictions are calibrated until a held-out, leakage-free backtest supports it.
- No team logo use or raw-data mirror endpoint; show only derived analysis and brief team statistics.
- Never put fake or synthetic data into a production D1 database. Synthetic fixtures belong to tests only.
