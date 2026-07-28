#!/usr/bin/env python3
import json
import sys
from pathlib import Path


DAILY_DIR = Path("data/daily")
SEARCH_INDEX_PATH = Path("data/search-index.json")


def load_daily_file(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"error: failed to parse {path}: {exc}", file=sys.stderr)
        sys.exit(1)


def as_string_list(value):
    if not isinstance(value, list):
        return []

    items = []
    for item in value:
        if not isinstance(item, str):
            continue
        item = item.strip()
        if item:
            items.append(item)
    return items


def excerpt(text, limit=200):
    if not isinstance(text, str):
        return ""
    normalized = " ".join(text.split())
    return normalized[:limit]


def build_search_items(report, fallback_date):
    topics = report.get("topics") if isinstance(report.get("topics"), list) else []
    date = str(report.get("date") or fallback_date)
    report_title = str(report.get("title") or "")
    items = []

    for index, topic in enumerate(topics):
        if not isinstance(topic, dict):
            continue
        items.append(
            {
                "id": f"{date}-{index}",
                "date": date,
                "reportTitle": report_title,
                "title": str(topic.get("title") or ""),
                "content": excerpt(topic.get("content")),
                "tags": as_string_list(topic.get("tags")),
                "tools": as_string_list(topic.get("tools_mentioned")),
                "insights": as_string_list(topic.get("key_insights")),
                "contributors": as_string_list(topic.get("contributors")),
            }
        )

    return items


def main():
    SEARCH_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    DAILY_DIR.mkdir(parents=True, exist_ok=True)

    items = []
    for path in sorted(DAILY_DIR.glob("*.json"), reverse=True):
        report = load_daily_file(path)
        if not isinstance(report, dict):
            print(f"error: {path} must contain a JSON object", file=sys.stderr)
            sys.exit(1)
        items.extend(build_search_items(report, path.stem))

    tmp_path = SEARCH_INDEX_PATH.with_suffix(SEARCH_INDEX_PATH.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(SEARCH_INDEX_PATH)
    print(f"Indexed {len(items)} topics")
    print(f"Wrote {SEARCH_INDEX_PATH}")


if __name__ == "__main__":
    main()
