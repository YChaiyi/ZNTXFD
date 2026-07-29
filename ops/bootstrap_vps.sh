#!/bin/bash
# Root-only bootstrap for the one-time VPS migration. It never runs
# automatically from GitHub Actions or the daily content publisher.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
# shellcheck source=ops/lib/deploy-common.sh
source "$LIB_DIR/deploy-common.sh"

COMMAND="${1:-}"
shift || true
ROOT="/var/www/znt.group"
SERVICE="znt-group.service"
GOAT_DB=""
CONFIRMED=0

usage() {
  cat <<'EOF'
Usage:
  sudo bash ops/bootstrap_vps.sh prepare
  sudo bash ops/bootstrap_vps.sh migrate --confirm-migration \
    --source-sha <git-sha> \
    [--goatcounter-db /path/to/goatcounter.sqlite3]

prepare  creates the restricted accounts, directories, root-owned release tools,
         sudoers file, and an empty protected runtime layout. It does not replace
         the active systemd unit or switch the running site.

migrate  takes a same-filesystem snapshot, copies legacy production content,
         clones and builds the requested current YChaiyi/ZNTXFD main commit,
         switches links, and starts the hardened systemd unit. It requires
         --confirm-migration.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT="${2:-}"
      shift 2
      ;;
    --goatcounter-db)
      GOAT_DB="${2:-}"
      shift 2
      ;;
    --source-sha)
      SOURCE_SHA="${2:-}"
      shift 2
      ;;
    --confirm-migration)
      CONFIRMED=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      znt_fail "unknown argument: $1"
      ;;
  esac
done

CONTENT_ROOT="$ROOT/shared/content"
CONTENT_RELEASES="$CONTENT_ROOT/releases"
CONTENT_STAGING="$CONTENT_ROOT/staging"
CONTENT_PROMOTION="$CONTENT_ROOT/.promotion"
RELEASES="$ROOT/releases"
BUILD_ROOT="$ROOT/builds"
BUILD_ISOLATION="$BUILD_ROOT/.isolation"
RUNTIME_DIR="$ROOT/shared/runtime"
STATE_DIR="$ROOT/shared/state/token-rank"
STORE_PATH="$STATE_DIR/token-rank-store.json"
SNAPSHOT_ROOT="$ROOT/.migration-backups"
NODE_BIN="$ZNT_NODE_BIN"
NPM_BIN="$ZNT_NPM_BIN"
SOURCE_SHA="${SOURCE_SHA:-}"
MIGRATION_CONTENT_STAGE=""
MIGRATION_CONTENT_RELEASE=""
MIGRATION_FETCH_WORKSPACE=""
MIGRATION_BUILD_CANDIDATE=""
MIGRATION_RELEASE_CANDIDATE=""
MIGRATION_CODE_RELEASE=""
MIGRATION_MAIN_CHECK_WORKSPACE=""

ensure_group() {
  local group="$1"
  getent group "$group" >/dev/null || groupadd --system "$group"
}

ensure_user() {
  local user="$1"
  local group="$2"
  local home="$3"
  local shell="$4"
  if ! id -u "$user" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$home" --shell "$shell" --gid "$group" "$user"
  fi
  [[ "$(id -gn "$user")" = "$group" ]] || znt_fail "existing user $user has an unexpected primary group"
}

install_tooling() {
  install -d -o root -g root -m 0755 /usr/local/lib/znt
  install -o root -g root -m 0755 "$LIB_DIR/deploy-common.sh" /usr/local/lib/znt/deploy-common.sh
  install -o root -g root -m 0644 "$LIB_DIR/build-content-manifest.mjs" /usr/local/lib/znt/build-content-manifest.mjs
  install -o root -g root -m 0644 "$LIB_DIR/validate-content-bundle.mjs" /usr/local/lib/znt/validate-content-bundle.mjs
  install -o root -g root -m 0755 "$LIB_DIR/extract-content-archive.py" /usr/local/lib/znt/extract-content-archive.py
  install -o root -g root -m 0755 "$SCRIPT_DIR/bin/znt-app-start" /usr/local/bin/znt-app-start
  install -o root -g root -m 0755 "$SCRIPT_DIR/bin/znt-code-deploy" /usr/local/bin/znt-code-deploy
  install -o root -g root -m 0755 "$SCRIPT_DIR/bin/znt-content-promote" /usr/local/bin/znt-content-promote
  install -o root -g root -m 0755 "$SCRIPT_DIR/bin/znt-deploy-ssh" /usr/local/bin/znt-deploy-ssh
  install -o root -g root -m 0755 "$SCRIPT_DIR/bin/znt-content-ssh" /usr/local/bin/znt-content-ssh
  install -o root -g root -m 0755 "$SCRIPT_DIR/bin/znt-rollback" /usr/local/bin/znt-rollback
  visudo -cf "$SCRIPT_DIR/sudoers/zntdeploy"
  visudo -cf "$SCRIPT_DIR/sudoers/zntcontent"
  install -o root -g root -m 0440 "$SCRIPT_DIR/sudoers/zntdeploy" /etc/sudoers.d/zntdeploy
  install -o root -g root -m 0440 "$SCRIPT_DIR/sudoers/zntcontent" /etc/sudoers.d/zntcontent
}

