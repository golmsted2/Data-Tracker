import json
from datetime import datetime, timezone

from src import pipeline
from src.github_issue import build_issue_body


def test_current_scoreboard_date_uses_central_calendar_date(monkeypatch):
    monkeypatch.setattr(pipeline, "utc_now", lambda: datetime(2026, 11, 26, 5, 30, tzinfo=timezone.utc))
    assert pipeline.current_scoreboard_date() == "2026-11-25"


def test_movement_rule_reports_old_and_new_values():
    rows = [
        {"date": "2026-11-23", "item_id": "1", "item": "Alpha", "win_pct": "0.500000", "point_diff": "4"},
        {"date": "2026-11-23", "item_id": "2", "item": "Beta", "win_pct": "0.750000", "point_diff": "12"},
        {"date": "2026-11-24", "item_id": "1", "item": "Alpha", "win_pct": "0.666667", "point_diff": "10"},
        {"date": "2026-11-24", "item_id": "2", "item": "Beta", "win_pct": "0.750000", "point_diff": "12"},
    ]
    summary = pipeline.movement_summary(rows)
    assert summary["current_date"] == "2026-11-24"
    assert summary["previous_date"] == "2026-11-23"
    assert summary["movers"][0]["item"] == "Alpha"
    assert summary["movers"][0]["win_pct_old"] == 0.5
    assert summary["movers"][0]["win_pct_new"] == 0.666667
    assert summary["movers"][0]["point_diff_old"] == 4
    assert summary["movers"][0]["point_diff_new"] == 10


def test_daily_issue_body_contains_comparison_and_source_status():
    rows = [
        {"date": "2026-11-23", "item_id": "1", "item": "Alpha", "win_pct": "0.500000", "point_diff": "4"},
        {"date": "2026-11-24", "item_id": "1", "item": "Alpha", "win_pct": "0.666667", "point_diff": "10"},
    ]
    body = build_issue_body(rows, {"items": 1, "games_logged": 2, "sources": [{"name": "Test source", "ok": True, "count": 2}]}, "2026-11-24")
    assert "Alpha" in body
    assert "4 → 10" in body
    assert "Test source" in body
    assert "Mover rule" in body


def test_failed_source_still_writes_status_and_returns_success(tmp_path, monkeypatch):
    teams_path = tmp_path / "teams.csv"
    teams_path.write_text("item_id,item,conference\n" + "".join(f"{i},Team {i},Test\n" for i in range(1, 11)), encoding="utf-8")
    monkeypatch.setattr(pipeline, "ROOT", tmp_path)
    monkeypatch.setattr(pipeline, "TEAMS_PATH", teams_path)
    monkeypatch.setattr(pipeline, "RAW_DIR", tmp_path / "data" / "raw")
    monkeypatch.setattr(pipeline, "HISTORY_PATH", tmp_path / "data" / "history.csv")
    monkeypatch.setattr(pipeline, "GAMES_PATH", tmp_path / "data" / "games.csv")
    monkeypatch.setattr(pipeline, "LIVE_GAMES_PATH", tmp_path / "data" / "live_games.json")
    monkeypatch.setattr(pipeline, "STATUS_PATH", tmp_path / "data" / "status.json")
    monkeypatch.setattr(pipeline, "RANKINGS_PATH", tmp_path / "data" / "rankings.json")
    monkeypatch.setattr(pipeline, "fetch_rankings", lambda opener: {"polls": []})

    def failing_opener(request, timeout=45):
        raise OSError("source unavailable")

    assert pipeline.run("2026-11-24", opener=failing_opener) == 0
    status = json.loads((tmp_path / "data" / "status.json").read_text(encoding="utf-8"))
    assert status["failed_dates"] == ["2026-11-24"]
    assert status["sources"][0]["ok"] is False


def test_live_poll_writes_completed_game_and_skips_duplicate_poll(tmp_path, monkeypatch):
    teams_path = tmp_path / "teams.csv"
    teams_path.write_text("item_id,item,conference\n" + "".join(f"{i},Team {i},Test\n" for i in range(1, 11)), encoding="utf-8")
    monkeypatch.setattr(pipeline, "ROOT", tmp_path)
    monkeypatch.setattr(pipeline, "TEAMS_PATH", teams_path)
    monkeypatch.setattr(pipeline, "RAW_DIR", tmp_path / "data" / "raw")
    monkeypatch.setattr(pipeline, "HISTORY_PATH", tmp_path / "data" / "history.csv")
    monkeypatch.setattr(pipeline, "GAMES_PATH", tmp_path / "data" / "games.csv")
    monkeypatch.setattr(pipeline, "LIVE_GAMES_PATH", tmp_path / "data" / "live_games.json")
    monkeypatch.setattr(pipeline, "STATUS_PATH", tmp_path / "data" / "status.json")
    monkeypatch.setattr(pipeline, "RANKINGS_PATH", tmp_path / "data" / "rankings.json")
    payload = {
        "events": [{
            "id": "live-game-1",
            "status": {"type": {"completed": True, "name": "STATUS_FINAL"}},
            "competitions": [{
                "neutralSite": False,
                "competitors": [
                    {"homeAway": "home", "score": "82", "team": {"id": "1", "displayName": "Team 1"}},
                    {"homeAway": "away", "score": "74", "team": {"id": "2", "displayName": "Team 2"}},
                ],
            }],
        }],
    }
    monkeypatch.setattr(pipeline, "fetch_scoreboard", lambda game_date, opener: payload)
    assert pipeline.run_live("2026-11-25") == 0
    assert len(pipeline.read_csv_rows(tmp_path / "data" / "games.csv")) == 1
    assert pipeline.run_live("2026-11-25") == 0


def test_scoreboard_games_preserves_in_progress_status():
    teams = {
        "1": {"item_id": "1", "item": "Alpha", "conference": "Test"},
        "2": {"item_id": "2", "item": "Beta", "conference": "Test"},
    }
    payload = {
        "events": [{
            "id": "live-game",
            "date": "2026-11-25T01:00Z",
            "status": {"type": {"state": "in", "name": "STATUS_IN_PROGRESS", "detail": "2nd Half - 04:12"}},
            "competitions": [{
                "neutralSite": False,
                "competitors": [
                    {"homeAway": "home", "score": "61", "team": {"id": "1", "displayName": "Alpha"}},
                    {"homeAway": "away", "score": "58", "team": {"id": "2", "displayName": "Beta"}},
                ],
            }],
        }],
    }
    game = pipeline.scoreboard_games("2026-11-25", payload, teams)[0]
    assert game["status"] == "In progress"
    assert game["status_detail"] == "2nd Half - 04:12"
    assert game["completed"] is False
