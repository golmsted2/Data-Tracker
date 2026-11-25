"""Fetch and rebuild the NCAA Division I college basketball tracker."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import shutil
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
TEAMS_PATH = ROOT / "config" / "teams.csv"
RAW_DIR = ROOT / "data" / "raw"
HISTORY_PATH = ROOT / "data" / "history.csv"
GAMES_PATH = ROOT / "data" / "games.csv"
STATUS_PATH = ROOT / "data" / "status.json"
SOURCE_NAME = "ESPN Men's College Basketball Scoreboard"
SOURCE_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/scoreboard"
)

HISTORY_FIELDS = [
    "date",
    "item_id",
    "item",
    "source",
    "conference",
    "games_played",
    "wins",
    "losses",
    "win_pct",
    "points_for",
    "points_against",
    "point_diff",
    "avg_points_for",
    "avg_points_against",
    "streak",
]

GAME_FIELDS = [
    "date",
    "event_id",
    "home_id",
    "home_team",
    "home_conference",
    "home_score",
    "away_id",
    "away_team",
    "away_conference",
    "away_score",
    "winner_id",
    "loser_id",
    "margin",
    "total_points",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def load_teams(path: Path | None = None) -> dict[str, dict[str, str]]:
    if path is None:
        path = TEAMS_PATH
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    teams: dict[str, dict[str, str]] = {}
    for row in rows:
        item_id = str(row["item_id"])
        if item_id in teams:
            raise ValueError(f"Duplicate team ID: {item_id}")
        teams[item_id] = {
            "item_id": item_id,
            "item": row["item"],
            "conference": row["conference"],
        }
    if len(teams) < 10:
        raise ValueError("The roster must contain at least ten teams")
    return teams


def fetch_scoreboard(game_date: str, opener=urlopen) -> dict:
    url = f"{SOURCE_URL}?dates={game_date.replace('-', '')}&groups=50&limit=400"
    request = Request(url, headers={"User-Agent": "ncaa-division-i-tracker/1.0"})
    with opener(request, timeout=45) as response:
        if getattr(response, "status", 200) != 200:
            raise RuntimeError(f"Scoreboard returned HTTP {response.status}")
        return json.loads(response.read().decode("utf-8"))


def raw_path(game_date: str) -> Path:
    return RAW_DIR / game_date / "espn_scoreboard.json.gz"


def write_raw(game_date: str, payload: dict) -> Path:
    destination = raw_path(game_date)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("wb", delete=False, dir=destination.parent) as temporary:
        temporary_path = Path(temporary.name)
        with gzip.GzipFile(fileobj=temporary, mode="wb", mtime=0) as compressed:
            compressed.write(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    os.replace(temporary_path, destination)
    return destination


def read_raw_files() -> list[tuple[str, dict]]:
    files: list[tuple[str, dict]] = []
    if not RAW_DIR.exists():
        return files
    for path in sorted(RAW_DIR.glob("*/espn_scoreboard.json.gz")):
        game_date = path.parent.name
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            files.append((game_date, json.load(handle)))
    return files


def _score(value) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def completed_games(payload: dict, teams: dict[str, dict[str, str]]) -> list[dict]:
    games = []
    for event in payload.get("events", []):
        status = event.get("status", {}).get("type", {})
        if not status.get("completed"):
            status_name = str(status.get("name", "")).lower()
            if status_name not in {"status_final", "final"}:
                continue
        competition = (event.get("competitions") or [{}])[0]
        competitors = competition.get("competitors") or []
        if len(competitors) < 2:
            continue
        parsed = []
        for competitor in competitors[:2]:
            team = competitor.get("team") or {}
            item_id = str(team.get("id", ""))
            parsed.append({
                "item_id": item_id,
                "item": team.get("displayName") or team.get("shortDisplayName") or item_id,
                "score": _score(competitor.get("score")),
                "home_away": competitor.get("homeAway"),
            })
        if len(parsed) != 2 or any(row["score"] is None for row in parsed):
            continue
        if parsed[0]["score"] == parsed[1]["score"]:
            continue
        tracked = []
        for competitor in parsed:
            if competitor["item_id"] not in teams:
                continue
            opponent = next(row for row in parsed if row is not competitor)
            tracked.append({
                "item_id": competitor["item_id"],
                "score": competitor["score"],
                "opponent_score": opponent["score"],
                "home_away": competitor["home_away"],
            })
        if not tracked:
            continue
        games.append({
            "event_id": str(event.get("id", "")),
            "teams": tracked,
            "competitors": parsed,
        })
    return games


def _initial_state(teams: dict[str, dict[str, str]]) -> dict[str, dict]:
    return {
        item_id: {
            **team,
            "games_played": 0,
            "wins": 0,
            "losses": 0,
            "points_for": 0,
            "points_against": 0,
            "streak_results": [],
        }
        for item_id, team in teams.items()
    }


def _apply_game(state: dict[str, dict], game: dict) -> None:
    for team in game["teams"]:
        item_id = team["item_id"]
        won = team["score"] > team["opponent_score"]
        row = state[item_id]
        row["games_played"] += 1
        row["wins"] += int(won)
        row["losses"] += int(not won)
        row["points_for"] += team["score"]
        row["points_against"] += team["opponent_score"]
        row["streak_results"].append("W" if won else "L")


def _streak(results: list[str]) -> str:
    if not results:
        return "-"
    latest = results[-1]
    count = 0
    for result in reversed(results):
        if result != latest:
            break
        count += 1
    return f"{latest}{count}"


def _snapshot_row(game_date: str, state: dict) -> dict[str, str | int | float]:
    games = state["games_played"]
    points_for = state["points_for"]
    points_against = state["points_against"]
    return {
        "date": game_date,
        "item_id": state["item_id"],
        "item": state["item"],
        "source": SOURCE_NAME,
        "conference": state["conference"],
        "games_played": games,
        "wins": state["wins"],
        "losses": state["losses"],
        "win_pct": round(state["wins"] / games, 6) if games else 0,
        "points_for": points_for,
        "points_against": points_against,
        "point_diff": points_for - points_against,
        "avg_points_for": round(points_for / games, 3) if games else 0,
        "avg_points_against": round(points_against / games, 3) if games else 0,
        "streak": _streak(state["streak_results"]),
    }


def build_history(teams: dict[str, dict[str, str]], raw_files: list[tuple[str, dict]]) -> list[dict]:
    state = _initial_state(teams)
    seen_games: set[str] = set()
    history: list[dict] = []
    for game_date, payload in sorted(raw_files, key=lambda pair: pair[0]):
        for game in completed_games(payload, teams):
            game_key = game["event_id"] or "-".join(sorted(row["item_id"] for row in game["teams"]))
            if game_key in seen_games:
                continue
            seen_games.add(game_key)
            _apply_game(state, game)
        history.extend(_snapshot_row(game_date, state[item_id]) for item_id in sorted(state, key=int))
    return history


def build_games(teams: dict[str, dict[str, str]], raw_files: list[tuple[str, dict]]) -> list[dict]:
    games: list[dict] = []
    seen_games: set[str] = set()
    for game_date, payload in sorted(raw_files, key=lambda pair: pair[0]):
        for game in completed_games(payload, teams):
            game_key = game["event_id"] or "-".join(sorted(row["item_id"] for row in game["competitors"]))
            if game_key in seen_games:
                continue
            seen_games.add(game_key)
            competitors = game["competitors"]
            home = next((row for row in competitors if row["home_away"] == "home"), competitors[0])
            away = next((row for row in competitors if row["home_away"] == "away"), competitors[1])
            winner = home if home["score"] > away["score"] else away
            loser = away if winner is home else home

            def team_name(row: dict) -> str:
                return teams.get(row["item_id"], {}).get("item", row["item"])

            def conference(row: dict) -> str:
                return teams.get(row["item_id"], {}).get("conference", "Outside roster")

            games.append({
                "date": game_date,
                "event_id": game["event_id"],
                "home_id": home["item_id"],
                "home_team": team_name(home),
                "home_conference": conference(home),
                "home_score": home["score"],
                "away_id": away["item_id"],
                "away_team": team_name(away),
                "away_conference": conference(away),
                "away_score": away["score"],
                "winner_id": winner["item_id"],
                "loser_id": loser["item_id"],
                "margin": abs(winner["score"] - loser["score"]),
                "total_points": home["score"] + away["score"],
            })
    return games


def write_history(rows: list[dict]) -> None:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = HISTORY_PATH.with_suffix(".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=HISTORY_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, HISTORY_PATH)


def write_games(rows: list[dict]) -> None:
    GAMES_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = GAMES_PATH.with_suffix(".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=GAME_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, GAMES_PATH)


def validate_dataset(teams: dict[str, dict[str, str]], history_rows: list[dict], game_rows: list[dict]) -> dict:
    issues: list[str] = []
    latest_date = max((row["date"] for row in history_rows), default=None)
    latest_rows = [row for row in history_rows if row["date"] == latest_date] if latest_date else []
    if latest_date and len(latest_rows) != len(teams):
        issues.append(f"latest snapshot has {len(latest_rows)} teams; expected {len(teams)}")
    if len({row["item_id"] for row in latest_rows}) != len(latest_rows):
        issues.append("latest snapshot contains duplicate team IDs")
    if any(row["item_id"] not in teams for row in latest_rows):
        issues.append("latest snapshot contains a team outside the configured roster")
    event_ids = [row["event_id"] for row in game_rows if row["event_id"]]
    if len(event_ids) != len(set(event_ids)):
        issues.append("game log contains duplicate event IDs")
    if any(row["home_score"] == "" or row["away_score"] == "" for row in game_rows):
        issues.append("game log contains a missing score")
    return {
        "ok": not issues,
        "issues": issues,
        "latest_date": latest_date,
        "history_rows": len(history_rows),
        "games_logged": len(game_rows),
    }


def write_status(teams: dict[str, dict[str, str]], raw_files: list[tuple[str, dict]], latest_payload: dict | None, ok: bool, error: str | None = None, requested_dates: list[str] | None = None, failed_dates: list[str] | None = None, history_rows: list[dict] | None = None, game_rows: list[dict] | None = None) -> None:
    dates = [game_date for game_date, _ in raw_files]
    history_rows = history_rows if history_rows is not None else build_history(teams, raw_files)
    game_rows = game_rows if game_rows is not None else build_games(teams, raw_files)
    latest_rows = [row for row in history_rows if dates and row["date"] == dates[-1]]
    quality = validate_dataset(teams, history_rows, game_rows)
    status = {
        "run_time": utc_now().isoformat().replace("+00:00", "Z"),
        "first_run_date": min(dates) if dates else None,
        "days_with_success": len(dates),
        "dates_requested": requested_dates or dates,
        "failed_dates": failed_dates or [],
        "items": len(teams),
        "new_today": [],
        "gone_today": [],
        "games_logged": len(game_rows),
        "data_quality": quality,
        "sources": [{
            "name": SOURCE_NAME,
            "ok": ok,
            "count": len((latest_payload or {}).get("events", [])) if ok else 0,
        }],
    }
    if latest_rows:
        status["items"] = len(latest_rows)
    if error:
        status["error"] = error
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATUS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(status, indent=2), encoding="utf-8")
    os.replace(temporary, STATUS_PATH)


def run_range(start_date: str, end_date: str, opener=urlopen) -> int:
    teams = load_teams()
    requested_dates = [value.isoformat() for value in date_range(start_date, end_date)]
    failed_dates = []
    latest_payload = None
    for game_date in requested_dates:
        try:
            latest_payload = fetch_scoreboard(game_date, opener=opener)
            write_raw(game_date, latest_payload)
        except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
            failed_dates.append(game_date)
            print(f"Pipeline failed for {game_date}: {exc}", file=sys.stderr)
    raw_files = read_raw_files()
    history_rows = build_history(teams, raw_files)
    game_rows = build_games(teams, raw_files)
    write_history(history_rows)
    write_games(game_rows)
    write_status(
        teams,
        raw_files,
        latest_payload,
        ok=not failed_dates,
        error=f"Failed dates: {', '.join(failed_dates)}" if failed_dates else None,
        requested_dates=requested_dates,
        failed_dates=failed_dates,
        history_rows=history_rows,
        game_rows=game_rows,
    )
    return 1 if failed_dates else 0


def date_range(start_date: str, end_date: str):
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if end < start:
        raise ValueError("end date must not be earlier than start date")
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def run(game_date: str, opener=urlopen) -> int:
    return run_range(game_date, game_date, opener=opener)


def previous_utc_date() -> str:
    return (utc_now().date() - timedelta(days=1)).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=previous_utc_date(), help="Scoreboard date in YYYY-MM-DD format")
    parser.add_argument("--start-date", help="First date in a backfill range")
    parser.add_argument("--end-date", help="Last date in a backfill range")
    args = parser.parse_args()
    try:
        if bool(args.start_date) != bool(args.end_date):
            parser.error("--start-date and --end-date must be provided together")
        if args.start_date and args.end_date:
            date.fromisoformat(args.start_date)
            date.fromisoformat(args.end_date)
        else:
            date.fromisoformat(args.date)
    except ValueError:
        parser.error("--date must use YYYY-MM-DD")
    if args.start_date and args.end_date:
        return run_range(args.start_date, args.end_date)
    return run(args.date)


if __name__ == "__main__":
    raise SystemExit(main())

