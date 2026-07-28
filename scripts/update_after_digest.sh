#!/bin/bash
# Update znt.group content after the daily group digest has completed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${AGENT_KB_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUNTIME_DIR="${GROUP_DIGEST_RUNTIME:-$HOME/.group-digest-runtime}"
DATE="${1:-}"
DEPLOY="${2:-}"
LOG_DIR="$RUNTIME_DIR/logs"
LOG="$LOG_DIR/site-update.log"
LOCK_ROOT="$RUNTIME_DIR/.schedule"
DATE_LOCK_DIR=""
CONTENT_LOCK_DIR="$LOCK_ROOT/site-content.publish.lock"
DATE_LOCK_HELD=0
CONTENT_LOCK_HELD=0
DATE_LOCK_TOKEN=""
CONTENT_LOCK_TOKEN=""
ACQUIRED_LOCK_TOKEN=""
WORK_DIR=""
LOCK_HELPER="$PROJECT_DIR/scripts/site_lock.py"

DATE_LOCK_TTL_SECONDS="${ZNT_SITE_DATE_LOCK_TTL_SECONDS:-21600}"
DATE_LOCK_WAIT_SECONDS="${ZNT_SITE_DATE_LOCK_WAIT_SECONDS:-7200}"
CONTENT_LOCK_TTL_SECONDS="${ZNT_SITE_CONTENT_LOCK_TTL_SECONDS:-21600}"
CONTENT_LOCK_WAIT_SECONDS="${ZNT_SITE_CONTENT_LOCK_WAIT_SECONDS:-7200}"
LOCK_POLL_SECONDS="${ZNT_SITE_LOCK_POLL_SECONDS:-2}"
LOCK_CREATION_GRACE_SECONDS="${ZNT_SITE_LOCK_CREATION_GRACE_SECONDS:-30}"

mkdir -p "$LOG_DIR" "$LOCK_ROOT"

if [ -z "$DATE" ]; then
  if TZ=Asia/Shanghai date -v-1d '+%Y-%m-%d' >/dev/null 2>&1; then
    DATE=$(TZ=Asia/Shanghai date -v-1d '+%Y-%m-%d')
  else
    DATE=$(TZ=Asia/Shanghai date -d yesterday '+%Y-%m-%d')
  fi
fi

if ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Usage: $0 YYYY-MM-DD [--deploy]" >&2
  exit 2
fi

LOCK_DIR="$RUNTIME_DIR/.schedule/site-update-$DATE.running"
STAMP="$RUNTIME_DIR/.schedule/site-update-$DATE.ok"

log() {
  echo "[$(TZ=Asia/Shanghai date '+%F %T')] $*" | tee -a "$LOG"
}

run_optional() {
  local label="$1"
  shift
  if "$@" 2>&1 | tee -a "$LOG"; then
    return 0
  fi
  log "warning: optional step failed and publication will continue: $label"
}

epoch_seconds() {
  date '+%s'
}

release_lock() {
  local lock_dir="$1"
  local token="$2"
  local status=0
  [ -n "$token" ] || return 0
  if python3 "$LOCK_HELPER" release "$lock_dir" "$token"; then
    return 0
  else
    status=$?
    if [ "$status" -gt 1 ]; then
      log "warning: failed to release lock safely: $lock_dir"
    fi
  fi
  return "$status"
}

reclaim_stale_lock() {
  local lock_dir="$1"
  local label="$2"
  local ttl="$3"
  local status=0
  if python3 "$LOCK_HELPER" reclaim "$lock_dir" "$ttl" "$LOCK_CREATION_GRACE_SECONDS"; then
    log "reclaimed stale $label lock: $lock_dir"
    return 0
  else
    status=$?
  fi
  if [ "$status" -gt 1 ]; then
    log "error: unable to inspect or reclaim $label lock: $lock_dir"
    return 2
  fi
  return 1
}

acquire_lock() {
  local lock_dir="$1"
  local label="$2"
  local mode="$3"
  local ttl="$4"
  local timeout="$5"
  local wait_started now elapsed

  wait_started="$(epoch_seconds)"
  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [ ! -d "$lock_dir" ]; then
      log "error: cannot create $label lock: $lock_dir"
      return 2
    fi
    if reclaim_stale_lock "$lock_dir" "$label" "$ttl"; then
      continue
    else
      local reclaim_status=$?
      if [ "$reclaim_status" -eq 2 ]; then
        return 2
      fi
    fi
    if [ "$mode" = "skip" ]; then
      log "$label already running; active lock: $lock_dir"
      return 1
    fi
    now="$(epoch_seconds)"
    elapsed=$((now - wait_started))
    if [ "$elapsed" -ge "$timeout" ]; then
      log "error: timed out waiting for $label lock after ${elapsed}s"
      return 2
    fi
    sleep "$LOCK_POLL_SECONDS"
  done

  ACQUIRED_LOCK_TOKEN="$$-$(epoch_seconds)-$RANDOM-$RANDOM"
  if ! (umask 077; printf 'pid=%s\nstarted_at=%s\ntoken=%s\n' \
      "$$" "$(epoch_seconds)" "$ACQUIRED_LOCK_TOKEN" > "$lock_dir/owner"); then
    rmdir "$lock_dir" 2>/dev/null || true
    log "error: cannot write $label lock ownership metadata"
    return 2
  fi
}

