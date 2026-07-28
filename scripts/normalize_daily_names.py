#!/usr/bin/env python3
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


DB_PATH = Path("~/.group-digest-runtime/wechat_ods.db").expanduser()
DAILY_DIR = Path("data/daily")
SEARCH_INDEX_SCRIPT = Path("scripts/generate_search_index.py")


def fetch_name_maps():
    by_date: dict[str, dict[str, str]] = defaultdict(dict)
    counts: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)

    with sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
              substr(m.sent_at, 1, 10) AS report_date,
              m.sender AS stored_sender,
              COALESCE(
                NULLIF(g.group_nickname, ''),
                NULLIF(g.wechat_nickname, ''),
                NULLIF(m.sender, '')
              ) AS display_sender
            FROM messages m
            LEFT JOIN group_member_names g
              ON g.group_name = m.group_name
             AND g.sender_wxid = m.sender_wxid
            WHERE m.group_name LIKE '%智能体%'
              AND m.sender <> ''
              AND m.sent_at <> ''
            """
        )
        for row in rows:
            report_date = row["report_date"]
            stored_sender = (row["stored_sender"] or "").strip()
            display_sender = (row["display_sender"] or "").strip()
            if not report_date or not stored_sender or not display_sender:
                continue
            if stored_sender == display_sender:
                continue
            counts[(report_date, stored_sender)][display_sender] += 1

    for (report_date, stored_sender), counter in counts.items():
        display_sender, _ = counter.most_common(1)[0]
        by_date[report_date][stored_sender] = display_sender

    return by_date


def replace_sender_prefixes(content: str, name_map: dict[str, str]) -> str:
    if not isinstance(content, str) or not content or not name_map:
        return content

    updated = content
    for old_name, new_name in sorted(name_map.items(), key=lambda item: len(item[0]), reverse=True):
        if not old_name or not new_name or old_name == new_name:
            continue
        escaped = re.escape(old_name)
        updated = re.sub(rf"(^|\n)(-\s*){escaped}([：:])", rf"\1\2{new_name}\3", updated)
    return updated


def normalize_file(path: Path, name_map: dict[str, str]) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = False

    for topic in data.get("topics") or []:
        contributors = topic.get("contributors")
        if isinstance(contributors, list):
            normalized = []
            seen = set()
            for name in contributors:
                if not isinstance(name, str):
                    continue
                clean_name = name.strip()
                display_name = name_map.get(clean_name, clean_name)
                if display_name and display_name not in seen:
                    seen.add(display_name)
                    normalized.append(display_name)
            if normalized != contributors:
                topic["contributors"] = normalized
                changed = True

        content = topic.get("content")
        new_content = replace_sender_prefixes(content, name_map)
        if new_content != content:
            topic["content"] = new_content
            changed = True

    if changed:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(path)
    return changed


def main():
    name_maps = fetch_name_maps()
    changed_files = 0

    for path in sorted(DAILY_DIR.glob("*.json")):
        name_map = name_maps.get(path.stem, {})
        if name_map and normalize_file(path, name_map):
            changed_files += 1

    print(f"Normalized names in {changed_files} daily files")
    if SEARCH_INDEX_SCRIPT.exists():
        print("Run `python3 scripts/generate_search_index.py` to refresh search contributors.")


if __name__ == "__main__":
    main()
