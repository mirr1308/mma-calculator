# MMA 2026 Calculator

Static dashboard for the 2026 MMA vote tracker.

## Features
- Manual refresh runs the Supabase `global-top10` collector.
- The collector fetches Berriz + Melon, validates both 30-artist sets, and atomically updates `public.mma`.
- Every successful collection is stored as an immutable JSON snapshot under `history/snapshots/YYYY-MM-DD/`.
- The annual `history/YYYY.json` file keeps the latest cumulative vote snapshot for each date.
- The dashboard shows current scores, daily ranks, and daily net votes.

## Score formula
- Total Vote = Korea + Global
- Max Vote = maximum Total Vote among the 30 artists for that snapshot
- Vote Score = round((Total Vote / Max Vote) * 20, 2)
- Total Score = fixed Chart Score (60 max) + Vote Score (20 max)
- Ranking = Total Score descending

Chart Score values are maintained in `src/config.js`.

## Supabase setup
The existing `global-top10` Edge Function includes:
- `GET ?mode=current`: read-only current data for the dashboard.
- `POST`: collect Berriz + Melon, save Supabase, then save GitHub history.

Add a Supabase Edge Function secret named `GITHUB_TOKEN`. It must be a fine-grained GitHub token restricted to this repository with **Contents: Read and write** permission. The token is only used server-side by the Edge Function and must never be added to frontend files.

If the GitHub write fails after Supabase succeeds, the API response still reports `ok: true` with `historySaved: false` and an error message. The dashboard displays this as a partial success.

## Daily collection
The existing Supabase Cron collector also calls the same POST route, so scheduled and manual collections use the same History writer. No separate GitHub Actions history workflow is required.

## GitHub Pages
Publish from the `main` branch, root folder. If Pages is unavailable for this private repository on the current GitHub plan, the repository must be made public or the account plan must support private-repository Pages.
