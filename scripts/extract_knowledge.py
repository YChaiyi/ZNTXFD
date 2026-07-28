#!/usr/bin/env python3
"""
Extract persistent knowledge items from reviewed group essence JSON files.

The website knowledge base should be backed by real group-digest evidence,
not synthesized from the daily search index. This script reads the item-level
essence files, filters for high-signal items, writes stable item JSON files,
and rebuilds a lightweight index for the Next.js pages.
"""
import argparse
import hashlib
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RUNTIME_DIR = Path.home() / ".group-digest-runtime"
KNOWLEDGE_DIR = PROJECT_ROOT / "data" / "knowledge"
ITEMS_DIR = KNOWLEDGE_DIR / "items"
INDEX_PATH = KNOWLEDGE_DIR / "index.json"

GROUPS = [
    {
        "key": "group1",
        "short": "g1",
        "label": "一群",
        "name": "智能体先锋队一群",
        "active_from": "2026-05-17",
    },
    {
        "key": "group2",
        "short": "g2",
        "label": "二群",
        "name": "智能体先锋队二群",
        "active_from": "2026-06-02",
    },
    {
        "key": "group3",
        "short": "g3",
        "label": "三群",
        "name": "智能体先锋队三群",
        "active_from": "2026-06-14",
    },
    {
        "key": "group4",
        "short": "g4",
        "label": "四群",
        "name": "智能体先锋队四群",
        "active_from": "2026-06-20",
    },
    {
        "key": "group5",
        "short": "g5",
        "label": "五群",
        "name": "智能体先锋队五群",
        "active_from": "2026-07-15",
    },
]

CATEGORY_RULES = [
    (
        "AI 编程与项目交付",
        ["Codex", "Claude Code", "AI开发", "编程", "代码", "开发", "Vue", "React", "ERP", "工作区"],
    ),
    (
        "模型、订阅与工具选择",
        ["Claude", "Fable", "Kimi", "K3", "模型", "订阅", "Token", "额度", "GPT", "Gemini", "OpenAI"],
    ),
    (
        "Agent 工作流与自动化",
        ["Agent", "智能体", "自动化", "workflow", "流程", "MCP", "同步", "权限"],
    ),
    (
        "商业化、电商与增长",
        ["电商", "商业", "变现", "客户", "增长", "Shopee", "TikTok", "副业", "成本"],
    ),
    (
        "内容生产与视频图像",
        ["视频", "图片", "剪辑", "短视频", "混剪", "生图", "内容", "小红书"],
    ),
    (
        "基础设施、账号与成本",
        ["VPS", "Oracle", "Google Cloud", "部署", "账号", "硬件", "算力", "云资源", "NAS", "服务器", "代理", "IP"],
    ),
    (
        "风险、合规与安全边界",
        ["合规", "风险", "安全", "破甲", "权限", "敏感", "会议", "封号", "防封", "风控", "VPN", "被封"],
    ),
]

STRONG_A_SIGNALS = [
    "Codex",
    "Claude",
    "Claude Code",
    "ChatGPT",
    "GPT",
    "Gemini",
    "Kimi",
    "MCP",
    "Agent",
    "API",
    "部署",
    "教程",
    "步骤",
    "SOP",
    "流程",
    "配置",
    "风控",
    "封号",
    "风险",
    "报错",
    "安全",
]

TOOL_MARKERS = [
    "Codex",
    "Claude Code",
    "Claude",
    "ChatGPT",
    "GPT",
    "Gemini",
    "OpenAI",
    "Kimi",
    "K3",
    "Fable",
    "MCP",
    "Vercel",
    "Oracle",
    "Google Cloud",
    "React",
    "Vue",
    "Obsidian",
    "ChatCut",
    "TikTok",
    "Shopee",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("date", help="business date in YYYY-MM-DD")
    parser.add_argument(
        "--runtime-dir",
        type=Path,
        default=DEFAULT_RUNTIME_DIR,
        help="group digest runtime directory",
    )
    return parser.parse_args()


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def normalize_text(value):
    return " ".join(str(value or "").split())


def normalize_key(value):
    text = normalize_text(value).lower()
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "", text)
    return text


def slugify(value, fallback):
    value = normalize_text(value)
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", value, flags=re.UNICODE).strip("-").lower()
    slug = slug[:72].strip("-")
    return slug or fallback


def first_sentence(text, limit=120):
    text = normalize_text(text)
    if not text:
        return ""
    parts = re.split(r"(?<=[。！？!?])", text, maxsplit=1)
    return parts[0].strip()[:limit]


def essence_path(runtime_dir, group_name, date):
    return runtime_dir / "out" / f"{group_name}-群精华项目" / f"{date}-essence.json"


