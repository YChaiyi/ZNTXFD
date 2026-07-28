#!/usr/bin/env python3
import json
import sys
from pathlib import Path


DAILY_DIR = Path("data/daily")
INDEX_PATH = Path("data/index.json")


def load_daily_file(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"error: failed to parse {path}: {exc}", file=sys.stderr)
        sys.exit(1)


def build_index_item(report):
    topics = report.get("topics") if isinstance(report.get("topics"), list) else []
    stats = report.get("stats") if isinstance(report.get("stats"), dict) else {}
    tags = []
    seen = set()

    for topic in topics:
        if not isinstance(topic, dict):
            continue
        for tag in topic.get("tags") or []:
            if not isinstance(tag, str):
                continue
            tag = tag.strip()
            if tag and tag not in seen:
                seen.add(tag)
                tags.append(tag)

    return {
        "date": str(report.get("date") or ""),
        "title": str(report.get("title") or ""),
        "tags": tags,
        "topic_count": len(topics),
        "total_messages": int(stats.get("total_messages") or 0),
        "active_members": int(stats.get("active_members") or 0),
    }


def main():
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    DAILY_DIR.mkdir(parents=True, exist_ok=True)

    items = []
    for path in sorted(DAILY_DIR.glob("*.json")):
        report = load_daily_file(path)
        if not isinstance(report, dict):
            print(f"error: {path} must contain a JSON object", file=sys.stderr)
            sys.exit(1)
        items.append(build_index_item(report))

    items.sort(key=lambda item: item["date"], reverse=True)
    tmp_path = INDEX_PATH.with_suffix(INDEX_PATH.suffix + ".tmp")
    tmp_path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(INDEX_PATH)
    print(f"Indexed {len(items)} daily reports")
    print(f"Wrote {INDEX_PATH}")


if __name__ == "__main__":
    main()
