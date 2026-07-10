# GD Bio Run Tracker

Live-updates your **Discord bio** with today's Geometry Dash runs while you play.

```
gravity
17-88%, 29-100%, 2x45-100%      <- this row is managed automatically
```

Two parts, both run on your PC:

- **`gd-mod/`** — a Geode mod. Hooks every attempt and reports `start% -> end%` to the updater.
- **`bio-updater/`** — a small Node service. Filters runs, formats the row, and edits your bio live.

## How "live" works

Each run the mod POSTs to `127.0.0.1:8787`. The updater coalesces bursts (3s debounce +
a 10s minimum interval, so a wave of deaths = one edit) and PATCHes your bio. Discord
rate-limits profile edits; the updater honors `retry_after`.

## Rules

- A run is logged only if it **reaches 100%** or **spans more than 30 points** (e.g. `29-100%`, `17-88%`). `79->82` is ignored.
- Row keeps the **last 3** distinct runs; a 4th drops the oldest.
- A repeat collapses to a count prefix (e.g. `2x45-100%`).
- From-0 death shows the bare percent (`86%`); a partial run shows `start-end%` (`29-100%`).
- Resets each local day.
- Your existing bio (everything above the row) is auto-detected and never touched.

## Global vs per-server

- **Server ID blank** → updates your **global** About Me bio.
- **Server ID = a guild id** → updates that one server's bio (**Discord Nitro required**).

## Setup — updater

```bash
cd bio-updater
npm install
cp .env.example .env      # or set token/guild in the mod's in-game settings
npm test                  # optional: verify the row logic
npm start
```

`DISCORD_TOKEN` is your *user* token. Treat it like a password — it's only used locally to edit your own bio.

## Setup — mod

1. Install the [Geode SDK](https://docs.geode-sdk.org) and set `GEODE_SDK`.
2. Build: `cd gd-mod && geode build` (or push to GitHub — the included Actions workflow builds a Windows `.geode`).
3. Drop the `.geode` in your `geode/mods/` folder (or "Install from file" in-game).
4. In-game: **Settings → Bio Run Tracker** — set your **Discord Token** and optional **Server ID**.

Start the updater before playing. Play the level, watch the bio update.

## Notes

- Version targets: Geode `5.7.1`, GD `2.2081` (Windows). On a different version, bump `mod.json` and rebuild.
- Practice-mode checkpoints count as the run's start%, so a checkpoint run logs as `45-100%`.