def load_essence(runtime_dir, date):
    reports = []
    missing = []
    for group in GROUPS:
        if date < group["active_from"]:
            continue
        path = essence_path(runtime_dir, group["name"], date)
        if not path.exists():
            missing.append(str(path))
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            fail(f"failed to parse {path}: {exc}")
        reports.append((group, data))

    if missing:
        print("warning: missing group essence files:", file=sys.stderr)
        for path in missing:
            print(f"  - {path}", file=sys.stderr)

    if not reports:
        fail(f"no essence reports found for {date}")
    return reports


def has_strong_signal(item):
    haystack = " ".join(
        [
            normalize_text(item.get("title")),
            normalize_text(item.get("summary")),
            " ".join(normalize_text(tag) for tag in item.get("tags") or []),
        ]
    ).lower()
    return any(signal.lower() in haystack for signal in STRONG_A_SIGNALS)


def should_include(item):
    rating = normalize_text(item.get("rating")).upper()
    if rating in {"AAA", "AA"}:
        return True
    if rating == "A" and (item.get("type") == "deep" or has_strong_signal(item)):
        return True
    return False


def classify_item(item):
    haystack = " ".join(
        [
            normalize_text(item.get("title")),
            normalize_text(item.get("summary")),
            " ".join(normalize_text(tag) for tag in item.get("tags") or []),
        ]
    ).lower()
    best = "其他高价值讨论"
    best_score = 0
    for category, keywords in CATEGORY_RULES:
        score = sum(1 for keyword in keywords if keyword.lower() in haystack)
        if score > best_score:
            best = category
            best_score = score
    return best


def collect_tools(item):
    text = " ".join(
        [
            normalize_text(item.get("title")),
            normalize_text(item.get("summary")),
            " ".join(normalize_text(tag) for tag in item.get("tags") or []),
        ]
    )
    tools = []
    for marker in TOOL_MARKERS:
        if marker.lower() in text.lower() and marker not in tools:
            tools.append(marker)
    return tools


def source_from_quote(group, date, quote, summary):
    speaker = normalize_text(quote.get("speaker")) if isinstance(quote, dict) else ""
    text = normalize_text(quote.get("text")) if isinstance(quote, dict) else ""
    if not text:
        text = first_sentence(summary, 180)
    if len(text) > 180:
        text = text[:177] + "..."
    return {
        "group_key": group["key"],
        "group": group["name"],
        "group_label": group["label"],
        "date": date,
        "speaker": speaker or "社群成员",
        "quote": text,
        "daily_ref": f"/daily/{date}",
    }


def candidate_from_item(group, date, index, item):
    title = normalize_text(item.get("title"))
    summary = normalize_text(item.get("summary"))
    quotes = item.get("quotes") if isinstance(item.get("quotes"), list) else []
    sources = [source_from_quote(group, date, quote, summary) for quote in quotes[:4]]
    if not sources:
        sources = [source_from_quote(group, date, {}, summary)]
    contributors = []
    for source in sources:
        speaker = source["speaker"]
        if speaker and speaker != "社群成员" and speaker not in contributors:
            contributors.append(speaker)

    return {
        "title": title,
        "claim": first_sentence(summary, 160) or title,
        "summary": summary,
        "category": classify_item(item),
        "rating": normalize_text(item.get("rating")).upper() or "A",
        "status": "has_evidence" if quotes else "unverified",
        "tags": unique_strings([normalize_text(tag) for tag in item.get("tags") or []])[:8],
        "tools": collect_tools(item)[:8],
        "sources": sources,
        "contributors": contributors[:12],
        "source_items": [
            {
                "date": date,
                "group_key": group["key"],
                "group": group["name"],
                "item_index": index,
                "rating": normalize_text(item.get("rating")).upper(),
                "type": normalize_text(item.get("type")),
                "time_range": normalize_text(item.get("time_range")),
            }
        ],
    }


def unique_strings(items):
    result = []
    seen = set()
    for item in items:
        item = normalize_text(item)
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def similarity(left, right):
    return SequenceMatcher(None, normalize_key(left), normalize_key(right)).ratio()


def is_same_knowledge(left, right):
    title_similarity = similarity(left.get("title", ""), right.get("title", ""))
    if title_similarity >= 0.82:
        return True

    left_claim = first_sentence(left.get("claim") or left.get("summary"), 100)
    right_claim = first_sentence(right.get("claim") or right.get("summary"), 100)
    if left_claim and right_claim and similarity(left_claim, right_claim) >= 0.88:
        return True

    left_tags = set(left.get("tags") or [])
    right_tags = set(right.get("tags") or [])
    tag_overlap = len(left_tags & right_tags) / max(len(left_tags | right_tags), 1)
    return tag_overlap >= 0.6 and title_similarity >= 0.58


def rating_rank(value):
    return {"AAA": 3, "AA": 2, "A": 1}.get(str(value).upper(), 0)


