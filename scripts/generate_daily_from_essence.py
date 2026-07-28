#!/usr/bin/env python3
"""
Generate a website daily report from the curated group essence JSON files.

This intentionally does not read raw WeChat rows. The website is a knowledge
base, so its daily report should be built from the reviewed group essence
artifacts rather than from unedited chat fragments.
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "data" / "daily"
DEFAULT_RUNTIME_DIR = Path.home() / ".group-digest-runtime"

GROUPS = [
    {"name": "智能体先锋队一群", "active_from": "2026-05-17"},
    {"name": "智能体先锋队二群", "active_from": "2026-06-02"},
    {"name": "智能体先锋队三群", "active_from": "2026-06-14"},
    {"name": "智能体先锋队四群", "active_from": "2026-06-20"},
    {"name": "智能体先锋队五群", "active_from": "2026-07-15"},
]

CATEGORY_RULES = [
    (
        "AI 编程与项目交付",
        "把 Codex、Claude Code、工程协作和老项目改造里的经验沉淀成可复用的交付方法。",
        ["Codex", "Claude Code", "AI开发", "编程", "代码", "开发", "Vue", "React", "ERP", "工作区"],
    ),
    (
        "模型、订阅与工具选择",
        "围绕模型能力、额度、订阅稳定性和工具组合，提炼更稳的选型判断。",
        ["Claude", "Fable", "Kimi", "K3", "模型", "订阅", "Token", "额度", "GPT", "Gemini", "OpenAI"],
    ),
    (
        "Agent 工作流与自动化",
        "把 Agent、流程编排、同步和权限问题整理成可执行的自动化经验。",
        ["Agent", "智能体", "自动化", "workflow", "流程", "MCP", "同步", "权限"],
    ),
    (
        "商业化、电商与增长",
        "记录社群里真实业务场景的算账、避坑和增长打法。",
        ["电商", "商业", "变现", "客户", "增长", "Shopee", "TikTok", "副业", "卖", "成本"],
    ),
    (
        "内容生产与视频图像",
        "沉淀短视频、图像、剪辑和内容流水线中的工具经验与成本判断。",
        ["视频", "图片", "剪辑", "短视频", "混剪", "生图", "内容", "小红书"],
    ),
    (
        "基础设施、账号与成本",
        "把云资源、本地部署、账号切换和运行成本整理成基础设施决策参考。",
        [
            "VPS",
            "Oracle",
            "Google Cloud",
            "本地",
            "部署",
            "账号",
            "硬件",
            "算力",
            "云资源",
            "IPv4",
            "NAS",
            "存储",
            "硬盘",
            "RAID",
            "备份",
            "相册",
            "私有云",
            "服务器",
            "节点",
            "线路",
            "Shadowrocket",
            "Tailscale",
            "代理",
            "IP",
        ],
    ),
    (
        "风险、合规与安全边界",
        "标记越界能力、数据安全、权限开放和会议入库里的风险点。",
        ["合规", "风险", "安全", "破甲", "权限", "敏感", "会议", "封号", "防封", "指纹", "VPN", "被封"],
    ),
]

RATING_SCORE = {"AAA": 4, "AA": 3, "A": 2}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("date", help="YYYY-MM-DD")
    parser.add_argument(
        "--runtime-dir",
        type=Path,
        default=DEFAULT_RUNTIME_DIR,
        help="group digest runtime directory",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="directory for the generated daily JSON",
    )
    return parser.parse_args()


def essence_path(runtime_dir, group_name, date):
    return runtime_dir / "out" / f"{group_name}-群精华项目" / f"{date}-essence.json"


def load_group_essence(runtime_dir, date):
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
            print(f"error: failed to parse {path}: {exc}", file=sys.stderr)
            sys.exit(1)
        reports.append(data)

    if missing:
        print("error: missing required group essence files:", file=sys.stderr)
        for path in missing:
            print(f"  - {path}", file=sys.stderr)
        sys.exit(1)

    if not reports:
        print(f"error: no active group essence files for {date}", file=sys.stderr)
        sys.exit(1)

    return reports


def normalize_text(value):
    return " ".join(str(value or "").split())


def item_score(item):
    rating = str(item.get("rating") or "").upper()
    type_bonus = 1 if item.get("type") == "deep" else 0
    summary_len = min(len(normalize_text(item.get("summary"))) / 120, 1)
    return RATING_SCORE.get(rating, 1) * 10 + type_bonus + summary_len


def classify_item(item):
    haystack = " ".join(
        [
            normalize_text(item.get("title")),
            normalize_text(item.get("summary")),
            " ".join(normalize_text(tag) for tag in item.get("tags") or []),
        ]
    ).lower()

    best_name = "其他高价值讨论"
    best_desc = "保留当天值得回看的零散经验，作为后续知识库继续沉淀的素材。"
    best_score = 0
    for name, desc, keywords in CATEGORY_RULES:
        score = 0
        for keyword in keywords:
            if keyword.lower() in haystack:
                score += 1
        if score > best_score:
            best_name = name
            best_desc = desc
            best_score = score

    return best_name, best_desc


def collect_tools(tags):
    tools = []
    tool_markers = [
        "Codex",
        "Claude",
        "Claude Code",
        "Fable",
        "Kimi",
        "K3",
        "GPT",
        "Gemini",
        "OpenAI",
        "Oracle",
        "Google Cloud",
        "Vercel",
        "Vue",
        "React",
        "TikTok",
        "Shopee",
        "MCP",
    ]
    text = " ".join(tags)
    for marker in tool_markers:
        if marker.lower() in text.lower():
            tools.append(marker)
    return tools


def first_sentence(text):
    text = normalize_text(text)
    if not text:
        return ""
    parts = re.split(r"(?<=[。！？!?])", text, maxsplit=1)
    sentence = parts[0].strip()
    return sentence[:120]


def collect_contributors(items):
    contributors = []
    seen = set()
    for item in items:
        for quote in item.get("quotes") or []:
            speaker = normalize_text(quote.get("speaker"))
            if speaker and speaker not in seen:
                seen.add(speaker)
                contributors.append(speaker)
            if len(contributors) >= 8:
                return contributors
    return contributors


def collect_quotes(items, limit=5):
    quotes = []
    for item in items:
        for quote in item.get("quotes") or []:
            speaker = normalize_text(quote.get("speaker"))
            text = normalize_text(quote.get("text"))
            if not speaker or not text:
                continue
            if len(text) > 120:
                text = text[:117] + "..."
            quotes.append((speaker, text))
            if len(quotes) >= limit:
                return quotes
    return quotes


def tags_for_topic(category_name, items):
    tags = [category_name.replace("、", "/").replace("与", "/")]
    seen = set(tags)
    tag_counter = defaultdict(int)
    for item in items:
        for tag in item.get("tags") or []:
            tag = normalize_text(tag)
            if tag:
                tag_counter[tag] += 1
    for tag, _ in sorted(tag_counter.items(), key=lambda pair: (-pair[1], pair[0])):
        if tag not in seen:
            seen.add(tag)
            tags.append(tag)
        if len(tags) >= 5:
            break
    return tags


def action_items_for_topic(topic_tags, group_actions):
    matches = []
    tag_text = " ".join(topic_tags).lower()
    for action in group_actions:
        action_text = normalize_text(action)
        if not action_text:
            continue
        action_lower = action_text.lower()
        if any(part and part in action_lower for part in re.split(r"[/、\s]+", tag_text)):
            matches.append(action_text)
        elif len(matches) < 2:
            matches.append(action_text)
        if len(matches) >= 3:
            break
    return list(dict.fromkeys(matches))[:3]


def build_content(description, items):
    lines = [description, "", "### 关键沉淀"]
    for item in items[:7]:
        title = normalize_text(item.get("title"))
        summary = normalize_text(item.get("summary"))
        if title and summary:
            lines.append(f"- **{title}**：{summary}")

    quotes = collect_quotes(items)
    if quotes:
        lines.extend(["", "### 证据原话"])
        for speaker, text in quotes:
            lines.append(f"- {speaker}：{text}")

    return "\n".join(lines).strip()


def build_topics(reports):
    buckets = {}
    group_actions = []

    for report in reports:
        group = report.get("group_name") or ""
        for action in report.get("actions") or []:
            group_actions.append(action)
        for item in report.get("items") or []:
            enriched = dict(item)
            enriched["_group"] = group
            category, description = classify_item(item)
            bucket = buckets.setdefault(category, {"description": description, "items": []})
            bucket["items"].append(enriched)

    topics = []
    for category, bucket in buckets.items():
        items = sorted(bucket["items"], key=item_score, reverse=True)
        if not items:
            continue
        tags = tags_for_topic(category, items)
        insights = []
        for item in items:
            insight = first_sentence(item.get("summary"))
            if insight and insight not in insights:
                insights.append(insight)
            if len(insights) >= 4:
                break
        all_tags = []
        for item in items:
            all_tags.extend(normalize_text(tag) for tag in item.get("tags") or [])

        topics.append(
            {
                "title": category,
                "content": build_content(bucket["description"], items),
                "key_insights": insights,
                "tools_mentioned": collect_tools(all_tags)[:8],
                "action_items": action_items_for_topic(tags + all_tags, group_actions),
                "contributors": collect_contributors(items),
                "tags": tags,
                "_score": sum(item_score(item) for item in items),
            }
        )

    topics.sort(key=lambda topic: topic.pop("_score"), reverse=True)
    return topics[:10]


def build_title(topics):
    if not topics:
        return "社群知识日报"
    names = [topic["title"] for topic in topics[:2]]
    return "、".join(names)


def build_stats(reports):
    total_messages = 0
    active_members = 0
    for report in reports:
        stats = report.get("stats") or {}
        total_messages += int(stats.get("message_count") or 0)
        active_members += int(stats.get("active_users") or 0)
    return {"total_messages": total_messages, "active_members": active_members}


def main():
    args = parse_args()
    reports = load_group_essence(args.runtime_dir, args.date)
    topics = build_topics(reports)
    report = {
        "date": args.date,
        "title": build_title(topics),
        "topics": topics,
        "stats": build_stats(reports),
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"{args.date}.json"
    tmp_path = output_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(output_path)
    print(f"Generated {len(topics)} essence-backed topics")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
