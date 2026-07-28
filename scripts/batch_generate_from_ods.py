#!/usr/bin/env python3
"""
Batch generate daily knowledge reports from WeChat ODS database.
Reads messages, clusters them into topics, and outputs structured JSON.

Usage: python3 scripts/batch_generate_from_ods.py 2026-07-09 2026-07-16
"""
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

DB_PATH = Path.home() / ".group-digest-runtime" / "wechat_ods.db"
OUTPUT_DIR = Path("data/daily")

SKIP_PATTERNS = [
    r"^\[.*\]$",          # emoji-only like [破涕为笑]
    r"^收到转账",         # transfer notifications
    r"^<msg>",            # XML messages
    r"撤回了一条消息",    # recalled messages
    r"^系统消息",         # system messages
]

SKIP_MSG_TYPES = {10000, 10002, 49}  # system, revoke, mini-program


def fetch_messages(conn, date_str):
    next_date = date_str[:8] + str(int(date_str[8:10]) + 1).zfill(2)
    if date_str.endswith("31"):
        parts = date_str.split("-")
        m = int(parts[1]) + 1
        next_date = f"{parts[0]}-{m:02d}-01"

    cur = conn.execute(
        """
        SELECT
          m.sender,
          m.sender_wxid,
          COALESCE(
            NULLIF(g.group_nickname, ''),
            NULLIF(g.wechat_nickname, ''),
            NULLIF(m.sender, ''),
            '未知用户'
          ) AS display_sender,
          m.content,
          m.msg_type,
          m.sent_at
        FROM messages m
        LEFT JOIN group_member_names g
          ON g.group_name = m.group_name
         AND g.sender_wxid = m.sender_wxid
        WHERE m.group_name LIKE '%智能体%'
          AND m.sent_at >= ? AND m.sent_at < ?
        ORDER BY m.sent_at ASC
        """,
        (f"{date_str} 00:00:00", f"{next_date} 00:00:00"),
    )
    rows = cur.fetchall()
    filtered = []
    for row in rows:
        sender = (row["display_sender"] or row["sender"] or "未知用户").strip() or "未知用户"
        content = row["content"]
        msg_type = row["msg_type"]
        sent_at = row["sent_at"]
        if msg_type in SKIP_MSG_TYPES:
            continue
        if not content or len(content.strip()) < 3:
            continue
        if sender == "系统":
            continue
        if any(re.search(p, content) for p in SKIP_PATTERNS):
            continue
        # skip image-only
        if content.strip().startswith("[图片]") and len(content.strip()) < 20:
            continue
        filtered.append({
            "sender": sender,
            "participant_key": (row["sender_wxid"] or sender).strip() or sender,
            "content": content.strip(),
            "time": sent_at,
        })
    return filtered


def cluster_messages(messages):
    """Simple keyword-based clustering into conversation threads."""
    if not messages:
        return {}

    # Keywords that indicate AI/tech topics
    topic_keywords = {
        "Claude": ["claude", "anthropic", "sonnet", "opus", "haiku"],
        "GPT/OpenAI": ["gpt", "openai", "chatgpt", "o1", "o3", "o4"],
        "Codex": ["codex"],
        "编程开发": ["代码", "编程", "python", "javascript", "github", "api", "开发", "框架", "部署"],
        "AI工具": ["cursor", "windsurf", "bolt", "v0", "replit", "lovable", "manus"],
        "AI应用": ["agent", "智能体", "workflow", "自动化", "prompt", "提示词"],
        "商业变现": ["变现", "赚钱", "收入", "付费", "商业", "客户", "创业", "副业"],
        "AI视频/图片": ["视频", "图片", "生图", "midjourney", "suno", "kling", "可灵", "sora"],
        "本地部署": ["本地", "ollama", "部署", "开源模型", "llama", "qwen"],
        "行业动态": ["发布", "更新", "新功能", "上线", "官方", "公告"],
    }

    topics = defaultdict(list)
    uncategorized = []

    for msg in messages:
        content_lower = msg["content"].lower()
        matched = False
        for topic, keywords in topic_keywords.items():
            if any(kw in content_lower for kw in keywords):
                topics[topic].append(msg)
                matched = True
                break
        if not matched:
            uncategorized.append(msg)

    # Merge small topics into "其他讨论"
    final_topics = {}
    other = uncategorized[:]
    for topic, msgs in topics.items():
        if len(msgs) >= 3:
            final_topics[topic] = msgs
        else:
            other.extend(msgs)

    if other and len(other) >= 3:
        final_topics["其他讨论"] = other

    return final_topics