install_build_slice() {
  local temporary
  temporary="$(mktemp /tmp/znt-build-slice.XXXXXX)"
  {
    printf '%s\n' '[Unit]'
    printf '%s\n' 'Description=ZNT isolated source build budget'
    printf '%s\n' '[Slice]'
    printf '%s\n' 'MemoryHigh=1536M'
    printf '%s\n' 'MemoryMax=2G'
    printf '%s\n' 'TasksMax=256'
    printf '%s\n' 'CPUQuota=200%'
  } > "$temporary"
  install -o root -g root -m 0644 "$temporary" /etc/systemd/system/znt-build.slice
  rm -f -- "$temporary"
  systemctl daemon-reload
  systemctl start znt-build.slice
}

validate_effective_ssh_account() {
  local account="$1"
  local dispatcher="$2"
  local key_file="/etc/ssh/authorized_keys/$account"
  local effective

  effective="$(/usr/sbin/sshd -T -C "user=$account,host=localhost,addr=127.0.0.1")" \
    || return 1
  grep -Fqx "authorizedkeysfile $key_file" <<< "$effective" \
    && grep -Fqx "forcecommand $dispatcher" <<< "$effective" \
    && grep -Fqx 'authenticationmethods publickey' <<< "$effective" \
    && grep -Fqx 'passwordauthentication no' <<< "$effective" \
    && grep -Fqx 'kbdinteractiveauthentication no' <<< "$effective" \
    && grep -Fqx 'pubkeyauthentication yes' <<< "$effective" \
    && grep -Fqx 'disableforwarding yes' <<< "$effective" \
    && grep -Fqx 'permittty no' <<< "$effective" \
    && grep -Fqx 'permituserrc no' <<< "$effective"
}

install_ssh_restrictions() {
  local account key_file ssh_service=""
  local drop_in="/etc/ssh/sshd_config.d/60-znt-restricted.conf"
  local backup=""
  local had_drop_in=0

  install -d -o root -g root -m 0755 /etc/ssh/authorized_keys /etc/ssh/sshd_config.d
  for account in zntdeploy zntcontent; do
    key_file="/etc/ssh/authorized_keys/$account"
    if [[ ! -e "$key_file" ]]; then
      install -o root -g "$account" -m 0640 /dev/null "$key_file"
    fi
    [[ -f "$key_file" && ! -L "$key_file" ]] \
      || znt_fail "restricted authorized-keys file is invalid: $key_file"
    chown root:"$account" "$key_file"
    chmod 0640 "$key_file"
    [[ "$(stat -c '%U:%G %a' "$key_file")" = "root:$account 640" ]] \
      || znt_fail "restricted authorized-keys file has invalid ownership or mode: $key_file"
  done

  if [[ -e "$drop_in" ]]; then
    [[ -f "$drop_in" && ! -L "$drop_in" ]] || znt_fail "restricted SSH drop-in is invalid"
    backup="$(mktemp /etc/ssh/sshd_config.d/.60-znt-restricted.XXXXXX)"
    install -o root -g root -m 0600 "$drop_in" "$backup"
    had_drop_in=1
  fi
  install -o root -g root -m 0644 "$SCRIPT_DIR/sshd/znt-restricted.conf" "$drop_in"
  if ! /usr/sbin/sshd -t \
    || ! validate_effective_ssh_account zntdeploy /usr/local/bin/znt-deploy-ssh \
    || ! validate_effective_ssh_account zntcontent /usr/local/bin/znt-content-ssh; then
    if (( had_drop_in == 1 )); then
      install -o root -g root -m 0644 "$backup" "$drop_in"
    else
      rm -f -- "$drop_in"
    fi
    [[ -z "$backup" ]] || rm -f -- "$backup"
    /usr/sbin/sshd -t || znt_fail "previous SSH configuration is invalid after restoring it"
    znt_fail "restricted SSH configuration failed syntax or effective-policy validation"
  fi
  if systemctl is-active --quiet ssh.service; then
    ssh_service="ssh.service"
  elif systemctl is-active --quiet sshd.service; then
    ssh_service="sshd.service"
  fi
  [[ -n "$ssh_service" ]] || znt_fail "cannot identify the active SSH service"
  if ! systemctl reload "$ssh_service"; then
    if (( had_drop_in == 1 )); then
      install -o root -g root -m 0644 "$backup" "$drop_in"
    else
      rm -f -- "$drop_in"
    fi
    /usr/sbin/sshd -t || znt_fail "SSH reload failed and the previous configuration is invalid"
    systemctl reload "$ssh_service" || znt_fail "SSH reload failed after restoring the previous configuration"
    [[ -z "$backup" ]] || rm -f -- "$backup"
    znt_fail "restricted SSH configuration could not be activated"
  fi
  [[ -z "$backup" ]] || rm -f -- "$backup"
}

