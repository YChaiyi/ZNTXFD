#!/usr/bin/env python3
"""Batch generate daily reports for all dates with messages but no report."""
import json
import sqlite3
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BEIJING_TZ = ZoneInfo("Asia/Shanghai")
DB_PATH = Path("~/.group-digest-runtime/wechat_ods.db").expanduser()
DAILY_DIR = Path(__file__).resolve().parent.parent / "data" / "daily"
SCRIPT = Path(__file__).resolve().parent / "generate_daily.py"


def get_dates_with_messages():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT DISTINCT DATE(sent_at) as d FROM messages "
            "WHERE group_name LIKE '%智能体先锋队%' "
            "ORDER BY d"
        ).fetchall()
    return [r[0] for r in rows]


def get_existing_reports():
    if not DAILY_DIR.exists():
        return set()
    return {p.stem for p in DAILY_DIR.glob("*.json")}


def needs_enhancement(report_path):
    try:
        data = json.loads(report_path.read_text(encoding="utf-8"))
        for topic in data.get("topics", []):
            if "key_insights" not in topic:
                return True
        return False
    except Exception:
        return True


def run_one(date_str):
    print(f"\n{'='*60}")
    print(f"Processing {date_str}")
    print(f"{'='*60}")
    start = time.time()
    try:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--date", date_str],
            capture_output=True, text=True, timeout=900,
        )
        elapsed = time.time() - start
        if result.returncode == 0:
            print(f"  OK ({elapsed:.0f}s)")
            return True
        else:
            print(f"  FAILED ({elapsed:.0f}s): {result.stderr[-200:]}")
            return False
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT after 900s")
        return False


def main():
    all_dates = get_dates_with_messages()
    existing = get_existing_reports()

    today_bj = datetime.now(BEIJING_TZ).date().isoformat()
    if today_bj in all_dates:
        all_dates.remove(today_bj)

    missing = [d for d in all_dates if d not in existing]
    needs_update = [d for d in all_dates if d in existing and needs_enhancement(DAILY_DIR / f"{d}.json")]

    todo = sorted(set(missing + needs_update))

    print(f"Total dates with messages: {len(all_dates)}")
    print(f"Missing reports: {len(missing)}")
    print(f"Need enhancement: {len(needs_update)}")
    print(f"Total to process: {len(todo)}")
    print()

    success = 0
    failed = 0
    for i, d in enumerate(todo, 1):
        print(f"\n[{i}/{len(todo)}] ", end="")
        if run_one(d):
            success += 1
        else:
            failed += 1

    print(f"\n\n{'='*60}")
    print(f"DONE: {success} success, {failed} failed out of {len(todo)} total")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
