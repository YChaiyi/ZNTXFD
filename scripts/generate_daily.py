#!/usr/bin/env python3
import argparse
import json
import re
import sqlite3
import subprocess
import sys
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

BEIJING_TZ = ZoneInfo("Asia/Shanghai")
DB_PATH = Path("~/.group-digest-runtime/wechat_ods.db").expanduser()
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "daily"
WORK_DIR = Path(__file__).resolve().parent.parent / "data" / ".work"
SKIP_MSG_TYPES = {"system", "系统消息", "sticker", "动画表情", "red_packet", "pat"}
BRACKET_EMOJI_RE = re.compile(r"^(?:\s*\[[^\[\]\n]{1,24}\]\s*)+$")
MAX_MESSAGES = 3000
TIMEOUT_SECONDS = 600

CODEX_CMD = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write"]

PROMPT_TEMPLATE = """你是一个社群知识整理专家。请阅读消息文件 {messages_file}（智能体先锋队社群在 {date} 的全部消息，格式：[HH:MM:SS] 发送者: 内容），将讨论内容内化为结构化的知识日报，并把结果以 JSON 写入文件 {output_json}。

只写 JSON 文件，不要输出其他内容。JSON 结构（严格遵守）：

{{
  "title": "当日知识日报的总标题（概括最重要的 1-2 个话题）",
  "topics": [
    {{
      "title": "话题标题",
      "content": "知识内容，markdown 格式，可以有列表、加粗等。不是简单摘要，而是将讨论内容内化为知识输出，用流畅的文字描述核心知识点、洞见和结论。",
      "key_insights": ["核心观点1（一句话概括一个关键洞见）", "核心观点2"],
      "tools_mentioned": ["工具或资源名称1", "工具或资源名称2"],
      "action_items": ["可执行建议1（群友看完可以立刻做的事）", "可执行建议2"],
      "contributors": ["贡献者1", "贡献者2"],
      "tags": ["标签1", "标签2"]
    }}
  ]
}}

要求：
1. 不是简单摘要，而是将讨论内容内化为知识输出
2. 按话题分段，每个话题给出清晰的标题
3. 每个话题下，用流畅的文字描述核心知识点、洞见和结论
4. key_insights：提炼 2-5 个核心观点，每个用一句话概括，是该话题最有价值的洞见
5. tools_mentioned：提取讨论中提到的所有工具、产品、平台、链接（如 Claude Code、Cursor、n8n 等），没有则留空数组
6. action_items：提炼 1-3 个可执行建议，是群友看完后可以立刻行动的事情，没有则留空数组
7. 标注每个话题的核心贡献者（发言最多或提出关键观点的人），只能使用消息文件中方括号时间后面的发送者展示名；这些展示名已按“群昵称 > 微信昵称 > 兜底原始 sender”处理。严禁改写为通讯录备注、私人备注或你推断出的真实姓名
8. 为每个话题打 1-3 个标签（如：AI Agent、商业化、技术方案、行业趋势等）
9. 如果某些讨论没有实质知识价值（纯闲聊、表情等），直接跳过
10. JSON 字符串内的双引号必须转义为 \\"

统计信息：共 {message_count} 条有效消息，{active_users} 人参与讨论。
"""


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD, defaults to today Beijing time")
    return parser.parse_args()


def resolve_date(date_arg):
    if date_arg:
        try:
            return datetime.strptime(date_arg, "%Y-%m-%d").date()
        except ValueError:
            print("error: --date must be YYYY-MM-DD", file=sys.stderr)
            sys.exit(2)
    return datetime.now(BEIJING_TZ).date()