cleanup() {
  local status=0
  if [ "$CONTENT_LOCK_HELD" -eq 1 ]; then
    if release_lock "$CONTENT_LOCK_DIR" "$CONTENT_LOCK_TOKEN"; then
      :
    else
      status=$?
      log "warning: content publication lock remains held after cleanup (status=$status)"
    fi
  fi
  if [ "$DATE_LOCK_HELD" -eq 1 ]; then
    if release_lock "$DATE_LOCK_DIR" "$DATE_LOCK_TOKEN"; then
      :
    else
      status=$?
      log "warning: date lock remains held after cleanup (status=$status)"
    fi
  fi
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

DATE_LOCK_DIR="$LOCK_ROOT/site-update-$DATE.running"
STAMP="$LOCK_ROOT/site-update-$DATE.ok"
DATE_LOCK_MODE="skip"
DATE_LOCK_TIMEOUT=0
if [ "$DEPLOY" = "--deploy" ]; then
  DATE_LOCK_MODE="wait"
  DATE_LOCK_TIMEOUT="$DATE_LOCK_WAIT_SECONDS"
fi
if acquire_lock "$DATE_LOCK_DIR" "site update for $DATE" "$DATE_LOCK_MODE" \
    "$DATE_LOCK_TTL_SECONDS" "$DATE_LOCK_TIMEOUT"; then
  DATE_LOCK_HELD=1
  DATE_LOCK_TOKEN="$ACQUIRED_LOCK_TOKEN"
else
  lock_status=$?
  if [ "$lock_status" -eq 1 ]; then
    exit 0
  fi
  exit "$lock_status"
fi

WORK_DIR="$(mktemp -d "$LOCK_ROOT/site-staging-$DATE.XXXXXX")"

promote_file() {
  local source="$1"
  local target="$2"
  local target_dir temp
  target_dir="$(dirname "$target")"
  temp="$target_dir/.${DATE}.tmp.$$"
  mkdir -p "$target_dir"
  if ! cp "$source" "$temp"; then
    rm -f "$temp"
    return 1
  fi
  mv -f "$temp" "$target"
}

promote_images() {
  local source="$1"
  local parent="$PROJECT_DIR/public/digest-images"
  local target="$parent/$DATE"
  local incoming backup

  mkdir -p "$parent"
  incoming="$(mktemp -d "$parent/.${DATE}.incoming.XXXXXX")"
  if ! rsync -a "$source/" "$incoming/"; then
    rm -rf "$incoming"
    return 1
  fi
  backup=""
  if [ -d "$target" ]; then
    backup="$(mktemp -d "$parent/.${DATE}.previous.XXXXXX")"
    rmdir "$backup"
    if ! mv "$target" "$backup"; then
      rm -rf "$incoming"
      return 1
    fi
  fi
  if ! mv "$incoming" "$target"; then
    rm -rf "$incoming"
    if [ -n "$backup" ] && [ -d "$backup" ]; then
      mv "$backup" "$target" || true
    fi
    return 1
  fi
  if [ -n "$backup" ]; then
    rm -rf "$backup"
  fi
}

cd "$PROJECT_DIR"

log "site update start date=$DATE deploy=${DEPLOY:-no}"

python3 scripts/generate_daily_from_essence.py "$DATE" \
  --runtime-dir "$RUNTIME_DIR" \
  --output-dir "$WORK_DIR/daily" 2>&1 | tee -a "$LOG"
python3 scripts/check_daily_quality.py "$DATE" --daily-dir "$WORK_DIR/daily" 2>&1 | tee -a "$LOG"

STAGED_IMAGE_DIR="$WORK_DIR/digest-images/$DATE"
mkdir -p "$STAGED_IMAGE_DIR"
if [ -d "$PROJECT_DIR/public/digest-images/$DATE" ]; then
  rsync -a "$PROJECT_DIR/public/digest-images/$DATE/" "$STAGED_IMAGE_DIR/"
fi
run_optional "digest image synchronization" env \
  GROUP_DIGEST_RUNTIME="$RUNTIME_DIR" \
  ZNT_DIGEST_IMAGES_OUTPUT_DIR="$STAGED_IMAGE_DIR" \
  node scripts/sync_digest_images.mjs "$DATE"

if acquire_lock "$CONTENT_LOCK_DIR" "content publication" "wait" "$CONTENT_LOCK_TTL_SECONDS" "$CONTENT_LOCK_WAIT_SECONDS"; then
  CONTENT_LOCK_HELD=1
  CONTENT_LOCK_TOKEN="$ACQUIRED_LOCK_TOKEN"
else
  exit "$?"
fi

promote_file "$WORK_DIR/daily/$DATE.json" "$PROJECT_DIR/data/daily/$DATE.json"
promote_images "$STAGED_IMAGE_DIR"
run_optional "knowledge extraction" python3 scripts/extract_knowledge.py "$DATE" --runtime-dir "$RUNTIME_DIR"
python3 scripts/generate_index.py 2>&1 | tee -a "$LOG"
python3 scripts/generate_search_index.py 2>&1 | tee -a "$LOG"

if [ "$DEPLOY" = "--deploy" ]; then
  ZNT_CONTENT_LOCK_HELD=1 bash scripts/deploy_vps.sh "$DATE"
  log "vps production deploy completed for $DATE"
fi

if release_lock "$CONTENT_LOCK_DIR" "$CONTENT_LOCK_TOKEN"; then
  :
else
  release_status=$?
  log "error: content publication lock could not be released safely (status=$release_status)"
  exit "$release_status"
fi
CONTENT_LOCK_HELD=0
CONTENT_LOCK_TOKEN=""

if [ "$DEPLOY" != "--deploy" ]; then
  npm run build 2>&1 | tee -a "$LOG"
fi

touch "$STAMP"
log "site update done date=$DATE"
