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
                "competitors": [
                    {"homeAway": "home", "score": str(score_a), "team": {"id": "1", "displayName": "Alpha"}},
                    {"homeAway": "away", "score": str(score_b), "team": {"id": "2", "displayName": "Beta"}},
                ]
            }],
        }]
    }


class PipelineTests(unittest.TestCase):
    def test_completed_game_is_normalized_for_both_teams(self):
        teams = {
            "1": {"item_id": "1", "item": "Alpha", "conference": "Test"},
            "2": {"item_id": "2", "item": "Beta", "conference": "Test"},
        }
        games = pipeline.completed_games(payload_for(), teams)
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["winner"], "1")

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

    def test_run_replaces_same_date_and_writes_compressed_raw_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            teams_path = root / "teams.csv"
            teams_path.write_text(
                "item_id,item,conference\n"
                + "".join(f"{item_id},Team {item_id},Test\n" for item_id in range(1, 11)),
                encoding="utf-8",
            )
            with patch.object(pipeline, "ROOT", root), patch.object(pipeline, "TEAMS_PATH", teams_path), patch.object(pipeline, "RAW_DIR", root / "data" / "raw"), patch.object(pipeline, "HISTORY_PATH", root / "data" / "history.csv"), patch.object(pipeline, "STATUS_PATH", root / "data" / "status.json"), patch.object(pipeline, "fetch_scoreboard", return_value=payload_for()):
                self.assertEqual(pipeline.run("2026-11-23"), 0)
                self.assertEqual(pipeline.run("2026-11-23"), 0)
                raw = root / "data" / "raw" / "2026-11-23" / "espn_scoreboard.json.gz"
                with gzip.open(raw, "rt", encoding="utf-8") as handle:
                    self.assertEqual(len(json.load(handle)["events"]), 1)
                with (root / "data" / "history.csv").open(newline="", encoding="utf-8") as handle:
                    rows = list(csv.DictReader(handle))
                self.assertEqual(len(rows), 10)
                self.assertEqual(rows[0]["games_played"], "1")


if __name__ == "__main__":
    unittest.main()