def fetch_messages(report_date):
    if not DB_PATH.exists():
        print(f"error: database not found: {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    start = datetime.combine(report_date, datetime.min.time()).strftime("%Y-%m-%d %H:%M:%S")
    end = datetime.combine(report_date + timedelta(days=1), datetime.min.time()).strftime("%Y-%m-%d %H:%M:%S")
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return list(conn.execute(
            """
            SELECT
              m.id,
              m.group_name,
              m.sender,
              m.sender_wxid,
              m.sender_name_source,
              COALESCE(
                NULLIF(g.group_nickname, ''),
                NULLIF(g.wechat_nickname, ''),
                NULLIF(m.sender, ''),
                '未知用户'
              ) AS display_sender,
              m.sent_at,
              m.content,
              m.msg_type
            FROM messages m
            LEFT JOIN group_member_names g
              ON g.group_name = m.group_name
             AND g.sender_wxid = m.sender_wxid
            WHERE m.group_name LIKE ? AND m.sent_at >= ? AND m.sent_at < ?
            ORDER BY m.sent_at ASC, m.id ASC
            """,
            ("%智能体%", start, end),
        ))


def display_sender(row):
    return (row["display_sender"] or row["sender"] or "未知用户").strip() or "未知用户"


def participant_key(row):
    wxid = (row["sender_wxid"] or "").strip()
    if wxid:
        return wxid
    return display_sender(row)


def is_meaningful_message(row):
    msg_type = (row["msg_type"] or "").strip()
    content = (row["content"] or "").strip()
    if msg_type in SKIP_MSG_TYPES:
        return False
    if not content:
        return False
    if BRACKET_EMOJI_RE.fullmatch(content):
        return False
    meaningful = False
    all_emoji = True
    for char in content:
        if char.isspace() or char in {"️", "‍"}:
            continue
        meaningful = True
        if not unicodedata.category(char).startswith("S"):
            all_emoji = False
            break
    if meaningful and all_emoji:
        return False
    return True


def write_messages_file(messages, messages_path):
    sampled = list(messages)
    header = ""
    if len(messages) > MAX_MESSAGES:
        step = (len(messages) - 1) / max(MAX_MESSAGES - 1, 1)
        indices = [min(len(messages) - 1, int(round(i * step))) for i in range(MAX_MESSAGES)]
        indices = list(dict.fromkeys(indices))
        sampled = [messages[i] for i in indices[:MAX_MESSAGES]]
        header = f"# 消息过多：原始 {len(messages)} 条，已均匀抽样保留 {len(sampled)} 条\n\n"

    lines = []
    for row in sampled:
        sent_at = row["sent_at"] or ""
        try:
            time_text = datetime.strptime(sent_at, "%Y-%m-%d %H:%M:%S").strftime("%H:%M:%S")
        except ValueError:
            time_text = sent_at[11:19] if len(sent_at) >= 19 else "--:--:--"
        sender = display_sender(row)
        content = " ".join((row["content"] or "").split())
        lines.append(f"[{time_text}] {sender}: {content}")
    messages_path.write_text(header + "\n".join(lines), encoding="utf-8")
    return len(sampled)


def run_codex(prompt, output_json):
    if output_json.exists():
        output_json.unlink()
    print("  Calling codex exec...")
    try:
        result = subprocess.run(
            CODEX_CMD + [prompt],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            cwd=str(WORK_DIR),
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("codex exec timed out")

    if result.returncode != 0:
        raise RuntimeError(f"codex exit code {result.returncode}: {result.stderr[:300]}")

    if not output_json.exists():
        raise RuntimeError(f"codex did not produce {output_json.name}")

    raw = output_json.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx == -1 or end_idx <= start_idx:
            raise RuntimeError("codex output is not valid JSON")
        data = json.loads(cleaned[start_idx:end_idx + 1])

    if not isinstance(data, dict) or not isinstance(data.get("topics"), list):
        raise RuntimeError("codex JSON missing required 'topics' array")
    return data


def generate(report_date):
    print(f"Generating daily report for {report_date.isoformat()} (Beijing time)")

    raw_messages = fetch_messages(report_date)
    messages = [row for row in raw_messages if is_meaningful_message(row)]
    active_members = len({participant_key(row) for row in messages if participant_key(row)})
    stats = {"total_messages": len(messages), "active_members": active_members}

    print(f"  Raw messages: {len(raw_messages)}")
    print(f"  After filtering: {len(messages)}")
    print(f"  Active members: {active_members}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{report_date.isoformat()}.json"

    if not messages:
        report = {"date": report_date.isoformat(), "title": f"{report_date.isoformat()} 知识日报", "topics": [], "stats": stats}
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  No messages, wrote empty report")
        return

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    messages_path = WORK_DIR / f"{report_date.isoformat()}-messages.txt"
    output_json = WORK_DIR / f"{report_date.isoformat()}-knowledge.json"
    write_messages_file(messages, messages_path)

    prompt = PROMPT_TEMPLATE.format(
        messages_file=str(messages_path),
        output_json=str(output_json),
        date=report_date.isoformat(),
        message_count=len(messages),
        active_users=active_members,
    )

    data = None
    last_error = None
    for attempt in (1, 2):
        try:
            data = run_codex(prompt, output_json)
            print(f"  codex succeeded on attempt {attempt}")
            break
        except Exception as e:
            last_error = e
            print(f"  codex attempt {attempt} failed: {e}")

    if data is None:
        print(f"error: codex failed after 2 attempts: {last_error}", file=sys.stderr)
        sys.exit(1)

    data["date"] = report_date.isoformat()
    data["stats"] = stats

    tmp_path = output_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(output_path)

    print(f"  Generated {len(data.get('topics', []))} topics")
    print(f"  Wrote {output_path}")


def main():
    args = parse_args()
    report_date = resolve_date(args.date)
    generate(report_date)


if __name__ == "__main__":
    main()