install_service_unit() {
  install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/znt-group.service" "/etc/systemd/system/$SERVICE"
  systemctl daemon-reload
}

prepare_layout() {
  ensure_group zntapp
  ensure_group zntdeploy
  ensure_group zntcontent
  ensure_group zntupload
  ensure_user zntapp zntapp /var/lib/zntapp /usr/sbin/nologin
  ensure_user zntdeploy zntdeploy /var/lib/zntdeploy /bin/bash
  ensure_user zntcontent zntcontent /var/lib/zntcontent /bin/bash
  usermod -a -G zntupload zntdeploy
  usermod -a -G zntupload zntcontent
  if id -nG zntdeploy | tr ' ' '\n' | grep -qx zntapp; then
    gpasswd -d zntdeploy zntapp >/dev/null 2>&1 || true
  fi
  if id -nG zntcontent | tr ' ' '\n' | grep -qx zntapp; then
    gpasswd -d zntcontent zntapp >/dev/null 2>&1 || true
  fi
  passwd -l zntapp >/dev/null 2>&1 || true
  passwd -l zntdeploy >/dev/null 2>&1 || true
  passwd -l zntcontent >/dev/null 2>&1 || true

  install -d -o root -g root -m 0755 "$ROOT"
  if [[ -e "$ROOT/shared" ]]; then
    [[ -d "$ROOT/shared" && ! -L "$ROOT/shared" ]] || znt_fail "shared must be a real directory"
  else
    install -d -o root -g root -m 0755 "$ROOT/shared"
  fi
  # Keep an existing legacy shared directory's owner and mode unchanged until
  # the old service is stopped. The legacy Token Rank writer creates a sibling
  # temporary file before rename and would otherwise fail during preparation.
  install -d -o root -g root -m 0755 "$CONTENT_ROOT"
  install -d -o root -g zntapp -m 0750 "$RELEASES" "$CONTENT_RELEASES"
  install -d -o root -g root -m 0700 "$RELEASES/.protected" "$CONTENT_RELEASES/.protected"
  install -d -o zntdeploy -g zntdeploy -m 0730 "$BUILD_ROOT"
  install -d -o zntcontent -g zntcontent -m 0730 "$CONTENT_STAGING"
  install -d -o root -g root -m 0711 "$BUILD_ISOLATION"
  install -d -o root -g root -m 0700 "$CONTENT_PROMOTION"
  install -d -o root -g zntapp -m 0750 "$RUNTIME_DIR"
  install -d -o zntapp -g zntapp -m 0700 "$STATE_DIR"
  install -d -o root -g zntupload -m 0750 /var/lib/znt-upload-locks
  if [[ ! -e /var/lib/znt-upload-locks/global.lock ]]; then
    install -o root -g zntupload -m 0660 /dev/null /var/lib/znt-upload-locks/global.lock
  fi
  [[ -f /var/lib/znt-upload-locks/global.lock && ! -L /var/lib/znt-upload-locks/global.lock ]] \
    || znt_fail "global upload lock is invalid"
  chown root:zntupload /var/lib/znt-upload-locks/global.lock
  chmod 0660 /var/lib/znt-upload-locks/global.lock
  if [[ ! -e "$RUNTIME_DIR/app.env" ]]; then
    install -o root -g zntapp -m 0640 /dev/null "$RUNTIME_DIR/app.env"
  fi
  [[ -f "$RUNTIME_DIR/app.env" && ! -L "$RUNTIME_DIR/app.env" ]] || znt_fail "runtime app.env must be a regular file"
  chown root:zntapp "$RUNTIME_DIR/app.env"
  chmod 0640 "$RUNTIME_DIR/app.env"
}

harden_shared_layout() {
  chown root:root "$ROOT/shared"
  chmod 0755 "$ROOT/shared"
}

write_empty_store() {
  printf '%s\n' '{"revision":0,"users":[],"records":[],"collectors":[],"lastUploadAt":""}' > "$STORE_PATH"
  chown zntapp:zntapp "$STORE_PATH"
  chmod 0600 "$STORE_PATH"
}