def merge_candidate(base, incoming):
    if rating_rank(incoming["rating"]) > rating_rank(base["rating"]):
        base["rating"] = incoming["rating"]
    base["tags"] = unique_strings([*base.get("tags", []), *incoming.get("tags", [])])[:10]
    base["tools"] = unique_strings([*base.get("tools", []), *incoming.get("tools", [])])[:10]
    base["contributors"] = unique_strings(
        [*base.get("contributors", []), *incoming.get("contributors", [])]
    )[:20]

    source_keys = {
        (
            source.get("date"),
            source.get("group_key"),
            source.get("speaker"),
            source.get("quote"),
        )
        for source in base.get("sources", [])
    }
    for source in incoming.get("sources", []):
        key = (
            source.get("date"),
            source.get("group_key"),
            source.get("speaker"),
            source.get("quote"),
        )
        if key not in source_keys:
            source_keys.add(key)
            base.setdefault("sources", []).append(source)

    base["source_items"] = [*base.get("source_items", []), *incoming.get("source_items", [])]
    if base["status"] == "unverified" and incoming["status"] == "has_evidence":
        base["status"] = "has_evidence"
    return base


def stable_id(date, candidate):
    source_items = candidate.get("source_items") or []
    first_source = source_items[0] if source_items else {}
    short = next(
        (group["short"] for group in GROUPS if group["key"] == first_source.get("group_key")),
        "gx",
    )
    digest = hashlib.sha1(
        f"{date}|{candidate.get('title')}|{candidate.get('claim')}".encode("utf-8")
    ).hexdigest()[:8]
    return f"{date}-{short}-{slugify(candidate.get('title'), 'knowledge')}-{digest}"


def load_existing_item(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_item(path, item):
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def build_index():
    items = []
    for path in sorted(ITEMS_DIR.glob("*.json")):
        item = load_existing_item(path)
        if not isinstance(item, dict):
            continue
        sources = item.get("sources") if isinstance(item.get("sources"), list) else []
        items.append(
            {
                "id": item.get("id") or path.stem,
                "slug": item.get("slug") or item.get("id") or path.stem,
                "title": item.get("title") or "",
                "claim": item.get("claim") or "",
                "summary": item.get("summary") or item.get("claim") or "",
                "category": item.get("category") or "其他高价值讨论",
                "rating": item.get("rating") or "A",
                "status": item.get("status") or "unverified",
                "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
                "tools": item.get("tools") if isinstance(item.get("tools"), list) else [],
                "contributors": item.get("contributors")
                if isinstance(item.get("contributors"), list)
                else [],
                "source_count": len(sources),
                "source_date": item.get("source_date") or item.get("created_at") or "",
                "created_at": item.get("created_at") or "",
                "updated_at": item.get("updated_at") or "",
            }
        )

    items.sort(
        key=lambda item: (
            item["updated_at"],
            rating_rank(item["rating"]),
            item["source_count"],
        ),
        reverse=True,
    )
    tmp_path = INDEX_PATH.with_suffix(INDEX_PATH.suffix + ".tmp")
    tmp_path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(INDEX_PATH)
    return items


def main():
    args = parse_args()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
        fail("date must be YYYY-MM-DD")

    reports = load_essence(args.runtime_dir, args.date)
    candidates = []
    rating_counts = {"AAA": 0, "AA": 0, "A": 0}
    for group, report in reports:
        items = report.get("items") if isinstance(report.get("items"), list) else []
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict) or not should_include(item):
                continue
            candidate = candidate_from_item(group, args.date, index, item)
            rating_counts[candidate["rating"]] = rating_counts.get(candidate["rating"], 0) + 1

            match = next((existing for existing in candidates if is_same_knowledge(existing, candidate)), None)
            if match:
                merge_candidate(match, candidate)
            else:
                candidates.append(candidate)

    ITEMS_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

    written = 0
    for candidate in candidates:
        item_id = stable_id(args.date, candidate)
        path = ITEMS_DIR / f"{item_id}.json"
        existing = load_existing_item(path)
        item = existing if isinstance(existing, dict) else {}
        item.update(candidate)
        item["id"] = item_id
        item["slug"] = item_id
        item["source_date"] = args.date
        item["created_at"] = item.get("created_at") or args.date
        item["updated_at"] = args.date
        write_item(path, item)
        written += 1

    index = build_index()
    merged = sum(max(0, len(item.get("source_items", [])) - 1) for item in candidates)
    print(
        "Extracted "
        f"{written} knowledge items "
        f"({rating_counts.get('AAA', 0)} AAA, {rating_counts.get('AA', 0)} AA, {rating_counts.get('A', 0)} A candidates), "
        f"{merged} merged cross-group/source items"
    )
    print(f"Indexed {len(index)} knowledge items")
    print(f"Wrote {INDEX_PATH}")


if __name__ == "__main__":
    main()