def extract_tools(messages):
    """Extract tool/product names mentioned."""
    tool_patterns = [
        "Claude", "GPT", "ChatGPT", "Codex", "Cursor", "Windsurf", "Bolt",
        "V0", "Replit", "Lovable", "Manus", "Midjourney", "Suno", "Kling",
        "可灵", "Sora", "Ollama", "Llama", "Qwen", "DeepSeek", "Gemini",
        "Anthropic", "OpenAI", "Perplexity", "NotebookLM", "Dify", "Coze",
        "扣子", "豆包", "通义", "文心", "Kimi", "MCP", "n8n", "ComfyUI",
        "Stable Diffusion", "飞书", "Notion", "Obsidian", "Arc", "Vercel",
        "Supabase", "Firebase", "GitHub Copilot", "Copilot", "Trae",
        "Claude Code", "Augment", "Sol",
    ]
    found = set()
    all_text = " ".join(m["content"] for m in messages).lower()
    for tool in tool_patterns:
        if tool.lower() in all_text:
            found.add(tool)
    return sorted(found)


def extract_contributors(messages):
    """Get top contributors by message count."""
    counter = Counter(m["sender"] for m in messages)
    return [name for name, _ in counter.most_common(5)]


def summarize_topic(topic_name, messages):
    """Create a knowledge summary from clustered messages."""
    contributors = extract_contributors(messages)
    tools = extract_tools(messages)

    # Build content from actual messages
    key_messages = []
    seen = set()
    for msg in messages:
        text = msg["content"]
        # Skip very short or duplicate
        if len(text) < 10 or text in seen:
            continue
        # Skip pure images
        if text.startswith("[图片]") or text.startswith("- image:"):
            continue
        seen.add(text)
        key_messages.append(f"- {msg['sender']}：{text}")

    # Take top messages as content (limit to avoid too long)
    content_lines = key_messages[:15]
    content = "\n".join(content_lines)

    # Extract insights from longer messages
    insights = []
    for msg in messages:
        text = msg["content"]
        if len(text) > 30 and not text.startswith("[") and not text.startswith("<"):
            insight = text[:80].strip()
            if insight not in insights and len(insights) < 5:
                insights.append(insight)

    # Generate tags
    tags = []
    if tools:
        tags.extend(tools[:3])
    tags.append("社群讨论")
    if any(kw in topic_name for kw in ["变现", "商业", "赚钱"]):
        tags.append("商业化")
    if any(kw in topic_name for kw in ["编程", "开发", "代码"]):
        tags.append("技术开发")
    if any(kw in topic_name for kw in ["AI", "智能体", "Agent"]):
        tags.append("AI应用")

    # Action items from messages containing actionable language
    action_items = []
    action_keywords = ["可以", "建议", "推荐", "试试", "值得", "应该"]
    for msg in messages:
        text = msg["content"]
        if any(kw in text for kw in action_keywords) and 15 < len(text) < 120:
            item = text.strip()
            if item not in action_items and len(action_items) < 3:
                action_items.append(item)

    return {
        "title": topic_name,
        "content": content if content else f"群内关于{topic_name}的讨论",
        "key_insights": insights[:5] if insights else [f"群友围绕{topic_name}展开讨论"],
        "tools_mentioned": tools[:6],
        "action_items": action_items[:3],
        "contributors": contributors[:5],
        "tags": list(dict.fromkeys(tags))[:5],
    }


def generate_report(conn, date_str):
    messages = fetch_messages(conn, date_str)
    if not messages:
        print(f"  No messages for {date_str}, skipping")
        return None

    clusters = cluster_messages(messages)
    if not clusters:
        print(f"  No topics for {date_str}, skipping")
        return None

    topics = []
    for topic_name, topic_messages in clusters.items():
        topic = summarize_topic(topic_name, topic_messages)
        topics.append(topic)

    # Sort by number of messages (most active first)
    topics.sort(key=lambda t: len(t["content"]), reverse=True)

    unique_senders = len(set(m.get("participant_key") or m["sender"] for m in messages))

    # Generate title from top topics
    top_topic_names = [t["title"] for t in topics[:3] if t["title"] != "其他讨论"]
    title = "与".join(top_topic_names[:2]) if top_topic_names else "社群日常讨论"

    report = {
        "date": date_str,
        "title": title,
        "topics": topics,
        "stats": {
            "total_messages": len(messages),
            "active_members": unique_senders,
        },
    }
    return report


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 batch_generate_from_ods.py START_DATE END_DATE")
        print("Example: python3 batch_generate_from_ods.py 2026-07-09 2026-07-16")
        sys.exit(1)

    start = sys.argv[1]
    end = sys.argv[2]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Generate date range
    from datetime import date, timedelta
    d = date.fromisoformat(start)
    end_d = date.fromisoformat(end)

    generated = 0
    while d <= end_d:
        date_str = d.isoformat()
        out_path = OUTPUT_DIR / f"{date_str}.json"
        print(f"Generating {date_str}...")
        report = generate_report(conn, date_str)
        if report:
            out_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"  -> {out_path} ({len(report['topics'])} topics, {report['stats']['total_messages']} msgs)")
            generated += 1
        d += timedelta(days=1)

    conn.close()
    print(f"\nDone: generated {generated} reports")


if __name__ == "__main__":
    main()