validate_store() {
  [[ -f "$STORE_PATH" && ! -L "$STORE_PATH" ]] || znt_fail "Token Rank store is missing"
  [[ "$(stat -c '%U:%G' "$STORE_PATH")" = "zntapp:zntapp" ]] || znt_fail "Token Rank store ownership is invalid"
  [[ "$(stat -c '%a' "$STORE_PATH")" = "600" ]] || znt_fail "Token Rank store must have mode 0600"
  "$NODE_BIN" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$STORE_PATH"
}

nginx_preflight() {
  local rendered health_block login_block upload_block
  rendered="$(mktemp /tmp/znt-nginx.XXXXXX)"
  if ! nginx -T > "$rendered" 2>&1; then
    rm -f -- "$rendered"
    znt_fail "nginx -T failed; fix Nginx before migration"
  fi

  health_block="$(awk '
    /location = \/api\/health[[:space:]]*\{/ { inside=1 }
    inside {
      print
      opens = gsub(/\{/, "&")
      closes = gsub(/\}/, "&")
      depth += opens - closes
      if (depth == 0) exit
    }
  ' "$rendered")"
  login_block="$(awk '
    /location = \/api\/auth\/verify[[:space:]]*\{/ { inside=1 }
    inside {
      print
      opens = gsub(/\{/, "&")
      closes = gsub(/\}/, "&")
      depth += opens - closes
      if (depth == 0) exit
    }
  ' "$rendered")"
  upload_block="$(awk '
    /location = \/api\/token-rank\/upload[[:space:]]*\{/ { inside=1 }
    inside {
      print
      opens = gsub(/\{/, "&")
      closes = gsub(/\}/, "&")
      depth += opens - closes
      if (depth == 0) exit
    }
  ' "$rendered")"

  if ! grep -Fq 'limit_req_zone $binary_remote_addr zone=znt_login:' "$rendered" || \
    ! grep -Fq 'limit_req_zone $binary_remote_addr zone=znt_upload:' "$rendered"; then
    rm -f -- "$rendered"
    znt_fail "Nginx login/upload rate-limit zones are missing"
  fi
  if [[ "$health_block" != *'allow 127.0.0.1;'* || "$health_block" != *'allow ::1;'* || \
    "$health_block" != *'deny all;'* || "$health_block" != *'proxy_set_header X-ZNT-Local-Health 1;'* ]]; then
    rm -f -- "$rendered"
    znt_fail "Nginx /api/health must be an exact localhost-only location with the trusted health header"
  fi
  if [[ "$login_block" != *'limit_req zone=znt_login'* || "$login_block" != *'client_max_body_size 4k;'* ]]; then
    rm -f -- "$rendered"
    znt_fail "Nginx login request limit is missing"
  fi
  if [[ "$upload_block" != *'limit_req zone=znt_upload'* || "$upload_block" != *'client_max_body_size 2m;'* ]]; then
    rm -f -- "$rendered"
    znt_fail "Nginx Token Rank upload request limit is missing"
  fi
  rm -f -- "$rendered"
}

prepare() {
  znt_require_root
  znt_require_node_runtime
  prepare_layout
  install_tooling
  install_build_slice
  install_ssh_restrictions
  if [[ ! -e "$STORE_PATH" ]]; then
    write_empty_store
  fi
  validate_store
  echo "prepared restricted ZNT VPS layout under $ROOT"
}

snapshot_goatcounter() {
  local snapshot="$1"
  local detected=()
  if [[ -z "$GOAT_DB" && -d "$ROOT/shared/goatcounter" ]]; then
    mapfile -t detected < <(find "$ROOT/shared/goatcounter" -maxdepth 1 -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -print)
    if (( ${#detected[@]} == 1 )); then
      GOAT_DB="${detected[0]}"
    elif (( ${#detected[@]} > 1 )); then
      znt_fail "multiple GoatCounter SQLite files found; pass --goatcounter-db explicitly"
    fi
  fi
  [[ -z "$GOAT_DB" ]] && return 0
  [[ -f "$GOAT_DB" && ! -L "$GOAT_DB" ]] || znt_fail "GoatCounter database is invalid"
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$GOAT_DB" ".backup '$snapshot/goatcounter.sqlite3'"
  elif command -v python3 >/dev/null; then
    python3 - "$GOAT_DB" "$snapshot/goatcounter.sqlite3" <<'PY_SQLITE_BACKUP'
import sqlite3
import sys
from pathlib import Path

source_path = Path(sys.argv[1]).resolve()
target_path = Path(sys.argv[2]).resolve()
source = sqlite3.connect(f"{source_path.as_uri()}?mode=ro", uri=True, timeout=60)
target = sqlite3.connect(target_path, timeout=60)
try:
    source.backup(target, pages=256, sleep=0.05)
finally:
    target.close()
    source.close()

check = sqlite3.connect(f"{target_path.as_uri()}?mode=ro", uri=True)
try:
    result = check.execute("PRAGMA integrity_check").fetchall()
finally:
    check.close()
if result != [("ok",)]:
    raise SystemExit(f"GoatCounter backup integrity failed: {result!r}")
PY_SQLITE_BACKUP
  else
    znt_fail "sqlite3 CLI or Python 3 is required for a consistent GoatCounter snapshot"
  fi
  chmod 0600 "$snapshot/goatcounter.sqlite3"
}

snapshot_shared_tree() {
  local snapshot_dir="$1"
  local shared_real goat_real goat_relative
  local -a exclude_args=()

  shared_real="$(znt_realpath "$ROOT/shared")"
  if [[ -n "$GOAT_DB" ]]; then
    goat_real="$(znt_realpath "$GOAT_DB")"
    if [[ "$goat_real" == "$shared_real/"* ]]; then
      goat_relative="${goat_real#"$shared_real"/}"
      exclude_args+=(--exclude="/$goat_relative")
    fi
  fi

  install -d -o root -g root -m 0700 "$snapshot_dir"
  rsync -aHAX --delete "${exclude_args[@]}" "$ROOT/shared/" "$snapshot_dir/"
}

copy_legacy_content() {
  local legacy="$1"
  local content_version="$2"
  local code_sha="$3"
  local stage="$CONTENT_PROMOTION/.migration-$content_version.$$.$RANDOM"
  local release="$CONTENT_RELEASES/$content_version"

  [[ ! -e "$stage" && ! -e "$release" ]] || znt_fail "migration content version already exists"
  MIGRATION_CONTENT_STAGE="$stage"
  [[ -d "$legacy/data/daily" ]] || znt_fail "legacy daily content is missing"
  [[ -f "$legacy/data/index.json" && -f "$legacy/data/search-index.json" ]] || znt_fail "legacy indexes are missing"
  [[ -d "$legacy/public/digest-images" ]] || znt_fail "legacy digest images are missing"

  install -d -o root -g root -m 0700 "$stage/daily" "$stage/knowledge" "$stage/digest-images"
  rsync -a --no-specials --no-devices "$legacy/data/daily/" "$stage/daily/"
  if [[ -d "$legacy/data/knowledge" ]]; then
    rsync -a --no-specials --no-devices "$legacy/data/knowledge/" "$stage/knowledge/"
  else
    # The legacy search-derived view remains available through search-index.json
    # until the daily extractor has emitted a reviewed knowledge index.
    printf '[]\n' > "$stage/knowledge/index.json"
  fi
  install -o root -g root -m 0600 "$legacy/data/index.json" "$stage/index.json"
  install -o root -g root -m 0600 "$legacy/data/search-index.json" "$stage/search-index.json"
  rsync -a --no-specials --no-devices "$legacy/public/digest-images/" "$stage/digest-images/"
  "$NODE_BIN" /usr/local/lib/znt/build-content-manifest.mjs "$stage" "$content_version" "$code_sha"
  "$NODE_BIN" /usr/local/lib/znt/validate-content-bundle.mjs "$stage"
  chown -hR root:zntapp "$stage"
  find -P "$stage" -type d -exec chmod 0750 {} +
  find -P "$stage" -type f -exec chmod 0640 {} +
  mv "$stage" "$release"
  MIGRATION_CONTENT_STAGE=""
  touch "$CONTENT_RELEASES/.protected/$content_version"
  MIGRATION_CONTENT_RELEASE="$release"
}

validate_runtime_config() {
  "$NODE_BIN" - "$RUNTIME_DIR/app.env" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const values = new Map();
for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const index = line.indexOf("=");
  if (index <= 0) continue;
  const name = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  values.set(name, value);
}
if (!values.get("ACCESS_PASSWORD")) throw new Error("ACCESS_PASSWORD is missing from app.env");
if ((values.get("ACCESS_SESSION_SECRET") || "").length < 32) {
  throw new Error("ACCESS_SESSION_SECRET must contain at least 32 characters");
}
NODE
}

assert_initial_source_tree() {
  local candidate="$1"
  local forbidden environment_file

  for forbidden in \
    data public/digest-images .agents .claude .codex .memory .logs .work .znt-build-home AGENTS.md .git .npmrc \
    node_modules .next .vercel; do
    [[ ! -e "$candidate/$forbidden" ]] || znt_fail "source checkout contains forbidden path: $forbidden"
  done

  while IFS= read -r environment_file; do
    [[ "$environment_file" = "$candidate/.env.example" && -f "$environment_file" && ! -L "$environment_file" ]] \
      || znt_fail "source checkout contains forbidden environment file: ${environment_file#$candidate/}"
  done < <(find -P "$candidate" -xdev -name '.env*' -print)

  if find -P "$candidate" -xdev -type l -print -quit | grep -q .; then
    znt_fail "source checkout contains symbolic links"
  fi
  if find -P "$candidate" -xdev -type f \( -name '*.pem' -o -name '*.key' -o -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.ods' -o -name '*.log' \) -print -quit | grep -q .; then
    znt_fail "source checkout contains a secret or database file"
  fi
  if find -P "$candidate" -xdev ! -type d ! -type f -print -quit | grep -q .; then
    znt_fail "source checkout contains an unsupported filesystem entry"
  fi
  [[ -f "$candidate/package.json" && -f "$candidate/package-lock.json" ]] \
    || znt_fail "source checkout is missing package metadata"
  znt_assert_source_tree_budget "$candidate"
}

validate_migration_request() {
  [[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || znt_fail "migrate requires a valid --source-sha"
}

build_initial_code() {
  local code_sha="$1"
  local snapshot="$2"
  local fetch_workspace build_candidate isolated_candidate
  local candidate=""
  local release="$RELEASES/$code_sha"

  [[ ! -e "$release" ]] || znt_fail "migration code release already exists"
  fetch_workspace="$(mktemp -d "$BUILD_ROOT/.migration-fetch-$code_sha.XXXXXX")"
  MIGRATION_FETCH_WORKSPACE="$fetch_workspace"
  chown zntdeploy:zntdeploy "$fetch_workspace"
  chmod 0700 "$fetch_workspace"
  znt_clone_verified_public_main "$ROOT" "$fetch_workspace" "$code_sha"
  build_candidate="$fetch_workspace/source"
  isolated_candidate="$(mktemp -d "$BUILD_ISOLATION/.migration-$code_sha.XXXXXX")"
  rmdir "$isolated_candidate"
  mv -- "$build_candidate" "$isolated_candidate"
  build_candidate="$isolated_candidate"
  MIGRATION_BUILD_CANDIDATE="$build_candidate"
  rm -rf -- "$fetch_workspace"
  MIGRATION_FETCH_WORKSPACE=""
  assert_initial_source_tree "$build_candidate"
  install -d -o root -g root -m 0700 "$snapshot/source"
  tar --sort=name --owner=0 --group=0 --numeric-owner -C "$build_candidate" \
    -czf "$snapshot/source/znt-source-$code_sha.tar.gz" .
  chmod 0600 "$snapshot/source/znt-source-$code_sha.tar.gz"
  znt_run_isolated_build "$ROOT" "$build_candidate" download \
    "$NPM_BIN" ci --ignore-scripts --no-audit --no-fund
  znt_run_isolated_build "$ROOT" "$build_candidate" offline \
    "$NPM_BIN" rebuild --offline --no-audit --no-fund
  znt_run_isolated_build "$ROOT" "$build_candidate" offline \
    /usr/bin/env \
      ACCESS_PASSWORD=znt-build-only \
      ACCESS_SESSION_SECRET=znt-build-only-session-secret-with-at-least-32-characters \
      TOKEN_RANK_STORE_PATH="$build_candidate/.znt-build-token-rank.json" \
      BUILD_SHA="$code_sha" \
      "$NPM_BIN" run build
  rm -rf -- "$build_candidate/.znt-build-home"
  znt_require_free_kib "$ROOT"
  candidate="$(mktemp -d "$RELEASES/.migration-candidate.XXXXXX")"
  MIGRATION_RELEASE_CANDIDATE="$candidate"
  rsync -a --no-specials --no-devices "$build_candidate/" "$candidate/"
  rm -rf -- "$build_candidate"
  MIGRATION_BUILD_CANDIDATE=""
  rm -f -- "$candidate/.znt-build-token-rank.json"
  chown -hR root:zntapp "$candidate"
  znt_assert_internal_symlinks "$candidate"
  if find -P "$candidate" -xdev ! -type d ! -type f ! -type l -print -quit | grep -q .; then
    znt_fail "migration candidate build created an unsupported filesystem entry"
  fi
  find -P "$candidate" -type d -exec chmod 0750 {} +
  find -P "$candidate" -type f -perm /u+x -exec chmod 0750 {} +
  find -P "$candidate" -type f ! -perm /u+x -exec chmod 0640 {} +
  mv "$candidate" "$release"
  MIGRATION_RELEASE_CANDIDATE=""
  touch "$RELEASES/.protected/$code_sha"
  MIGRATION_CODE_RELEASE="$release"
}

migrate() {
  local legacy="$ROOT/current"
  local timestamp
  local snapshot
  local code_sha
  local content_version
  local legacy_saved
  local old_store="$ROOT/shared/token-rank-store.json"
  local retired_store=""
  local old_store_moved=0
  local previous_unit=""
  local had_unit=0
  local unit_replaced=0
  local switched=0
  local service_stopped=0
  local service_was_active=0
  local shared_existed=0
  local shared_hardened=0
  local legacy_shared_owner=""
  local legacy_shared_mode=""

  znt_require_root
  (( CONFIRMED == 1 )) || znt_fail "migrate requires --confirm-migration"
  validate_migration_request
  [[ -d "$legacy" && ! -L "$legacy" ]] || znt_fail "legacy current must be a real directory; this host may already be migrated"
  [[ ! -e "$CONTENT_ROOT/current" ]] || znt_fail "content current already exists; refuse to overwrite a prior migration"
  [[ ! -e "$ROOT/shared/deploy-state.json" ]] || znt_fail "deploy state already exists; refuse to overwrite a partial migration"
  [[ ! -f "$ROOT/.migration-complete" ]] || znt_fail "migration was already marked complete"
  if [[ -e "$ROOT/shared" ]]; then
    [[ -d "$ROOT/shared" && ! -L "$ROOT/shared" ]] || znt_fail "shared must be a real directory"
    shared_existed=1
    legacy_shared_owner="$(stat -c '%u:%g' "$ROOT/shared")"
    legacy_shared_mode="$(stat -c '%a' "$ROOT/shared")"
  fi
  if systemctl is-active --quiet "$SERVICE"; then
    service_was_active=1
  fi

  prepare
  nginx_preflight
  validate_runtime_config
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  snapshot="$SNAPSHOT_ROOT/$timestamp"
  code_sha="$SOURCE_SHA"
  content_version="migration-$timestamp"
  legacy_saved="$snapshot/legacy-current"

  cleanup_migration() {
    local status=$?
    trap - EXIT
    znt_stop_active_build_unit
    if (( status != 0 )); then
      # Recovery must continue even when one best-effort step fails. The
      # original migration failure remains the process exit status.
      set +e
      if (( switched == 1 || service_stopped == 1 || unit_replaced == 1 )); then
        systemctl stop "$SERVICE" >/dev/null 2>&1 || true
      fi
      if (( switched == 1 )); then
        rm -f -- "$ROOT/.migration-complete" "$ROOT/shared/deploy-state.json"
        [[ ! -L "$ROOT/current" ]] || rm -f -- "$ROOT/current"
        [[ ! -e "$ROOT/current" && -d "$legacy_saved" ]] && mv "$legacy_saved" "$ROOT/current"
        [[ ! -L "$CONTENT_ROOT/current" ]] || rm -f -- "$CONTENT_ROOT/current"
      fi
      if (( old_store_moved == 1 )) && [[ ! -e "$old_store" && -n "$retired_store" && -f "$retired_store" ]]; then
        mv "$retired_store" "$old_store"
      fi
      if (( shared_hardened == 1 && shared_existed == 1 )); then
        chown "$legacy_shared_owner" "$ROOT/shared" || true
        chmod "$legacy_shared_mode" "$ROOT/shared" || true
      fi
      if (( unit_replaced == 1 )); then
        if (( had_unit == 1 )); then
          install -o root -g root -m 0644 "$previous_unit" "/etc/systemd/system/$SERVICE"
        elif [[ -e "/etc/systemd/system/$SERVICE" ]]; then
          rm -f -- "/etc/systemd/system/$SERVICE"
        fi
        systemctl daemon-reload || true
      fi
      if [[ -n "$MIGRATION_CODE_RELEASE" && -d "$MIGRATION_CODE_RELEASE" ]]; then
        rm -rf -- "$MIGRATION_CODE_RELEASE"
        rm -f -- "$RELEASES/.protected/$code_sha"
      fi
      if [[ -n "$MIGRATION_CONTENT_RELEASE" && -d "$MIGRATION_CONTENT_RELEASE" ]]; then
        rm -rf -- "$MIGRATION_CONTENT_RELEASE"
        rm -f -- "$CONTENT_RELEASES/.protected/$content_version"
      fi
      [[ -z "$MIGRATION_BUILD_CANDIDATE" || ! -e "$MIGRATION_BUILD_CANDIDATE" ]] \
        || rm -rf -- "$MIGRATION_BUILD_CANDIDATE"
      [[ -z "$MIGRATION_FETCH_WORKSPACE" || ! -e "$MIGRATION_FETCH_WORKSPACE" ]] \
        || rm -rf -- "$MIGRATION_FETCH_WORKSPACE"
      [[ -z "$MIGRATION_MAIN_CHECK_WORKSPACE" || ! -e "$MIGRATION_MAIN_CHECK_WORKSPACE" ]] \
        || rm -rf -- "$MIGRATION_MAIN_CHECK_WORKSPACE"
      [[ -z "$MIGRATION_RELEASE_CANDIDATE" || ! -e "$MIGRATION_RELEASE_CANDIDATE" ]] \
        || rm -rf -- "$MIGRATION_RELEASE_CANDIDATE"
      [[ -z "$MIGRATION_CONTENT_STAGE" || ! -e "$MIGRATION_CONTENT_STAGE" ]] \
        || rm -rf -- "$MIGRATION_CONTENT_STAGE"
      if (( service_was_active == 1 )) && (( switched == 1 || service_stopped == 1 || unit_replaced == 1 )); then
        systemctl start "$SERVICE" >/dev/null 2>&1 \
          || echo "znt-deploy: warning: failed to restart the legacy service during recovery" >&2
      fi
    fi
    znt_lock_release || true
    exit "$status"
  }
  trap cleanup_migration EXIT

  install -d -o root -g root -m 0700 "$snapshot"
  if [[ -f "/etc/systemd/system/$SERVICE" ]]; then
    had_unit=1
    install -d -o root -g root -m 0700 "$snapshot/systemd"
    install -o root -g root -m 0600 "/etc/systemd/system/$SERVICE" "$snapshot/systemd/$SERVICE"
    previous_unit="$snapshot/systemd/$SERVICE"
  fi

  znt_lock_acquire "$ROOT" migration
  znt_cleanup_stale_build_units
  # Daily publishing is paused for the maintenance window, so these immutable
  # candidates can be prepared while the legacy app continues serving traffic.
  copy_legacy_content "$legacy" "$content_version" "$code_sha"
  build_initial_code "$code_sha" "$snapshot"
  snapshot_goatcounter "$snapshot"
  snapshot_shared_tree "$snapshot/shared"
  touch "$snapshot/.migration-snapshot"
  znt_require_free_kib "$ROOT"

  # Refuse a stale migration candidate if main advanced during the build or
  # snapshot preparation.
  MIGRATION_MAIN_CHECK_WORKSPACE="$(mktemp -d "$BUILD_ROOT/.migration-main-check-$code_sha.XXXXXX")"
  chown zntdeploy:zntdeploy "$MIGRATION_MAIN_CHECK_WORKSPACE"
  chmod 0700 "$MIGRATION_MAIN_CHECK_WORKSPACE"
  znt_assert_public_main "$ROOT" "$MIGRATION_MAIN_CHECK_WORKSPACE" "$code_sha"
  rm -rf -- "$MIGRATION_MAIN_CHECK_WORKSPACE"
  MIGRATION_MAIN_CHECK_WORKSPACE=""

  systemctl stop "$SERVICE"
  service_stopped=1
  # Only a small incremental shared-data sync remains in the downtime window.
  # The legacy current tree itself is moved atomically into this snapshot.
  snapshot_shared_tree "$snapshot/shared"
  shared_hardened=1
  harden_shared_layout

  if [[ -e "$old_store" ]]; then
    [[ -f "$old_store" && ! -L "$old_store" ]] || znt_fail "legacy Token Rank store is not a regular file"
    install -o zntapp -g zntapp -m 0600 "$old_store" "$STORE_PATH"
  fi
  [[ -e "$STORE_PATH" ]] || write_empty_store
  chown zntapp:zntapp "$STORE_PATH"
  chmod 0600 "$STORE_PATH"
  validate_store

  unit_replaced=1
  install_service_unit

  mv "$legacy" "$legacy_saved"
  switched=1
  znt_switch_link "$RELEASES/$code_sha" "$ROOT/current"
  znt_switch_link "$CONTENT_RELEASES/$content_version" "$CONTENT_ROOT/current"
  znt_start_and_check "$SERVICE" "$code_sha" || znt_fail "migration health check failed"
  service_stopped=0
  if [[ -f "$old_store" ]]; then
    retired_store="$snapshot/retired-token-rank-store.json"
    mv "$old_store" "$retired_store"
    old_store_moved=1
  fi
  znt_write_state "$ROOT/shared/deploy-state.json" "$code_sha" "$RELEASES/$code_sha" \
    "$content_version" "$CONTENT_RELEASES/$content_version" "" "" "" ""
  touch "$ROOT/.migration-complete"
  znt_lock_release
  echo "migration complete: code=$code_sha content=$content_version snapshot=$snapshot"
}
case "$COMMAND" in
  prepare)
    prepare
    ;;
  migrate)
    migrate
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    znt_fail "unknown command: $COMMAND"
    ;;
esac
