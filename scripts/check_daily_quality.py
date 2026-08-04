#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DAILY_DIR = PROJECT_ROOT / "data" / "daily"

BAD_PATTERNS = [
    "拍了拍",
    "撤回了一条消息",
    "收到转账",
    "<msg>",
    "系统消息",
]

TIME_FRAGMENT_RE = re.compile(r"(?:^|\D)\d{1,2}:\d{1,2}(?:\D|$)")
CHAT_LINE_RE = re.compile(r"^\s*-\s*[^：:\n]{1,24}[：:]", re.MULTILINE)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("date", help="YYYY-MM-DD")
    parser.add_argument(
        "--daily-dir",
        type=Path,
        default=DAILY_DIR,
        help="directory containing generated daily JSON files",
    )
    return parser.parse_args()


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def as_list(value):
    return value if isinstance(value, list) else []


def check_topic(topic, index):
    title = str(topic.get("title") or "").strip()
    content = str(topic.get("content") or "").strip()
    if not title:
        fail(f"topic #{index} has empty title")
    if len(content) < 80:
        fail(f"topic {title!r} content is too short")

    raw_hits = []
    for pattern in BAD_PATTERNS:
        if pattern in content:
            raw_hits.append(pattern)
    if CHAT_LINE_RE.search(content) and not any(marker in content for marker in ["### 关键沉淀", "### 证据原话"]):
        raw_hits.append("raw chat line shape")
    if len(TIME_FRAGMENT_RE.findall(content)) >= 4:
        raw_hits.append("many time fragments")
    if raw_hits:
        fail(f"topic {title!r} looks raw: {', '.join(raw_hits)}")

    if len(as_list(topic.get("key_insights"))) == 0:
        fail(f"topic {title!r} has no key_insights")
    if len(as_list(topic.get("tags"))) == 0:
        fail(f"topic {title!r} has no tags")


def check_action_items(topics):
    holders = {}
    for topic in topics:
        title = str(topic.get("title") or "").strip()
        for action in as_list(topic.get("action_items")):
            # Collapse whitespace the same way the generator does, so
            # duplicates differing only in spacing cannot evade the check.
            action_text = " ".join(str(action).split())
            if not action_text:
                fail(f"topic {title!r} has an empty action item")
            if action_text in holders:
                fail(
                    "action item duplicated across topics "
                    f"({holders[action_text]!r} and {title!r}): {action_text!r}"
                )
            holders[action_text] = title


def main():
    args = parse_args()
    path = args.daily_dir / f"{args.date}.json"
    if not path.exists():
        fail(f"daily report not found: {path}")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"failed to parse {path}: {exc}")

    topics = report.get("topics")
    if not isinstance(topics, list) or not topics:
        fail("daily report has no topics")

    for index, topic in enumerate(topics, start=1):
        if not isinstance(topic, dict):
            fail(f"topic #{index} is not an object")
        check_topic(topic, index)

    check_action_items(topics)

    print(f"Quality OK: {path} ({len(topics)} topics)")


if __name__ == "__main__":
    main()
