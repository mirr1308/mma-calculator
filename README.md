# MMA 2026 Calculator

Static dashboard for the 2026 MMA vote tracker.

## Features
- Current ranking / score changes (compared with the previous daily snapshot)
- Daily ranking history
- Daily net vote changes (global and Korea shown separately)

## Score formula
- Total Vote = Korea + Global
- Max Vote = maximum Total Vote among the 30 artists for that snapshot
- Vote Score = round((Total Vote / Max Vote) * 20, 2)
- Total Score = fixed Chart Score (60 max) + Vote Score (20 max)
- Ranking = Total Score descending

Chart Score values are maintained in `src/config.js`. Unknown values are intentionally `null`; enter the official fixed values before using Total Score rankings.

## Data flow
- Current values: read-only `GET /functions/v1/global-top10?mode=current`
- Daily history: GitHub Actions at 00:05 KST reads the latest `mma` snapshot and commits cumulative vote values to `history/YYYY.json`.
- Supabase tables are not modified by this repository.

## GitHub Actions setup
1. In repository Settings → Secrets and variables → Actions, add `SUPABASE_PUBLISHABLE_KEY` (the project's publishable key).
2. Enable GitHub Actions.
3. The workflow runs at 00:05 KST daily, after the existing 23:59 KST Supabase Cron collector.
4. To test, run **Save daily MMA history** manually from Actions → Run workflow.

## GitHub Pages
Enable Pages in Settings → Pages and publish from the `main` branch, root folder. If Pages is unavailable for this private repository on the current GitHub plan, the repository must be made public or the account plan must support private-repository Pages.

## Supabase function
The existing `global-top10` function has a read-only `?mode=current` GET route for the dashboard and history workflow. The existing GET/POST collection behavior remains unchanged.
