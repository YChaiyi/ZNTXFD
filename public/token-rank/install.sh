#!/usr/bin/env bash
set -euo pipefail

TOKEN=""
ENDPOINT=""
NO_SCHEDULE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --endpoint)
      ENDPOINT="${2:-}"
      shift 2
      ;;
    --no-schedule)
      NO_SCHEDULE=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$TOKEN" || -z "$ENDPOINT" ]]; then
  echo "缺少 --token 或 --endpoint，请从 Token 消耗榜页面复制专属命令。" >&2
  exit 1
fi

if [[ "$TOKEN" == *"xxx"* || "$TOKEN" == *"your_private_token"* ]]; then
  echo "令牌还是占位符：$TOKEN" >&2
  echo "请先在 Token 消耗榜页面点击「生成命令」，复制生成后的真实专属命令。" >&2
  exit 1
fi

SCRIPT_URL="${ENDPOINT%/api/token-rank/upload}/token-rank/client.mjs"
INSTALL_DIR="$HOME/.znt-tokenrank"
CLIENT="$INSTALL_DIR/client.mjs"
CLIENT_DOWNLOAD="$INSTALL_DIR/client.download.$$.mjs"
CLIENT_BACKUP="$INSTALL_DIR/client.previous.mjs"
CONFIG_DIR="${ZNT_TOKENRANK_HOME:-$INSTALL_DIR}"
CONFIG="$CONFIG_DIR/config.json"
CONFIG_BACKUP="$INSTALL_DIR/config.previous.json"
NODE_BIN="${ZNT_TOKENRANK_NODE:-$(command -v node || true)}"

if [[ -z "$NODE_BIN" ]]; then
  echo "没有找到 node。请先安装 Node.js，再重新运行接入命令。" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ || "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js 版本过旧。Token 消耗榜需要 Node.js 18 或更高版本。" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
trap 'rm -f "$CLIENT_DOWNLOAD"' EXIT
curl -fsSL "$SCRIPT_URL" -o "$CLIENT_DOWNLOAD"
if ! "$NODE_BIN" --check "$CLIENT_DOWNLOAD"; then
  echo "下载的客户端脚本校验失败，现有客户端未修改。" >&2
  exit 1
