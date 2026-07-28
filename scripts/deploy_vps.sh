#!/bin/bash
# Publish generated content only. Source code is deployed by GitHub Actions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${GROUP_DIGEST_RUNTIME:-$HOME/.group-digest-runtime}"
LOG_DIR="$RUNTIME_DIR/logs"
LOG="$LOG_DIR/site-update.log"
DATE="${1:-}"

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
SSH_KEY="${ZNT_VPS_SSH_KEY:-$(read_dotenv_value "$DOTENV_FILE" ZNT_VPS_SSH_KEY)}"
KNOWN_HOSTS="${ZNT_VPS_KNOWN_HOSTS:-$(read_dotenv_value "$DOTENV_FILE" ZNT_VPS_KNOWN_HOSTS)}"
REMOTE="${ZNT_VPS_REMOTE:-$(read_dotenv_value "$DOTENV_FILE" ZNT_VPS_REMOTE)}"
KEEP_CONTENT="${ZNT_CONTENT_KEEP:-$(read_dotenv_value "$DOTENV_FILE" ZNT_CONTENT_KEEP)}"

REMOTE="${REMOTE:-zntcontent@43.128.59.181}"
KNOWN_HOSTS="${KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
KEEP_CONTENT="${KEEP_CONTENT:-30}"

log() {
  echo "[$(TZ=Asia/Shanghai date '+%F %T')] $*" | tee -a "$LOG"
}

if [ -n "$DATE" ] && ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Usage: $0 [YYYY-MM-DD]" >&2
  exit 2
fi

if [ "${ZNT_CONTENT_LOCK_HELD:-}" != "1" ]; then
  echo "Run content publication through npm run site:deploy so the global content lock is held." >&2
  exit 2
fi

if [ -z "$SSH_KEY" ] || [ ! -r "$SSH_KEY" ]; then
  echo "Missing or unreadable ZNT_VPS_SSH_KEY; set it in the environment or $DOTENV_FILE" >&2
  exit 1
fi
if [ ! -r "$KNOWN_HOSTS" ]; then
  echo "Missing or unreadable ZNT_VPS_KNOWN_HOSTS; seed the verified VPS host key in $KNOWN_HOSTS" >&2
  exit 1
fi

SSH_OPTIONS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=120
  -o "UserKnownHostsFile=$KNOWN_HOSTS"
)
mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

manifest_sha="unknown"
if [ -d .git ]; then
  source_dirty=0
  if [ -n "$(git status --porcelain --untracked-files=all 2>/dev/null)" ]; then
    source_dirty=1
    log "warning: local project has uncommitted or untracked files; content publication continues"
  fi
  local_sha="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
  upstream_ref="${ZNT_MAIN_REF:-origin/main}"
  if [[ "$upstream_ref" =~ ^([A-Za-z0-9._-]+)/([A-Za-z0-9._/-]+)$ ]] && \
      [[ "${BASH_REMATCH[2]}" != *..* ]]; then
    upstream_remote="${BASH_REMATCH[1]}"
    upstream_branch="${BASH_REMATCH[2]}"
    if remote_main_sha="$(python3 - "$upstream_remote" "$upstream_branch" <<'PY_REMOTE_SHA'
import os
import re
import subprocess
import sys

remote, branch = sys.argv[1:]
environment = dict(os.environ)
environment["GIT_TERMINAL_PROMPT"] = "0"
try:
    result = subprocess.run(
        ["git", "-c", "credential.helper=", "ls-remote", "--exit-code", remote, f"refs/heads/{branch}"],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
        env=environment,
    )
except (OSError, subprocess.SubprocessError):
    raise SystemExit(1)
fields = result.stdout.strip().split()
if len(fields) != 2 or fields[1] != f"refs/heads/{branch}" or not re.fullmatch(r"[0-9a-f]{40}", fields[0]):
    raise SystemExit(1)
print(fields[0])
PY_REMOTE_SHA
)"; then
      if [ "$local_sha" != "$remote_main_sha" ]; then
        log "warning: local HEAD is not the current $upstream_ref; content publication continues"
      fi
    else
      log "warning: cannot query current $upstream_ref within 15 seconds; content publication continues"
    fi
  else
    log "warning: invalid ZNT_MAIN_REF=$upstream_ref; content publication continues"
  fi
  if [ "$source_dirty" -eq 0 ] && [[ "$local_sha" =~ ^[0-9a-f]{40}$ ]]; then
    manifest_sha="$local_sha"
  fi
else
  local_sha="unknown"
  log "warning: project has no Git metadata; content publication continues"
fi

content_version="$(TZ=Asia/Shanghai date '+%Y%m%dT%H%M%S')-${manifest_sha:0:12}-$(printf '%04x' "$((RANDOM % 65536))")"
bundle_dir="$(mktemp -d "${TMPDIR:-/tmp}/znt-content.XXXXXX")"
bundle_archive="$(mktemp "${TMPDIR:-/tmp}/znt-content.XXXXXX.tar.gz")"
trap 'rm -rf "$bundle_dir"; rm -f "$bundle_archive"' EXIT

mkdir -p "$bundle_dir/daily" "$bundle_dir/knowledge" "$bundle_dir/digest-images"
rsync -a "$PROJECT_DIR/data/daily/" "$bundle_dir/daily/"
if [ -d "$PROJECT_DIR/data/knowledge" ]; then
  rsync -a "$PROJECT_DIR/data/knowledge/" "$bundle_dir/knowledge/"
else
  # First migration can preserve the existing search-derived knowledge view
  # until the daily extractor has emitted its first reviewed knowledge index.
  printf '[]\n' > "$bundle_dir/knowledge/index.json"
fi
cp "$PROJECT_DIR/data/index.json" "$bundle_dir/index.json"
cp "$PROJECT_DIR/data/search-index.json" "$bundle_dir/search-index.json"
rsync -a "$PROJECT_DIR/public/digest-images/" "$bundle_dir/digest-images/"

node "$PROJECT_DIR/scripts/build_content_manifest.mjs" "$bundle_dir" "$content_version" "$manifest_sha" 2>&1 | tee -a "$LOG"
node "$PROJECT_DIR/scripts/validate_content_bundle.mjs" "$bundle_dir" "$DATE" 2>&1 | tee -a "$LOG"
COPYFILE_DISABLE=1 tar -C "$bundle_dir" -czf "$bundle_archive" .

log "content deploy start date=${DATE:-none} version=$content_version remote=$REMOTE"

ssh -T "${SSH_OPTIONS[@]}" "$REMOTE" "upload-content $content_version" \
  < "$bundle_archive" 2>&1 | tee -a "$LOG"

ssh -T "${SSH_OPTIONS[@]}" "$REMOTE" \
  "promote-content $content_version $DATE $KEEP_CONTENT" 2>&1 | tee -a "$LOG"

mkdir -p "$RUNTIME_DIR/.schedule"
printf '{"contentVersion":"%s","codeSha":"%s","publishedAt":"%s"}\n' \
  "$content_version" "$manifest_sha" "$(TZ=Asia/Shanghai date '+%Y-%m-%dT%H:%M:%S%z')" \
  > "$RUNTIME_DIR/.schedule/site-content-${DATE:-latest}.json"

log "content deploy done date=${DATE:-none} version=$content_version"
