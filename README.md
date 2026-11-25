# NCAA Division I College Basketball Tracker

An automated daily tracker for all current men's NCAA Division I college basketball teams.

The roster currently contains 365 teams from ESPN's live Division I directory, with each team assigned to its current conference in the roster metadata.

## What it tracks

Each configured team is an item identified by its ESPN team ID. The history file contains season-to-date snapshots with:

- games played, wins, losses, and winning percentage;
- points scored and points allowed;
- point differential and average points per game;
- current win/loss streak;
- conference membership;
- game-level results for standings, schedules, recaps, comparisons, and alerts.

The pipeline downloads the daily Division I scoreboard, keeps every completed game involving at least one configured team—including games against opponents outside that team's conference—and rebuilds the full history and game log from the compressed raw files. A team that does not play on a particular day carries forward its latest season-to-date values.

## Data source

The daily source is ESPN's public men's college basketball scoreboard endpoint:

`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard`

The endpoint is queried with `groups=50` and a date-specific `limit`. The NCAA scoreboard is the reference site for the sport. The ESPN endpoint is public but not formally documented, so the pipeline records source failures and the README identifies the endpoint clearly.

## Repository layout

| Path | Purpose |
| --- | --- |
| `config/teams.csv` | Frozen 365-team roster and conference metadata |
| `src/pipeline.py` | Fetches raw games and rebuilds history/status files |
| `data/raw/<date>/` | Compressed source response for each game date |
| `data/history.csv` | One season-to-date row per configured team per date |
| `data/games.csv` | One normalized row per completed matchup, including neutral-site flags |
| `data/status.json` | Latest run and source status |
| `site/index.html` | Today dashboard |
| `site/browse.html` | Searchable, sortable team table |
| `site/conferences.html` | Conference standings and records |
| `site/compare.html` | Head-to-head team comparison |
| `site/schedule.html` | Team schedules and results |
| `site/trends.html` | Team trend charts |
| `site/bubble.html` | Exploratory March Madness bubble board |
| `site/assets/` | Shared CSS and browser logic |
| `.github/workflows/` | Daily pipeline, tests, and Pages deployment |
| `tests/` | Pipeline tests |

## History columns

| Column | Meaning | Unit |
| --- | --- | --- |
| `date` | Scoreboard/game date | `YYYY-MM-DD` |
| `item_id` | ESPN team ID | identifier |
| `item` | Team display name | text |
| `source` | Source name | text |
| `conference` | Conference in the configured roster | text |
| `games_played` | Completed games counted | games |
| `wins` | Cumulative wins | games |
| `losses` | Cumulative losses | games |
| `win_pct` | Wins divided by games played | fraction |
| `points_for` | Cumulative points scored | points |
| `points_against` | Cumulative points allowed | points |
| `point_diff` | Points for minus points against | points |
| `avg_points_for` | Points scored per game | points/game |
| `avg_points_against` | Points allowed per game | points/game |
| `streak` | Current result streak, such as `W3` or `L1` | text |

The configured roster is the fixed item universe. The `item_id` key keeps the same team aligned across dates even if the displayed team name changes.

The site also provides national rankings, daily movers, conference filters, upset alerts, daily recaps, recent-form charts, and data-quality status. The bubble board uses a transparent NET-style proxy with location-aware quadrants, SOS, quality wins, bad losses, conference strength, and recent form; it remains exploratory because official NET data is not part of the ESPN scoreboard feed.

## Mover rule

The Today page ranks teams by changes in winning percentage and cumulative `point_diff` from the previous available date. It also highlights the best current records, daily recap, and heuristic upset alerts. On a day with no completed games, the snapshot is unchanged and the mover list is empty.

## Run locally

Python 3.11 or newer is recommended. The pipeline uses only the Python standard library.

```bash
python src/pipeline.py --date 2026-11-23
python src/pipeline.py --start-date 2026-11-01 --end-date 2026-11-24
python -m unittest discover -s tests -v
```

The first command downloads one scoreboard response and writes:

- `data/raw/2026-11-23/espn_scoreboard.json.gz`
- `data/history.csv`
- `data/status.json`

Running the same date again replaces that date's raw file and rebuilds the history, so a second run does not duplicate games.

The backfill command replaces each requested date's raw response and rebuilds the entire history. The manual `Backfill season to date` workflow runs the same command on GitHub Actions.

## GitHub Actions and Pages

The daily workflow runs at 09:00 UTC, after the prior U.S. game date has normally completed, and queries the previous UTC date. It commits new raw/history/status files. The Pages workflow runs the tests, copies the current data into the static site, and deploys `site/` to GitHub Pages.

For the GitHub Actions schedule to commit successfully, the repository workflow setting must allow `GITHUB_TOKEN` to write contents. Enable Pages with **GitHub Actions** as the deployment source in the repository settings.

## Academic integrity

This repository is a project scaffold and implementation for the assigned tracker. Any submitted work should be understood, tested, and customized by the student. Do not copy another student's repository or data files.

