#!/bin/bash
# Website project helper for znt.group.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

read_dotenv_value() {
  local file="$1"
  local name="$2"
  local value=""

  [ -f "$file" ] || return 0
  value="$(sed -n "s/^${name}=//p" "$file" | tail -n 1)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

DOTENV_FILE="$PROJECT_DIR/.env.local"
RUNTIME_DIR="${GROUP_DIGEST_RUNTIME:-$(read_dotenv_value "$DOTENV_FILE" GROUP_DIGEST_RUNTIME)}"
RUNTIME_DIR="${RUNTIME_DIR:-$HOME/.group-digest-runtime}"
DEFAULT_DOMAIN="${ZNT_SITE_URL:-$(read_dotenv_value "$DOTENV_FILE" ZNT_SITE_URL)}"
DEFAULT_DOMAIN="${DEFAULT_DOMAIN:-https://znt.group}"

usage() {
  cat <<'EOF'
Usage:
  scripts/sitectl.sh update [YYYY-MM-DD]
  scripts/sitectl.sh deploy [YYYY-MM-DD]
  scripts/sitectl.sh verify [YYYY-MM-DD]
  scripts/sitectl.sh status

Dates are business dates in Asia/Shanghai. If omitted, update/deploy/verify use yesterday in Beijing time.
EOF
}

beijing_yesterday() {
  if TZ=Asia/Shanghai date -v-1d '+%Y-%m-%d' >/dev/null 2>&1; then
    TZ=Asia/Shanghai date -v-1d '+%Y-%m-%d'
  else
    TZ=Asia/Shanghai date -d yesterday '+%Y-%m-%d'
  fi
}

date_arg() {
  local value="${1:-}"
  if [ -z "$value" ]; then
    value="$(beijing_yesterday)"
  fi
  if ! [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Invalid date: $value" >&2
    usage >&2
    exit 2
  fi
  printf '%s\n' "$value"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  update)
    date_value="$(date_arg "${1:-}")"
    cd "$PROJECT_DIR"
    AGENT_KB_DIR="$PROJECT_DIR" GROUP_DIGEST_RUNTIME="$RUNTIME_DIR" \
      bash "$PROJECT_DIR/scripts/update_after_digest.sh" "$date_value"
    ;;
  deploy)
    date_value="$(date_arg "${1:-}")"
    cd "$PROJECT_DIR"
    AGENT_KB_DIR="$PROJECT_DIR" GROUP_DIGEST_RUNTIME="$RUNTIME_DIR" \
      bash "$PROJECT_DIR/scripts/update_after_digest.sh" "$date_value" --deploy
    ;;
  verify)
    date_value="$(date_arg "${1:-}")"
    cd "$PROJECT_DIR"
    GROUP_DIGEST_RUNTIME="$RUNTIME_DIR" node - "$DEFAULT_DOMAIN" "$date_value" <<'NODE'
const fs = require("fs");
const os = require("os");

const baseUrl = process.argv[2].replace(/\/$/, "");
const date = process.argv[3];
const dailyPath = `data/daily/${date}.json`;

if (!fs.existsSync(dailyPath)) {
  console.error(`Missing local daily data: ${dailyPath}`);
  process.exit(1);
}

const daily = JSON.parse(fs.readFileSync(dailyPath, "utf8"));
const title = daily.title || "";
const url = `${baseUrl}/daily/${date}`;

function readEnvValue(filePath, name) {
  if (!fs.existsSync(filePath)) return "";
  const line = fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${name}=`));
  if (!line) return "";
  const value = line.slice(name.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "");
}

const password =
  process.env.ZNT_SITE_PASSWORD ||
  process.env.ACCESS_PASSWORD ||
  readEnvValue(".env.local", "ZNT_SITE_PASSWORD") ||
  readEnvValue(".env.local", "ACCESS_PASSWORD") ||
  readEnvValue(".env", "ZNT_SITE_PASSWORD") ||
  readEnvValue(".env", "ACCESS_PASSWORD");
const versionStampPath = process.env.GROUP_DIGEST_RUNTIME
  ? `${process.env.GROUP_DIGEST_RUNTIME}/.schedule/site-content-${date}.json`
  : `${os.homedir()}/.group-digest-runtime/.schedule/site-content-${date}.json`;
let expectedContentVersion = null;
try {
  expectedContentVersion = JSON.parse(fs.readFileSync(versionStampPath, "utf8")).contentVersion || null;
} catch {}

(async () => {
  if (!password) throw new Error("Missing ZNT_SITE_PASSWORD or ACCESS_PASSWORD for site:verify");
  const login = await fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    redirect: "manual",
  });
  if (!login.ok) throw new Error(`Site login failed with HTTP ${login.status}`);
  const rawCookie = login.headers.getSetCookie?.()[0] || login.headers.get("set-cookie") || "";
  const cookie = rawCookie.split(";", 1)[0];
  if (!cookie) throw new Error("Site login did not return a session cookie");
  const response = await fetch(url, { cache: "no-store", headers: { cookie } });
  const text = await response.text();
  const hasDate = text.includes(date) || text.includes(date.slice(5).replace("-", "月"));
  const hasTitle = title ? text.includes(title) : true;
  const health = await fetch(`${baseUrl}/api/content-version`, {
    cache: "no-store",
    headers: { cookie },
  });
  const healthBody = await health.json().catch(() => null);
  const hasContentVersion = health.ok && typeof healthBody?.contentVersion === "string" && healthBody.contentVersion;
  const contentVersionMatches = expectedContentVersion
    ? healthBody?.contentVersion === expectedContentVersion
    : Boolean(hasContentVersion);
  const ok = response.status === 200 && hasDate && hasTitle && contentVersionMatches;
  console.log(JSON.stringify({
    url,
    status: response.status,
    bytes: text.length,
    localTitle: title,
    hasDate,
    hasTitle,
    contentVersion: healthBody?.contentVersion ?? null,
    expectedContentVersion,
    contentVersionMatches,
    ok,
  }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
    ;;
  status)
    cd "$PROJECT_DIR"
    echo "Project: $PROJECT_DIR"
    echo "Runtime: $RUNTIME_DIR"
    echo "Domain:  $DEFAULT_DOMAIN"
    echo
    git status --short
    echo
    ls -1 data/daily/*.json 2>/dev/null | sed 's#^data/daily/##; s#\.json$##' | sort | tail -10
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 2
    ;;
esac
