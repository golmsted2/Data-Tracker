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
LIVE_GAMES_PATH = ROOT / "data" / "live_games.json"
STATUS_PATH = ROOT / "data" / "status.json"
RANKINGS_PATH = ROOT / "data" / "rankings.json"
SOURCE_NAME = "ESPN Men's College Basketball Scoreboard"
RANKINGS_SOURCE_NAME = "ESPN Men's College Basketball Rankings"
SOURCE_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/scoreboard"
)
RANKINGS_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/rankings"
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
    "neutral_site",
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


def fetch_rankings(opener=urlopen) -> dict:
    request = Request(RANKINGS_URL, headers={"User-Agent": "ncaa-division-i-tracker/1.0"})
    with opener(request, timeout=45) as response:
        if getattr(response, "status", 200) != 200:
            raise RuntimeError(f"Rankings returned HTTP {response.status}")
        return json.loads(response.read().decode("utf-8"))


def normalize_rankings(payload: dict) -> dict:
    polls = []
    for ranking in payload.get("rankings", []):
        name = ranking.get("name", "")
        key = "ap" if "AP" in name else "coaches" if "Coach" in name else ""
        if not key:
            continue
        ranks = []
        for entry in ranking.get("ranks", []):
            team = entry.get("team") or {}
            ranks.append({
                "rank": entry.get("current"),
                "previous_rank": entry.get("previous"),
                "trend": entry.get("trend", ""),
                "points": entry.get("points", 0),
                "first_place_votes": entry.get("firstPlaceVotes", 0),
                "team_id": str(team.get("id", "")),
                "team": team.get("location") or team.get("shortName") or team.get("name", ""),
                "record": entry.get("recordSummary", ""),
                "logo": team.get("logo", ""),
            })
        polls.append({
            "key": key,
            "name": name,
            "short_name": ranking.get("shortName", name),
            "date": next((entry.get("date") for entry in ranking.get("ranks", []) if entry.get("date")), ""),
            "last_updated": next((entry.get("lastUpdated") for entry in ranking.get("ranks", []) if entry.get("lastUpdated")), ""),
            "ranks": ranks,
        })
    polls.sort(key=lambda poll: {"ap": 0, "coaches": 1}.get(poll["key"], 2))
    if not polls:
        raise ValueError("Rankings response contained no AP or Coaches poll")
    requested = payload.get("requestedSeason") or payload.get("latestSeason") or {}
    week = payload.get("latestWeek") or requested.get("week") or {}
    return {
        "source": RANKINGS_SOURCE_NAME,
        "fetched_at": utc_now().isoformat().replace("+00:00", "Z"),
        "season": requested.get("displayName", ""),
        "week": week.get("displayValue") or week.get("display", ""),
        "polls": polls,
    }


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


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def canonical_rows(rows: list[dict], fields: list[str]) -> list[dict[str, str]]:
    return [{field: str(row.get(field, "")) for field in fields} for row in rows]


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
        neutral_site = competition.get("neutralSite") is True or str(competition.get("neutralSite", "")).lower() == "true"
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
            "neutral_site": neutral_site,
            "teams": tracked,
            "competitors": parsed,
        })
    return games


