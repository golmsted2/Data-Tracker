import csv
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src import pipeline


def payload_for(date_value="2026-11-23", score_a=82, score_b=74):
    return {
        "events": [{
            "id": "game-1",
            "date": f"{date_value}T23:00Z",
            "status": {"type": {"completed": True, "name": "STATUS_FINAL"}},
            "competitions": [{
                "neutralSite": False,
                "competitors": [
                    {"homeAway": "home", "score": str(score_a), "team": {"id": "1", "displayName": "Alpha"}},
                    {"homeAway": "away", "score": str(score_b), "team": {"id": "2", "displayName": "Beta"}},
                ]
            }],
        }]
    }


def rankings_payload():
    return {
        "requestedSeason": {"displayName": "2026-27", "week": {"displayValue": "Week 4"}},
        "latestWeek": {"displayValue": "Week 4"},
        "rankings": [
            {
                "name": "AP Top 25",
                "shortName": "AP Poll",
                "ranks": [{
                    "current": 1,
                    "previous": 3,
                    "trend": "+2",
                    "points": 1500,
                    "firstPlaceVotes": 50,
                    "recordSummary": "6-0",
                    "date": "2026-11-23T08:00Z",
                    "team": {"id": "1", "location": "Alpha", "logo": "https://example.test/alpha.png"},
                }],
            },
            {
                "name": "Coaches Poll",
                "shortName": "Coaches Poll",
                "ranks": [{
                    "current": 2,
                    "previous": 1,
                    "trend": "-1",
                    "points": 1400,
                    "firstPlaceVotes": 2,
                    "recordSummary": "6-0",
                    "date": "2026-11-23T08:00Z",
                    "team": {"id": "1", "location": "Alpha", "logo": "https://example.test/alpha.png"},
                }],
            },
        ],
    }


class PipelineTests(unittest.TestCase):
    def test_rankings_are_normalized_for_ap_and_coaches_polls(self):
        rankings = pipeline.normalize_rankings(rankings_payload())
        self.assertEqual(rankings["season"], "2026-27")
        self.assertEqual(rankings["week"], "Week 4")
        self.assertEqual([poll["key"] for poll in rankings["polls"]], ["ap", "coaches"])
        self.assertEqual(rankings["polls"][0]["ranks"][0]["previous_rank"], 3)
        self.assertEqual(rankings["polls"][1]["ranks"][0]["trend"], "-1")

    def test_completed_game_is_normalized_for_both_teams(self):
        teams = {
            "1": {"item_id": "1", "item": "Alpha", "conference": "Test"},
            "2": {"item_id": "2", "item": "Beta", "conference": "Test"},
        }
        games = pipeline.completed_games(payload_for(), teams)
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["teams"][0]["item_id"], "1")

    def test_game_against_untracked_opponent_is_counted(self):
        teams = {"1": {"item_id": "1", "item": "Alpha", "conference": "Test"}}
        payload = payload_for()
        payload["events"][0]["competitions"][0]["competitors"][1]["team"] = {"id": "999", "displayName": "Other Division I Team"}
        games = pipeline.completed_games(payload, teams)
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["teams"][0]["opponent_score"], 74)
        rows = pipeline.build_history(teams, [("2026-11-23", payload)])
        self.assertEqual(rows[0]["games_played"], 1)
        self.assertEqual(rows[0]["wins"], 1)

    def test_history_accumulates_and_carries_forward(self):
        teams = {
            "1": {"item_id": "1", "item": "Alpha", "conference": "Test"},
            "2": {"item_id": "2", "item": "Beta", "conference": "Test"},
        }
        rows = pipeline.build_history(teams, [("2026-11-23", payload_for())])
        alpha = next(row for row in rows if row["item_id"] == "1")
        beta = next(row for row in rows if row["item_id"] == "2")
        self.assertEqual(alpha["wins"], 1)
        self.assertEqual(alpha["point_diff"], 8)
        self.assertEqual(beta["losses"], 1)
        self.assertEqual(beta["streak"], "L1")

    def test_duplicate_event_is_counted_once(self):
        teams = {
            "1": {"item_id": "1", "item": "Alpha", "conference": "Test"},
            "2": {"item_id": "2", "item": "Beta", "conference": "Test"},
        }
        duplicate_dates = [("2026-11-23", payload_for()), ("2026-11-24", payload_for())]
        rows = pipeline.build_history(teams, duplicate_dates)
        latest = [row for row in rows if row["date"] == "2026-11-24" and row["item_id"] == "1"][0]
        self.assertEqual(latest["games_played"], 1)

    def test_game_log_contains_matchup_and_result_fields(self):
        teams = {
            "1": {"item_id": "1", "item": "Alpha", "conference": "Test"},
            "2": {"item_id": "2", "item": "Beta", "conference": "Test"},
        }
        games = pipeline.build_games(teams, [("2026-11-23", payload_for())])
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["winner_id"], "1")
        self.assertEqual(games[0]["neutral_site"], "false")
        self.assertEqual(games[0]["margin"], 8)
        self.assertEqual(games[0]["total_points"], 156)

    def test_data_quality_flags_duplicate_game_events(self):
        teams = {"1": {"item_id": "1", "item": "Alpha", "conference": "Test"}}
        game = {
            "event_id": "game-1",
            "home_id": "1",
            "home_score": 80,
            "away_score": 70,
        }
        quality = pipeline.validate_dataset(teams, [{"date": "2026-11-23", "item_id": "1"}], [game, game.copy()])
        self.assertFalse(quality["ok"])
        self.assertIn("duplicate event IDs", quality["issues"][0])

    def test_run_replaces_same_date_and_writes_compressed_raw_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            teams_path = root / "teams.csv"
            teams_path.write_text(
                "item_id,item,conference\n"
                + "".join(f"{item_id},Team {item_id},Test\n" for item_id in range(1, 11)),
                encoding="utf-8",
            )
            with patch.object(pipeline, "ROOT", root), patch.object(pipeline, "TEAMS_PATH", teams_path), patch.object(pipeline, "RAW_DIR", root / "data" / "raw"), patch.object(pipeline, "HISTORY_PATH", root / "data" / "history.csv"), patch.object(pipeline, "GAMES_PATH", root / "data" / "games.csv"), patch.object(pipeline, "LIVE_GAMES_PATH", root / "data" / "live_games.json"), patch.object(pipeline, "STATUS_PATH", root / "data" / "status.json"), patch.object(pipeline, "RANKINGS_PATH", root / "data" / "rankings.json"), patch.object(pipeline, "fetch_scoreboard", return_value=payload_for()), patch.object(pipeline, "fetch_rankings", return_value=rankings_payload()):
                self.assertEqual(pipeline.run("2026-11-23"), 0)
                self.assertEqual(pipeline.run("2026-11-23"), 0)
                raw = root / "data" / "raw" / "2026-11-23" / "espn_scoreboard.json.gz"
                with gzip.open(raw, "rt", encoding="utf-8") as handle:
                    self.assertEqual(len(json.load(handle)["events"]), 1)
                with (root / "data" / "history.csv").open(newline="", encoding="utf-8") as handle:
                    rows = list(csv.DictReader(handle))
                self.assertEqual(len(rows), 10)
                self.assertEqual(rows[0]["games_played"], "1")
                with (root / "data" / "games.csv").open(newline="", encoding="utf-8") as handle:
                    games = list(csv.DictReader(handle))
                self.assertEqual(len(games), 1)


if __name__ == "__main__":
    unittest.main()