fi
CLIENT_VERSION="$("$NODE_BIN" "$CLIENT_DOWNLOAD" --version)"
if [[ ! "$CLIENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  rm -f "$CLIENT_DOWNLOAD"
  echo "下载的客户端没有返回有效版本号，现有客户端未修改。" >&2
  exit 1
fi
chmod +x "$CLIENT_DOWNLOAD"

HAD_CLIENT=false
if [[ -f "$CLIENT" ]]; then
  HAD_CLIENT=true
  cp -p "$CLIENT" "$CLIENT_BACKUP"
fi

HAD_CONFIG=false
if [[ -f "$CONFIG" ]]; then
  HAD_CONFIG=true
  cp -p "$CONFIG" "$CONFIG_BACKUP"
fi
mv "$CLIENT_DOWNLOAD" "$CLIENT"

restore_client_and_config() {
  if [[ "$HAD_CLIENT" == true && -f "$CLIENT_BACKUP" ]]; then
    mv "$CLIENT_BACKUP" "$CLIENT"
  else
    rm -f "$CLIENT"
  fi
  if [[ "$HAD_CONFIG" == true && -f "$CONFIG_BACKUP" ]]; then
    mkdir -p "$CONFIG_DIR"
    cp -p "$CONFIG_BACKUP" "$CONFIG"
  else
    rm -f "$CONFIG"
  fi
  rm -f "$CONFIG_BACKUP"
}

if ! "$NODE_BIN" "$CLIENT" --token "$TOKEN" --endpoint "$ENDPOINT" --rebuild-history; then
  restore_client_and_config
  echo "首次同步失败，未安装后台任务。请确认你复制的是页面生成的真实专属命令。" >&2
  exit 1
fi

if [[ "$NO_SCHEDULE" == true ]]; then
  rm -f "$CLIENT_BACKUP" "$CONFIG_BACKUP"
  echo "Token 消耗榜客户端已验证，未安装后台任务（--no-schedule）。客户端版本：$CLIENT_VERSION"
  exit 0
fi

SCHEDULER_KIND=""
SCHEDULER_MUTATED=false
HAD_PLIST=false
HAD_SYSTEMD_SERVICE=false
HAD_SYSTEMD_TIMER=false
HAD_CRONTAB=false
SYSTEMD_WAS_ENABLED=false
SYSTEMD_WAS_ACTIVE=false

rollback_install() {
  trap - ERR
  restore_client_and_config
  if [[ "$SCHEDULER_MUTATED" != true ]]; then
    :
  elif [[ "$SCHEDULER_KIND" == "launchd" ]]; then
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
    if [[ "$HAD_PLIST" == true && -f "$PLIST_BACKUP" ]]; then
      mv "$PLIST_BACKUP" "$PLIST"
      launchctl load "$PLIST" >/dev/null 2>&1 || true
    else
      rm -f "$PLIST"
    fi
  elif [[ "$SCHEDULER_KIND" == "systemd" ]]; then
    systemctl --user disable --now znt-tokenrank.timer >/dev/null 2>&1 || true
    if [[ "$HAD_SYSTEMD_SERVICE" == true && -f "$SYSTEMD_SERVICE_BACKUP" ]]; then
      mv "$SYSTEMD_SERVICE_BACKUP" "$SYSTEMD_SERVICE"
    else
      rm -f "$SYSTEMD_SERVICE"
    fi
    if [[ "$HAD_SYSTEMD_TIMER" == true && -f "$SYSTEMD_TIMER_BACKUP" ]]; then
      mv "$SYSTEMD_TIMER_BACKUP" "$SYSTEMD_TIMER"
    else
      rm -f "$SYSTEMD_TIMER"
    fi
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    if [[ "$SYSTEMD_WAS_ENABLED" == true ]]; then
      systemctl --user enable znt-tokenrank.timer >/dev/null 2>&1 || true
    fi
    if [[ "$SYSTEMD_WAS_ACTIVE" == true ]]; then
      systemctl --user start znt-tokenrank.timer >/dev/null 2>&1 || true
    fi
  elif [[ "$SCHEDULER_KIND" == "cron" ]]; then
    if [[ "$HAD_CRONTAB" == true && -f "$CRON_BACKUP" ]]; then
      crontab "$CRON_BACKUP" >/dev/null 2>&1 || true
    else
      crontab -r >/dev/null 2>&1 || true
    fi
  fi
  rm -f "${PLIST_BACKUP:-}" "${SYSTEMD_SERVICE_BACKUP:-}" \
    "${SYSTEMD_TIMER_BACKUP:-}" "${CRON_BACKUP:-}" "${CRON_NEXT:-}"
  echo "后台任务安装失败，已恢复原客户端与配置。" >&2
}
trap rollback_install ERR

if [[ "$(uname -s)" == "Darwin" ]]; then
  SCHEDULER_KIND="launchd"
  PLIST="$HOME/Library/LaunchAgents/group.znt.tokenrank.plist"
  PLIST_BACKUP="$INSTALL_DIR/schedule.previous.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  if [[ -f "$PLIST" ]]; then
    cp -p "$PLIST" "$PLIST_BACKUP"
    HAD_PLIST=true
  fi
  SCHEDULER_MUTATED=true
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>group.znt.tokenrank</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$CLIENT</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/sync.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/sync.err.log</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
elif command -v systemctl >/dev/null 2>&1; then
  SCHEDULER_KIND="systemd"
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  SYSTEMD_SERVICE="$SYSTEMD_DIR/znt-tokenrank.service"
  SYSTEMD_TIMER="$SYSTEMD_DIR/znt-tokenrank.timer"
  SYSTEMD_SERVICE_BACKUP="$INSTALL_DIR/znt-tokenrank.service.previous"
  SYSTEMD_TIMER_BACKUP="$INSTALL_DIR/znt-tokenrank.timer.previous"
  mkdir -p "$SYSTEMD_DIR"
  if [[ -f "$SYSTEMD_SERVICE" ]]; then
    cp -p "$SYSTEMD_SERVICE" "$SYSTEMD_SERVICE_BACKUP"
    HAD_SYSTEMD_SERVICE=true
  fi
  if [[ -f "$SYSTEMD_TIMER" ]]; then
    cp -p "$SYSTEMD_TIMER" "$SYSTEMD_TIMER_BACKUP"
    HAD_SYSTEMD_TIMER=true
  fi
  if systemctl --user is-enabled --quiet znt-tokenrank.timer >/dev/null 2>&1; then
    SYSTEMD_WAS_ENABLED=true
  fi
  if systemctl --user is-active --quiet znt-tokenrank.timer >/dev/null 2>&1; then
    SYSTEMD_WAS_ACTIVE=true
  fi
  SCHEDULER_MUTATED=true
  cat > "$SYSTEMD_SERVICE" <<EOF
[Unit]
Description=ZNT Token Rank Sync

[Service]
Type=oneshot
ExecStart=$NODE_BIN $CLIENT
EOF
  cat > "$SYSTEMD_TIMER" <<EOF
[Unit]
Description=Run ZNT Token Rank Sync every 30 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now znt-tokenrank.timer
else
  SCHEDULER_KIND="cron"
  CRON_BACKUP="$INSTALL_DIR/crontab.previous"
  CRON_NEXT="$INSTALL_DIR/crontab.next"
  if crontab -l > "$CRON_BACKUP" 2>/dev/null; then
    HAD_CRONTAB=true
    grep -v "znt-tokenrank/client.mjs" "$CRON_BACKUP" > "$CRON_NEXT" || true
  else
    : > "$CRON_NEXT"
  fi
  CRON_LINE="*/30 * * * * $NODE_BIN $CLIENT >> $INSTALL_DIR/sync.log 2>> $INSTALL_DIR/sync.err.log"
  echo "$CRON_LINE" >> "$CRON_NEXT"
  SCHEDULER_MUTATED=true
  crontab "$CRON_NEXT"
fi

trap - ERR
rm -f "$CLIENT_BACKUP" "$CONFIG_BACKUP" "${PLIST_BACKUP:-}" \
  "${SYSTEMD_SERVICE_BACKUP:-}" "${SYSTEMD_TIMER_BACKUP:-}" \
  "${CRON_BACKUP:-}" "${CRON_NEXT:-}"
trap - EXIT
echo "Token 消耗榜已接入。配置目录：${INSTALL_DIR}。客户端版本：$CLIENT_VERSION"