def scoreboard_games(game_date: str, payload: dict, teams: dict[str, dict[str, str]]) -> list[dict]:
    games = []
    for event in payload.get("events", []):
        competition = (event.get("competitions") or [{}])[0]
        competitors = competition.get("competitors") or []
        if len(competitors) < 2:
            continue
        parsed = []
        for competitor in competitors[:2]:
            team = competitor.get("team") or {}
            item_id = str(team.get("id", ""))
            if item_id not in teams:
                continue
            parsed.append({
                "item_id": item_id,
                "item": teams[item_id]["item"],
                "conference": teams[item_id]["conference"],
                "score": _score(competitor.get("score")),
                "home_away": competitor.get("homeAway"),
            })
        if len(parsed) < 2:
            continue
        home = next((row for row in parsed if row["home_away"] == "home"), parsed[0])
        away = next((row for row in parsed if row["home_away"] == "away"), parsed[1])
        status = event.get("status", {}).get("type", {})
        status_name = str(status.get("name", "")).lower()
        state = str(status.get("state", "")).lower()
        completed = bool(status.get("completed")) or status_name in {"status_final", "final"}
        in_progress = state in {"in", "live"} or any(value in status_name for value in ("progress", "halftime", "period"))
        label = "Final" if completed else "In progress" if in_progress else "Scheduled"
        home_score = home["score"]
        away_score = away["score"]
        winner_id = ""
        if completed and home_score is not None and away_score is not None and home_score != away_score:
            winner_id = home["item_id"] if home_score > away_score else away["item_id"]
        games.append({
            "date": game_date,
            "event_id": str(event.get("id", "")),
            "neutral_site": str(competition.get("neutralSite", False)).lower(),
            "home_id": home["item_id"],
            "home_team": home["item"],
            "home_conference": home["conference"],
            "home_score": home_score if home_score is not None else "",
            "away_id": away["item_id"],
            "away_team": away["item"],
            "away_conference": away["conference"],
            "away_score": away_score if away_score is not None else "",
            "winner_id": winner_id,
            "completed": completed,
            "status": label,
            "status_detail": status.get("shortDetail") or status.get("detail") or status.get("description") or "",
            "start_time": event.get("date", ""),
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


def movement_summary(history_rows: list[dict], limit: int = 8) -> dict:
    dates = sorted({row.get("date", "") for row in history_rows if row.get("date")})
    current_date = dates[-1] if dates else None
    previous_date = dates[-2] if len(dates) > 1 else None
    current = {str(row["item_id"]): row for row in history_rows if row.get("date") == current_date}
    previous = {str(row["item_id"]): row for row in history_rows if row.get("date") == previous_date}
    movers = []
    if previous_date:
        for item_id in sorted(current):
            if item_id not in previous:
                continue
            current_row, previous_row = current[item_id], previous[item_id]
            win_pct_delta = float(current_row.get("win_pct", 0) or 0) - float(previous_row.get("win_pct", 0) or 0)
            point_diff_delta = int(float(current_row.get("point_diff", 0) or 0)) - int(float(previous_row.get("point_diff", 0) or 0))
            if win_pct_delta or point_diff_delta:
                movers.append({
                    "item_id": item_id,
                    "item": current_row.get("item", item_id),
                    "win_pct_old": float(previous_row.get("win_pct", 0) or 0),
                    "win_pct_new": float(current_row.get("win_pct", 0) or 0),
                    "win_pct_delta": win_pct_delta,
                    "point_diff_old": int(float(previous_row.get("point_diff", 0) or 0)),
                    "point_diff_new": int(float(current_row.get("point_diff", 0) or 0)),
                    "point_diff_delta": point_diff_delta,
                })
    movers.sort(key=lambda row: (abs(row["win_pct_delta"]), abs(row["point_diff_delta"])), reverse=True)
    current_ids, previous_ids = set(current), set(previous)
    return {
        "current_date": current_date,
        "previous_date": previous_date,
        "movers": movers[:limit],
        "appeared": sorted(current_ids - previous_ids) if previous_date else [],
        "disappeared": sorted(previous_ids - current_ids) if previous_date else [],
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
                "neutral_site": str(game.get("neutral_site", False)).lower(),
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


def write_live_games(game_date: str, rows: list[dict]) -> None:
    LIVE_GAMES_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = LIVE_GAMES_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps({"date": game_date, "fetched_at": utc_now().isoformat().replace("+00:00", "Z"), "games": rows}, indent=2), encoding="utf-8")
    os.replace(temporary, LIVE_GAMES_PATH)


def write_rankings(rows: dict) -> None:
    RANKINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = RANKINGS_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    os.replace(temporary, RANKINGS_PATH)


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


def write_status(teams: dict[str, dict[str, str]], raw_files: list[tuple[str, dict]], latest_payload: dict | None, ok: bool, error: str | None = None, requested_dates: list[str] | None = None, failed_dates: list[str] | None = None, history_rows: list[dict] | None = None, game_rows: list[dict] | None = None, rankings_data: dict | None = None, rankings_error: str | None = None) -> None:
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
    if rankings_data is not None or rankings_error:
        status["sources"].append({
            "name": RANKINGS_SOURCE_NAME,
            "ok": rankings_error is None,
            "count": sum(len(poll.get("ranks", [])) for poll in (rankings_data or {}).get("polls", [])),
        })
        if rankings_error:
            status["rankings_error"] = rankings_error
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
    rankings_data = None
    rankings_error = None
    for game_date in requested_dates:
        try:
            latest_payload = fetch_scoreboard(game_date, opener=opener)
            write_raw(game_date, latest_payload)
        except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
            failed_dates.append(game_date)
            print(f"Pipeline failed for {game_date}: {exc}", file=sys.stderr)
    raw_files = read_raw_files()
    if latest_payload is not None and requested_dates:
        write_live_games(requested_dates[-1], scoreboard_games(requested_dates[-1], latest_payload, teams))
    history_rows = build_history(teams, raw_files)
    game_rows = build_games(teams, raw_files)
    write_history(history_rows)
    write_games(game_rows)
    try:
        rankings_data = normalize_rankings(fetch_rankings(opener=opener))
        write_rankings(rankings_data)
    except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        rankings_error = str(exc)
        print(f"Rankings fetch failed: {exc}", file=sys.stderr)
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
        rankings_data=rankings_data,
        rankings_error=rankings_error,
    )
    return 0


def run_live(game_date: str, opener=urlopen) -> int:
    """Poll the current scoreboard and write only when a completed game changes data."""
    teams = load_teams()
    try:
        payload = fetch_scoreboard(game_date, opener=opener)
    except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
        print(f"Live scoreboard poll failed: {exc}", file=sys.stderr)
        return 0
    live_rows = scoreboard_games(game_date, payload, teams)
    existing_live = {}
    if LIVE_GAMES_PATH.exists():
        try:
            existing_live = json.loads(LIVE_GAMES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing_live = {}
    live_changed = existing_live.get("date") != game_date or existing_live.get("games", []) != live_rows
    if live_changed:
        write_live_games(game_date, live_rows)
    completed = completed_games(payload, teams)
    existing_raw = read_raw_files()
    if not completed and not any(existing_date == game_date for existing_date, _ in existing_raw):
        print("No completed tracked games yet; live scoreboard published.")
        return 0
    raw_files = [(existing_date, existing_payload) for existing_date, existing_payload in existing_raw if existing_date != game_date]
    raw_files.append((game_date, payload))
    raw_files.sort(key=lambda pair: pair[0])
    history_rows = build_history(teams, raw_files)
    game_rows = build_games(teams, raw_files)
    if (canonical_rows(history_rows, HISTORY_FIELDS) == canonical_rows(read_csv_rows(HISTORY_PATH), HISTORY_FIELDS)
            and canonical_rows(game_rows, GAME_FIELDS) == canonical_rows(read_csv_rows(GAMES_PATH), GAME_FIELDS)):
        print("No completed-game data changes detected; live scoreboard refreshed only.")
        return 0
    write_raw(game_date, payload)
    write_history(history_rows)
    write_games(game_rows)
    rankings_data = None
    if RANKINGS_PATH.exists():
        try:
            rankings_data = json.loads(RANKINGS_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            rankings_data = None
    write_status(
        teams,
        raw_files,
        latest_payload=payload,
        ok=True,
        requested_dates=[game_date],
        history_rows=history_rows,
        game_rows=game_rows,
        rankings_data=rankings_data,
    )
    print(f"Live update wrote {len(completed)} completed tracked games for {game_date}.")
    return 0


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
    parser.add_argument("--date", help="Scoreboard date in YYYY-MM-DD format")
    parser.add_argument("--start-date", help="First date in a backfill range")
    parser.add_argument("--end-date", help="Last date in a backfill range")
    parser.add_argument("--live", action="store_true", help="Poll the current date and write only completed-game changes")
    args = parser.parse_args()
    if args.live:
        if args.start_date or args.end_date:
            parser.error("--live cannot be combined with a date range")
        target_date = args.date or utc_now().date().isoformat()
        try:
            date.fromisoformat(target_date)
        except ValueError:
            parser.error("--date must use YYYY-MM-DD")
        return run_live(target_date)
    target_date = args.date or previous_utc_date()
    try:
        if bool(args.start_date) != bool(args.end_date):
            parser.error("--start-date and --end-date must be provided together")
        if args.start_date and args.end_date:
            date.fromisoformat(args.start_date)
            date.fromisoformat(args.end_date)
        else:
            date.fromisoformat(target_date)
    except ValueError:
        parser.error("--date must use YYYY-MM-DD")
    if args.start_date and args.end_date:
        return run_range(args.start_date, args.end_date)
    return run(target_date)


if __name__ == "__main__":
    raise SystemExit(main())

